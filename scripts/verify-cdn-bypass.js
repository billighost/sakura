/**
 * Confirm the payoff of promotion: a play of a promoted track must redirect to
 * the CDN and carry no audio through this server.
 *
 * That redirect is the entire point of the offload. Verifying only that the
 * Cloudinary URL landed in the database would leave the interesting half —
 * whether playback actually stops costing host bandwidth — untested.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const http = require("http");
const https = require("https");

function head(p, cookie) {
  return new Promise((resolve) => {
    const r = http.get(
      { hostname: "localhost", port: 3000, path: p, headers: { cookie } },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () =>
          resolve({ status: res.statusCode, location: res.headers.location, bytes })
        );
      }
    );
    r.on("error", (e) => resolve({ status: 0, err: e.message }));
    r.setTimeout(30000, () => r.destroy());
  });
}

function probeCdn(url) {
  return new Promise((resolve) => {
    const r = https.request(url, { method: "HEAD" }, (res) =>
      resolve({ status: res.statusCode, type: res.headers["content-type"], len: res.headers["content-length"] })
    );
    r.on("error", (e) => resolve({ status: 0, err: e.message }));
    r.setTimeout(30000, () => r.destroy());
    r.end();
  });
}

(async () => {
  const { encode } = require("next-auth/jwt");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  const { rows } = await pool.query(
    `SELECT id, title, "audioUrl" FROM "Track"
      WHERE "audioUrl" LIKE 'https://res.cloudinary.com/%' LIMIT 1`
  );
  await pool.end();

  if (!rows.length) {
    console.log("\n  No promoted tracks yet.\n");
    return;
  }
  const t = rows[0];

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  console.log(`\n  Track: "${t.title}"`);

  const r = await head(`/api/stream/${t.id}`, cookie);
  const toCdn = /res\.cloudinary\.com/.test(r.location || "");
  console.log(`\n  GET /api/stream/${t.id.slice(0, 20)}…`);
  console.log(`    status:   ${r.status}`);
  console.log(`    location: ${(r.location || "(none)").slice(0, 78)}`);
  console.log(`    payload:  ${r.bytes} bytes`);

  const cdn = await probeCdn(t.audioUrl);
  console.log(`\n  CDN object:`);
  console.log(`    status: ${cdn.status}  type: ${cdn.type}  size: ${cdn.len} bytes`);

  const checks = [
    ["redirects instead of proxying", r.status >= 300 && r.status < 400],
    ["redirect points at Cloudinary", toCdn],
    ["no audio bytes through this server", r.bytes < 1024],
    ["CDN object is reachable", cdn.status === 200],
    ["CDN object is audio", /audio|video|mpeg|octet/.test(cdn.type || "")],
    ["CDN object is non-trivial", Number(cdn.len) > 100000],
  ];
  console.log("");
  for (const [name, pass] of checks) console.log(`  ${pass ? "✓" : "✖"} ${name}`);
  const ok = checks.every(([, p]) => p);
  console.log(`\n  ${ok ? "PASS — playback now bypasses this server entirely" : "FAIL"}\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
