/**
 * Create PlayAggregate — the rolled-up form of old listening history.
 *
 * One row per (user, track) instead of one per play. This is what lets
 * ListeningHistory be pruned without destroying taste signal: the scorer
 * consumes play counts, completion ratios and skip ratios in aggregate, and all
 * of those survive the fold.
 *
 * Column choices worth noting:
 *   - No surrogate id. The natural key (userId, trackId) is the primary key,
 *     which removes a 37-byte text UUID and its index from every row. The old
 *     ListeningHistory.id was never once scanned.
 *   - Counters are int, totalMsPlayed is bigint (a heavy user replaying a long
 *     track for years would overflow int32 milliseconds).
 *   - Two indexes only: the PK, and userId for the per-user scan the taste
 *     recompute does. ListeningHistory carried six, at 4x the heap size.
 *
 * Run with --apply to commit.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

const DDL = `
CREATE TABLE IF NOT EXISTS "PlayAggregate" (
  "userId"        TEXT        NOT NULL,
  "trackId"       TEXT        NOT NULL,
  plays           INTEGER     NOT NULL DEFAULT 0,
  completions     INTEGER     NOT NULL DEFAULT 0,
  skips           INTEGER     NOT NULL DEFAULT 0,
  "totalMsPlayed" BIGINT      NOT NULL DEFAULT 0,
  "firstPlayedAt" TIMESTAMP   NOT NULL,
  "lastPlayedAt"  TIMESTAMP   NOT NULL,
  CONSTRAINT "PlayAggregate_pkey" PRIMARY KEY ("userId", "trackId"),
  CONSTRAINT "PlayAggregate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE,
  CONSTRAINT "PlayAggregate_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "Track"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "PlayAggregate_userId_idx" ON "PlayAggregate" ("userId");

-- The exact sum of signalWeight() across the folded plays.
--
-- Reconstructing the weight from counts and averages does not work: signalWeight
-- is a continuous function of played/duration ratio, so a track with three
-- completions and one early skip is not "mostly completed" — it is +3.0 and
-- -0.9, and averaging the milliseconds first produced scores 90% too high and
-- reordered users' top artists. Computing the sum at fold time, while the raw
-- rows still exist, makes the weight exact and leaves only decay approximated.
ALTER TABLE "PlayAggregate" ADD COLUMN IF NOT EXISTS "signalSum" DOUBLE PRECISION NOT NULL DEFAULT 0;
`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const exists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'PlayAggregate'`
  );
  console.log(`\n  PlayAggregate exists: ${exists.rowCount > 0 ? "yes" : "no"}`);

  if (!APPLY) {
    console.log(`\n${DDL}`);
    console.log(`  DRY RUN — re-run with --apply.\n`);
    await pool.end();
    return;
  }

  await pool.query(DDL);

  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'PlayAggregate' ORDER BY ordinal_position`
  );
  console.log(`\n  Created with columns:`);
  for (const c of cols.rows) console.log(`    ${c.column_name.padEnd(16)}${c.data_type}`);

  console.log(`\n  COMMITTED ✓\n`);
  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
