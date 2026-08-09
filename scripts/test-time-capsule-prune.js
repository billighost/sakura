/**
 * Does the rewritten Time Capsule query survive pruning?
 *
 * The mix is defined by plays older than 90 days — exactly the rows the
 * retention job folds into PlayAggregate. If the rewrite is wrong, the mix
 * simply stops appearing, and it would take months of production data before
 * anyone noticed. So: build old history, run the query, prune, run it again,
 * and require the same tracks.
 *
 * Everything happens inside a transaction that is always rolled back.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const TIME_CAPSULE = `
  WITH combined AS (
    SELECT h."trackId" AS track_id,
           MAX(h."playedAt") AS last_played,
           COUNT(*) FILTER (WHERE h.completed)::int AS completions,
           COUNT(*)::int AS plays
      FROM "ListeningHistory" h
     WHERE h."userId" = $1
     GROUP BY h."trackId"
    UNION ALL
    SELECT pa."trackId", pa."lastPlayedAt", pa.completions, pa.plays
      FROM "PlayAggregate" pa
     WHERE pa."userId" = $1
  ),
  rolled AS (
    SELECT track_id, MAX(last_played) AS last_played,
           SUM(completions)::int AS completions, SUM(plays)::int AS plays
      FROM combined GROUP BY track_id
  )
  SELECT r.track_id AS id
    FROM rolled r
    JOIN "Track" t ON t.id = r.track_id
   WHERE t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     AND r.last_played < NOW() - INTERVAL '90 days'
     AND r.completions >= 2
   ORDER BY r.plays DESC
   LIMIT 30`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const user = (await client.query(`SELECT id FROM "User" LIMIT 1`)).rows[0];
    const tracks = (
      await client.query(
        `SELECT id FROM "Track"
          WHERE "audioUrl" IS NOT NULL AND "audioUrl" NOT IN ('', 'pending') LIMIT 8`
      )
    ).rows;

    if (!user || tracks.length < 4) {
      console.log("\n  Not enough data to test.\n");
      return;
    }

    // Old, repeatedly-completed plays — the shape Time Capsule looks for.
    let n = 0;
    for (const [i, t] of tracks.entries()) {
      for (let r = 0; r < 4; r++) {
        await client.query(
          `INSERT INTO "ListeningHistory"
             ("userId","trackId","playedAt",skipped,"msPlayed",completed,autoplay,"hourOfDay","dayOfWeek")
           VALUES ($1,$2,NOW() - ($3||' days')::interval,false,200000,true,false,12,3)`,
          [user.id, t.id, 200 + i * 5 + r]
        );
        n++;
      }
    }
    console.log(`\n  Seeded ${n} plays older than 90 days across ${tracks.length} tracks`);

    const before = (await client.query(TIME_CAPSULE, [user.id])).rows.map((r) => r.id);
    console.log(`  Time Capsule before prune: ${before.length} tracks`);

    // Fold everything older than 120 days, as the retention job does.
    const old = await client.query(
      `SELECT "userId","trackId",COUNT(*)::int plays,
              COUNT(*) FILTER (WHERE completed)::int completions,
              COUNT(*) FILTER (WHERE skipped)::int skips,
              COALESCE(SUM("msPlayed"),0)::bigint ms,
              MIN("playedAt") first_at, MAX("playedAt") last_at
         FROM "ListeningHistory"
        WHERE "playedAt" < NOW() - INTERVAL '120 days'
        GROUP BY "userId","trackId"`
    );
    for (const r of old.rows) {
      await client.query(
        `INSERT INTO "PlayAggregate"
           ("userId","trackId",plays,completions,skips,"totalMsPlayed","signalSum","firstPlayedAt","lastPlayedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ("userId","trackId") DO UPDATE SET
           plays="PlayAggregate".plays+EXCLUDED.plays,
           completions="PlayAggregate".completions+EXCLUDED.completions,
           skips="PlayAggregate".skips+EXCLUDED.skips,
           "totalMsPlayed"="PlayAggregate"."totalMsPlayed"+EXCLUDED."totalMsPlayed",
           "signalSum"="PlayAggregate"."signalSum"+EXCLUDED."signalSum",
           "firstPlayedAt"=LEAST("PlayAggregate"."firstPlayedAt",EXCLUDED."firstPlayedAt"),
           "lastPlayedAt"=GREATEST("PlayAggregate"."lastPlayedAt",EXCLUDED."lastPlayedAt")`,
        [r.userId, r.trackId, r.plays, r.completions, r.skips, r.ms, r.completions * 2, r.first_at, r.last_at]
      );
    }
    const del = await client.query(
      `DELETE FROM "ListeningHistory" WHERE "playedAt" < NOW() - INTERVAL '120 days'`
    );
    console.log(`  Folded ${old.rowCount} pairs, deleted ${del.rowCount} raw rows`);

    const after = (await client.query(TIME_CAPSULE, [user.id])).rows.map((r) => r.id);
    console.log(`  Time Capsule after prune:  ${after.length} tracks`);

    const lost = before.filter((id) => !after.includes(id));
    const ok = before.length > 0 && lost.length === 0;
    console.log(`\n  ${ok ? "✓" : "✖"} every track survived the fold` + (lost.length ? ` (lost ${lost.length})` : ""));
    console.log(`\n  ${ok ? "PASS — Time Capsule survives pruning" : "FAIL — mix would silently vanish"}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
    console.log("  (rolled back)\n");
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
