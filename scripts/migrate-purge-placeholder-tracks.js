/**
 * Remove chart placeholder tracks left behind by the old refresh.
 *
 * `updateSystemPlaylist` used to INSERT a `Track` row with audioUrl='pending'
 * for every charted song the library didn't own, purely so the playlist had
 * something to point at. Charts now reference `deezer-<id>` directly with their
 * display metadata in Redis, so those rows are dead weight — measured at 102 of
 * 196 tracks on this database, and growing by up to 250/day as charts refresh.
 *
 * Only genuinely orphaned placeholders are removed. A row is kept if anyone has
 * liked it, played it, put it in a playlist, or if it carries real audio — a
 * placeholder that someone later downloaded is a real track now, and the
 * `audioUrl` check alone would not catch every such case.
 *
 * Run with --apply to commit; default is a dry run.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

const ORPHAN_PREDICATE = `
      ("audioUrl" IS NULL OR "audioUrl" IN ('', 'pending'))
  AND "telegramMessageId" IS NULL
  AND "telegramFileId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Favorite"         f  WHERE f."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "ListeningHistory" h  WHERE h."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "PlaylistTrack"    pt WHERE pt."trackId"       = t.id)
  AND NOT EXISTS (SELECT 1 FROM "SnoozedTrack"     s  WHERE s."trackId"        = t.id)
  AND NOT EXISTS (SELECT 1 FROM "SampledTrack"     st WHERE st."trackId"       = t.id
                                                        OR st."sampledTrackId" = t.id)
  AND NOT EXISTS (SELECT 1 FROM "PlayAggregate"    pa WHERE pa."trackId"       = t.id)
`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const before = Number(
      (await client.query(`SELECT pg_database_size(current_database()) AS b`)).rows[0].b
    );
    const total = (await client.query(`SELECT COUNT(*)::int AS n FROM "Track"`)).rows[0].n;

    const { rows: doomed } = await client.query(
      `SELECT COUNT(*)::int AS n FROM "Track" t WHERE ${ORPHAN_PREDICATE}`
    );
    console.log(`\n  Tracks total:            ${total}`);
    console.log(`  Orphaned placeholders:   ${doomed[0].n}`);

    // Anything a chart still lists must lose the reference, or the playlist
    // would render short. Charts are marked stale so the next refresh rebuilds
    // them as virtual references.
    const spBefore = await client.query(`
      SELECT "systemId", COALESCE(array_length("trackIds",1),0) AS n FROM "SystemPlaylist" ORDER BY "systemId"
    `);

    await client.query(`
      UPDATE "SystemPlaylist" sp
         SET "trackIds" = COALESCE((
               SELECT ARRAY_AGG(tid ORDER BY ord)
                 FROM UNNEST(sp."trackIds") WITH ORDINALITY AS u(tid, ord)
                WHERE NOT EXISTS (
                  SELECT 1 FROM "Track" t WHERE t.id = u.tid AND ${ORPHAN_PREDICATE}
                )
             ), ARRAY[]::text[]),
             "updatedAt" = NOW() - INTERVAL '2 days'
    `);

    await client.query(`
      UPDATE "UserMix" m
         SET "trackIds" = COALESCE((
               SELECT ARRAY_AGG(tid ORDER BY ord)
                 FROM UNNEST(m."trackIds") WITH ORDINALITY AS u(tid, ord)
                WHERE NOT EXISTS (
                  SELECT 1 FROM "Track" t WHERE t.id = u.tid AND ${ORPHAN_PREDICATE}
                )
             ), ARRAY[]::text[])
    `);

    // TrackArtist / TrackCredit cascade on the FK; nothing else references
    // these rows by the time the predicate holds.
    const del = await client.query(`DELETE FROM "Track" t WHERE ${ORPHAN_PREDICATE}`);
    console.log(`  Deleted:                 ${del.rowCount}`);

    const after = Number(
      (await client.query(`SELECT pg_database_size(current_database()) AS b`)).rows[0].b
    );
    const remaining = (await client.query(`SELECT COUNT(*)::int AS n FROM "Track"`)).rows[0].n;

    const spAfter = await client.query(`
      SELECT "systemId", COALESCE(array_length("trackIds",1),0) AS n FROM "SystemPlaylist" ORDER BY "systemId"
    `);
    console.log(`\n  Chart lengths (they refill as virtual refs on next refresh):`);
    for (const a of spAfter.rows) {
      const b = spBefore.rows.find((r) => r.systemId === a.systemId);
      console.log(`    ${a.systemId.padEnd(18)} ${b.n} → ${a.n}`);
    }

    console.log(`\n  Tracks remaining:        ${remaining}`);
    console.log(`  Database: ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);

    // Nothing may be left pointing at a deleted row.
    const dangling = (
      await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM "Favorite" f WHERE NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id=f."trackId")) +
        (SELECT COUNT(*)::int FROM "ListeningHistory" h WHERE NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id=h."trackId")) +
        (SELECT COUNT(*)::int FROM "PlaylistTrack" p WHERE NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id=p."trackId"))
        AS n`)
    ).rows[0].n;
    console.log(`  Dangling references:     ${dangling} ${dangling === 0 ? "✓" : "✖"}`);

    if (APPLY && dangling === 0) {
      await client.query("COMMIT");
      console.log(`\n  COMMITTED ✓\n`);
    } else {
      await client.query("ROLLBACK");
      console.log(
        dangling === 0
          ? `\n  DRY RUN — rolled back. Re-run with --apply.\n`
          : `\n  ROLLED BACK — would have orphaned rows.\n`
      );
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("\nFAILED, rolled back:", e.message, "\n");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
