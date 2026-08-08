require("dotenv").config();
const { Client } = require("pg");

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to database...");
    
    const res = await client.query(
      `UPDATE "Track" SET "audioUrl" = 'pending' WHERE "audioUrl" LIKE '%dzcdn.net%'`
    );
    
    console.log(`Successfully updated ${res.rowCount} tracks from Deezer previews to "pending"`);
  } catch (err) {
    console.error("Error updating database:", err);
  } finally {
    await client.end();
  }
}

run();
