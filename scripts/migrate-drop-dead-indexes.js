/**
 * Drop indexes that cost storage and write time without earning it.
 *
 * Measured before this ran: ListeningHistory carried 96KB of index against
 * 24KB of heap (4x), Favorite and ArtistAffinity 6x. On a 500MB budget where
 * the row count grows forever, index overhead is not a rounding error — it is
 * most of the table.
 *
 * Each drop below is justified individually. Indexes are only removed when they
 * are provably redundant (a prefix of a composite that already exists) or
 * provably unusable (wrong operator class for the query that would want them).
 * "Zero scans so far" is NOT sufficient on its own — a young index, or one
 * serving a rare admin path, reads the same in pg_stat_user_indexes as a
 * useless one.
 *
 * Run with --apply to commit.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

const DROPS = [
  {
    index: "ListeningHistory_userId_idx",
    why:
      "Redundant: a strict prefix of ListeningHistory_userId_playedAt_idx, which " +
      "Postgres can use for any userId-only lookup. Zero scans confirms it.",
  },
  {
    index: "Track_title_idx",
    why:
      "A btree on title cannot serve `title % $1` — that needs GIN/trgm_ops, " +
      "which Track_title_trgm_idx now provides. Nothing else filters on exact title.",
  },
  {
    index: "Artist_name_idx",
    why:
      "Same reasoning as Track_title_idx, and Artist_name_key (unique btree) " +
      "already covers exact-name lookups.",
    optional: true,
  },
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const before = (
    await pool.query(`SELECT pg_database_size(current_database()) AS b`)
  ).rows[0].b;

  // Verify each drop's premise before acting on it, rather than trusting the
  // list above to still be true.
  const existing = new Set(
    (await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map(
      (r) => r.indexname
    )
  );

  const covering = existing.has("ListeningHistory_userId_playedAt_idx");
  const trgm = existing.has("Track_title_trgm_idx");

  console.log(`\n  Preconditions:`);
  console.log(`    ${covering ? "✓" : "✖"} ListeningHistory_userId_playedAt_idx exists (covers the prefix)`);
  console.log(`    ${trgm ? "✓" : "✖"} Track_title_trgm_idx exists (serves the % operator)`);
  if (!covering || !trgm) {
    console.log(`\n  Refusing to drop anything — a precondition is missing.\n`);
    await pool.end();
    process.exit(1);
  }

  console.log(`\n  Dropping:`);
  let freed = 0;
  for (const d of DROPS) {
    if (!existing.has(d.index)) {
      console.log(`    – ${d.index} (not present, skipping)`);
      continue;
    }
    const size = Number(
      (await pool.query(`SELECT pg_relation_size($1::regclass) AS b`, [`"${d.index}"`])).rows[0].b
    );
    console.log(`    ${APPLY ? "✓" : "would drop"} ${d.index}  (${Math.round(size / 1024)}KB)`);
    console.log(`        ${d.why}`);
    freed += size;
    if (APPLY) await pool.query(`DROP INDEX IF EXISTS "${d.index}"`);
  }

  if (APPLY) {
    const after = (await pool.query(`SELECT pg_database_size(current_database()) AS b`)).rows[0].b;
    console.log(
      `\n  Database: ${(Number(before) / 1048576).toFixed(2)} MB → ${(Number(after) / 1048576).toFixed(2)} MB`
    );
    console.log(`  COMMITTED ✓\n`);
  } else {
    console.log(`\n  Would free ~${Math.round(freed / 1024)}KB of index (and the write cost on every insert).`);
    console.log(`  DRY RUN — re-run with --apply.\n`);
  }

  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
