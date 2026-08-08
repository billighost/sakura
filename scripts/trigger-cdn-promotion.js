/**
 * Trigger one CDN promotion and wait for it, with the stream read and the
 * database poll kept independent.
 *
 * The combined test failed for an uninteresting reason: reading 9MB from
 * Telegram takes over two minutes, and the pg pool it was holding open went
 * idle long enough for Neon to reset it. Fetch first, then open a fresh
 * connection to observe the result.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const http = require("http");

async function db(fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

function play(p, cookie) {
  return new Promise((resolve) => {
    const r = http.get(
      { hostname: "localhost", port: 3000, path: p, headers: { cookie } },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () => resolve({ status: res.statusCode, bytes }));
        res.on("error", (e) => resolve({ status: res.statusCode, bytes, err: e.message }));
      }
    );
    r.on("error", (e) => resolve({ status: 0, bytes: 0, err: e.message }));
    r.setTimeout(300000, () => r.destroy(new Error("client timeout")));
  });
}

(async () => {
  const { encode } = require("next-auth/jwt");

  const { user, track } = await db(async (pool) => ({
    user: (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0],
    track: (
      await pool.query(
        `SELECT id, title, "telegramMessageId" FROM "Track"
          WHERE "audioUrl" LIKE '/api/stream/telegram/%'
          ORDER BY duration ASC NULLS LAST LIMIT 1`
      )
    ).rows[0],
  }));

  if (!track) {
    console.log("\n  Nothing left on the proxy path.\n");
    return;
  }

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  console.log(`\n  Track: "${track.title}" (msg ${track.telegramMessageId})`);
  console.log(`  Streaming through the proxy …`);
  const t0 = Date.now();
  const res = await play(`/api/stream/telegram/${track.telegramMessageId}`, cookie);
  console.log(
    `    ${res.status}, ${(res.bytes / 1024).toFixed(0)}KB in ${((Date.now() - t0) / 1000).toFixed(0)}s` +
      (res.err ? ` (${res.err})` : "")
  );

  console.log(`  Polling for promotion (up to 5 min) …`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const url = await db(async (pool) =>
      (await pool.query(`SELECT "audioUrl" FROM "Track" WHERE id = $1`, [track.id])).rows[0].audioUrl
    );
    if (/res\.cloudinary\.com/.test(url)) {
      console.log(`\n  ✓ PROMOTED`);
      console.log(`    ${url}\n`);
      return;
    }
    process.stdout.write(".");
  }
  console.log(`\n\n  ✖ not promoted within 5 min — check [cdn] lines in .srv.log\n`);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
