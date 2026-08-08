/**
 * Sakura load test — closed-loop, multi-worker, authenticated.
 *
 * WHAT THIS MODELS
 * ----------------
 * "1000 concurrent users" is not "1000 requests per second". A person using a
 * music app reads a screen, plays a song, and thinks. Modelling them as an
 * open-loop firehose measures a number nobody experiences. So this is a
 * closed-loop test: N virtual users each run realistic *journeys* with think
 * time between actions, and the resulting throughput is an output, not an input.
 *
 * Set `--think 0` to turn it into a stress test and find the actual ceiling.
 *
 * WHY WORKERS
 * -----------
 * One Node event loop generating 1000 concurrent connections *and* timing them
 * is measuring itself as much as the server: client-side queueing shows up as
 * server latency. Load is spread across `--workers` threads, each with its own
 * keep-alive agent and its own share of the VUs.
 *
 * WHY IT AUTHENTICATES
 * --------------------
 * 58 of the app's route handlers begin with `await auth()`. A test that only
 * hits open endpoints exercises almost none of the real code, so this mints
 * genuine NextAuth JWE session cookies with the app's own `encode()` and real
 * user ids from the database.
 *
 * WHAT IT REPORTS
 * ---------------
 * Latency percentiles per endpoint (p50→p99.9, plus max), errors classified by
 * kind rather than lumped together, throughput over time so degradation is
 * visible as it develops, and — the part that decides free-tier viability —
 * Redis commands and Postgres queries *per request*, sampled from the server's
 * own counters via /api/health?stats=1.
 *
 *   node scripts/load-test.js --vus 1000 --duration 60
 *   node scripts/load-test.js --vus 500 --think 0 --duration 30   # stress
 *   node scripts/load-test.js --profile smoke
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

// ── Configuration ───────────────────────────────────────────────────────────

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
  smoke: { vus: 20, duration: 10, think: 500, rampUp: 2 },
  normal: { vus: 200, duration: 30, think: 2000, rampUp: 5 },
  target: { vus: 1000, duration: 60, think: 3000, rampUp: 15 },
  stress: { vus: 500, duration: 30, think: 0, rampUp: 5 },
  soak: { vus: 300, duration: 300, think: 2000, rampUp: 20 },
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
  timeoutMs: Number(args.timeout) || 30000,
  /** Journeys to exclude, comma separated — e.g. --skip download,telegram */
  skip: String(args.skip || "").split(",").filter(Boolean),
  /** Journeys to run exclusively — e.g. --only search. Overrides --skip. */
  only: String(args.only || "").split(",").filter(Boolean),
  /**
   * Enable mutating journeys (likes, play signals).
   *
   * Off by default because this harness authenticates as a real account and
   * calls the real endpoints, so its writes persist. Read-only runs still
   * exercise every query and cache path that determines capacity.
   */
  writes: !!args.writes,
  verbose: !!args.verbose,
};

// ── Journey definitions ─────────────────────────────────────────────────────

/**
 * Weights are roughly how often a real session does each thing. Home and search
 * dominate; radio and downloads are rare but expensive. The point of weighting
 * is that an unweighted test over-samples the cheap endpoints and reports a
 * flattering average that no user ever experiences.
 *
 * `cost` is documentation, not logic — it records why a weight is what it is.
 */
