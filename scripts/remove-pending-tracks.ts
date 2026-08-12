import "dotenv/config";
import { execute, query } from "../src/lib/sql";

async function main() {
  console.log("Removing pending tracks from the database...");

  try {
    const countRes = await query<{ count: string }>(`SELECT COUNT(*) FROM "Track" WHERE "audioUrl" = 'pending'`);
    const count = parseInt(countRes[0]?.count || "0", 10);
    console.log(`Found ${count} tracks with audioUrl = 'pending'.`);

    if (count > 0) {
      const res = await execute(`DELETE FROM "Track" WHERE "audioUrl" = 'pending'`);
      console.log(`Deleted ${res.rowCount} tracks.`);
    } else {
      console.log("No pending tracks to delete.");
    }
  } catch (err) {
    console.error("Error removing pending tracks:", err);
  }

  process.exit(0);
}

main();
