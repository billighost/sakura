const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { rows } = await pool.query(
    `SELECT i.indexrelname AS name, i.idx_scan AS scans,
            pg_relation_size(i.indexrelid) AS bytes,
            pg_get_indexdef(i.indexrelid) AS def
       FROM pg_stat_user_indexes i
      WHERE i.relname = 'ListeningHistory'
      ORDER BY i.idx_scan ASC`
  );
  const live = (await pool.query(`SELECT COUNT(*)::int n FROM "ListeningHistory"`)).rows[0].n;

  console.log(`\n  ListeningHistory indexes (${live} rows)\n`);
  for (const r of rows) {
    const perRow = live ? (Number(r.bytes) / live).toFixed(0) : "?";
    console.log(`    ${r.name}`);
    console.log(`      ${String(r.scans).padStart(6)} scans   ${perRow} B/row`);
    console.log(`      ${r.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING \w+ /, "")}`);
  }
  console.log();
  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
