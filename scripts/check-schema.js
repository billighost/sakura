/**
 * Verify the schema assumptions the chart rewrite depends on:
 *   - Track."deezerId" has a unique constraint (required by ON CONFLICT)
 *   - Track."createdAt" exists (used to pick the oldest match deterministically)
 *   - Artist.name is unique (required by the artist upsert)
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const cols = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('Track','Artist') AND column_name IN ('deezerId','createdAt','name')
      ORDER BY table_name, column_name`
  );
  console.log("\nRelevant columns:");
  for (const r of cols.rows) console.log(`  ${r.table_name}.${r.column_name}`);

  const idx = await pool.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('Track','Artist') ORDER BY tablename, indexname`
  );
  console.log("\nIndexes:");
  for (const r of idx.rows) {
    const uniq = r.indexdef.includes("UNIQUE") ? "UNIQUE " : "       ";
    console.log(`  ${uniq}${r.tablename}.${r.indexname}`);
    console.log(`          ${r.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, "")}`);
  }

  // The decisive check: does ON CONFLICT ("deezerId") actually have an arbiter?
  const arbiter = idx.rows.find(
    (r) => r.tablename === "Track" && r.indexdef.includes("UNIQUE") && r.indexdef.includes("deezerId")
  );
  console.log(
    `\n  ON CONFLICT ("deezerId") is ${arbiter ? "VALID ✓" : "INVALID ✖ — no unique index on Track.deezerId"}`
  );

  const artistUniq = idx.rows.find(
    (r) => r.tablename === "Artist" && r.indexdef.includes("UNIQUE") && r.indexdef.includes("name")
  );
  console.log(
    `  ON CONFLICT (name)         is ${artistUniq ? "VALID ✓" : "INVALID ✖ — no unique index on Artist.name"}`
  );

  // How many tracks have a NULL deezerId? Those never conflict, so repeated
  // chart refreshes could duplicate them.
  const nulls = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "Track" WHERE "deezerId" IS NULL`
  );
  console.log(`  Tracks with NULL deezerId: ${nulls.rows[0].n}`);

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
