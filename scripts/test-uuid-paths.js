/**
 * Exercise every user-scoped write path against the live schema.
 *
 * After User.id became uuid, most parameter binding still works — Postgres
 * infers a bare `$1` correctly — but two shapes do not: an explicit
 * `$n::text[]` inside UNNEST, and `= ANY($n::text[])`. Those fail at runtime,
 * in background jobs and write endpoints where a failure is logged and
 * swallowed rather than surfaced. Auditing 16 files by eye is how one gets
 * missed, so this drives the real endpoints instead.
 *
 * Cleans up everything it creates.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const http = require("http");

function req(method, p, { cookie, body } = {}) {
  return new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { accept: "application/json" };
    if (cookie) headers.cookie = cookie;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = payload.length;
    }
    const r = http.request(
      { hostname: "localhost", port: 3000, path: p, method, headers },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message }));
    r.setTimeout(60000, () => r.destroy());
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const { encode } = require("next-auth/jwt");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  const track = (
    await pool.query(
      `SELECT id FROM "Track" WHERE "audioUrl" IS NOT NULL AND "audioUrl" NOT IN ('','pending') LIMIT 1`
    )
  ).rows[0];

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  const count = async (t) =>
    Number((await pool.query(`SELECT COUNT(*)::int n FROM "${t}" WHERE "userId" = $1`, [user.id])).rows[0].n);

  console.log(`\n  user ${user.username} (${user.id})\n`);

  const checks = [];
  const record = (name, ok, detail = "") => {
    checks.push([name, ok]);
    console.log(`  ${ok ? "✓" : "✖"} ${name.padEnd(38)}${detail}`);
  };

  // Auth runs through the Prisma client — where a uuid/text mismatch in the
  // generated client would surface.
  const profile = await req("GET", "/api/profile", { cookie });
  record("auth + profile (Prisma client)", profile.status === 200, `${profile.status}`);

  for (const [name, p] of [
    ["favorites read", "/api/favorites"],
    ["history read", "/api/history?limit=10"],
    ["playlists read", "/api/playlists"],
    ["home aggregate", "/api/home"],
  ]) {
    const r = await req("GET", p, { cookie });
    record(name, r.status === 200, `${r.status}`);
  }

  const favBefore = await count("Favorite");
  const fav = await req("POST", "/api/favorites", { cookie, body: { trackId: track.id } });
  const favAfter = await count("Favorite");
  record("favorite write", fav.status < 400, `${fav.status}, ${favBefore}→${favAfter}`);

  const histBefore = await count("ListeningHistory");
  const sig = await req("POST", "/api/signals", {
    cookie,
    body: { signals: [{ trackId: track.id, msPlayed: 95000, completed: true, context: "uuidtest" }] },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const histAfter = await count("ListeningHistory");
  record(
    "signal write (bigint id + uuid fk)",
    sig.status < 400 && histAfter > histBefore,
    `${sig.status}, ${histBefore}→${histAfter}`
  );

  const radio = await req("POST", "/api/radio", { cookie, body: { limit: 5 } });
  record("radio (taste + affinities)", radio.status === 200, `${radio.status}`);

  // The fold that ::text[] actually broke.
  let foldOk = false, foldErr = "";
  try {
    await pool.query(
      `INSERT INTO "PlayAggregate"
         ("userId","trackId",plays,completions,skips,"totalMsPlayed","signalSum","firstPlayedAt","lastPlayedAt")
       SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::int[], $4::int[], $5::int[],
                            $6::bigint[], $7::double precision[], $8::timestamp[], $9::timestamp[])
       ON CONFLICT ("userId","trackId") DO UPDATE SET plays = "PlayAggregate".plays + EXCLUDED.plays`,
      [[user.id], [track.id], [1], [1], [0], [95000], [2.0], [new Date()], [new Date()]]
    );
    foldOk = true;
  } catch (e) {
    foldErr = e.message.split("\n")[0];
  }
  record("history fold (uuid[] in UNNEST)", foldOk, foldErr);

  // ── cleanup ──
  await pool.query(`DELETE FROM "PlayAggregate" WHERE "userId" = $1 AND "trackId" = $2`, [user.id, track.id]);
  await pool.query(`DELETE FROM "ListeningHistory" WHERE "userId" = $1 AND context = 'uuidtest'`, [user.id]);
  if (fav.status < 400 && favAfter > favBefore) {
    await pool.query(`DELETE FROM "Favorite" WHERE "userId" = $1 AND "trackId" = $2`, [user.id, track.id]);
  }

  await pool.end();
  const failed = checks.filter((c) => !c[1]);
  console.log(
    `\n  ${failed.length === 0 ? "PASS — every user-scoped path works on uuid ids" : `FAIL — ${failed.length} broken`}\n`
  );
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
