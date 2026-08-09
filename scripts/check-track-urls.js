require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE "audioUrl" LIKE '/api/stream/telegram/%' AND "audioUrl" NOT LIKE '%/0') AS usable,
    COUNT(*) FILTER (WHERE "audioUrl" IS NULL OR "audioUrl" = '' OR "audioUrl" = 'pending') AS empty,
    COUNT(*) FILTER (WHERE "audioUrl" LIKE '%/0') AS broken_zero,
    COUNT(*) FILTER (WHERE "audioUrl" NOT LIKE '/api/stream/telegram/%' AND "audioUrl" IS NOT NULL AND "audioUrl" <> '' AND "audioUrl" <> 'pending') AS other_url
  FROM "Track"
`).then(r => {
  const d = r.rows[0];
  const total = parseInt(d.total);
  const usable = parseInt(d.usable);
  console.log(`Total tracks:    ${total}`);
  console.log(`Usable (Telegram): ${usable} (${((usable/total)*100).toFixed(1)}%)`);
  console.log(`Empty/pending:   ${d.empty}`);
  console.log(`Broken /0 URL:   ${d.broken_zero}`);
  console.log(`Other URL:       ${d.other_url}`);
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
