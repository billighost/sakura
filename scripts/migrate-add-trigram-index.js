/**
 * Install pg_trgm and the trigram indexes the search query needs.
 *
 * The local half of search filters with `t.title % $1` — pg_trgm's similarity
 * operator. The extension was never installed, so that operator does not exist
 * and the query has been throwing `operator does not exist: text % unknown` on
 * every search since it was written. A `.catch(() => [])` at the call site
 * turned that into an empty array, so the failure presented as "you have
 * nothing matching in your library" rather than as an error — which is exactly
 * the trap `softFail` in lib/sql.ts exists to warn about.
 *
 * It is also why search collapsed under load. Each doomed query still takes a
 * pool connection and a round trip to fail, so 200 concurrent searches meant
 * 200 concurrent pointless queries, a saturated pool, 7.8s waits, and client
 * timeouts that looked like a provider problem.
 *
 * Plain btree indexes on these columns (which do exist) are no help: `%` can
 * only use GIN/GiST with trgm_ops. That's why the schema looks indexed and
 * isn't.
 *
 * Run with --apply to commit.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const before = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`);
  console.log(`\n  pg_trgm currently installed: ${before.rowCount > 0 ? "yes" : "no"}`);

  if (!APPLY) {
    console.log(`\n  Would run:`);
    console.log(`    CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log(`    CREATE INDEX "Track_title_trgm_idx"  ON "Track"  USING gin (title gin_trgm_ops);`);
    console.log(`    CREATE INDEX "Artist_name_trgm_idx"  ON "Artist" USING gin (name  gin_trgm_ops);`);
    console.log(`\n  DRY RUN — re-run with --apply.\n`);
    await pool.end();
    return;
  }

  console.log(`\n  Installing extension …`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Not CONCURRENTLY: these tables are small and this is a one-off, so the
  // brief lock is cheaper than the extra complexity of a concurrent build that
  // can leave an invalid index behind if it fails.
  console.log(`  Building trigram index on Track.title …`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "Track_title_trgm_idx" ON "Track" USING gin (title gin_trgm_ops)`
  );
  console.log(`  Building trigram index on Artist.name …`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "Artist_name_trgm_idx" ON "Artist" USING gin (name gin_trgm_ops)`
  );

  await pool.query(`ANALYZE "Track"`);
  await pool.query(`ANALYZE "Artist"`);

  // Prove the operator resolves and the query returns rows now.
  const t0 = Date.now();
  const res = await pool.query(
    `SELECT t.id, t.title FROM "Track" t JOIN "Artist" a ON a.id = t."artistId"
      WHERE t.title % $1
      UNION
     SELECT t.id, t.title FROM "Track" t JOIN "Artist" a ON a.id = t."artistId"
      WHERE a.name % $1
      LIMIT $2`,
    ["olivia", 10]
  );
  console.log(`\n  Verification query: ${res.rowCount} rows in ${Date.now() - t0}ms`);
  for (const r of res.rows.slice(0, 5)) console.log(`    "${r.title}"`);

  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE tablename IN ('Track','Artist') AND indexdef ILIKE '%gin%'
  `);
  console.log(`\n  Trigram indexes now present: ${idx.rows.map((r) => r.indexname).join(", ")}`);
  console.log(`\n  COMMITTED ✓\n`);

  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