const JOURNEYS = [
  {
    name: "home",
    weight: 20,
    cost: "8 parallel queries, cached 5m",
    steps: (ctx) => [{ method: "GET", path: "/api/home", label: "home" }],
  },
  {
    name: "search",
    weight: 18,
    cost: "trigram query + Deezer/iTunes, cached 6h",
    steps: (ctx) => [
      { method: "GET", path: `/api/music/search?q=${encodeURIComponent(ctx.pickZipf(ctx.seed.searchTerms))}&limit=10`, label: "search" },
    ],
  },
  {
    name: "play",
    weight: 15,
    cost: "1 query + a signal write",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      const steps = [
        { method: "GET", path: `/api/stream/${t.id}`, label: "stream", noRedirect: true },
      ];
      // Signals write ListeningHistory, which feeds taste profiles, radio and
      // "recently played". Synthetic plays would quietly reshape a real user's
      // recommendations, so this is gated behind --writes with the favourites
      // mutation. See the note there.
      if (CONFIG.writes) {
        steps.push({
          method: "POST",
          path: "/api/signals",
          label: "signal",
          body: { trackId: t.id, event: "play", msPlayed: 30000 + Math.floor(Math.random() * 120000) },
        });
      }
      return steps;
    },
  },
  {
    name: "lyrics",
    weight: 10,
    cost: "4 parallel providers, cached 30d",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      return [
        {
          method: "GET",
          path: `/api/lyrics?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}&duration=${t.duration || 200}`,
          label: "lyrics",
          okStatuses: [200, 404],
        },
      ];
    },
  },
  {
    name: "artist",
    weight: 9,
    cost: "2 local queries + 3 Deezer calls, cached 2m",
    steps: (ctx) => [
      { method: "GET", path: `/api/artists/${ctx.pick(ctx.seed.artists).id}`, label: "artist" },
    ],
  },
  {
    name: "credits",
    weight: 7,
    cost: "3 queries + Deezer fallback, cached 7d",
    steps: (ctx) => [
      {
        method: "GET",
        path: `/api/tracks/${ctx.pick(ctx.seed.tracks).id}/credits`,
        label: "credits",
      },
    ],
  },
  {
    name: "radio",
    weight: 6,
    cost: "multi-query scoring pass",
    steps: (ctx) => [
      {
        method: "POST",
        path: "/api/radio",
        label: "radio",
        body: {
          limit: 20,
          seedTrackId: ctx.pick(ctx.seed.tracks).id,
          excludeTrackIds: ctx.seed.tracks.slice(0, 10).map((t) => t.id),
        },
      },
    ],
  },
  {
    name: "library",
    weight: 6,
    cost: "3 list queries, batched into 1 round trip",
    steps: (ctx) => [
      {
        method: "POST",
        path: "/api/batch",
        label: "batch",
        body: {
          requests: [
            { key: "tracks", path: "/api/tracks?limit=30" },
            { key: "artists", path: "/api/artists" },
            { key: "albums", path: "/api/albums" },
          ],
        },
      },
    ],
  },
  {
    name: "charts",
    weight: 5,
    cost: "cached chart read",
    steps: (ctx) => [{ method: "GET", path: "/api/charts", label: "charts" }],
  },
  {
    name: "album",
    weight: 5,
    cost: "album + tracklist",
    steps: (ctx) => [
      { method: "GET", path: `/api/albums/${ctx.pick(ctx.seed.albums).id}`, label: "album" },
    ],
  },
  {
    name: "favorites",
    weight: 5,
    cost: "read + toggle write, invalidates cache",
    steps: (ctx) => {
      const t = ctx.pick(ctx.seed.tracks);
      const steps = [{ method: "GET", path: "/api/favorites", label: "favorites" }];

      /**
       * The write half is opt-in (`--writes`).
       *
       * This harness drives the real endpoints, so its writes are real: an
       * earlier run left 35 machine-made likes on a genuine account, and
       * because the test picks tracks at random from the catalogue they were
       * indistinguishable from the account owner's own likes except by
       * timestamp. A load test should not be something you have to clean up
       * after, so mutating journeys now have to be asked for explicitly.
       *
       * The read path still exercises the cache and the query underneath it,
       * which is the part that matters for capacity.
       */
      if (!CONFIG.writes) return steps;

      steps.push(
        Math.random() < 0.5
          ? {
              method: "POST",
              path: "/api/favorites",
              label: "favorite:toggle",
              body: { trackId: t.id },
              okStatuses: [200, 201, 409],
            }
          : {
              method: "DELETE",
              path: `/api/favorites/${t.id}`,
              label: "favorite:toggle",
              okStatuses: [200, 204, 404],
            }
      );
      return steps;
    },
  },
  {
    name: "history",
    weight: 4,
    cost: "recent plays",
    steps: (ctx) => [{ method: "GET", path: "/api/history?limit=25", label: "history" }],
  },
  {
    name: "explore",
    weight: 4,
    cost: "Deezer search per mood, revalidated 1h",
    steps: (ctx) => [
      {
        method: "GET",
        path: `/api/music/explore?q=${encodeURIComponent(ctx.pick(ctx.seed.moods))}&limit=20`,
        label: "explore",
        okStatuses: [200, 404],
      },
    ],
  },
  {
    name: "profile",
    weight: 3,
    cost: "counts",
    steps: (ctx) => [{ method: "GET", path: "/api/profile", label: "profile" }],
  },
  {
    name: "playlists",
    weight: 3,
    cost: "list + aggregate",
    steps: (ctx) => [{ method: "GET", path: "/api/playlists", label: "playlists" }],
  },
  {
    name: "taste",
    weight: 2,
    cost: "affinity read",
    steps: (ctx) => [
      { method: "GET", path: "/api/taste", label: "taste", okStatuses: [200, 404] },
    ],
  },
];

