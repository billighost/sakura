/**
 * Sakura Download Load Test
 *
 * Tests the download-specific API paths that the general load test deliberately
 * skips: the download metadata endpoints, stream redirects, and playlist/track
 * lookup routes. The real Telegram bot is NOT called — this tests everything
 * around the download path (auth, DB lookup, coalescing guard, redirect chain)
 * without saturating the bot.
 *
 * WHAT THIS TESTS
 * ---------------
 *  - GET  /api/stream/[trackId]          → DB lookup + redirect (main hot path)
 *  - POST /api/download/[trackId]        → authenticated track metadata fetch
 *  - POST /api/download/playlist/[id]    → playlist tracklist for offline
 *  - POST /api/music/download (DB hit)   → the cache-hit path (existing audioUrl)
 *
 * WHAT IT DOES NOT TEST
 * ----------------------
 *  - Actually calling the Telegram bot (searchAndSelect)
 *  - Writing audio blobs (that's a client-only IDB operation)
 *
 * PROFILES
 * --------
 *  smoke   — 20 VUs, 15s   (sanity check before a real run)
 *  normal  — 200 VUs, 60s  (expected production load)
 *  target  — 1000 VUs, 60s (capacity target)
 *  stress  — 500 VUs, 30s, think=0 (find the ceiling)
 *
 * USAGE
 * -----
 *  node scripts/load-test-downloads.js --profile smoke
 *  node scripts/load-test-downloads.js --profile target
 *  node scripts/load-test-downloads.js --vus 1000 --duration 60
 *  node scripts/load-test-downloads.js --only stream,metadata
 *  node scripts/load-test-downloads.js --profile stress --url https://your-app.vercel.app
 */

const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

// ── Configuration ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const PROFILES = {
  smoke:  { vus: 20,   duration: 15, think: 300,  rampUp: 3  },
  normal: { vus: 200,  duration: 60, think: 1500, rampUp: 10 },
  target: { vus: 1000, duration: 60, think: 2000, rampUp: 15 },
  stress: { vus: 500,  duration: 30, think: 0,    rampUp: 5  },
};

const args = parseArgs(process.argv);
const profile = PROFILES[args.profile] || PROFILES.normal;

const CONFIG = {
  baseUrl: (args.url || process.env.LOAD_TEST_URL || "http://localhost:3000").replace(/\/$/, ""),
  vus: Number(args.vus) || profile.vus,
  durationSec: Number(args.duration) || profile.duration,
  thinkMs: args.think !== undefined ? Number(args.think) : profile.think,
  rampUpSec: args.rampUp !== undefined ? Number(args.rampUp) : profile.rampUp,
  workers: Number(args.workers) || Math.min(os.cpus().length, 8),
  timeoutMs: Number(args.timeout) || 15000,
  skip: String(args.skip || "").split(",").filter(Boolean),
  only: String(args.only || "").split(",").filter(Boolean),
  verbose: !!args.verbose,
};

// ── Journey definitions ──────────────────────────────────────────────────────

/**
 * Weight breakdown — download traffic is heavier on stream (every play goes
 * through it) and lighter on playlist/metadata (batch operations).
 */
const JOURNEYS = [
  {
    name: "stream",
    weight: 45,
    cost: "DB lookup (indexed by PK) + redirect",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      return [{
        method: "GET",
        path: `/api/stream/${t.id}`,
        label: "stream",
        // Redirect is expected — the audio is hosted elsewhere
        okStatuses: [200, 206, 301, 302, 307, 308],
        noRedirect: true,
      }];
    },
  },
  {
    name: "metadata",
    weight: 25,
    cost: "DB lookup by PK for track download metadata",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      return [{
        method: "POST",
        path: `/api/download/${t.id}`,
        label: "metadata",
        body: {},
        okStatuses: [200, 404],
      }];
    },
  },
  {
    name: "download_cache_hit",
    weight: 20,
    cost: "music/download with existing audioUrl — short-circuits before Telegram",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      return [{
        method: "POST",
        path: "/api/music/download",
        label: "download_cache",
        body: { title: t.title, artist: t.artist, duration: t.duration || 200 },
        okStatuses: [200, 404, 429],
      }];
    },
  },
  {
    name: "playlist_download",
    weight: 10,
    cost: "playlist tracklist fetch for offline queuing",
    steps: (ctx) => {
      const p = ctx.pick(ctx.seed.playlists);
      if (!p) return [{ method: "GET", path: "/api/playlists", label: "playlists_fallback" }];
      return [{
        method: "POST",
        path: `/api/download/playlist/${p.id}`,
        label: "playlist_dl",
        body: {},
        okStatuses: [200, 403, 404],
      }];
    },
  },
];

