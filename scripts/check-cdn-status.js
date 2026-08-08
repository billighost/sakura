/** Report which Telegram tracks have been promoted to the CDN. */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE "audioUrl" LIKE 'https://res.cloudinary.com/%')::int AS on_cdn,
      COUNT(*) FILTER (WHERE "audioUrl" LIKE '/api/stream/telegram/%')::int AS on_proxy,
      COUNT(*) FILTER (WHERE "audioUrl" LIKE 'https://cdnt-preview%')::int AS previews,
      COUNT(*)::int AS total
    FROM "Track"
  `);
  console.log(`\n  on CDN:   ${rows[0].on_cdn}`);
  console.log(`  on proxy: ${rows[0].on_proxy}`);
  console.log(`  previews: ${rows[0].previews}`);
  console.log(`  total:    ${rows[0].total}`);

  const { rows: sample } = await pool.query(`
    SELECT title, "audioUrl" FROM "Track"
     WHERE "audioUrl" LIKE 'https://res.cloudinary.com/%' LIMIT 5
  `);
  if (sample.length) {
    console.log(`\n  Promoted tracks:`);
    for (const s of sample) console.log(`    "${s.title}"\n      ${s.audioUrl}`);
  }
  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