// ── Statistics ──────────────────────────────────────────────────────────────

/**
 * Percentiles come from the full sorted sample rather than a streaming
 * estimator: at these volumes the memory is trivial and an exact p99.9 is worth
 * more than an approximate one when the whole question is "how bad is the tail".
 */
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

// ── Worker ──────────────────────────────────────────────────────────────────

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
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    /**
     * Zipf-ish pick: heavily favours the front of the list.
     *
     * Uniform selection over a term pool is the wrong model for search and it
     * biases the result in both directions at once — with a small pool
     * everything is a cache hit, with a large one almost nothing is. Real
     * traffic is neither: a few artists account for most queries while the tail
     * is effectively unbounded. `x^2` over a sorted pool reproduces that shape
     * closely enough to make the measured hit rate mean something, with the
     * real catalogue names sitting at the head of the list.
     */
    pickZipf: (arr) => arr[Math.floor(Math.random() ** 2 * arr.length)],
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
        // Rate limiters key off this. Varying it per VU is what makes the test
        // exercise the limiter the way real distinct clients would, instead of
        // one synthetic IP tripping a limit that no real deployment would hit.
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
          res.on("data", (c) => {
            bytes += c.length;
          });
          res.on("end", () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const ok = (step.okStatuses || [200, 201, 204]).includes(res.statusCode) ||
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

      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });

      req.on("error", (err) => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        resolve({
          label: step.label,
          ms,
          status: 0,
          ok: false,
          bytes: 0,
          // Classified, because "ECONNRESET" and "504" mean completely different
          // things about where the ceiling is: one is the socket layer giving
          // up, the other is the app being too slow.
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
    // Stagger arrivals across the ramp so the run measures steady state rather
    // than a synchronised stampede at t=0 — otherwise p99 just reports the
    // cold-start thundering herd.
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
        // Exponential think time. Uniform think time makes every VU cycle at
        // the same rate and produces artificially smooth load; real arrivals
        // are bursty, and burstiness is what finds queueing bugs.
        await sleep(-Math.log(1 - Math.random()) * config.thinkMs);
      }
    }
  }

  const vusForWorker = Math.floor(config.vus / config.workers) +
    (workerId < config.vus % config.workers ? 1 : 0);

  // Report partial results every second so the parent can plot degradation
  // while the run is still going.
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

  const { encode } = require("next-auth/jwt");
  const { Pool } = require("pg");

  console.log("");
  header("SAKURA LOAD TEST");
  console.log(`  Target        ${CONFIG.baseUrl}`);
  console.log(`  Virtual users ${CONFIG.vus}`);
  console.log(`  Duration      ${CONFIG.durationSec}s  (ramp ${CONFIG.rampUpSec}s)`);
  console.log(`  Think time    ${CONFIG.thinkMs === 0 ? "0 (STRESS MODE)" : `~${CONFIG.thinkMs}ms exponential`}`);
  console.log(`  Workers       ${CONFIG.workers}`);
  console.log(
    `  Writes        ${CONFIG.writes ? "ENABLED — will persist likes and play signals" : "off (read-only; pass --writes to include)"}`
  );
  if (CONFIG.skip.length) console.log(`  Skipping      ${CONFIG.skip.join(", ")}`);
  console.log("");

  // ── Preflight ─────────────────────────────────────────────────────────────
  const buildMode = await detectBuildMode(CONFIG.baseUrl);
  if (buildMode === "dev") {
    console.log("  ⚠  Server appears to be running in DEV mode.");
    console.log("     Dev builds are 10-50x slower and recompile per route — the");
    console.log("     numbers below would not describe production. Run:");
    console.log("         npm run build && npm start");
    console.log("");
  } else if (buildMode === "unreachable") {
    console.error(`  ✖ Cannot reach ${CONFIG.baseUrl}. Is the server running?`);
    process.exit(1);
  }

  // ── Seed data ─────────────────────────────────────────────────────────────
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
      `${seed.artists.length} artists · ${seed.albums.length} albums`
  );

  // ── Sessions ──────────────────────────────────────────────────────────────
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

  // Fail fast on a bad session rather than reporting a 100%-401 run as "fast".
  const authCheck = await probe(`${CONFIG.baseUrl}/api/profile`, cookies[0]);
  if (authCheck.status === 401) {
    console.error("  ✖ Minted session rejected (401). Secret mismatch between .env and server?");
    process.exit(1);
  }
  console.log(`    Auth verified (GET /api/profile → ${authCheck.status})`);
  console.log("");

  // ── Reset server counters ─────────────────────────────────────────────────
  // `reset=1` returns the accumulated values *and then* zeroes them, so the
  // run's own cost is simply whatever the counters read afterwards. Subtracting
  // the returned figures would double-count the reset and produce a negative
  // delta — which it did.
  await probeJson(`${CONFIG.baseUrl}/api/health?stats=1&reset=1`);
  const statsBefore = { redis: { commands: 0 }, sql: { queries: 0 } };

  // ── Run ───────────────────────────────────────────────────────────────────
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

  report(all, timeline, statsBefore, statsAfter, cookies.length);
}

