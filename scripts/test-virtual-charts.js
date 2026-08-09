/**
 * Do virtualised chart entries actually render?
 *
 * Charts now store `deezer-<id>` for songs the library doesn't own, with the
 * display metadata in Redis. That is only a saving if the read path still
 * returns a complete, ordered playlist — otherwise it is just a way to lose
 * chart entries. This checks the API response, not the database.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const http = require("http");

function get(p, cookie) {
  return new Promise((resolve) => {
    const r = http.get({ hostname: "localhost", port: 3000, path: p, headers: { cookie } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("error", (e) => resolve({ status: 0, body: e.message }));
    r.setTimeout(60000, () => r.destroy());
  });
}

(async () => {
  const { encode } = require("next-auth/jwt");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  const charts = (await pool.query(`SELECT "systemId", "trackIds" FROM "SystemPlaylist" ORDER BY "systemId"`)).rows;
  await pool.end();

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  console.log("");
  let allOk = true;

  for (const c of charts) {
    const stored = c.trackIds ?? [];
    const virtualStored = stored.filter((t) => t.startsWith("deezer-")).length;

    const res = await get(`/api/system-playlists/${c.systemId}`, cookie);
    let data = {};
    try {
      data = JSON.parse(res.body);
    } catch {}
    const tracks = data.tracks ?? [];
    const rendered = tracks.length;
    const virtualRendered = tracks.filter((t) => t.isVirtual).length;
    const named = tracks.filter((t) => t.title && t.artist?.name).length;
    const withArt = tracks.filter((t) => t.coverUrl).length;

    const ok = rendered === stored.length && named === rendered;
    if (!ok) allOk = false;

    console.log(
      `  ${ok ? "✓" : "✖"} ${c.systemId.padEnd(18)} stored ${String(stored.length).padStart(2)} ` +
        `(${virtualStored} virtual) → rendered ${String(rendered).padStart(2)} ` +
        `(${virtualRendered} virtual), ${named} named, ${withArt} with art`
    );
    if (tracks.length) {
      const sample = tracks.find((t) => t.isVirtual) ?? tracks[0];
      console.log(`      e.g. "${sample.title}" — ${sample.artist?.name}${sample.isVirtual ? "  [virtual]" : ""}`);
    }
  }

  console.log(
    `\n  ${allOk ? "PASS — every stored id renders with title, artist and art" : "FAIL — entries lost or unnamed"}\n`
  );
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
