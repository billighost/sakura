/**
 * Focused check for the stream-redirect fix.
 *
 * `audioUrl` holds two shapes — an absolute Cloudinary URL and a relative
 * `/api/stream/telegram/<id>` path — and only one of them used to work. This
 * exercises both explicitly rather than relying on whichever one the load test
 * happened to sample.
 */
const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

function head(p, cookie) {
  return new Promise((resolve) => {
    const r = http.request(
      { hostname: "localhost", port: 3000, path: p, method: "GET", headers: { cookie } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, location: res.headers.location, body: b.slice(0, 200) })
        );
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message }));
    r.end();
  });
}

(async () => {
  const { encode } = require("next-auth/jwt");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  const relative = (
    await pool.query(
      `SELECT id, title, "audioUrl" FROM "Track" WHERE "audioUrl" LIKE '/api/%' LIMIT 3`
    )
  ).rows;
  const absolute = (
    await pool.query(
      `SELECT id, title, "audioUrl" FROM "Track" WHERE "audioUrl" LIKE 'http%' LIMIT 3`
    )
  ).rows;
  const pending = (
    await pool.query(
      `SELECT id, title, "audioUrl" FROM "Track"
        WHERE "audioUrl" IS NULL OR "audioUrl" IN ('', 'pending') LIMIT 2`
    )
  ).rows;
  await pool.end();

  console.log("");
  console.log(`  relative audioUrl tracks: ${relative.length}`);
  console.log(`  absolute audioUrl tracks: ${absolute.length}`);
  console.log(`  pending/empty tracks:     ${pending.length}`);
  console.log("");

  const check = async (label, rows, want) => {
    for (const t of rows) {
      const r = await head(`/api/stream/${t.id}`, cookie);
      const pass = want.includes(r.status);
      console.log(
        `  ${pass ? "✓" : "✖"} ${label.padEnd(9)} ${String(r.status).padEnd(4)} ` +
          `${(t.audioUrl || "(null)").slice(0, 46).padEnd(48)} → ${(r.location || r.body).slice(0, 60)}`
      );
    }
  };

  await check("relative", relative, [307, 302, 308]);
  await check("absolute", absolute, [307, 302, 308]);
  await check("pending", pending, [409]);
  await check("missing", [{ id: "does-not-exist", audioUrl: "-" }], [404]);
  console.log("");
})();
