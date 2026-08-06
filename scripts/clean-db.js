const { Client } = require("pg");
require("dotenv").config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Connected to database. Starting deduplication...");

  // Get all tracks with duplicates on deezerId or telegramMessageId
  const dupDeezer = await client.query(`
    SELECT "deezerId", ARRAY_AGG(id ORDER BY "createdAt" ASC) as ids
    FROM "Track"
    WHERE "deezerId" IS NOT NULL
    GROUP BY "deezerId"
    HAVING COUNT(*) > 1
  `);

  const dupTelegram = await client.query(`
    SELECT "telegramMessageId", ARRAY_AGG(id ORDER BY "createdAt" ASC) as ids
    FROM "Track"
    WHERE "telegramMessageId" IS NOT NULL AND "deezerId" IS NULL
    GROUP BY "telegramMessageId"
    HAVING COUNT(*) > 1
  `);

  const duplicates = [...dupDeezer.rows, ...dupTelegram.rows];
  console.log(`Found ${duplicates.length} duplicate groups.`);

  for (const group of duplicates) {
    const canonicalId = group.ids[0];
    const dupIds = group.ids.slice(1);
    console.log(`Group: Canonical ${canonicalId}, Duplicates: ${dupIds.join(", ")}`);

    for (const dupId of dupIds) {
      // 1. PlaylistTrack
      const plTracks = await client.query(`SELECT "playlistId" FROM "PlaylistTrack" WHERE "trackId" = $1`, [dupId]);
      for (const row of plTracks.rows) {
        try {
          await client.query(
            `UPDATE "PlaylistTrack" SET "trackId" = $1 WHERE "trackId" = $2 AND "playlistId" = $3`,
            [canonicalId, dupId, row.playlistId]
          );
        } catch (err) {
          // Unique constraint violation, delete the duplicate
          await client.query(`DELETE FROM "PlaylistTrack" WHERE "trackId" = $1 AND "playlistId" = $2`, [dupId, row.playlistId]);
        }
      }

      // 2. Favorite
      const favs = await client.query(`SELECT "userId" FROM "Favorite" WHERE "trackId" = $1`, [dupId]);
      for (const row of favs.rows) {
        try {
          await client.query(
            `UPDATE "Favorite" SET "trackId" = $1 WHERE "trackId" = $2 AND "userId" = $3`,
            [canonicalId, dupId, row.userId]
          );
        } catch (err) {
          await client.query(`DELETE FROM "Favorite" WHERE "trackId" = $1 AND "userId" = $2`, [dupId, row.userId]);
        }
      }

      // 3. ListeningHistory
      await client.query(`UPDATE "ListeningHistory" SET "trackId" = $1 WHERE "trackId" = $2`, [canonicalId, dupId]);

      // 4. TrackArtist
      const trackArtists = await client.query(`SELECT "artistId" FROM "TrackArtist" WHERE "trackId" = $1`, [dupId]);
      for (const row of trackArtists.rows) {
        try {
          await client.query(
            `UPDATE "TrackArtist" SET "trackId" = $1 WHERE "trackId" = $2 AND "artistId" = $3`,
            [canonicalId, dupId, row.artistId]
          );
        } catch (err) {
          await client.query(`DELETE FROM "TrackArtist" WHERE "trackId" = $1 AND "artistId" = $2`, [dupId, row.artistId]);
        }
      }

      // 5. TrackCredit
      await client.query(`UPDATE "TrackCredit" SET "trackId" = $1 WHERE "trackId" = $2`, [canonicalId, dupId]);

      // 6. SampledTrack
      await client.query(`UPDATE "SampledTrack" SET "trackId" = $1 WHERE "trackId" = $2`, [canonicalId, dupId]);
      await client.query(`UPDATE "SampledTrack" SET "sampledTrackId" = $1 WHERE "sampledTrackId" = $2`, [canonicalId, dupId]);

      // 7. SnoozedTrack
      const snoozed = await client.query(`SELECT "userId" FROM "SnoozedTrack" WHERE "trackId" = $1`, [dupId]);
      for (const row of snoozed.rows) {
        try {
          await client.query(
            `UPDATE "SnoozedTrack" SET "trackId" = $1 WHERE "trackId" = $2 AND "userId" = $3`,
            [canonicalId, dupId, row.userId]
          );
        } catch (err) {
          await client.query(`DELETE FROM "SnoozedTrack" WHERE "trackId" = $1 AND "userId" = $2`, [dupId, row.userId]);
        }
      }

      // Finally, delete duplicate Track row
      await client.query(`DELETE FROM "Track" WHERE id = $1`, [dupId]);
    }
  }

  console.log("Deduplication complete!");
  await client.end();
}

run().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
