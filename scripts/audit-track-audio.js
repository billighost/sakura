/**
 * Audit — and optionally repair — the audio linking on every Track row.
 *
 * The symptom this exists for: the app says a song is downloaded, then plays
 * nothing. `Track.audioUrl` is the only thing the UI consults to decide
 * "downloaded", so any value that isn't actually playable produces exactly that.
 *
 * Three shapes are legitimate:
 *
 *   pending        `audioUrl = 'pending'` — honestly not downloaded. Correct.
 *   telegram-proxy `/api/stream/telegram/<messageId>` — served through our proxy.
 *   cloudinary     `https://res.cloudinary.com/…` — promoted to the CDN.
 *
 * Anything else is a lie, and one shape in particular is common: Deezer
 * *preview* urls (`cdnt-preview.dzcdn.net`). Those are 30-second tokenised clips
 * that expire, so a row carrying one claims to be downloaded, then fails to play
 * once the token dies. There is already a `previewUrl` column for them, which is
 * where they should have gone.
 *
 * `audioUrl` is NOT NULL in the schema, so "not downloaded" is spelled
 * `'pending'` — that's the sentinel the app's own queries already exclude.
 *
 *   node scripts/audit-track-audio.js              # report only
 *   node scripts/audit-track-audio.js --apply      # reset the broken ones
 *   node scripts/audit-track-audio.js --apply --purge-orphans
 *
 * `--purge-orphans` additionally deletes reset rows that nothing references —
 * no favourite, history, playlist entry, snooze, sample or aggregate. A row
 * somebody has interacted with is kept even when its audio is gone, because the
 * reference is worth more than the row is costing.
 *
 * Cloudinary urls are verified with a real HEAD request. Telegram urls are
 * checked structurally (positive integer id, consistent with
 * `telegramMessageId`) — confirming the message still holds a document needs the
 * MTProto client and is out of scope here.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const PURGE = process.argv.includes("--purge-orphans");

/** Kept low: this is someone's CDN account, not a load test. */
const HEAD_CONCURRENCY = 8;
const HEAD_TIMEOUT_MS = 8000;

const ORPHAN_PREDICATE = `
      NOT EXISTS (SELECT 1 FROM "Favorite"         f  WHERE f."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "ListeningHistory" h  WHERE h."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "PlaylistTrack"    pt WHERE pt."trackId"       = t.id)
  AND NOT EXISTS (SELECT 1 FROM "SnoozedTrack"     s  WHERE s."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "SampledTrack"     st WHERE st."trackId"       = t.id
                                                        OR st."sampledTrackId" = t.id)
  AND NOT EXISTS (SELECT 1 FROM "PlayAggregate"    pa WHERE pa."trackId"       = t.id)
`;

function classify(row) {
  const url = (row.audioUrl ?? "").trim();

  if (!url || url === "pending") return { kind: "pending" };

  if (url.startsWith("/api/stream/telegram/")) {
    const raw = url.slice("/api/stream/telegram/".length);
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return { kind: "broken", why: `non-positive telegram message id (${raw || "empty"})` };
    }
    // The column and the url must agree; promoteToCdn and the stream route each
    // trust a different one of the two, so a mismatch breaks one of them.
    if (row.telegramMessageId && String(row.telegramMessageId) !== raw) {
      return {
        kind: "broken",
        why: `url says message ${raw} but column says ${row.telegramMessageId}`,
      };
    }
    return { kind: "telegram" };
  }

  if (/^https:\/\/res\.cloudinary\.com\//i.test(url)) return { kind: "cloudinary" };

  if (/dzcdn\.net/i.test(url)) {
    return { kind: "broken", why: "Deezer preview clip, not a download", preview: url };
  }

  return { kind: "broken", why: `unrecognised audio url (${url.slice(0, 48)}…)` };
}

