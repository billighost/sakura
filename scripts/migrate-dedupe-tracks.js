/**
 * Dedupe Track rows sharing a deezerId, then add the UNIQUE index that stops
 * them coming back.
 *
 * The duplicates are debris from the old chart-refresh loop, which INSERTed
 * unconditionally on every pass because nothing constrained deezerId. The
 * rewritten refresh relies on ON CONFLICT ("deezerId"), which needs a unique
 * arbiter index to exist — so this has to run before that code path does.
 *
 * Order matters: eight tables carry an FK to Track.id, so every reference is
 * repointed at the surviving row before anything is deleted. The whole thing
 * runs in one transaction — a partial dedupe would leave orphaned references.
 *
 * Survivor choice, in priority order:
 *   1. has real audio          — a 'pending' chart placeholder must never win
 *                                over a copy that actually plays
 *   2. has a Telegram file id  — the source of the audio, worth keeping
 *   3. has a real title        — some rows carry the literal string 'undefined'
 *   4. oldest createdAt        — stable tiebreak, keeps the earliest reference
 *
 * Ordering by createdAt alone (the obvious choice) is wrong here and was
 * verified to be wrong: chart refreshes insert placeholder rows with
 * audioUrl='pending' the moment a song enters the Top 50, so for 50 of these
 * groups the *oldest* row is the empty one and the newest is the copy someone
 * actually downloaded. Audio has to outrank age.
 *
 * Run with --apply to commit; default is a dry run that rolls back.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

// Every table with an FK to Track.id, from information_schema.
const REFERENCING = [
  ["Favorite", "trackId"],
  ["ListeningHistory", "trackId"],
  ["PlaylistTrack", "trackId"],
  ["SnoozedTrack", "trackId"],
  ["TrackArtist", "trackId"],
  ["TrackCredit", "trackId"],
  ["SampledTrack", "trackId"],
  ["SampledTrack", "sampledTrackId"],
];

// Tables where repointing can collide with an existing row: these have a
// composite unique/PK over (owner, trackId), so if a user favourited both the
// survivor and a duplicate, the UPDATE would violate it. Delete the losing
// reference instead of repointing it.
const COMPOSITE = {
  Favorite: ["userId"],
  PlaylistTrack: ["playlistId"],
  SnoozedTrack: ["userId"],
  TrackArtist: ["artistId"],
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Survivor per deezerId — playable audio first, age only as a tiebreak.
    // Each ORDER BY term is a boolean sorted ASC, so `false` (0, meaning "has
    // the good property") sorts ahead of `true`.
    const SURVIVOR_ORDER = `
      ORDER BY ("audioUrl" IS NULL OR "audioUrl" = 'pending'),
               ("telegramFileId" IS NULL),
               (title IS NULL OR title = 'undefined'),
               "createdAt" ASC`;

    const { rows: groups } = await client.query(`
      SELECT "deezerId",
             (ARRAY_AGG(id ${SURVIVOR_ORDER}))[1] AS keep_id,
             ARRAY_AGG(id) AS all_ids,
             COUNT(*)::int AS n
        FROM "Track"
       WHERE "deezerId" IS NOT NULL
       GROUP BY "deezerId"
      HAVING COUNT(*) > 1
    `);

    console.log(`\nDuplicate groups: ${groups.length}`);
    let totalDeleted = 0;
    let totalRepointed = 0;

    for (const g of groups) {
      const dupIds = g.all_ids.filter((id) => id !== g.keep_id);
      if (dupIds.length === 0) continue;

      for (const [table, col] of REFERENCING) {
        const partnerCols = COMPOSITE[table];
        if (partnerCols) {
          // Drop references that would collide with one already pointing at the
          // survivor, then repoint whatever is left.
          const cond = partnerCols.map((c) => `x."${c}" = y."${c}"`).join(" AND ");
          await client.query(
            `DELETE FROM "${table}" x
              WHERE x."${col}" = ANY($1::text[])
                AND EXISTS (SELECT 1 FROM "${table}" y
                             WHERE y."${col}" = $2 AND ${cond})`,
            [dupIds, g.keep_id]
          );
        }
        const r = await client.query(
          `UPDATE "${table}" SET "${col}" = $2 WHERE "${col}" = ANY($1::text[])`,
          [dupIds, g.keep_id]
        );
        totalRepointed += r.rowCount;
      }

      const d = await client.query(`DELETE FROM "Track" WHERE id = ANY($1::text[])`, [dupIds]);
      totalDeleted += d.rowCount;
    }

    console.log(`  references repointed: ${totalRepointed}`);
    console.log(`  duplicate tracks deleted: ${totalDeleted}`);

    /**
     * `SystemPlaylist.trackIds` and `UserMix.trackIds` are text[] columns, not
     * foreign keys, so nothing above touched them and Postgres will not
     * complain that they now point at deleted rows. They have to be repaired in
     * the same transaction — leaving them for a follow-up script means the
     * window between the two is a database that looks intact to `information_
     * schema` while the home page renders half-empty shelves.
     *
     * Dead ids are stripped rather than remapped: both columns hold derived
     * data that regenerates (charts from the providers, mixes from
     * `generateUserMixes`), so the correct repair is to drop the dead entries
     * and let the next refresh refill them.
     */
    for (const table of ["SystemPlaylist", "UserMix"]) {
      const r = await client.query(`
        UPDATE "${table}" x
           SET "trackIds" = COALESCE((
                 SELECT ARRAY_AGG(tid ORDER BY ord)
                   FROM UNNEST(x."trackIds") WITH ORDINALITY AS u(tid, ord)
                  WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t.id = u.tid)
               ), ARRAY[]::text[])
         WHERE EXISTS (
                 SELECT 1 FROM UNNEST(x."trackIds") AS tid
                  WHERE NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id = tid)
               )
      `);
      console.log(`  ${table} array refs repaired: ${r.rowCount}`);
    }

    // A mix too thin to display is worse than no mix; home regenerates when it
    // finds none. Charts are marked stale so the next render rebuilds them.
    const thin = await client.query(
      `DELETE FROM "UserMix" WHERE COALESCE(array_length("trackIds", 1), 0) < 5`
    );
    console.log(`  under-filled mixes dropped: ${thin.rowCount}`);
    await client.query(`UPDATE "SystemPlaylist" SET "updatedAt" = NOW() - INTERVAL '2 days'`);

    // Now the constraint that prevents recurrence. NULL deezerId stays legal —
    // Postgres permits many NULLs in a unique index — which matters because
    // Telegram-sourced tracks have no Deezer id.
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Track_deezerId_key" ON "Track" ("deezerId")`
    );
    console.log(`  UNIQUE index Track_deezerId_key created`);

    const { rows: check } = await client.query(`
      SELECT COUNT(*)::int AS n FROM (
        SELECT "deezerId" FROM "Track" WHERE "deezerId" IS NOT NULL
        GROUP BY "deezerId" HAVING COUNT(*) > 1
      ) s
    `);
    console.log(`  remaining duplicate groups: ${check[0].n}`);

    const { rows: tot } = await client.query(`SELECT COUNT(*)::int AS n FROM "Track"`);
    console.log(`  tracks remaining: ${tot[0].n}`);

    if (APPLY) {
      await client.query("COMMIT");
      console.log("\n  COMMITTED ✓\n");
    } else {
      await client.query("ROLLBACK");
      console.log("\n  DRY RUN — rolled back. Re-run with --apply to commit.\n");
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
