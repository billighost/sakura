// Wipes all application data from the DB while preserving the schema and
// the _migrations ledger.
//
//   node scripts/clear-db.js
//
// The tables are truncated in an order that respects foreign-key constraints
// (children before parents), using CASCADE just in case.

const { Client } = require("pg");
require("dotenv").config();

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — check your .env file.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Connected.\n");

  // Order: most-derived tables first, root tables last.
  const tables = [
    // junction / leaf tables
    "PlaylistTrack",
    "TrackArtist",
    "Favorite",
    "SnoozedTrack",
    "ListeningHistory",
    "PlayAggregate",
    "PlaybackState",
    "Share",
    "TasteFeedback",
    "ArtistAffinity",
    "GenreAffinity",
    "TasteProfile",
    "UserMix",
    "UserSettings",
    // mid-level
    "Track",
    "Album",
    "Playlist",
    "PlaylistFolder",
    "Artist",
    // root
    "User",
  ];

  try {
    await client.query("BEGIN");

    for (const table of tables) {
      process.stdout.write(`  Truncating "${table}" … `);
      await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
      console.log("ok");
    }

    await client.query("COMMIT");
    console.log("\n✓ All data cleared. Schema and migrations ledger preserved.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nFailed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
