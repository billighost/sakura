/** Index usage on the tables whose row cost dominates the storage budget. */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  for (const t of ["ListeningHistory", "Favorite", "ArtistAffinity", "Track"]) {
    const r = await pool.query(
      `SELECT indexrelname i, idx_scan s FROM pg_stat_user_indexes
        WHERE relname = $1 ORDER BY s DESC`,
      [t]
    );
    console.log(`\n  ${t}:`);
    for (const x of r.rows) console.log(`    ${x.i.padEnd(44)} scans=${String(x.s).padStart(6)}`);
  }
  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