// ── Statistics ───────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(latencies) {
  const s = [...latencies].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    count: s.length,
    avg: s.length ? sum / s.length : 0,
    min: s.length ? s[0] : 0,
    p50: percentile(s, 50),
    p75: percentile(s, 75),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    p999: percentile(s, 99.9),
    max: s.length ? s[s.length - 1] : 0,
  };
}

// ── Worker ───────────────────────────────────────────────────────────────────

if (!isMainThread) {
  runWorker().catch((err) => {
    parentPort.postMessage({ type: "fatal", error: err.message, stack: err.stack });
  });
}

async function runWorker() {
  const { config, seed, cookies, workerId, startAt } = workerData;
  const isHttps = config.baseUrl.startsWith("https://");
  const transport = isHttps ? https : http;

  const agent = new (isHttps ? https.Agent : http.Agent)({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: Math.max(64, Math.ceil(config.vus / config.workers) + 16),
    maxFreeSockets: 128,
    timeout: config.timeoutMs,
    scheduling: "fifo",
  });

  const url = new URL(config.baseUrl);
  const results = [];
  const activeJourneys = config.only.length
    ? JOURNEYS.filter((j) => config.only.includes(j.name))
    : JOURNEYS.filter((j) => !config.skip.includes(j.name));
  const totalWeight = activeJourneys.reduce((a, j) => a + j.weight, 0);

  function pickJourney() {
    let r = Math.random() * totalWeight;
    for (const j of activeJourneys) {
      r -= j.weight;
      if (r <= 0) return j;
    }
    return activeJourneys[activeJourneys.length - 1];
  }

  const ctx = {
    seed,
    pick: (arr) => arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null,
  };

  function request(step, cookie) {
    return new Promise((resolve) => {
      const started = process.hrtime.bigint();
      const payload = step.body ? Buffer.from(JSON.stringify(step.body)) : null;

      const headers = {
        cookie,
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        connection: "keep-alive",
        "x-forwarded-for": step.ip,
      };
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = payload.length;
      }

      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: step.path,
          method: step.method,
          agent,
          headers,
          timeout: config.timeoutMs,
        },
        (res) => {
          let bytes = 0;
          res.on("data", (c) => { bytes += c.length; });
          res.on("end", () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const okStatuses = step.okStatuses || [200, 201, 204];
            const ok = okStatuses.includes(res.statusCode) ||
              (step.noRedirect && res.statusCode >= 300 && res.statusCode < 400);
            resolve({
              label: step.label,
              ms,
              status: res.statusCode,
              ok,
              bytes,
              errorKind: ok ? null : `http_${res.statusCode}`,
            });
          });
          res.resume();
        }
      );

      req.on("timeout", () => { req.destroy(new Error("timeout")); });
      req.on("error", (err) => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        resolve({
          label: step.label,
          ms,
          status: 0,
          ok: false,
          bytes: 0,
          errorKind: err.message === "timeout" ? "timeout" : `net_${err.code || err.message}`,
        });
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const endAt = startAt + config.durationSec * 1000;

  async function virtualUser(vuIndex) {
    const rampDelay = config.rampUpSec > 0
      ? (vuIndex / Math.max(1, config.vus / config.workers)) * config.rampUpSec * 1000
      : 0;
    await sleep(rampDelay + Math.random() * 50);

    const cookie = cookies[vuIndex % cookies.length];
    const ip = `10.${workerId}.${(vuIndex >> 8) & 255}.${vuIndex & 255}`;

    while (Date.now() < endAt) {
      const journey = pickJourney();
      const steps = journey.steps(ctx);
      const journeyStart = process.hrtime.bigint();
      let journeyOk = true;

      for (const step of steps) {
        if (Date.now() >= endAt) break;
        const r = await request({ ...step, ip }, cookie);
        r.journey = journey.name;
        results.push(r);
        if (!r.ok) journeyOk = false;
      }

      results.push({
        label: `__journey__${journey.name}`,
        ms: Number(process.hrtime.bigint() - journeyStart) / 1e6,
        status: journeyOk ? 200 : 0,
        ok: journeyOk,
        bytes: 0,
        errorKind: null,
        journey: journey.name,
      });

      if (config.thinkMs > 0) {
        await sleep(-Math.log(1 - Math.random()) * config.thinkMs);
      }
    }
  }

  const vusForWorker = Math.floor(config.vus / config.workers) +
    (workerId < config.vus % config.workers ? 1 : 0);

  let reported = 0;
  const ticker = setInterval(() => {
    const slice = results.slice(reported);
    reported = results.length;
    parentPort.postMessage({ type: "tick", results: slice });
  }, 1000);

  await Promise.all(Array.from({ length: vusForWorker }, (_, i) => virtualUser(i)));

  clearInterval(ticker);
  parentPort.postMessage({ type: "done", results: results.slice(reported) });
  agent.destroy();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

  const { encode } = require("next-auth/jwt");
  const { Pool } = require("pg");

  console.log("");
  header("SAKURA DOWNLOAD LOAD TEST");
  console.log(`  Target        ${CONFIG.baseUrl}`);
  console.log(`  Virtual users ${CONFIG.vus}`);
  console.log(`  Duration      ${CONFIG.durationSec}s  (ramp ${CONFIG.rampUpSec}s)`);
  console.log(`  Think time    ${CONFIG.thinkMs === 0 ? "0 (STRESS MODE)" : `~${CONFIG.thinkMs}ms exponential`}`);
  console.log(`  Workers       ${CONFIG.workers}`);
  console.log(`  Scope         Download endpoints only (no real Telegram bot calls)`);
  if (CONFIG.skip.length) console.log(`  Skipping      ${CONFIG.skip.join(", ")}`);
  if (CONFIG.only.length) console.log(`  Only          ${CONFIG.only.join(", ")}`);
  console.log("");

  // ── Preflight ──────────────────────────────────────────────────────────────
  const buildMode = await detectBuildMode(CONFIG.baseUrl);
  if (buildMode === "unreachable") {
    console.error(`  ✖ Cannot reach ${CONFIG.baseUrl}. Is the server running?`);
    process.exit(1);
  }
  if (buildMode === "dev") {
    console.log("  ⚠  Server appears to be running in DEV mode.");
    console.log("     Numbers below will not describe production. Run npm run build && npm start");
    console.log("");
  }

  // ── Seed data ──────────────────────────────────────────────────────────────
  console.log("  Loading seed data from database…");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const seed = await loadSeed(pool);
  await pool.end();

  if (!seed.users.length) {
    console.error("  ✖ No users in database — cannot mint sessions.");
    process.exit(1);
  }
  console.log(
    `    ${seed.users.length} users · ${seed.tracks.length} tracks · ` +
    `${seed.playlists.length} playlists`
  );

  // ── Sessions ───────────────────────────────────────────────────────────────
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error("  ✖ NEXTAUTH_SECRET not set — cannot mint sessions.");
    process.exit(1);
  }
  const salt = CONFIG.baseUrl.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  const cookies = await Promise.all(
    seed.users.map(async (u) => {
      const token = await encode({
        token: { id: u.id, name: u.username, sub: u.id },
        secret,
        salt,
        maxAge: 60 * 60 * 24,
      });
      return `${salt}=${token}`;
    })
  );
  console.log(`    Minted ${cookies.length} session cookie(s)`);

  // Auth check
  const authCheck = await probe(`${CONFIG.baseUrl}/api/profile`, cookies[0]);
  if (authCheck.status === 401) {
    console.error("  ✖ Minted session rejected (401). Secret mismatch?");
    process.exit(1);
  }
  console.log(`    Auth verified (GET /api/profile → ${authCheck.status})`);
  console.log("");

  // ── Baseline coalescing check ──────────────────────────────────────────────
  // Fire 5 concurrent requests for the same track to verify the pendingDownloads
  // guard coalesces them (all should succeed, not 5× Telegram calls).
  if (seed.tracks.length > 0) {
    console.log("  Verifying download coalescing (5 concurrent same-track requests)…");
    const t = seed.tracks[0];
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        probePost(
          `${CONFIG.baseUrl}/api/music/download`,
          { title: t.title, artist: t.artist, duration: t.duration || 200 },
          cookies[0]
        )
      )
    );
    const elapsed = Date.now() - start;
    const statuses = results.map((r) => r.status);
    const allOk = statuses.every((s) => [200, 404, 429].includes(s));
    console.log(`    Statuses: [${statuses.join(", ")}] in ${elapsed}ms`);
    console.log(`    ${allOk ? "✓ Coalescing handled (no 500s)" : "⚠  Unexpected statuses — check server logs"}`);
    console.log("");
  }

  // Reset server counters
  await probeJson(`${CONFIG.baseUrl}/api/health?stats=1&reset=1`);

  // ── Run ────────────────────────────────────────────────────────────────────
  header("RUNNING");
  const startAt = Date.now() + 300;
  const all = [];
  const timeline = [];
  let lastTick = Date.now();
  let tickAccum = [];

  const workers = Array.from({ length: CONFIG.workers }, (_, workerId) => {
    const w = new Worker(__filename, {
      workerData: { config: CONFIG, seed, cookies, workerId, startAt },
    });
    w.on("message", (msg) => {
      if (msg.type === "fatal") {
        console.error(`  Worker ${workerId} crashed: ${msg.error}`);
        return;
      }
      const real = msg.results.filter((r) => !r.label.startsWith("__journey__"));
      all.push(...msg.results);
      tickAccum.push(...real);

      if (msg.type === "tick" && Date.now() - lastTick >= 1000) {
        const elapsed = (Date.now() - startAt) / 1000;
        const rps = tickAccum.length / ((Date.now() - lastTick) / 1000);
        const s = summarize(tickAccum.map((r) => r.ms));
        const errs = tickAccum.filter((r) => !r.ok).length;
        timeline.push({ t: elapsed, rps, p95: s.p95, errors: errs });
        if (elapsed > 0) {
          process.stdout.write(
            `  ${String(Math.round(elapsed)).padStart(3)}s  ` +
            `${rps.toFixed(0).padStart(5)} rps  ` +
            `p50 ${s.p50.toFixed(0).padStart(5)}ms  ` +
            `p95 ${s.p95.toFixed(0).padStart(6)}ms  ` +
            `err ${String(errs).padStart(4)}\n`
          );
        }
        lastTick = Date.now();
        tickAccum = [];
      }
    });
    return w;
  });

  await Promise.all(
    workers.map((w) => new Promise((res) => { w.on("exit", res); w.on("error", res); }))
  );

  const statsAfter = await probeJson(`${CONFIG.baseUrl}/api/health?stats=1`);

  report(all, timeline, statsAfter, cookies.length);
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function header(title) {
  console.log(`  ${"─".repeat(74)}`);
  console.log(`  ${title}`);
  console.log(`  ${"─".repeat(74)}`);
}

