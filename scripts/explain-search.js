/**
 * Why is the local search query slow?
 *
 * It uses pg_trgm's `%` similarity operator, which only uses an index if that
 * index is GIN/GiST with trgm_ops. A plain btree on the same column does
 * nothing for `%` — Postgres has to scan every row and compute similarity — but
 * it looks reassuring in `\d` and in the Prisma schema, which is how this hides.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`);
  console.log(`\n  pg_trgm installed: ${ext.rowCount > 0 ? "yes" : "NO"}`);

  const idx = await pool.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE tablename IN ('Track','Artist')
       AND (indexdef ILIKE '%gin%' OR indexdef ILIKE '%gist%' OR indexdef ILIKE '%trgm%')
  `);
  console.log(`  trigram indexes: ${idx.rowCount}`);
  for (const r of idx.rows) console.log(`    ${r.indexname}`);

  const sizes = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM "Track") AS tracks,
           (SELECT COUNT(*)::int FROM "Artist") AS artists
  `);
  console.log(`\n  rows: ${sizes.rows[0].tracks} tracks, ${sizes.rows[0].artists} artists`);

  const sql = `
    SELECT t.id, t."deezerId", t.title, t."audioUrl"
      FROM "Track" t JOIN "Artist" a ON a.id = t."artistId"
     WHERE t.title % $1
     UNION
    SELECT t.id, t."deezerId", t.title, t."audioUrl"
      FROM "Track" t JOIN "Artist" a ON a.id = t."artistId"
     WHERE a.name % $1
     LIMIT $2`;

  const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, ["taylor", 10]);
  console.log(`\n  Query plan:`);
  for (const r of plan.rows) console.log(`    ${r["QUERY PLAN"]}`);

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
