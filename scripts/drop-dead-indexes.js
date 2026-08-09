/**
 * Drop indexes that measurement shows earn nothing.
 *
 * Each entry below is justified by `pg_stat_user_indexes` and by there being
 * another index that already serves the same lookup. Index bytes are not free
 * on a 500 MB tier: they are ~57% of a ListeningHistory row.
 *
 * Deliberately NOT dropped:
 *   ListeningHistory_pkey     0 scans, but Prisma requires an @id and removing
 *                             it means a schema migration, not an index drop.
 *   Track_sourceHash_key      0 scans, but it is a uniqueness constraint that
 *                             prevents duplicate uploads — correctness, not speed.
 *   Track_telegramFileId_key  same: 0 scans, still the dedupe guard.
 *
 * Run with --apply to execute; default is a dry run.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const DROPS = [
  {
    index: "Track_deezerId_idx",
    reason: "duplicate of the unique Track_deezerId_key, which serves the same lookups",
  },
];

(async () => {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  console.log(`\n  ${apply ? "APPLYING" : "DRY RUN"} — dead index removal\n`);
  let freed = 0;

  for (const d of DROPS) {
    const { rows } = await pool.query(
      `SELECT pg_relation_size(indexrelid) b, idx_scan s
         FROM pg_stat_user_indexes WHERE indexrelname = $1`,
      [d.index]
    );
    if (!rows.length) {
      console.log(`    – ${d.index}: already gone`);
      continue;
    }
    const kb = (Number(rows[0].b) / 1024).toFixed(0);
    freed += Number(rows[0].b);
    console.log(`    ${apply ? "✓" : "→"} ${d.index}  (${kb} KB, ${rows[0].s} scans)`);
    console.log(`        ${d.reason}`);
    if (apply) await pool.query(`DROP INDEX IF EXISTS "${d.index}"`);
  }

  console.log(`\n  ${apply ? "Freed" : "Would free"} ${(freed / 1024).toFixed(0)} KB now, and ` +
    `~${DROPS.length * 47} B per future row.\n`);
  if (!apply) console.log("  Re-run with --apply to execute.\n");

  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
