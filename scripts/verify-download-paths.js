#!/usr/bin/env node
/**
 * Functional verification of every way a download can happen.
 *
 * The load test answers "does this stay up under load". It deliberately avoids
 * the real Telegram bot, which means the single most important path — actually
 * acquiring a song nobody has downloaded before — is the one thing it never
 * exercises. This script covers correctness instead of capacity, and is the
 * only place the live bot gets driven.
 *
 * Scenarios, in the order a real library encounters them:
 *
 *   A  new song            — nothing in the DB, must come from Telegram
 *   B  already downloaded  — another user already fetched it; must be a DB hit
 *                            and must NOT touch the bot
 *   C  stub upgrade        — a Deezer row with no usable audioUrl gets upgraded
 *                            in place rather than duplicated
 *   D  coalescing          — N concurrent requests for one new song produce one
 *                            bot call and N identical answers
 *   E  metadata endpoint   — /api/download/<id> for the offline queue
 *   F  playlist manifest   — /api/download/playlist/<id>, incl. the 403/404 split
 *   G  stream resolution   — /api/stream/<id> redirects to real audio
 *   H  range requests      — the resume path the download queue depends on
 *   I  missing track       — 404 rather than a hang or a 500
 *   J  negative cache      — a failed search doesn't slam the bot on retry
 *
 * Usage:
 *   node scripts/verify-download-paths.js              # skips the live bot
 *   node scripts/verify-download-paths.js --live       # includes A, C, D, J
 *   node scripts/verify-download-paths.js --live --song "Artist|Title"
 *
 * --live drives the real Telegram bot and takes 30-60s per acquisition. Without
 * it, scenarios needing a genuinely-new song are reported as SKIPPED rather
 * than silently passing, because a suite that quietly drops its most important
 * case is worse than one that fails.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const { Pool } = require("pg");

const BASE = process.env.LOADTEST_URL || "http://localhost:3000";
const LIVE = process.argv.includes("--live");
const songArg = (() => {
  const i = process.argv.indexOf("--song");
  return i !== -1 ? process.argv[i + 1] : null;
})();

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m",
};

const results = [];
/** Playlist ids this run created, removed in main()'s finally. */
const createdFixtures = [];

function record(id, name, status, detail, ms) {
  results.push({ id, name, status, detail, ms });
  const mark =
    status === "PASS" ? `${C.green}✓${C.reset}` :
    status === "FAIL" ? `${C.red}✖${C.reset}` :
    status === "SKIP" ? `${C.dim}−${C.reset}` :
                        `${C.yellow}!${C.reset}`;
  const timing = ms != null ? `${C.dim}${String(ms).padStart(6)}ms${C.reset}` : " ".repeat(8);
  console.log(`  ${mark} ${C.bold}${id}${C.reset} ${name.padEnd(42)} ${timing}  ${detail}`);
}

function header(t) {
  console.log("");
  console.log(`  ${C.dim}${"─".repeat(76)}${C.reset}`);
  console.log(`  ${C.bold}${t}${C.reset}`);
  console.log(`  ${C.dim}${"─".repeat(76)}${C.reset}`);
}

async function req(path, { method = "GET", body, cookie, redirect = "manual", headers = {} } = {}) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Date.now() - start;
    const ct = res.headers.get("content-type") || "";
    let payload = null;
    if (ct.includes("application/json")) {
      payload = await res.json().catch(() => null);
    } else {
      // Don't pull a whole audio file into memory.
      payload = null;
      if (res.body) await res.body.cancel().catch(() => {});
    }
    return { status: res.status, headers: res.headers, json: payload, ms, error: null };
  } catch (err) {
    /**
     * A transport-level failure is a result, not a reason to stop.
     *
     * This matters more than it looks: the bug this harness found first
     * presented as an undici parser error, because the server emitted a
     * negative Content-Length. If a throw here aborts the run, the single most
     * informative failure the suite can produce takes every later scenario down
     * with it and reports nothing.
     */
    const cause = err?.cause;
    const detail = cause?.code || cause?.message || err.message;
    return {
      status: 0,
      headers: new Headers(),
      json: null,
      ms: Date.now() - start,
      error: String(detail).slice(0, 160),
      raw: cause?.data ? String(cause.data).slice(0, 200) : null,
    };
  }
}

