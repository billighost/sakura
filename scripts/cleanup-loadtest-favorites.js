/**
 * Remove favourites the load test created.
 *
 * Identified by write rate, not content: the harness drives the real
 * /api/favorites endpoint, so its rows are indistinguishable from a person's
 * except that a person does not like nineteen songs in fifty-eight seconds.
 * Only minutes containing more than `BURST_THRESHOLD` likes are removed, which
 * leaves sparse human-paced likes untouched even if that means a few test rows
 * survive — erring toward keeping a real like rather than deleting one.
 *
 * Run with --apply to commit; default is a dry run.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const BURST_THRESHOLD = 3;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const before = (await client.query(`SELECT COUNT(*)::int AS n FROM "Favorite"`)).rows[0].n;

    const { rows: bursts } = await client.query(
      `SELECT date_trunc('minute', "createdAt") AS minute, COUNT(*)::int AS n
         FROM "Favorite"
        GROUP BY 1 HAVING COUNT(*) > $1
        ORDER BY 1`,
      [BURST_THRESHOLD]
    );

    console.log(`\n  Favourites before: ${before}`);
    console.log(`  Burst minutes (>${BURST_THRESHOLD} likes):`);
    for (const b of bursts) {
      console.log(`    ${new Date(b.minute).toISOString().slice(0, 16).replace("T", " ")}  ${b.n} rows`);
    }

    const del = await client.query(
      `DELETE FROM "Favorite"
        WHERE date_trunc('minute', "createdAt") IN (
          SELECT date_trunc('minute', "createdAt") FROM "Favorite"
           GROUP BY 1 HAVING COUNT(*) > $1
        )`,
      [BURST_THRESHOLD]
    );

    const after = (await client.query(`SELECT COUNT(*)::int AS n FROM "Favorite"`)).rows[0].n;
    console.log(`\n  Deleted: ${del.rowCount}`);
    console.log(`  Favourites after: ${after}`);

    const { rows: remaining } = await client.query(`
      SELECT u.username, t.title, COALESCE(a.name,'?') AS artist, f."createdAt"
        FROM "Favorite" f
        JOIN "User" u ON u.id = f."userId"
        JOIN "Track" t ON t.id = f."trackId"
        LEFT JOIN "Artist" a ON a.id = t."artistId"
       ORDER BY f."createdAt"
    `);
    console.log(`\n  Remaining likes:`);
    for (const r of remaining) {
      console.log(
        `    ${new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}  ` +
          `"${r.title}" — ${r.artist}`
      );
    }

    if (APPLY) {
      await client.query("COMMIT");
      console.log("\n  COMMITTED ✓");

      // These rows are cached; drop the keys the write path would have busted.
      const { Redis } = require("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      const users = (await pool.query(`SELECT id FROM "User"`)).rows;
      for (const u of users) {
        await redis.del(`favorites:${u.id}`, `home:${u.id}`, `radio:${u.id}`, `radioctx:${u.id}`);
      }
      console.log(`  Cleared caches for ${users.length} user(s) ✓\n`);
    } else {
      await client.query("ROLLBACK");
      console.log("\n  DRY RUN — rolled back. Re-run with --apply.\n");
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("\nFAILED, rolled back:", e.message, "\n");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
