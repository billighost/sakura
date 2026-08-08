/**
 * Do multiple Track rows share a telegramMessageId?
 *
 * It matters for the CDN offload: `promoteToCdn` resolves a message id to a
 * single row with LIMIT 1, so if several rows point at the same Telegram
 * message only one gets the CDN url and the others keep proxying forever —
 * quietly defeating the offload for those tracks.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const { rows: dupes } = await pool.query(`
    SELECT "telegramMessageId", COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE "audioUrl" LIKE 'https://res.cloudinary.com/%')::int AS on_cdn,
           ARRAY_AGG(id) AS ids
      FROM "Track"
     WHERE "telegramMessageId" IS NOT NULL
     GROUP BY "telegramMessageId"
    HAVING COUNT(*) > 1
     ORDER BY n DESC LIMIT 20
  `);

  console.log(`\n  Duplicate telegramMessageId groups: ${dupes.length}`);
  for (const d of dupes.slice(0, 10)) {
    console.log(`    msg ${d.telegramMessageId}: ${d.n} rows (${d.on_cdn} on CDN)`);
  }

  const { rows: tot } = await pool.query(`
    SELECT COUNT(*)::int AS with_msg,
           COUNT(DISTINCT "telegramMessageId")::int AS distinct_msg
      FROM "Track" WHERE "telegramMessageId" IS NOT NULL
  `);
  console.log(`\n  Rows with a message id: ${tot[0].with_msg}`);
  console.log(`  Distinct message ids:   ${tot[0].distinct_msg}`);
  console.log(
    `  Redundant rows:         ${tot[0].with_msg - tot[0].distinct_msg}` +
      (tot[0].with_msg === tot[0].distinct_msg ? "  ✓" : "  ← these would keep proxying")
  );

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