async function headOk(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    if (!res.ok) return { ok: false, why: `HEAD ${res.status}` };
    const len = Number(res.headers.get("content-length") ?? "0");
    // A promoted track is a whole song; anything tiny is a truncated upload.
    if (len > 0 && len < 100_000) {
      return { ok: false, why: `only ${len} bytes` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e.name === "AbortError" ? "HEAD timed out" : String(e.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded parallel map — enough to be quick, not enough to look like an attack. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  try {
    const { rows } = await pool.query(`
      SELECT t.id, t.title, t."audioUrl", t."telegramMessageId", t."previewUrl",
             a.name AS artist
        FROM "Track" t
        LEFT JOIN "Artist" a ON a.id = t."artistId"
       ORDER BY t."createdAt" DESC
    `);

    console.log(`\n  ${rows.length} tracks\n`);

    const buckets = { pending: [], telegram: [], cloudinary: [], broken: [] };
    const reasons = new Map();

    for (const r of rows) {
      const c = classify(r);
      buckets[c.kind].push(r);
      if (c.kind === "broken") {
        r._why = c.why;
        r._preview = c.preview ?? null;
        reasons.set(c.why, (reasons.get(c.why) ?? 0) + 1);
      }
    }

    // Cloudinary is the only shape we can truly verify from here, so do.
    process.stdout.write(`  verifying ${buckets.cloudinary.length} CDN urls… `);
    const checks = await mapLimit(buckets.cloudinary, HEAD_CONCURRENCY, (r) => headOk(r.audioUrl));
    const cdnDead = [];
    buckets.cloudinary.forEach((r, i) => {
      if (!checks[i].ok) {
        r._why = `CDN url unreachable: ${checks[i].why}`;
        reasons.set("CDN url unreachable", (reasons.get("CDN url unreachable") ?? 0) + 1);
        cdnDead.push(r);
      }
    });
    console.log(`${buckets.cloudinary.length - cdnDead.length} ok, ${cdnDead.length} dead`);

    const cdnOk = buckets.cloudinary.length - cdnDead.length;
    const allBroken = [...buckets.broken, ...cdnDead];

    console.log(`
  playable
    cloudinary (verified)   ${cdnOk}
    telegram proxy          ${buckets.telegram.length}
  not downloaded
    pending                 ${buckets.pending.length}
  BROKEN — claims to be downloaded but is not
    total                   ${allBroken.length}`);

    for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(4)}  ${why}`);
    }

    if (allBroken.length > 0) {
      console.log(`\n  examples:`);
      for (const r of allBroken.slice(0, 12)) {
        console.log(`    ${(r.artist ?? "?").slice(0, 22).padEnd(24)} ${(r.title ?? "").slice(0, 30).padEnd(32)} ${r._why}`);
      }
      if (allBroken.length > 12) console.log(`    … and ${allBroken.length - 12} more`);
    }

    if (allBroken.length === 0) {
      console.log(`\n  Nothing to repair.\n`);
      return;
    }

    if (!APPLY) {
      console.log(`
  Dry run — nothing written. Re-run with --apply to reset these ${allBroken.length} rows
  to 'pending' so the app stops reporting them as downloaded. Add --purge-orphans
  to also delete the ones nothing references.
`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const ids = allBroken.map((r) => r.id);

      /*
       * Preserve the preview rather than discard it: it's a legitimate 30-second
       * clip, it just isn't a download. Only fills the column when it's empty,
       * so a good previewUrl already there wins.
       */
      const withPreview = allBroken.filter((r) => r._preview && !r.previewUrl);
      if (withPreview.length > 0) {
        await client.query(
          `UPDATE "Track" AS t SET "previewUrl" = v.preview
             FROM (SELECT * FROM UNNEST($1::text[], $2::text[]) AS x(id, preview)) AS v
            WHERE t.id = v.id`,
          [withPreview.map((r) => r.id), withPreview.map((r) => r._preview)],
        );
        console.log(`\n  moved ${withPreview.length} preview urls into previewUrl`);
      }

      const reset = await client.query(
        `UPDATE "Track"
            SET "audioUrl" = 'pending',
                "telegramMessageId" = NULL,
                "telegramFileId" = NULL
          WHERE id = ANY($1::text[])`,
        [ids],
      );
      console.log(`  reset ${reset.rowCount} rows to 'pending'`);

      let purged = 0;
      if (PURGE) {
        const del = await client.query(
          `DELETE FROM "Track" t
            WHERE t.id = ANY($1::text[])
              AND ${ORPHAN_PREDICATE}`,
          [ids],
        );
        purged = del.rowCount;
        console.log(`  deleted ${purged} orphaned rows (kept ${ids.length - purged} that are referenced)`);
      }

      await client.query("COMMIT");
      console.log(`\n  Committed.\n`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`\n  Rolled back: ${e.message}\n`);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
})();
