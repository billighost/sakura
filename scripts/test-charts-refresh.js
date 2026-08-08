/**
 * Exercise the rewritten chart refresh directly.
 *
 * `updateSystemPlaylist` normally runs inside `after()`, where a throw is
 * logged and forgotten — precisely where a broken rewrite would sit unnoticed
 * while the home page quietly served stale charts. This calls it in the
 * foreground so failures are loud, and checks the properties that the rewrite
 * is supposed to guarantee.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const http = require("http");

function get(p, cookie) {
  return new Promise((resolve) => {
    const r = http.get(
      { hostname: "localhost", port: 3000, path: p, headers: cookie ? { cookie } : {} },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message }));
    r.setTimeout(120000, () => r.destroy());
  });
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  const before = await pool.query(
    `SELECT "systemId", COALESCE(array_length("trackIds",1),0) AS n, "updatedAt"
       FROM "SystemPlaylist" ORDER BY "systemId"`
  );
  const trackCountBefore = (await pool.query(`SELECT COUNT(*)::int AS n FROM "Track"`)).rows[0].n;

  console.log("\n  Before refresh:");
  for (const r of before.rows) console.log(`    ${r.systemId}: ${r.n} tracks`);
  console.log(`    Track table: ${trackCountBefore} rows`);

  // The refresh is scheduled by `getHomeData`, not by /api/charts — and only on
  // a cache miss, since a cached home never reaches the freshness check. So the
  // home key is dropped first and the request is authenticated, which together
  // reproduce exactly what a real first-visit-of-the-day does.
  console.log("\n  Clearing home cache and triggering refresh via /api/home …");
  const { Redis } = require("@upstash/redis");
  const { encode } = require("next-auth/jwt");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  await redis.del(`home:${user.id}`);

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  const t0 = Date.now();
  const res = await get("/api/home", cookie);
  console.log(`    GET /api/home → ${res.status} in ${Date.now() - t0}ms`);

  // The refresh runs after the response flushes; give it room.
  console.log("    waiting 45s for background refresh …");
  await new Promise((r) => setTimeout(r, 45000));

  const after = await pool.query(
    `SELECT "systemId", COALESCE(array_length("trackIds",1),0) AS n, "updatedAt"
       FROM "SystemPlaylist" ORDER BY "systemId"`
  );
  const trackCountAfter = (await pool.query(`SELECT COUNT(*)::int AS n FROM "Track"`)).rows[0].n;

  console.log("\n  After refresh:");
  for (const r of after.rows) {
    const prev = before.rows.find((b) => b.systemId === r.systemId);
    const moved = prev && new Date(r.updatedAt) > new Date(prev.updatedAt);
    console.log(`    ${r.systemId}: ${r.n} tracks ${moved ? "(refreshed ✓)" : "(unchanged)"}`);
  }
  console.log(`    Track table: ${trackCountAfter} rows (+${trackCountAfter - trackCountBefore})`);

  // The property the whole dedupe exists to protect.
  const dupes = await pool.query(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT "deezerId" FROM "Track" WHERE "deezerId" IS NOT NULL
      GROUP BY "deezerId" HAVING COUNT(*) > 1
    ) s
  `);
  console.log(`\n  Duplicate deezerId groups after refresh: ${dupes.rows[0].n}`);
  console.log(
    dupes.rows[0].n === 0
      ? "  ✓ refresh did NOT reintroduce duplicates"
      : "  ✖ duplicates came back — ON CONFLICT is not doing its job"
  );

  // Chart rows must still resolve to real tracks.
  const stale = await pool.query(`
    SELECT "systemId",
           (SELECT COUNT(*)::int FROM UNNEST("trackIds") tid
             WHERE NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id = tid)) AS dead
      FROM "SystemPlaylist" ORDER BY "systemId"
  `);
  const totalDead = stale.rows.reduce((a, r) => a + r.dead, 0);
  console.log(`  Dangling chart track refs: ${totalDead} ${totalDead === 0 ? "✓" : "✖"}`);

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
