/**
 * Capacity against Neon's 500 MB, using marginal row cost.
 *
 * The trap this avoids: `pg_total_relation_size / row_count` on a nearly-empty
 * table charges whole 8 KB pages and five index page-headers to a handful of
 * rows, which reported ~2.9 KB per listening-history row and a ceiling of 75
 * users. The real marginal cost of the next row is far lower.
 *
 * So heap is measured with `pg_column_size` over live rows (actual encoded
 * bytes) plus Postgres' 24-byte tuple header, and index cost is derived from
 * the declared key widths — a btree entry is roughly the key plus a 6-byte item
 * pointer and a 4-byte line pointer. That predicts what a millionth row costs,
 * which is the question.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const LIMIT_MB = 500;
const HEADROOM = 0.8;      // autovacuum, WAL and bloat need slack
const BTREE_ENTRY_OVERHEAD = 10;

/** Bytes a value of this type occupies in a tuple. */
function typeWidth(dataType, colName) {
  switch (dataType) {
    case "integer": return 4;
    case "bigint": case "double precision": case "timestamp without time zone": return 8;
    case "boolean": return 1;
    case "uuid": return 16;
    case "text": case "character varying":
      // Ids in this schema are uuid-shaped strings: 36 chars + 1 length byte.
      return /Id$|^id$/.test(colName) ? 37 : 24;
    default: return 8;
  }
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const q = async (s, p) => (await pool.query(s, p)).rows;

  async function marginalCost(table) {
    const cols = await q(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`, [table]);
    if (!cols.length) return null;

    // Prefer measured encoded width; fall back to declared types when the
    // table is empty.
    let heap = 0;
    const live = await q(`SELECT COUNT(*)::int n FROM "${table}"`);
    if (live[0].n > 0) {
      const w = await q(`SELECT AVG(pg_column_size(t.*))::numeric AS w FROM "${table}" t`);
      heap = Math.round(Number(w[0].w)) + 24;
    } else {
      heap = cols.reduce((a, c) => a + typeWidth(c.data_type, c.column_name), 0) + 24;
    }

    const idx = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [table]);
    const widthOf = (name) => {
      const c = cols.find((x) => x.column_name === name);
      return c ? typeWidth(c.data_type, c.column_name) : 8;
    };
    let indexBytes = 0;
    for (const i of idx) {
      const m = i.indexdef.match(/\(([^)]+)\)/);
      if (!m) continue;
      const keys = m[1].split(",").map((s) => s.trim().replace(/"/g, "").split(" ")[0]);
      indexBytes += keys.reduce((a, k) => a + widthOf(k), 0) + BTREE_ENTRY_OVERHEAD;
    }
    return { heap, indexBytes, total: heap + indexBytes, indexes: idx.length };
  }

  const RAW_DAYS = Number(process.env.HISTORY_RAW_DAYS) || 60;
  const PLAYS_PER_DAY = Number(process.env.PLAYS_PER_DAY) || 20;

  const hist = await marginalCost("ListeningHistory");
  const agg = await marginalCost("PlayAggregate");
  const fav = await marginalCost("Favorite");
  const aff = await marginalCost("ArtistAffinity");

  console.log(`\n  Marginal cost per row (heap + index):`);
  for (const [n, c] of [["ListeningHistory", hist], ["PlayAggregate", agg], ["Favorite", fav], ["ArtistAffinity", aff]]) {
    console.log(`    ${n.padEnd(18)} ${String(c.total).padStart(4)} B  (${c.heap} heap + ${c.indexBytes} across ${c.indexes} indexes)`);
  }

  const shared = Number((await q(`
    SELECT COALESCE(SUM(pg_total_relation_size(c.oid)),0) b FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND relname IN ('Track','Artist','Album','TrackArtist','TrackCredit','SystemPlaylist','SampledTrack')`))[0].b);

  console.log(`\n  Shared catalogue today: ${(shared / 1048576).toFixed(1)} MB (flat — same for 1 user or 100k)`);

  const scenarios = [
    { days: 30, label: "30-day raw window" },
    { days: 60, label: "60-day raw window" },
    { days: RAW_DAYS, label: `${RAW_DAYS}-day raw window (current)` },
  ];

  console.log(`\n  Per-user steady state, at ${PLAYS_PER_DAY} plays/day:`);
  const results = [];
  for (const s of scenarios) {
    const rawRows = s.days * PLAYS_PER_DAY;
    const bytes =
      rawRows * hist.total +          // raw window
      600 * agg.total +               // one aggregate per distinct track ever
      300 * aff.total +               // artist affinities
      150 * fav.total +               // favourites
      6000;                           // profile, settings, playlists
    results.push({ ...s, bytes });
    console.log(`    ${s.label.padEnd(30)} ${(bytes / 1024).toFixed(0).padStart(5)} KB/user  (${rawRows} raw rows)`);
  }

  const budgetBytes = (LIMIT_MB * HEADROOM) * 1048576 - shared;
  console.log(`\n  Usable budget: ${(budgetBytes / 1048576).toFixed(0)} MB  (${LIMIT_MB} × ${HEADROOM} headroom − catalogue)`);
  console.log(`\n  Monthly-active user ceiling:`);
  for (const r of results) {
    console.log(`    ${r.label.padEnd(30)} ${Math.floor(budgetBytes / r.bytes).toLocaleString().padStart(7)} users`);
  }

  // Catalogue growth is worth stating separately — it is shared, but not free.
  const trackCost = await marginalCost("Track");
  console.log(`\n  Catalogue growth: ${trackCost.total} B/track → 10k tracks ≈ ${((10000 * trackCost.total) / 1048576).toFixed(0)} MB`);
  console.log("");

  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
