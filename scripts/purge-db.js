const { Client } = require("pg");
const { Redis } = require("@upstash/redis");
require("dotenv").config();

async function run() {
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  console.log("Connected to PostgreSQL. Purging database library tables...");

  const query = `
    TRUNCATE TABLE 
      "Favorite", 
      "PlaylistTrack", 
      "Playlist", 
      "PlaylistFolder", 
      "TrackArtist", 
      "TrackCredit", 
      "SampledTrack", 
      "ListeningHistory", 
      "UserMix", 
      "SnoozedTrack", 
      "Track", 
      "Album", 
      "Artist" 
    CASCADE;
  `;
  await pgClient.query(query);
  console.log("PostgreSQL library tables successfully purged!");
  await pgClient.end();

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.log("Connecting to Upstash Redis to invalidate cache...");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.flushdb();
    console.log("Redis cache successfully flushed!");
  } else {
    console.log("Redis credentials not found in env. Skipping Redis flush.");
  }

  console.log("Purge run completed successfully!");
}

run().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
