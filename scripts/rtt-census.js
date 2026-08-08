/**
 * Round-trip census.
 *
 * Latency numbers measured from a laptop against a Frankfurt database mostly
 * describe the distance to Frankfurt. What survives the move to Vercel is the
 * *count* of round trips each endpoint makes — that number is the same in every
 * region, and multiplied by an in-region RTT it predicts production latency far
 * better than a local stopwatch does.
 *
 * It's also the free-tier currency: Upstash meters commands, so Redis calls per
 * request is literally the monthly bill.
 *
 * Runs each endpoint twice — cold (first hit, caches empty) and warm (second
 * hit) — because the gap between them is what the cache is actually buying.
 *
 *   node scripts/rtt-census.js
 */

const http = require("http");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const BASE = (process.env.LOAD_TEST_URL || "http://localhost:3000").replace(/\/$/, "");

function req(method, p, { cookie, body } = {}) {
  return new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { accept: "application/json" };
    if (cookie) headers.cookie = cookie;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = payload.length;
    }
    const started = Date.now();
    const r = http.request(
      { hostname: new URL(BASE).hostname, port: new URL(BASE).port || 80, path: p, method, headers },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b, ms: Date.now() - started }));
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message, ms: Date.now() - started }));
    r.setTimeout(60000, () => r.destroy());
    if (payload) r.write(payload);
    r.end();
  });
}

async function stats(reset) {
  const r = await req("GET", `/api/health?stats=1${reset ? "&reset=1" : ""}`);
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

async function main() {
  const { encode } = require("next-auth/jwt");
  const { Pool } = require("pg");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const users = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows;
  const tracks = (
    await pool.query(
      `SELECT t.id, t.title, COALESCE(a.name,'Unknown') artist FROM "Track" t
         LEFT JOIN "Artist" a ON a.id=t."artistId"
        WHERE t."audioUrl" IS NOT NULL AND t."audioUrl" NOT IN ('','pending') LIMIT 3`
    )
  ).rows;
  const artists = (await pool.query(`SELECT id,name FROM "Artist" LIMIT 2`)).rows;
  const albums = (await pool.query(`SELECT id,title FROM "Album" LIMIT 2`)).rows;
  await pool.end();

  const salt = "authjs.session-token";
  const token = await encode({
    token: { id: users[0].id, name: users[0].username, sub: users[0].id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  });
  const cookie = `${salt}=${token}`;

  const t = tracks[0];
  const cases = [
    ["GET  /api/home", "GET", "/api/home"],
    ["GET  /api/charts", "GET", "/api/charts"],
    ["GET  /api/profile", "GET", "/api/profile"],
    ["GET  /api/favorites", "GET", "/api/favorites"],
    ["GET  /api/history", "GET", "/api/history?limit=25"],
    ["GET  /api/tracks", "GET", "/api/tracks?limit=30"],
    ["GET  /api/artists", "GET", "/api/artists"],
    ["GET  /api/albums", "GET", "/api/albums"],
    ["GET  /api/playlists", "GET", "/api/playlists"],
    ["GET  /api/music/search", "GET", `/api/music/search?q=${encodeURIComponent("olivia")}&limit=10`],
    ["GET  /api/artists/[id]", "GET", `/api/artists/${artists[0].id}`],
    ["GET  /api/albums/[id]", "GET", `/api/albums/${albums[0].id}`],
    ["GET  /api/tracks/[id]/credits", "GET", `/api/tracks/${t.id}/credits`],
    ["GET  /api/stream/[id]", "GET", `/api/stream/${t.id}`],
    [
      "GET  /api/lyrics",
      "GET",
      `/api/lyrics?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}`,
    ],
    ["POST /api/radio", "POST", "/api/radio", { limit: 20, seedTrackId: t.id }],
    ["POST /api/signals", "POST", "/api/signals", { trackId: t.id, event: "play", msPlayed: 60000 }],
    [
      "POST /api/batch",
      "POST",
      "/api/batch",
      {
        requests: [
          { key: "t", path: "/api/tracks?limit=30" },
          { key: "a", path: "/api/artists" },
          { key: "b", path: "/api/albums" },
        ],
      },
    ],
  ];

  console.log("");
  console.log("  ROUND-TRIP CENSUS — cost per request, by endpoint");
  console.log("  " + "─".repeat(84));
  console.log(
    "  " +
      "endpoint".padEnd(30) +
      "status".padStart(7) +
      "sql".padStart(6) +
      "redis".padStart(7) +
      "  cold ms".padStart(10) +
      "  warm ms".padStart(10) +
      "  warm sql/redis".padStart(17)
  );
  console.log("  " + "─".repeat(84));

  const findings = [];

  for (const [label, method, p, body] of cases) {
    // Cold
    await stats(true);
    const cold = await req(method, p, { cookie, body });
    const coldStats = await stats(false);

    // Warm — same request again, caches now populated.
    await stats(true);
    const warm = await req(method, p, { cookie, body });
    const warmStats = await stats(false);

    const cs = coldStats?.sql?.queries ?? -1;
    const cr = coldStats?.redis?.commands ?? -1;
    const ws = warmStats?.sql?.queries ?? -1;
    const wr = warmStats?.redis?.commands ?? -1;

    const flag =
      cold.status >= 400 ? "  ← " + cold.status : cs > 6 ? "  ← many queries" : ws > 3 ? "  ← weak cache" : "";

    console.log(
      "  " +
        label.padEnd(30) +
        String(cold.status).padStart(7) +
        String(cs).padStart(6) +
        String(cr).padStart(7) +
        String(cold.ms).padStart(10) +
        String(warm.ms).padStart(10) +
        `${ws}/${wr}`.padStart(17) +
        flag
    );

    findings.push({ label, coldSql: cs, coldRedis: cr, warmSql: ws, warmRedis: wr, coldMs: cold.ms, warmMs: warm.ms, status: cold.status });
  }

  console.log("");
  const worstSql = [...findings].sort((a, b) => b.coldSql - a.coldSql).slice(0, 5);
  const worstRedis = [...findings].sort((a, b) => b.warmRedis - a.warmRedis).slice(0, 5);
  console.log("  Most Postgres round trips (cold):");
  for (const f of worstSql) console.log(`    ${String(f.coldSql).padStart(3)}  ${f.label}`);
  console.log("");
  console.log("  Most Redis commands (warm — this is the monthly Upstash bill):");
  for (const f of worstRedis) console.log(`    ${String(f.warmRedis).padStart(3)}  ${f.label}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
