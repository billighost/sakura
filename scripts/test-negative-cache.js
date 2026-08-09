/**
 * Does a search that finds nothing get cached?
 *
 * Before, `searchProviders` returned null both for "no results" and for
 * "provider unreachable", and `cachedWithStale` never caches null — so every
 * repeat of a typo re-asked Deezer *and* iTunes. This asks for a term that
 * cannot exist, twice, and checks the second one costs no upstream calls.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const http = require("http");

function get(p, cookie) {
  return new Promise((resolve) => {
    const started = Date.now();
    const r = http.get(
      { hostname: "localhost", port: 3000, path: p, headers: cookie ? { cookie } : {} },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: b, ms: Date.now() - started })
        );
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message, ms: Date.now() - started }));
    r.setTimeout(60000, () => r.destroy());
  });
}

async function stats(reset) {
  const r = await get(`/api/health?stats=1${reset ? "&reset=1" : ""}`);
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

(async () => {
  const { encode } = require("next-auth/jwt");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const user = (await pool.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
  await pool.end();

  const salt = "authjs.session-token";
  const cookie = `${salt}=${await encode({
    token: { id: user.id, name: user.username, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET,
    salt,
    maxAge: 86400,
  })}`;

  // Unique per run so it is genuinely uncached, and shaped like the typo/prefix
  // traffic this is meant to absorb.
  const term = `zzqx${Date.now().toString(36)}`;
  const url = `/api/music/search?q=${term}&limit=10`;

  console.log(`\n  term: "${term}" (cannot match anything)\n`);

  await stats(true);
  const first = await get(url, cookie);
  const s1 = await stats(false);
  const firstTracks = JSON.parse(first.body || "{}").tracks?.length ?? "?";
  console.log(
    `  1st call: ${first.status}  ${first.ms}ms  tracks=${firstTracks}  ` +
      `sql=${s1?.sql?.queries} redis=${s1?.redis?.commands}`
  );

  await stats(true);
  const second = await get(url, cookie);
  const s2 = await stats(false);
  const secondTracks = JSON.parse(second.body || "{}").tracks?.length ?? "?";
  console.log(
    `  2nd call: ${second.status}  ${second.ms}ms  tracks=${secondTracks}  ` +
      `sql=${s2?.sql?.queries} redis=${s2?.redis?.commands}`
  );

  const checks = [
    ["both calls succeed", first.status === 200 && second.status === 200],
    ["empty result is returned, not an error", firstTracks === 0 && secondTracks === 0],
    ["2nd call is much faster (served from cache)", second.ms < Math.max(60, first.ms / 3)],
    ["2nd call costs no database queries", (s2?.sql?.queries ?? 99) === 0],
  ];
  console.log("");
  for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${n}`);
  const pass = checks.every(([, o]) => o);
  console.log(`\n  ${pass ? "PASS — misses are cached; repeats no longer reach Deezer" : "FAIL"}\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