function report(all, timeline, statsAfter, seedUserCount = 1) {
  const requests = all.filter((r) => !r.label.startsWith("__journey__"));
  const journeys = all.filter((r) => r.label.startsWith("__journey__"));

  const ok = requests.filter((r) => r.ok);
  const failed = requests.filter((r) => !r.ok);
  const overall = summarize(requests.map((r) => r.ms));

  const wallSec = CONFIG.durationSec;
  const rps = requests.length / wallSec;

  console.log("");
  header("RESULTS");
  console.log(`  Requests        ${requests.length}  (${rps.toFixed(1)}/s)`);
  console.log(`  Journeys        ${journeys.length}`);
  const successPct = requests.length ? (ok.length / requests.length) * 100 : 0;
  console.log(
    `  Success         ${ok.length} (${successPct.toFixed(2)}%)` +
    (successPct < 99.5 ? "   ← below 99.5% SLO" : "")
  );
  console.log(`  Failed          ${failed.length}`);
  console.log(`  Transferred     ${(requests.reduce((a, r) => a + r.bytes, 0) / 1048576).toFixed(1)} MB`);
  console.log("");

  console.log("  LATENCY (all requests, ms)");
  console.log(
    `    avg ${overall.avg.toFixed(0).padStart(6)}   p50 ${overall.p50.toFixed(0).padStart(6)}   ` +
    `p90 ${overall.p90.toFixed(0).padStart(6)}   p95 ${overall.p95.toFixed(0).padStart(6)}`
  );
  console.log(
    `    p99 ${overall.p99.toFixed(0).padStart(6)}   p99.9 ${overall.p999.toFixed(0).padStart(4)}   ` +
    `max ${overall.max.toFixed(0).padStart(6)}   min ${overall.min.toFixed(0).padStart(6)}`
  );
  console.log("");

  // Per endpoint
  const byLabel = new Map();
  for (const r of requests) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label).push(r);
  }

  console.log("  BY ENDPOINT (sorted by p95)");
  console.log(
    `    ${"endpoint".padEnd(20)}${"n".padStart(7)}${"ok%".padStart(8)}` +
    `${"p50".padStart(8)}${"p95".padStart(9)}${"p99".padStart(9)}${"max".padStart(9)}`
  );
  const rows = [...byLabel.entries()]
    .map(([label, rs]) => {
      const s = summarize(rs.map((r) => r.ms));
      const okPct = (rs.filter((r) => r.ok).length / rs.length) * 100;
      return { label, s, okPct, n: rs.length };
    })
    .sort((a, b) => b.s.p95 - a.s.p95);

  for (const row of rows) {
    const flag = row.s.p95 > 1000 ? "  ← SLOW" : row.okPct < 99 ? "  ← ERRORS" : "";
    console.log(
      `    ${row.label.padEnd(20)}${String(row.n).padStart(7)}` +
      `${row.okPct.toFixed(1).padStart(8)}` +
      `${row.s.p50.toFixed(0).padStart(8)}` +
      `${row.s.p95.toFixed(0).padStart(9)}` +
      `${row.s.p99.toFixed(0).padStart(9)}` +
      `${row.s.max.toFixed(0).padStart(9)}${flag}`
    );
  }
  console.log("");

  // Errors
  if (failed.length) {
    const byKind = new Map();
    for (const r of failed) {
      const k = `${r.label} → ${r.errorKind}`;
      byKind.set(k, (byKind.get(k) || 0) + 1);
    }
    console.log("  ERRORS");
    for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`    ${String(n).padStart(6)}  ${k}`);
    }

    const rateLimited = failed.filter((r) => r.errorKind === "http_429").length;
    if (rateLimited > 0) {
      const perAccount = (CONFIG.vus / seedUserCount).toFixed(0);
      console.log("");
      console.log(
        `    ${rateLimited} of these are 429s. The run drove ${CONFIG.vus} VUs through ` +
        `${seedUserCount} account(s) (~${perAccount}× per-user rate).`
      );
      console.log(`    Rate limiters trip here in a way they would not with real distinct users.`);
    }
    console.log("");
  }

  // Stability
  if (timeline.length >= 4) {
    const firstQ = timeline.slice(0, Math.floor(timeline.length / 4));
    const lastQ = timeline.slice(-Math.floor(timeline.length / 4));
    const avg = (xs, k) => xs.reduce((a, x) => a + x[k], 0) / xs.length;
    const p95Start = avg(firstQ, "p95");
    const p95End = avg(lastQ, "p95");
    const drift = p95Start > 0 ? ((p95End - p95Start) / p95Start) * 100 : 0;

    console.log("  STABILITY");
    console.log(`    p95 first quarter  ${p95Start.toFixed(0)}ms`);
    console.log(`    p95 last quarter   ${p95End.toFixed(0)}ms   (${drift >= 0 ? "+" : ""}${drift.toFixed(0)}%)`);
    if (drift > 50) {
      console.log("    ← latency climbing: pool, memory, or a leak.");
    }
    console.log("");
  }

  // Server counters
  if (statsAfter) {
    header("SERVER COUNTERS");
    const perReq = requests.length || 1;
    if (statsAfter.redis?.commands !== undefined)
      console.log(`  Redis commands       ${statsAfter.redis.commands}  (${(statsAfter.redis.commands / perReq).toFixed(2)}/request)`);
    if (statsAfter.sql?.queries !== undefined)
      console.log(`  Postgres queries     ${statsAfter.sql.queries}  (${(statsAfter.sql.queries / perReq).toFixed(2)}/request)`);
    if (statsAfter.sql?.avgMs !== undefined)
      console.log(`  Avg query time       ${statsAfter.sql.avgMs}ms   slow (>200ms): ${statsAfter.sql.slow}`);
    if (statsAfter.pool)
      console.log(`  PG pool             total ${statsAfter.pool.total} · idle ${statsAfter.pool.idle} · waiting ${statsAfter.pool.waiting}`);
    if (statsAfter.memoryCache)
      console.log(`  L1 cache hit rate    ${statsAfter.memoryCache.l1HitRate}%  (${statsAfter.memoryCache.size} keys)`);
    if (statsAfter.rss)
      console.log(`  Server RSS           ${statsAfter.rss} MB`);
    const openBreakers = (statsAfter.breakers || []).filter((b) => b.state !== "closed");
    if (openBreakers.length)
      console.log(`  Tripped breakers     ${openBreakers.map((b) => `${b.name}:${b.state}`).join(", ")}`);
    console.log("");
  }

  // Verdict
  header("VERDICT");

  const rateLimited = failed.filter((r) => r.errorKind === "http_429").length;
  const served = requests.length - rateLimited;
  const realFailures = failed.length - rateLimited;
  const servingSuccess = served > 0 ? ((served - realFailures) / served) * 100 : 0;

  const lastQ = timeline.slice(-Math.max(1, Math.floor(timeline.length / 4)));
  const steadyP95 = lastQ.length
    ? lastQ.reduce((a, x) => a + x.p95, 0) / lastQ.length
    : overall.p95;

  const checks = [
    {
      name: "Serving success ≥ 99.5%",
      pass: servingSuccess >= 99.5,
      actual: `${servingSuccess.toFixed(2)}%  (${realFailures} real failures, ${rateLimited} rate-limited)`,
    },
    { name: "Steady-state p95 < 800ms", pass: steadyP95 < 800, actual: `${steadyP95.toFixed(0)}ms` },
    { name: "Overall p99 < 2000ms",     pass: overall.p99 < 2000, actual: `${overall.p99.toFixed(0)}ms` },
    {
      name: "No pool starvation",
      pass: !statsAfter?.pool || statsAfter.pool.waiting === 0,
      actual: `${statsAfter?.pool?.waiting ?? "?"} waiting`,
    },
    {
      name: "Stream endpoint p95 < 500ms",
      pass: (() => {
        const streamRows = rows.find((r) => r.label === "stream");
        return !streamRows || streamRows.s.p95 < 500;
      })(),
      actual: (() => {
        const streamRows = rows.find((r) => r.label === "stream");
        return streamRows ? `${streamRows.s.p95.toFixed(0)}ms` : "n/a";
      })(),
    },
  ];

  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✖"}  ${c.name.padEnd(30)} ${c.actual}`);
  }

  const passed = checks.every((c) => c.pass);
  console.log("");
  console.log(`  ${passed ? "✓ PASSED — download endpoints support the target load" : "✖ FAILED — see failures above"}`);
  console.log("");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSeed(pool) {
  const safe = async (sql, fallback = []) => {
    try {
      const r = await pool.query(sql);
      return r.rows;
    } catch (e) {
      console.log(`    (seed query failed: ${e.message})`);
      return fallback;
    }
  };

  const [users, tracks, playlists] = await Promise.all([
    safe(`SELECT id, username FROM "User" LIMIT 20`),
    safe(
      // Only seed tracks that have a USABLE Telegram audioUrl.
      // Tracks with a null, empty, 'pending', or /api/stream/telegram/0 audioUrl
      // would cause /api/music/download to fall through to the real Telegram bot,
      // turning a "cache-hit" journey into a real 30-60s bot call.
      // The download_cache journey is meant to test the fast DB-lookup path only.
      `SELECT t.id, t.title, t.duration, COALESCE(a.name,'Unknown') AS artist
         FROM "Track" t LEFT JOIN "Artist" a ON a.id = t."artistId"
        WHERE t."audioUrl" LIKE '/api/stream/telegram/%'
          AND t."audioUrl" NOT LIKE '%/0'
          AND t."audioUrl" IS NOT NULL
        LIMIT 100`
    ),
    // Playlist schema has no isPublic column — just fetch id and userId.
    safe(`SELECT id, "userId" FROM "Playlist" LIMIT 30`),
  ]);


  return {
    users,
    tracks: tracks.length
      ? tracks
      : [{ id: "missing", title: "Unknown", artist: "Unknown", duration: 200 }],
    playlists: playlists.length ? playlists : [],
  };
}

function probe(url, cookie) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: cookie ? { cookie } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", () => resolve({ status: 0, body: "", headers: {} }));
    req.setTimeout(15000, () => req.destroy());
  });
}

async function probeJson(url) {
  const r = await probe(url);
  try { return JSON.parse(r.body); } catch { return null; }
}

function probePost(url, body, cookie) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const payload = Buffer.from(JSON.stringify(body));
    const parsedUrl = new URL(url);
    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (url.startsWith("https") ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": payload.length,
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(15000, () => req.destroy());
    req.write(payload);
    req.end();
  });
}

async function detectBuildMode(baseUrl) {
  const r = await probe(`${baseUrl}/api/health`);
  if (r.status === 0) return "unreachable";
  const t0 = Date.now();
  await probe(`${baseUrl}/api/health`);
  return (Date.now() - t0) > 400 ? "dev" : "prod";
}

if (isMainThread) {
  main().catch((err) => {
    console.error("\nDownload load test failed:", err);
    process.exit(1);
  });
}