// ── Reporting ───────────────────────────────────────────────────────────────

function header(title) {
  console.log(`  ${"─".repeat(74)}`);
  console.log(`  ${title}`);
  console.log(`  ${"─".repeat(74)}`);
}

function report(all, timeline, statsBefore, statsAfter, seedUserCount = 1) {
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
  console.log(`  Journeys        ${journeys.length}  (${(journeys.length / wallSec).toFixed(1)}/s)`);
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

  // ── Per endpoint ──────────────────────────────────────────────────────────
  const byLabel = new Map();
  for (const r of requests) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label).push(r);
  }

  console.log("  BY ENDPOINT (sorted by p95)");
  console.log(
    `    ${"endpoint".padEnd(18)}${"n".padStart(7)}${"ok%".padStart(8)}` +
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
      `    ${row.label.padEnd(18)}${String(row.n).padStart(7)}` +
        `${row.okPct.toFixed(1).padStart(8)}` +
        `${row.s.p50.toFixed(0).padStart(8)}` +
        `${row.s.p95.toFixed(0).padStart(9)}` +
        `${row.s.p99.toFixed(0).padStart(9)}` +
        `${row.s.max.toFixed(0).padStart(9)}${flag}`
    );
  }
  console.log("");

  // ── Errors ────────────────────────────────────────────────────────────────
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

    /**
     * 429s need calling out separately, because in this harness they are
     * usually an artifact rather than a finding.
     *
     * Per-user rate limits are keyed on the session's user id, and the test
     * mints its cookies from however many real accounts the database happens to
     * contain. With N accounts and V virtual users, every limiter bucket sees
     * V/N times the traffic a real user would generate — so a limit that is
     * generous in production trips constantly here. The seed count is printed
     * alongside so the ratio is visible rather than implied.
     */
    const rateLimited = failed.filter((r) => r.errorKind === "http_429").length;
    if (rateLimited > 0) {
      const perAccount = (CONFIG.vus / seedUserCount).toFixed(0);
      console.log("");
      console.log(
        `    ${rateLimited} of these are 429s. The run drove ${CONFIG.vus} virtual users through ` +
          `${seedUserCount} real account(s)`
      );
      console.log(
        `    — about ${perAccount}× the per-user rate a real listener produces, so the per-user`
      );
      console.log(
        `    limiters trip here in a way they would not in production. Add accounts to remove this.`
      );
    }
    console.log("");
  }

  // ── Degradation ───────────────────────────────────────────────────────────
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
      console.log("    ← latency climbing through the run: resource exhaustion,");
      console.log("      not steady-state load. Pool, memory, or a leak.");
    }
    console.log("");
  }

  // ── Free-tier cost accounting ─────────────────────────────────────────────
  if (statsBefore && statsAfter) {
    const redisOps = statsAfter.redis.commands - (statsBefore.redis.commands || 0);
    const sqlOps = statsAfter.sql.queries - (statsBefore.sql.queries || 0);
    const perReq = requests.length || 1;

    header("FREE-TIER COST PROJECTION");
    console.log(`  Redis commands       ${redisOps}  (${(redisOps / perReq).toFixed(2)}/request)`);
    console.log(`  Postgres queries     ${sqlOps}  (${(sqlOps / perReq).toFixed(2)}/request)`);
    if (statsAfter.memoryCache) {
      console.log(
        `  L1 cache hit rate    ${statsAfter.memoryCache.l1HitRate}%  ` +
          `(${statsAfter.memoryCache.size} keys resident)`
      );
    }
    if (statsAfter.sql) {
      console.log(`  Avg query time       ${statsAfter.sql.avgMs}ms   slow (>200ms): ${statsAfter.sql.slow}`);
    }
    if (statsAfter.pool) {
      console.log(
        `  PG pool             total ${statsAfter.pool.total} · idle ${statsAfter.pool.idle} · waiting ${statsAfter.pool.waiting}`
      );
      if (statsAfter.pool.waiting > 0) {
        console.log("    ← requests queued for a connection: pool is the bottleneck");
      }
    }
    if (statsAfter.rss) console.log(`  Server RSS           ${statsAfter.rss} MB`);

    const openBreakers = (statsAfter.breakers || []).filter((b) => b.state !== "closed");
    if (openBreakers.length) {
      console.log(`  Tripped breakers     ${openBreakers.map((b) => `${b.name}:${b.state}`).join(", ")}`);
    }
    console.log("");

    /**
     * Project the measured per-request cost onto a month.
     *
     * The load model matters more than the measurement here, and the obvious
     * one is wrong: "1000 users × 60 requests/hour × 24h × 30d" describes a
     * thousand people using the app every minute of every day, which is not a
     * music app, it's a monitoring probe. It inflates the projection by roughly
     * the ratio of a day to a listening session — about 20×.
     *
     * So the model is stated in the terms a person would actually describe
     * their usage in: how many are active on a given day, for how long, and how
     * many requests a minute of listening costs. Override via env to sanity
     * check a different shape of audience.
     */
    const TARGET_USERS = Number(process.env.PROJECT_USERS) || 1000;
    const DAILY_ACTIVE_PCT = Number(process.env.PROJECT_DAU_PCT) || 0.4;
    const SESSION_MINUTES = Number(process.env.PROJECT_SESSION_MIN) || 45;
    const REQ_PER_MINUTE = Number(process.env.PROJECT_REQ_PER_MIN) || 2;

    const dailyActive = TARGET_USERS * DAILY_ACTIVE_PCT;
    const monthlyRequests = dailyActive * SESSION_MINUTES * REQ_PER_MINUTE * 30;
    const redisPerReq = redisOps / perReq;
    const sqlPerReq = sqlOps / perReq;
    const monthlyRedis = redisPerReq * monthlyRequests;
    const monthlySql = sqlPerReq * monthlyRequests;

    const UPSTASH_FREE = 500_000;

    console.log(`  Model: ${TARGET_USERS} users, ${(DAILY_ACTIVE_PCT * 100).toFixed(0)}% active/day,`);
    console.log(`         ${SESSION_MINUTES}min sessions, ${REQ_PER_MINUTE} req/min of listening`);
    console.log(`    ${fmtBig(monthlyRequests)} requests/month  (${fmtBig(monthlyRequests / 30 / 86400)}/s average)`);
    console.log(
      `    ${fmtBig(monthlyRedis)} Redis commands/month   ` +
        (monthlyRedis > UPSTASH_FREE
          ? `← Upstash free = 500K (${(monthlyRedis / UPSTASH_FREE).toFixed(1)}× over)`
          : `✓ within Upstash free (${((monthlyRedis / UPSTASH_FREE) * 100).toFixed(0)}% of quota)`)
    );
    console.log(`    ${fmtBig(monthlySql)} Postgres queries/month`);

    // The lever, stated plainly: Redis cost is per-request cost × volume, and
    // per-request cost is one minus the L1 hit rate. Worth printing because
    // it's the number to optimise if the projection comes out over quota.
    if (monthlyRedis > UPSTASH_FREE) {
      const needed = redisPerReq * (UPSTASH_FREE / monthlyRedis);
      console.log("");
      console.log(
        `    To fit the free tier: ${redisPerReq.toFixed(2)} → ${needed.toFixed(2)} Redis commands/request`
      );
      console.log(
        `    (raise the L1 hit rate, currently ${statsAfter.memoryCache?.l1HitRate ?? "?"}%, or lengthen L1 TTLs)`
      );
    }
    console.log("");
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  header("VERDICT");

  /**
   * Judged on *serving* failures, with 429s held separately.
   *
   * A 429 is the rate limiter working — the server stayed up and answered
   * correctly. Counting it as a failed request would mark a correctly-defended
   * service as broken, and here the 429s are mostly an artifact of driving many
   * virtual users through few real accounts (see the note above the error
   * table). Timeouts, 5xx and dropped connections are the real signal.
   */
  const rateLimited = failed.filter((r) => r.errorKind === "http_429").length;
  const served = requests.length - rateLimited;
  const realFailures = failed.length - rateLimited;
  const servingSuccess = served > 0 ? ((served - realFailures) / served) * 100 : 0;

  // Steady-state latency: the last quarter of the run, after caches have filled.
  // The first-quarter figure describes a cold start, which is a real but
  // separate concern from how the service behaves once it's warm.
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
    { name: "Overall p99 < 2000ms", pass: overall.p99 < 2000, actual: `${overall.p99.toFixed(0)}ms` },
    {
      name: "No pool starvation",
      pass: !statsAfter?.pool || statsAfter.pool.waiting === 0,
      actual: `${statsAfter?.pool?.waiting ?? "?"} waiting`,
    },
  ];
  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✖"}  ${c.name.padEnd(26)} ${c.actual}`);
  }
  console.log("");
}

