/**
 * Assert that a default (read-only) load-test run mutates nothing.
 *
 * Snapshots the tables the harness could write to, runs it, and compares. The
 * point is that "read-only" stays true as journeys get added — a new journey
 * that POSTs would otherwise be discovered the way the last one was, by finding
 * junk in a real account afterwards.
 *
 *   node scripts/verify-readonly.js
 */
const path = require("path");
const { execFileSync } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const TABLES = [
  "Favorite",
  "ListeningHistory",
  "Track",
  "Artist",
  "Playlist",
  "PlaylistTrack",
  "TasteFeedback",
  "SnoozedTrack",
  "UserMix",
];

async function snapshot(pool) {
  const out = {};
  for (const t of TABLES) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    out[t] = r.rows[0].n;
  }
  return out;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const before = await snapshot(pool);
  console.log("\n  Before:", JSON.stringify(before));

  console.log("  Running read-only load test (60 VUs, 25s)…");
  execFileSync(
    process.execPath,
    [
      path.resolve(__dirname, "load-test.js"),
      "--vus", "60", "--duration", "25", "--think", "1500", "--rampUp", "5", "--workers", "2",
    ],
    { stdio: "ignore" }
  );

  const after = await snapshot(pool);
  console.log("  After: ", JSON.stringify(after));

  const changed = TABLES.filter((t) => before[t] !== after[t]);
  console.log("");
  if (changed.length === 0) {
    console.log("  ✓ PASS — read-only run mutated nothing\n");
  } else {
    for (const t of changed) {
      console.log(`  ✖ ${t}: ${before[t]} → ${after[t]}  (${after[t] - before[t] > 0 ? "+" : ""}${after[t] - before[t]})`);
    }
    console.log("\n  ✖ FAIL — a journey is writing without --writes\n");
  }

  await pool.end();
  process.exit(changed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
