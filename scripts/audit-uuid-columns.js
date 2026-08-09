/**
 * Which text id columns can actually become native `uuid`?
 *
 * `uuid` is 16 bytes against 37 for the text form, and every index on such a
 * column carries that width too — so the saving is large. But the conversion is
 * only safe where every existing value parses as a UUID, and in this schema
 * that is emphatically not everywhere: the download path creates Track rows
 * whose ids are literally `deezer-2177406017`, and charts now reference the
 * same shape. Casting those would fail outright, or worse, be "fixed" by
 * someone rewriting the ids and silently breaking every reference to them.
 *
 * A column is convertible only if BOTH sides of every relationship it
 * participates in are convertible, so this reports the FK graph as well as the
 * per-column verdict. Read-only.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const UUID_RE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const q = async (s, p) => (await pool.query(s, p)).rows;

  // Every text column that looks like an identifier.
  const cols = await q(`
    SELECT c.table_name AS tbl, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.data_type = 'text'
       AND (c.column_name = 'id' OR c.column_name LIKE '%Id')
     ORDER BY c.table_name, c.column_name
  `);

  // The FK graph, so a column is never judged in isolation.
  const fks = await q(`
    SELECT tc.table_name AS child, kcu.column_name AS child_col,
           ccu.table_name AS parent, ccu.column_name AS parent_col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  console.log(`\n  Auditing ${cols.length} text id columns…\n`);

  const verdict = new Map();
  for (const { tbl, col } of cols) {
    const [{ total, bad, sample }] = await q(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "${col}" IS NOT NULL AND "${col}" !~ $1)::int AS bad,
              (SELECT "${col}" FROM "${tbl}" WHERE "${col}" IS NOT NULL AND "${col}" !~ $1 LIMIT 1) AS sample
         FROM "${tbl}"`,
      [UUID_RE]
    );
    verdict.set(`${tbl}.${col}`, { tbl, col, total, bad, sample });
  }

  // Propagate: if either end of an FK is dirty, neither end can convert.
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fks) {
      const c = verdict.get(`${f.child}.${f.child_col}`);
      const p = verdict.get(`${f.parent}.${f.parent_col}`);
      if (!c || !p) continue;
      if (c.bad > 0 && p.blocked !== true && p.bad === 0) { p.blocked = true; p.blockedBy = `${f.child}.${f.child_col}`; changed = true; }
      if (p.bad > 0 && c.blocked !== true && c.bad === 0) { c.blocked = true; c.blockedBy = `${f.parent}.${f.parent_col}`; changed = true; }
      if ((p.blocked || p.bad > 0) && !c.blocked && c.bad === 0) { c.blocked = true; c.blockedBy = `${f.parent}.${f.parent_col}`; changed = true; }
      if ((c.blocked || c.bad > 0) && !p.blocked && p.bad === 0) { p.blocked = true; p.blockedBy = `${f.child}.${f.child_col}`; changed = true; }
    }
  }

  const ok = [], dirty = [], blocked = [];
  for (const v of verdict.values()) {
    if (v.bad > 0) dirty.push(v);
    else if (v.blocked) blocked.push(v);
    else ok.push(v);
  }

  console.log(`  ✖ NOT convertible — contains non-UUID values:`);
  for (const v of dirty) {
    console.log(`      ${`${v.tbl}.${v.col}`.padEnd(34)} ${v.bad}/${v.total} bad   e.g. "${v.sample}"`);
  }

  console.log(`\n  ✖ Blocked — clean, but joined to a dirty column:`);
  for (const v of blocked) {
    console.log(`      ${`${v.tbl}.${v.col}`.padEnd(34)} blocked by ${v.blockedBy}`);
  }

  console.log(`\n  ✓ Convertible to native uuid (${ok.length}):`);
  for (const v of ok) {
    console.log(`      ${`${v.tbl}.${v.col}`.padEnd(34)} ${v.total} rows`);
  }

  // What the convertible set is actually worth, counting indexes.
  let saving = 0;
  for (const v of ok) {
    const idx = await q(
      `SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE schemaname='public' AND tablename=$1 AND indexdef LIKE '%"' || $2 || '"%'`,
      [v.tbl, v.col]
    );
    const rows = await q(`SELECT COUNT(*)::int AS n FROM "${v.tbl}"`);
    // 21 bytes saved in the heap, plus 21 in each index carrying the column.
    saving += rows[0].n * 21 * (1 + idx[0].n);
  }
  console.log(`\n  Saving on current data: ~${(saving / 1024).toFixed(0)} KB`);
  console.log(`  (the real win is per future row — 21 B per column occurrence)\n`);

  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