function fmtBig(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

  const [users, tracks, artists, albums] = await Promise.all([
    safe(`SELECT id, username FROM "User" LIMIT 20`),
    safe(
      `SELECT t.id, t.title, t.duration, COALESCE(a.name,'Unknown') AS artist
         FROM "Track" t LEFT JOIN "Artist" a ON a.id = t."artistId"
        WHERE t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
        LIMIT 100`
    ),
    safe(`SELECT id, name FROM "Artist" LIMIT 50`),
    safe(`SELECT id, title FROM "Album" LIMIT 50`),
  ]);

  // Search terms drawn from real catalogue names plus deliberate misses. A test
  // that only searches for things already cached measures the cache, not the
  // search path.
  const searchTerms = [
    ...artists.slice(0, 15).map((a) => a.name),
    ...tracks.slice(0, 15).map((t) => t.title),
    "drake", "taylor swift", "weeknd", "burna boy", "afrobeats",
    "jazz", "lofi", "amapiano", "sza", "kendrick",
  ].filter(Boolean);

  /**
   * Cache hit rate is a property of *query diversity*, not of the cache — and
   * the seed above yields only ~35 distinct terms, which any cache will serve at
   * 90%+ and which flatters the result badly.
   *
   * Real search traffic is a long tail: a handful of hot artists plus an
   * effectively unbounded set of one-off queries. `--termPool N` widens the set
   * with synthetic misses so the measured hit rate reflects that shape. Terms
   * are drawn from a Zipf-ish distribution by the caller, so popular terms still
   * repeat while the tail stays cold.
   */
  const poolSize = Number(process.argv.includes("--termPool")
    ? process.argv[process.argv.indexOf("--termPool") + 1]
    : 0);
  if (poolSize > searchTerms.length) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    for (let i = searchTerms.length; i < poolSize; i++) {
      // Deterministic, so repeated runs are comparable, and unlikely to collide
      // with anything a provider actually has — these are meant to miss.
      const a = alphabet[i % 26];
      const b = alphabet[Math.floor(i / 26) % 26];
      searchTerms.push(`${a}${b}${i} song`);
    }
  }

  return {
    users,
    tracks: tracks.length ? tracks : [{ id: "missing", title: "Unknown", artist: "Unknown", duration: 200 }],
    artists: artists.length ? artists : [{ id: "missing", name: "Unknown" }],
    albums: albums.length ? albums : [{ id: "missing", title: "Unknown" }],
    searchTerms,
    moods: ["happy", "sad", "chill", "workout", "focus", "party", "romantic", "sleep"],
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
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

async function detectBuildMode(baseUrl) {
  const r = await probe(`${baseUrl}/api/health`);
  if (r.status === 0) return "unreachable";
  // next dev advertises itself in this header; next start does not.
  if (r.headers["x-powered-by"] === "Next.js" && r.headers["cache-control"]?.includes("no-store")) {
    // Not conclusive on its own — fall through to a timing check.
  }
  const t0 = Date.now();
  await probe(`${baseUrl}/api/health`);
  const warm = Date.now() - t0;
  return warm > 400 ? "dev" : "prod";
}

if (isMainThread) {
  main().catch((err) => {
    console.error("\nLoad test failed:", err);
    process.exit(1);
  });
}
