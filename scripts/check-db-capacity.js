/**
 * Real per-row storage cost, and what the 500MB Neon budget buys.
 *
 * A naive `pg_total_relation_size / row_count` is badly wrong on a small
 * database: every table and index allocates whole 8KB pages, so a table with
 * two rows reports tens of kilobytes per row. Projecting from that produced
 * "1000 users fills the disk in -6 days", which is obviously nonsense and would
 * have been an embarrassing thing to report.
 *
 * This measures the actual tuple width with `pg_column_size` over live rows,
 * adds Postgres' 24-byte tuple header, and applies an index-overhead ratio
 * measured from the largest table that has enough rows for the ratio to mean
 * something. Where a table is empty, a conservative literal is used and marked
 * as such.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const TUPLE_HEADER = 24;

/** Tables whose row count scales with plays, signups, or catalogue size. */
const GROWTH = {
  ListeningHistory: "per play (unbounded over time)",
  Favorite: "per like",
  ArtistAffinity: "per user × artists they play",
  GenreAffinity: "per user × genres",
  Track: "per catalogue track",
  Artist: "per catalogue artist",
  TrackArtist: "per track × credited artists",
  TrackCredit: "per track × credits",
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const dbBytes = Number(
    (await pool.query(`SELECT pg_database_size(current_database()) AS b`)).rows[0].b
  );

  // Index overhead as a ratio of heap, measured where there are enough rows to
  // be meaningful rather than assumed.
  const { rows: ratioRows } = await pool.query(`
    SELECT c.relname AS name,
           pg_relation_size(c.oid) AS heap,
           pg_indexes_size(c.oid) AS idx,
           COALESCE(s.n_live_tup, 0) AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND COALESCE(s.n_live_tup,0) > 50
     ORDER BY s.n_live_tup DESC
  `);
  let indexRatio = 1.6;
  if (ratioRows.length) {
    const heap = ratioRows.reduce((a, r) => a + Number(r.heap), 0);
    const idx = ratioRows.reduce((a, r) => a + Number(r.idx), 0);
    if (heap > 0) indexRatio = 1 + idx / heap;
  }

  async function rowCost(table, fallback) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(AVG(pg_column_size(t.*)), 0)::numeric AS w
         FROM "${table}" t`
    );
    const n = rows[0].n;
    if (n < 5) return { bytes: fallback, measured: false, n };
    const bytes = Math.round((Number(rows[0].w) + TUPLE_HEADER) * indexRatio);
    return { bytes, measured: true, n };
  }

  console.log(`\n  Database: ${(dbBytes / 1048576).toFixed(2)} MB of 500 MB (${((dbBytes / (500 * 1048576)) * 100).toFixed(1)}%)`);
  console.log(`  Index overhead measured at ${((indexRatio - 1) * 100).toFixed(0)}% of heap\n`);

  console.log(`  ${"table".padEnd(20)}${"rows".padStart(7)}${"B/row".padStart(9)}   growth`);
  console.log(`  ${"-".repeat(72)}`);

  const costs = {};
  const fallbacks = {
    ListeningHistory: 90, Favorite: 80, ArtistAffinity: 80, GenreAffinity: 70,
    Track: 700, Artist: 250, TrackArtist: 70, TrackCredit: 90,
  };
  for (const [t, note] of Object.entries(GROWTH)) {
    const c = await rowCost(t, fallbacks[t]);
    costs[t] = c.bytes;
    console.log(
      `  ${t.padEnd(20)}${String(c.n).padStart(7)}${String(c.bytes).padStart(8)}B   ${note}` +
        (c.measured ? "" : "  (estimated — too few rows)")
    );
  }

  // ── What actually fills the disk ─────────────────────────────────────────
  const BUDGET = 500 * 1048576;
  const ACCOUNT_FIXED = 3000; // User + TasteProfile + Settings + PlaybackState rows

  console.log(`\n  ── Capacity ──`);
  console.log(`  Assumptions: 20 plays/user/day, 60 likes/user, 80 affinity rows/user,`);
  console.log(`               catalogue grows to 5,000 tracks\n`);

  const catalogueBytes =
    5000 * costs.Track + 2000 * costs.Artist + 10000 * costs.TrackArtist + 15000 * costs.TrackCredit;
  console.log(`  Catalogue at 5,000 tracks: ${(catalogueBytes / 1048576).toFixed(1)} MB (one-off, shared by everyone)`);

  const perUserSignup = ACCOUNT_FIXED + 60 * costs.Favorite + 80 * costs.ArtistAffinity + 30 * costs.GenreAffinity;
  console.log(`  Per registered user:       ${(perUserSignup / 1024).toFixed(1)} KB (one-off at signup + usage)`);
  console.log(`  Per play logged:           ${costs.ListeningHistory} B (accumulates forever)\n`);

  for (const u of [100, 500, 1000, 2500, 5000]) {
    const fixed = catalogueBytes + u * perUserSignup;
    const perMonth = u * 20 * 30 * costs.ListeningHistory;
    const headroom = BUDGET - fixed;
    const months = headroom > 0 ? headroom / perMonth : 0;
    const verdict =
      headroom <= 0
        ? "OVER BUDGET on accounts alone"
        : months > 24
        ? `${(months / 12).toFixed(1)} yrs of history`
        : `${months.toFixed(1)} months of history`;
    console.log(
      `    ${String(u).padStart(5)} users → fixed ${(fixed / 1048576).toFixed(0).padStart(4)} MB, ` +
        `history ${(perMonth / 1048576).toFixed(1).padStart(6)} MB/mo → ${verdict}`
    );
  }

  console.log(`\n  With a 90-day retention window on ListeningHistory:`);
  for (const u of [1000, 5000, 10000]) {
    const fixed = catalogueBytes + u * perUserSignup;
    const steady = u * 20 * 90 * costs.ListeningHistory;
    const totalMb = (fixed + steady) / 1048576;
    console.log(
      `    ${String(u).padStart(5)} users → steady state ${totalMb.toFixed(0).padStart(4)} MB ` +
        `${totalMb < 500 ? "✓ fits" : "✖ over"}`
    );
  }

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