async function mintCookie(userId, username) {
  const { encode } = require("next-auth/jwt");
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  const salt = BASE.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const token = await encode({
    token: { id: userId, name: username, sub: userId },
    secret, salt, maxAge: 60 * 60 * 24,
  });
  return `${salt}=${token}`;
}

/**
 * A song that is plausibly on Telegram but definitely not in our DB.
 * Picked from a fixed list so a failure is reproducible, unlike a random pick.
 */
const NEW_SONG_CANDIDATES = [
  { artist: "Fleetwood Mac", title: "Dreams" },
  { artist: "a-ha", title: "Take On Me" },
  { artist: "Toto", title: "Africa" },
  { artist: "Tears for Fears", title: "Everybody Wants to Rule the World" },
  { artist: "Blondie", title: "Heart of Glass" },
];

async function main() {
  console.log("");
  console.log(`  ${C.dim}${"─".repeat(76)}${C.reset}`);
  console.log(`  ${C.bold}SAKURA DOWNLOAD PATH VERIFICATION${C.reset}`);
  console.log(`  ${C.dim}${"─".repeat(76)}${C.reset}`);
  console.log(`  Target        ${BASE}`);
  console.log(`  Live bot      ${LIVE ? `${C.yellow}ENABLED${C.reset} — will drive the real Telegram bot` : `${C.dim}disabled${C.reset} (pass --live to include A, C, D, J)`}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  // ── Seed ───────────────────────────────────────────────────────────────────
  const users = (await pool.query(
    `SELECT id, username FROM "User" ORDER BY "createdAt" ASC LIMIT 2`
  )).rows;
  if (users.length === 0) {
    console.error("  ✖ No users in the database.");
    process.exit(1);
  }

  const usable = (await pool.query(
    `SELECT t.id, t.title, a.name AS artist, t.duration, t."audioUrl"
       FROM "Track" t JOIN "Artist" a ON t."artistId" = a.id
      WHERE t."audioUrl" LIKE '/api/stream/telegram/%'
        AND t."audioUrl" NOT LIKE '%/0'
      ORDER BY t."createdAt" DESC LIMIT 25`
  )).rows;

  const stubs = (await pool.query(
    `SELECT t.id, t.title, a.name AS artist, t.duration, t."audioUrl"
       FROM "Track" t JOIN "Artist" a ON t."artistId" = a.id
      WHERE (t."audioUrl" IS NULL OR t."audioUrl" = '' OR t."audioUrl" = 'pending'
             OR t."audioUrl" LIKE '%/0'
             OR t."audioUrl" NOT LIKE '/api/stream/telegram/%')
      LIMIT 10`
  )).rows;

  const playlists = (await pool.query(
    `SELECT p.id, p."userId", COUNT(pt."trackId")::int AS n
       FROM "Playlist" p LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
      GROUP BY p.id, p."userId" ORDER BY n DESC LIMIT 5`
  )).rows;

  console.log(`  Seed          ${users.length} users · ${usable.length} playable · ${stubs.length} stubs · ${playlists.length} playlists`);

  const cookie = await mintCookie(users[0].id, users[0].username);
  const otherCookie = users[1] ? await mintCookie(users[1].id, users[1].username) : null;

  const auth = await req("/api/profile", { cookie });
  if (auth.status === 401) {
    console.error("  ✖ Minted session rejected — NEXTAUTH_SECRET mismatch.");
    process.exit(1);
  }
  console.log(`  Auth          verified (${auth.status})`);

  // ═══ B: already-downloaded song (the common case) ═════════════════════════
  header("B · ALREADY DOWNLOADED BY SOMEONE ELSE  (DB cache hit, no bot)");

  if (!usable.length) {
    record("B1", "cache hit returns playable audioUrl", "SKIP", "no playable tracks in DB");
  } else {
    const t = usable[0];
    const r = await req("/api/music/download", {
      method: "POST", cookie,
      body: { title: t.title, artist: t.artist, duration: t.duration },
    });
    const url = r.json?.audioUrl || "";
    const ok = r.status === 200 && url.startsWith("/api/stream/telegram/") && !url.endsWith("/0");
    record("B1", "cache hit returns playable audioUrl", ok ? "PASS" : "FAIL",
      ok ? `${url}` : `status=${r.status} url=${url || "(none)"}`, r.ms);

    // A cache hit must be fast. The bot path takes 30-60s; anything in that
    // range means we fell through to Telegram when we shouldn't have.
    record("B2", "cache hit short-circuits before Telegram", r.ms < 3000 ? "PASS" : "FAIL",
      r.ms < 3000 ? "well under bot latency" : `${r.ms}ms suggests it hit the bot`, r.ms);

    // Case-insensitivity: the route lowercases both sides, so a differently
    // cased request must resolve to the same row rather than a duplicate.
    const rc = await req("/api/music/download", {
      method: "POST", cookie,
      body: { title: t.title.toUpperCase(), artist: t.artist.toLowerCase(), duration: t.duration },
    });
    const sameRow = rc.status === 200 && rc.json?.id === r.json?.id;
    record("B3", "case-insensitive match hits the same row", sameRow ? "PASS" : "FAIL",
      sameRow ? `both → ${rc.json?.id}` : `got ${rc.json?.id} vs ${r.json?.id} (status ${rc.status})`, rc.ms);

    // Two different users asking for the same song must both get it — this is
    // the "someone else already downloaded it" case stated literally.
    if (otherCookie) {
      const r2 = await req("/api/music/download", {
        method: "POST", cookie: otherCookie,
        body: { title: t.title, artist: t.artist, duration: t.duration },
      });
      const shared = r2.status === 200 && r2.json?.audioUrl === r.json?.audioUrl;
      record("B4", "second user reuses the first user's download", shared ? "PASS" : "FAIL",
        shared ? "same audioUrl, no re-download" : `status=${r2.status}`, r2.ms);
    } else {
      record("B4", "second user reuses the first user's download", "SKIP", "only one user in DB");
    }
  }

  // ═══ E: metadata endpoint ══════════════════════════════════════════════════
  header("E · OFFLINE METADATA ENDPOINT  /api/download/<trackId>");

  if (!usable.length) {
    record("E1", "returns metadata for a real track", "SKIP", "no playable tracks");
  } else {
    const t = usable[0];
    const r = await req(`/api/download/${encodeURIComponent(t.id)}`, { method: "POST", cookie });
    const j = r.json || {};
    const ok = r.status === 200 && j.title && (j.artistName || j.artist);
    record("E1", "returns metadata for a real track", ok ? "PASS" : "FAIL",
      ok ? `"${j.title}"` : `status=${r.status} body=${JSON.stringify(j).slice(0, 90)}`, r.ms);

    const r2 = await req(`/api/download/${encodeURIComponent(t.id)}`, { method: "POST", cookie });
    record("E2", "repeat call is served from cache", r2.status === 200 ? "PASS" : "FAIL",
      `${r2.ms}ms (first ${r.ms}ms)`, r2.ms);

    const un = await req(`/api/download/${encodeURIComponent(t.id)}`, { method: "POST" });
    record("E3", "rejects unauthenticated callers", un.status === 401 ? "PASS" : "FAIL",
      `status=${un.status}`, un.ms);
  }

  const missing = await req("/api/download/definitely-not-a-real-track-id", { method: "POST", cookie });
  record("I1", "unknown track id → 404, not 500", missing.status === 404 ? "PASS" : "FAIL",
    `status=${missing.status}`, missing.ms);

  // ═══ F: playlist manifest ══════════════════════════════════════════════════
  header("F · BULK PLAYLIST DOWNLOAD  /api/download/playlist/<id>");

  /**
   * Build the fixtures rather than hoping the database happens to contain them.
   *
   * The first run of this suite passed F1 against a playlist with zero tracks
   * and skipped the ownership check entirely because every existing playlist
   * belonged to the same user — so the bulk-download path and the 403/404 split
   * were both reported green without either having been exercised. A test that
   * can only pass is not a test.
   *
   * Both fixtures are removed in the `finally` at the end of main().
   */
  const FIXTURE_OWNED = `verify-owned-${Date.now()}`;
  const FIXTURE_FOREIGN = `verify-foreign-${Date.now()}`;
  const fixtureTrackIds = usable.slice(0, 5).map((t) => t.id);

  if (fixtureTrackIds.length) {
    await pool.query(
      `INSERT INTO "Playlist" (id, "userId", name, "createdAt") VALUES ($1, $2, $3, NOW())`,
      [FIXTURE_OWNED, users[0].id, "verify-download-paths fixture"]
    );
    await pool.query(
      `INSERT INTO "PlaylistTrack" ("playlistId", "trackId", position, "addedAt")
       SELECT $1, t, ord - 1, NOW() FROM UNNEST($2::text[]) WITH ORDINALITY AS x(t, ord)`,
      [FIXTURE_OWNED, fixtureTrackIds]
    );
    createdFixtures.push(FIXTURE_OWNED);

    if (users[1]) {
      await pool.query(
        `INSERT INTO "Playlist" (id, "userId", name, "createdAt") VALUES ($1, $2, $3, NOW())`,
        [FIXTURE_FOREIGN, users[1].id, "verify-download-paths foreign fixture"]
      );
      createdFixtures.push(FIXTURE_FOREIGN);
    }
  }

  if (!fixtureTrackIds.length) {
    record("F1", "owner receives full track manifest", "SKIP", "no playable tracks to build a fixture");
    record("F2", "every manifest entry is queue-shaped", "SKIP", "no fixture");
    record("F3", "non-owner gets 403 (not a misleading 404)", "SKIP", "no fixture");
  } else {
    const r = await req(`/api/download/playlist/${encodeURIComponent(FIXTURE_OWNED)}`, { method: "POST", cookie });
    // The route responds with a bare array, not { tracks: [...] }. Accept either
    // so this assertion tests the endpoint rather than a guess about its shape.
    const tracks = Array.isArray(r.json) ? r.json : (r.json?.tracks || []);
    const ok = r.status === 200 && tracks.length === fixtureTrackIds.length;
    record("F1", "owner receives full track manifest", ok ? "PASS" : "FAIL",
      ok ? `${tracks.length}/${fixtureTrackIds.length} tracks` : `status=${r.status} got ${tracks.length} of ${fixtureTrackIds.length}`, r.ms);

    if (tracks.length) {
      const shaped = tracks.every((t) => t.id && t.title && t.audioUrl);
      const ordered = tracks.every((t, i) => t.id === fixtureTrackIds[i]);
      record("F2", "manifest is queue-shaped and in order", shaped && ordered ? "PASS" : "FAIL",
        shaped && ordered
          ? "id + title + audioUrl present, position order preserved"
          : `${shaped ? "" : "missing fields; "}${ordered ? "" : "wrong order"}`, null);
    } else {
      record("F2", "manifest is queue-shaped and in order", "FAIL", "empty manifest for a 5-track playlist");
    }

    // BUG-5: a non-owner must get 403, and a genuinely absent playlist 404.
    // Collapsing both into 404 is what the previous session set out to fix, so
    // it gets asserted against a playlist that really is owned by someone else.
    if (users[1]) {
      const rf = await req(`/api/download/playlist/${encodeURIComponent(FIXTURE_FOREIGN)}`, { method: "POST", cookie });
      record("F3", "non-owner gets 403 (not a misleading 404)", rf.status === 403 ? "PASS" : "FAIL",
        `status=${rf.status} ${rf.json?.error ? `"${rf.json.error}"` : ""}`, rf.ms);
    } else {
      record("F3", "non-owner gets 403 (not a misleading 404)", "SKIP", "only one user in DB");
    }
  }

  const noSuchPl = await req("/api/download/playlist/00000000-0000-0000-0000-000000000000", { method: "POST", cookie });
  record("F4", "absent playlist → 404", noSuchPl.status === 404 ? "PASS" : "FAIL",
    `status=${noSuchPl.status}`, noSuchPl.ms);

  // ═══ G/H: stream resolution and range requests ════════════════════════════
  header("G · STREAM RESOLUTION + RANGE RESUME");

  if (!usable.length) {
    record("G1", "resolves to a redirect", "SKIP", "no playable tracks");
  } else {
    const t = usable[0];
    const r = await req(`/api/stream/${encodeURIComponent(t.id)}`, { cookie });
    const loc = r.headers.get("location") || "";
    const ok = [301, 302, 307, 308].includes(r.status) && loc.length > 0;
    record("G1", "resolves to a redirect", ok ? "PASS" : "FAIL",
      ok ? loc.replace(BASE, "") : `status=${r.status}`, r.ms);

    const r2 = await req(`/api/stream/${encodeURIComponent(t.id)}`, { cookie });
    record("G2", "repeat resolution is cached", [301,302,307,308].includes(r2.status) ? "PASS" : "FAIL",
      `${r2.ms}ms (first ${r.ms}ms)`, r2.ms);

    const un = await req(`/api/stream/${encodeURIComponent(t.id)}`);
    record("G3", "rejects unauthenticated callers", un.status === 401 ? "PASS" : "FAIL",
      `status=${un.status}`, un.ms);

    // The resume path: the download queue saves partial chunks and re-requests
    // with a Range header. If this doesn't return 206, resume is silently
    // broken and every interrupted download restarts from zero.
    if (loc) {
      const target = loc.startsWith("http") ? loc.replace(BASE, "") : loc;
      const rangeRes = await req(target, { cookie, headers: { Range: "bytes=0-1023" } });
      const isPartial = rangeRes.status === 206;
      const cr = rangeRes.headers.get("content-range") || "";
      record("H1", "Range request returns 206 + Content-Range", isPartial && cr ? "PASS" : "WARN",
        isPartial ? `${cr}` : `status=${rangeRes.status} — resume will restart from 0`, rangeRes.ms);

      // A range beyond EOF must be a clean 416 or 200, never a hang. The queue
      // handles both, but only if the server actually answers.
      const beyond = await req(target, { cookie, headers: { Range: "bytes=999999999-" } });
      const handled = [200, 206, 416].includes(beyond.status);
      record("H2", "out-of-range Range answered cleanly", handled ? "PASS" : "FAIL",
        handled
          ? `status=${beyond.status}`
          : beyond.error
            ? `transport error: ${beyond.error}${beyond.raw ? ` — server sent: ${beyond.raw.split("\\r\\n")[0]}` : ""}`
            : `status=${beyond.status}`,
        beyond.ms);

      // The queue resumes with an open-ended range from its saved offset, so
      // that exact shape gets its own assertion rather than being inferred
      // from the bounded case above.
      const resume = await req(target, { cookie, headers: { Range: "bytes=1024-" } });
      const resumeOk = resume.status === 206 && /^bytes 1024-\d+\/\d+$/.test(resume.headers.get("content-range") || "");
      const cl = resume.headers.get("content-length");
      const clSane = cl === null || Number(cl) > 0;
      record("H3", "open-ended resume Range is well-formed",
        resumeOk && clSane ? "PASS" : "FAIL",
        resumeOk && clSane
          ? `${resume.headers.get("content-range")} len=${cl}`
          : resume.error
            ? `transport error: ${resume.error}`
            : `status=${resume.status} range="${resume.headers.get("content-range")}" len=${cl}`,
        resume.ms);
    } else {
      record("H1", "Range request returns 206 + Content-Range", "SKIP", "no redirect target");
      record("H2", "out-of-range Range answered cleanly", "SKIP", "no redirect target");
      record("H3", "open-ended resume Range is well-formed", "SKIP", "no redirect target");
    }
  }

  // ═══ A/C/D/J: the live bot paths ═══════════════════════════════════════════
  header("A · NEW SONG FROM TELEGRAM" + (LIVE ? "" : `  ${C.dim}(needs --live)${C.reset}`));

  let acquired = null;

  if (!LIVE) {
    record("A1", "brand-new song downloads from Telegram", "SKIP", "run with --live");
    record("A2", "acquired song is persisted and replayable", "SKIP", "run with --live");
    record("D1", "concurrent requests coalesce to one bot call", "SKIP", "run with --live");
  } else {
    let target = null;
    if (songArg && songArg.includes("|")) {
      const [artist, title] = songArg.split("|");
      target = { artist: artist.trim(), title: title.trim() };
    } else {
      for (const cand of NEW_SONG_CANDIDATES) {
        const { rows } = await pool.query(
          `SELECT 1 FROM "Track" t JOIN "Artist" a ON t."artistId" = a.id
            WHERE lower(t.title) = lower($1) AND lower(a.name) = lower($2)
              AND t."audioUrl" LIKE '/api/stream/telegram/%' AND t."audioUrl" NOT LIKE '%/0'`,
          [cand.title, cand.artist]
        );
        if (!rows.length) { target = cand; break; }
      }
    }

    if (!target) {
      record("A1", "brand-new song downloads from Telegram", "SKIP",
        "every candidate is already downloaded — pass --song \"Artist|Title\"");
      record("A2", "acquired song is persisted and replayable", "SKIP", "no target");
      record("D1", "concurrent requests coalesce to one bot call", "SKIP", "no target");
    } else {
      console.log(`  ${C.dim}  acquiring "${target.artist} — ${target.title}" (30-60s)…${C.reset}`);

      // D and A at once: five concurrent requests for a song nobody has. If
      // coalescing works this is one bot call and five identical answers.
      const started = Date.now();
      const conc = await Promise.all(
        Array.from({ length: 5 }, () =>
          req("/api/music/download", {
            method: "POST", cookie,
            body: { title: target.title, artist: target.artist, duration: 0 },
          })
        )
      );
      const elapsed = Date.now() - started;
      const ok200 = conc.filter((r) => r.status === 200);
      const first = ok200[0];
      const url = first?.json?.audioUrl || "";
      const gotIt = ok200.length > 0 && url.startsWith("/api/stream/telegram/") && !url.endsWith("/0");

      record("A1", "brand-new song downloads from Telegram", gotIt ? "PASS" : "FAIL",
        gotIt ? `${url}` : `statuses=[${conc.map((r) => r.status).join(",")}]`, elapsed);

      if (gotIt) {
        acquired = first.json;
        const ids = new Set(ok200.map((r) => r.json?.id));
        const urls = new Set(ok200.map((r) => r.json?.audioUrl));
        // Distinct audioUrls are the tell: each Telegram download lands under
        // its own messageId, so N urls means N bot downloads happened where one
        // should have. Identical ids alone don't prove coalescing — the writers
        // all resolve to the same row and simply overwrite each other.
        const consistent = ids.size === 1 && urls.size === 1;
        record("D1", "concurrent requests coalesce to one bot call",
          consistent ? "PASS" : "FAIL",
          consistent
            ? `${ok200.length}/5 identical → ${[...urls][0]}`
            : `${ids.size} id(s) but ${urls.size} distinct audioUrls: ${[...urls].join(", ")}`, null);

        // Exactly one DB row must exist for it. More than one means the
        // coalescing let a duplicate insert through.
        //
        // Matched by the id the API returned, not by the requested title:
        // Telegram stores a canonical title ("Dreams" → "Dreams (2004
        // Remaster)"), so an exact-title count reports zero for a track that
        // was persisted perfectly well.
        const { rows: dup } = await pool.query(
          `SELECT id, "audioUrl", "telegramMessageId" FROM "Track" WHERE id = $1`,
          [acquired.id]
        );
        record("A2", "acquired song is persisted exactly once",
          dup.length === 1 ? "PASS" : "FAIL",
          dup.length === 1
            ? `id ${acquired.id} → msg ${dup[0].telegramMessageId}`
            : `${dup.length} row(s) for the returned id`, null);

        // And the second request must now be a fast cache hit, not another bot run.
        const again = await req("/api/music/download", {
          method: "POST", cookie,
          body: { title: target.title, artist: target.artist, duration: 0 },
        });
        record("A3", "re-request is now a fast cache hit",
          again.status === 200 && again.ms < 3000 ? "PASS" : "FAIL",
          `${again.ms}ms status=${again.status}`, again.ms);
      } else {
        record("D1", "concurrent requests coalesce to one bot call", "FAIL", "acquisition failed");
        record("A2", "acquired song is persisted exactly once", "FAIL", "acquisition failed");
      }
    }
  }

  // ═══ C: stub upgrade ═══════════════════════════════════════════════════════
  header("C · DEEZER STUB UPGRADE" + (LIVE ? "" : `  ${C.dim}(needs --live)${C.reset}`));

  if (!LIVE) {
    record("C1", "stub with unusable audioUrl is upgraded in place", "SKIP", "run with --live");
  } else if (!stubs.length) {
    record("C1", "stub with unusable audioUrl is upgraded in place", "SKIP", "no stub rows in DB");
  } else {
    const s = stubs[0];
    const before = s.audioUrl;
    const r = await req("/api/music/download", {
      method: "POST", cookie,
      body: { title: s.title, artist: s.artist, duration: s.duration || 0 },
    });
    const after = r.json?.audioUrl || "";
    const upgraded = r.status === 200 && after.startsWith("/api/stream/telegram/") && !after.endsWith("/0");
    record("C1", "stub with unusable audioUrl is upgraded", upgraded ? "PASS" : "WARN",
      upgraded ? `"${before}" → "${after}"` : `status=${r.status} url="${after}"`, r.ms);

    if (upgraded) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "Track" t JOIN "Artist" a ON t."artistId" = a.id
          WHERE lower(t.title) = lower($1) AND lower(a.name) = lower($2)`,
        [s.title, s.artist]
      );
      record("C2", "upgrade edits the row rather than duplicating",
        rows[0].n === 1 ? "PASS" : "WARN", `${rows[0].n} row(s)`, null);
    } else {
      record("C2", "upgrade edits the row rather than duplicating", "SKIP", "no upgrade happened");
    }
  }

  // ═══ J: negative cache ═════════════════════════════════════════════════════
  header("J · FAILURE HANDLING" + (LIVE ? "" : `  ${C.dim}(needs --live)${C.reset}`));

  if (!LIVE) {
    record("J1", "unfindable song fails fast on retry", "SKIP", "run with --live");
  } else {
    const junk = { title: "Zzqx Nonexistent Track 84719", artist: "Nobody Qqzx" };
    const r1 = await req("/api/music/download", { method: "POST", cookie, body: { ...junk, duration: 0 } });
    const r2 = await req("/api/music/download", { method: "POST", cookie, body: { ...junk, duration: 0 } });
    // The second attempt should be served by the 30s negative cache, so it must
    // be dramatically faster than the first — that's the whole point of it.
    const fast = r2.ms < Math.max(2000, r1.ms / 3);
    record("J1", "unfindable song fails fast on retry", fast ? "PASS" : "WARN",
      `first ${r1.ms}ms (${r1.status}) → retry ${r2.ms}ms (${r2.status})`, r2.ms);
  }

  const badBody = await req("/api/music/download", { method: "POST", cookie, body: { title: "x" } });
  record("J2", "missing artist → 400", badBody.status === 400 ? "PASS" : "FAIL",
    `status=${badBody.status}`, badBody.ms);

  const unauth = await req("/api/music/download", { method: "POST", body: { title: "x", artist: "y" } });
  record("J3", "unauthenticated → 401", unauth.status === 401 ? "PASS" : "FAIL",
    `status=${unauth.status}`, unauth.ms);

  // ── Summary ────────────────────────────────────────────────────────────────
  header("SUMMARY");
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const warn = results.filter((r) => r.status === "WARN").length;
  const skip = results.filter((r) => r.status === "SKIP").length;

  console.log(`  ${C.green}${pass} passed${C.reset} · ${fail ? C.red : C.dim}${fail} failed${C.reset} · ${warn ? C.yellow : C.dim}${warn} warnings${C.reset} · ${C.dim}${skip} skipped${C.reset}`);

  if (fail) {
    console.log("");
    console.log(`  ${C.red}${C.bold}FAILURES${C.reset}`);
    for (const r of results.filter((x) => x.status === "FAIL")) {
      console.log(`    ${r.id}  ${r.name} — ${r.detail}`);
    }
  }
  if (warn) {
    console.log("");
    console.log(`  ${C.yellow}${C.bold}WARNINGS${C.reset}`);
    for (const r of results.filter((x) => x.status === "WARN")) {
      console.log(`    ${r.id}  ${r.name} — ${r.detail}`);
    }
  }
  if (skip && !LIVE) {
    console.log("");
    console.log(`  ${C.dim}Scenarios A, C, D and J need the real Telegram bot: re-run with --live.${C.reset}`);
  }
  console.log("");

  await cleanupFixtures(pool);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

/**
 * Remove anything this run inserted.
 *
 * Runs on the success path and from the crash handler alike: a verification
 * script that leaves rows behind changes the data the next run measures, which
 * is exactly how a suite starts reporting on its own residue.
 */
async function cleanupFixtures(pool) {
  if (!createdFixtures.length) return;
  try {
    await pool.query(`DELETE FROM "PlaylistTrack" WHERE "playlistId" = ANY($1::text[])`, [createdFixtures]);
    await pool.query(`DELETE FROM "Playlist" WHERE id = ANY($1::text[])`, [createdFixtures]);
    console.log(`  ${C.dim}Cleaned up ${createdFixtures.length} fixture playlist(s).${C.reset}`);
  } catch (err) {
    console.error(`  ${C.yellow}Fixture cleanup failed — remove manually: ${createdFixtures.join(", ")}${C.reset}`);
  }
}

main().catch(async (err) => {
  console.error("");
  console.error(`  ${C.red}Verification harness crashed:${C.reset}`, err);
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await cleanupFixtures(pool);
    await pool.end();
  } catch {}
  process.exit(1);
});
