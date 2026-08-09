/**
 * Where is the storage actually going, and how much of it is avoidable?
 *
 * Three questions this answers:
 *   1. How much of the catalogue is *placeholder* data — rows that exist only
 *      to be referenced, never played? Those are candidates for virtualisation.
 *   2. How much is derived data we already re-fetch and cache anyway (credits,
 *      contributors), and therefore need not be authoritative in Postgres?
 *   3. How much is pure id overhead from storing UUIDs as `text` (37 bytes)
 *      rather than the native `uuid` type (16 bytes)?
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;

  // ── 1. Placeholder vs real catalogue ─────────────────────────────────────
  const tracks = (
    await q(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE "audioUrl" IS NULL OR "audioUrl" IN ('', 'pending'))::int AS placeholder,
      COUNT(*) FILTER (WHERE "audioUrl" LIKE 'https://cdnt-preview%')::int AS preview_only,
      COUNT(*) FILTER (WHERE "telegramMessageId" IS NOT NULL)::int AS real_audio,
      COUNT(*) FILTER (WHERE "audioUrl" LIKE 'https://res.cloudinary%')::int AS on_cdn
    FROM "Track"`)
  )[0];

  console.log(`\n  ── Catalogue composition ──`);
  console.log(`    total tracks:            ${tracks.total}`);
  console.log(`    real audio (telegram):   ${tracks.real_audio}`);
  console.log(`    promoted to CDN:         ${tracks.on_cdn}`);
  console.log(`    30s preview only:        ${tracks.preview_only}   ← Deezer preview, not owned audio`);
  console.log(`    placeholders ('pending'):${String(tracks.placeholder).padStart(4)}   ← never playable`);

  // Which of those placeholders exist only because a chart references them?
  const chartOnly = (
    await q(`
    SELECT COUNT(*)::int AS n FROM "Track" t
     WHERE ("audioUrl" IS NULL OR "audioUrl" IN ('', 'pending'))
       AND EXISTS (SELECT 1 FROM "SystemPlaylist" sp WHERE t.id = ANY(sp."trackIds"))
       AND NOT EXISTS (SELECT 1 FROM "Favorite" f WHERE f."trackId" = t.id)
       AND NOT EXISTS (SELECT 1 FROM "PlaylistTrack" pt WHERE pt."trackId" = t.id)
       AND NOT EXISTS (SELECT 1 FROM "ListeningHistory" h WHERE h."trackId" = t.id)`)
  )[0].n;
  console.log(`    …of which chart-only:    ${String(chartOnly).padStart(4)}   ← nobody liked/played them`);

  // ── 2. Derived data that is also cached externally ───────────────────────
  const derived = (
    await q(`
    SELECT
      (SELECT COUNT(*)::int FROM "TrackCredit")   AS credits,
      (SELECT COUNT(*)::int FROM "TrackArtist")   AS contributors,
      (SELECT COUNT(*)::int FROM "SampledTrack")  AS samples`)
  )[0];
  console.log(`\n  ── Derived data (re-fetchable from Deezer, cached 30d) ──`);
  console.log(`    TrackCredit rows:  ${derived.credits}`);
  console.log(`    TrackArtist rows:  ${derived.contributors}`);
  console.log(`    SampledTrack rows: ${derived.samples}`);

  // ── 3. Id overhead ───────────────────────────────────────────────────────
  const idCols = await q(`
    SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND (c.column_name = 'id' OR c.column_name LIKE '%Id')
       AND c.data_type = 'text'
     ORDER BY c.table_name, c.column_name`);

  console.log(`\n  ── Id columns stored as text instead of uuid ──`);
  console.log(`    ${idCols.length} columns across ${new Set(idCols.map((r) => r.table_name)).size} tables`);
  console.log(`    Each costs 37 bytes per row instead of 16 — and every index on`);
  console.log(`    one of them carries that width too.`);

  // Index-to-heap ratio per table: where the overhead concentrates.
  const ratios = await q(`
    SELECT c.relname AS name,
           pg_relation_size(c.oid) AS heap,
           pg_indexes_size(c.oid) AS idx,
           (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = c.oid) AS n_idx,
           COALESCE(s.n_live_tup,0) AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname='public' AND c.relkind='r' AND COALESCE(s.n_live_tup,0) > 10
     ORDER BY pg_indexes_size(c.oid) DESC`);

  console.log(`\n  ── Index overhead by table ──`);
  console.log(`    ${"table".padEnd(20)}${"rows".padStart(6)}${"idxs".padStart(6)}${"heap".padStart(9)}${"index".padStart(9)}  ratio`);
  for (const r of ratios) {
    const heap = Number(r.heap), idx = Number(r.idx);
    console.log(
      `    ${r.name.padEnd(20)}${String(r.rows).padStart(6)}${String(r.n_idx).padStart(6)}` +
        `${(Math.round(heap / 1024) + "KB").padStart(9)}${(Math.round(idx / 1024) + "KB").padStart(9)}` +
        `  ${heap ? (idx / heap).toFixed(1) + "x" : "-"}`
    );
  }

  // Unused indexes are pure cost.
  const unused = await q(`
    SELECT relname AS tbl, indexrelname AS idx, pg_relation_size(indexrelid) AS bytes
      FROM pg_stat_user_indexes
     WHERE idx_scan = 0 AND NOT indexrelname LIKE '%_pkey'
     ORDER BY pg_relation_size(indexrelid) DESC`);
  console.log(`\n  ── Indexes never scanned (since last stats reset) ──`);
  if (!unused.length) console.log(`    none`);
  for (const u of unused) console.log(`    ${u.tbl}.${u.idx}  ${Math.round(u.bytes / 1024)}KB`);

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
