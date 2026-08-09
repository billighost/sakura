/**
 * Does folding old history into PlayAggregate preserve the taste profile?
 *
 * This is the claim the whole retention scheme rests on, and it is exactly the
 * kind of claim that is easy to assert and quietly wrong. If the fold loses
 * signal, users' recommendations silently degrade months after the fact, with
 * nothing in the logs and no way to reconstruct what was lost.
 *
 * So: snapshot the affinities, prune, recompute, compare.
 *
 * Runs inside a transaction that is ALWAYS rolled back — it must never be the
 * thing that mutates real listening history.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const RAW_DAYS = Number(process.env.HISTORY_RAW_DAYS) || 120;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const user = (await client.query(`SELECT id, username FROM "User" LIMIT 1`)).rows[0];
    if (!user) {
      console.log("\n  No users.\n");
      return;
    }

    // The live database has only a handful of plays, all recent, so pruning
    // would be a no-op and prove nothing. Manufacture history old enough to be
    // folded, using real tracks so the joins behave.
    const tracks = (
      await client.query(`SELECT id FROM "Track" WHERE "artistId" IS NOT NULL LIMIT 12`)
    ).rows;
    if (tracks.length < 5) {
      console.log("\n  Not enough catalogue to synthesise history.\n");
      return;
    }

    console.log(`\n  Synthesising old plays for ${user.username} …`);
    let inserted = 0;
    for (const [i, t] of tracks.entries()) {
      // Replays of the same track, spread from 400 to 150 days ago — all older
      // than the raw window, so all eligible for folding.
      const replays = 3 + (i % 5);
      for (let r = 0; r < replays; r++) {
        const daysAgo = RAW_DAYS + 30 + r * 7 + i;
        await client.query(
          `INSERT INTO "ListeningHistory"
             ("userId","trackId","playedAt",skipped,"msPlayed",completed,autoplay,"hourOfDay","dayOfWeek")
           VALUES ($1,$2, NOW() - ($3||' days')::interval, $4,$5,$6,false,$7,$8)`,
          [user.id, t.id, daysAgo, r % 4 === 0, r % 4 === 0 ? 8000 : 180000, r % 4 !== 0, (i * 3) % 24, i % 7]
        );
        inserted++;
      }
    }
    console.log(`    ${inserted} old plays across ${tracks.length} tracks`);

    // Baseline: recompute from full raw history.
    const { recomputeTasteViaSql } = makeRecompute(client);
    const before = await recomputeTasteViaSql(user.id);
    console.log(`\n  Before prune: ${before.artists.size} artists, ${before.genres.size} genres scored`);

    // Fold exactly as the retention job does: read the rows, weight each one
    // individually, and store the summed weight. This is the part that has to
    // be faithful — deriving the weight from counts afterwards is what failed.
    const { weight: rowWeight } = makeRecompute(client);
    const oldRows = await client.query(
      `SELECT h."userId",h."trackId",h."msPlayed",(COALESCE(t.duration,0)*1000) "durationMs",
              h.completed,h.skipped,h."playedAt"
         FROM "ListeningHistory" h LEFT JOIN "Track" t ON t.id=h."trackId"
        WHERE h."playedAt" < NOW() - ($1||' days')::interval`,
      [RAW_DAYS]
    );
    const foldMap = new Map();
    for (const r of oldRows.rows) {
      const k = `${r.userId} ${r.trackId}`;
      let f = foldMap.get(k);
      if (!f) {
        f = { u: r.userId, t: r.trackId, plays: 0, comp: 0, skip: 0, ms: 0, sig: 0, first: r.playedAt, last: r.playedAt };
        foldMap.set(k, f);
      }
      f.plays++;
      if (r.completed) f.comp++;
      if (r.skipped) f.skip++;
      f.ms += r.msPlayed || 0;
      f.sig += rowWeight(r.msPlayed, Number(r.durationMs) || 0, r.completed, r.skipped);
      if (r.playedAt < f.first) f.first = r.playedAt;
      if (r.playedAt > f.last) f.last = r.playedAt;
    }
    const fr = [...foldMap.values()];
    const folded = await client.query(
      `INSERT INTO "PlayAggregate"
         ("userId","trackId",plays,completions,skips,"totalMsPlayed","signalSum","firstPlayedAt","lastPlayedAt")
       SELECT * FROM UNNEST($1::uuid[],$2::text[],$3::int[],$4::int[],$5::int[],
                            $6::bigint[],$7::double precision[],$8::timestamp[],$9::timestamp[])
       ON CONFLICT ("userId","trackId") DO UPDATE SET
         plays="PlayAggregate".plays+EXCLUDED.plays,
         completions="PlayAggregate".completions+EXCLUDED.completions,
         skips="PlayAggregate".skips+EXCLUDED.skips,
         "totalMsPlayed"="PlayAggregate"."totalMsPlayed"+EXCLUDED."totalMsPlayed",
         "signalSum"="PlayAggregate"."signalSum"+EXCLUDED."signalSum",
         "firstPlayedAt"=LEAST("PlayAggregate"."firstPlayedAt",EXCLUDED."firstPlayedAt"),
         "lastPlayedAt"=GREATEST("PlayAggregate"."lastPlayedAt",EXCLUDED."lastPlayedAt")`,
      [fr.map(f=>f.u),fr.map(f=>f.t),fr.map(f=>f.plays),fr.map(f=>f.comp),fr.map(f=>f.skip),
       fr.map(f=>f.ms),fr.map(f=>f.sig),fr.map(f=>f.first),fr.map(f=>f.last)]
    );
    const del = await client.query(
      `DELETE FROM "ListeningHistory" WHERE "playedAt" < NOW() - ($1||' days')::interval`,
      [RAW_DAYS]
    );
    console.log(`  Folded ${folded.rowCount} pairs, deleted ${del.rowCount} raw rows`);

    const after = await recomputeTasteViaSql(user.id);
    console.log(`  After prune:  ${after.artists.size} artists, ${after.genres.size} genres scored`);

    // Compare. Exact equality is not the bar — decay is applied at
    // lastPlayedAt for a whole group rather than per play — but the *ranking*
    // must survive, because that is what recommendations consume.
    const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const rBefore = rank(before.artists).slice(0, 10);
    const rAfter = rank(after.artists).slice(0, 10);
    const overlap = rBefore.filter((a) => rAfter.includes(a)).length;

    console.log(`\n  Top-10 artist overlap: ${overlap}/${Math.min(10, rBefore.length)}`);
    const kept = [...before.artists.keys()].filter((a) => after.artists.has(a)).length;
    console.log(`  Artists retained:      ${kept}/${before.artists.size}`);

    let maxDrift = 0;
    for (const [a, s] of before.artists) {
      const t = after.artists.get(a) ?? 0;
      if (s > 0) maxDrift = Math.max(maxDrift, Math.abs(t - s) / s);
    }
    console.log(`  Worst score drift:     ${(maxDrift * 100).toFixed(0)}%`);

    const checks = [
      ["no artist dropped from the profile", kept === before.artists.size],
      ["top-10 ranking preserved", overlap === Math.min(10, rBefore.length)],
      ["scores within 35% of pre-prune", maxDrift < 0.35],
    ];
    console.log("");
    for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${n}`);
    console.log(`\n  ${checks.every(([, o]) => o) ? "PASS — pruning preserves taste" : "FAIL — signal lost"}\n`);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
    console.log("  (all changes rolled back)\n");
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

/**
 * Minimal re-implementation of the scoring the app does, over the same two
 * sources. Reproducing it here keeps the test independent of the app's module
 * graph (which needs Next's alias resolution) while exercising the same data.
 */
function makeRecompute(client) {
  const HALF_LIFE = 60;
  const decay = (d) => Math.pow(0.5, ((Date.now() - new Date(d).getTime()) / 86400000) / HALF_LIFE);

  /** Mirrors meanDecayFactor in lib/taste.ts — the mean of the decay curve
   *  across the group's span, not its value at an endpoint. */
  const meanDecay = (first, last) => {
    const dF = (Date.now() - new Date(first).getTime()) / 86400000;
    const dL = (Date.now() - new Date(last).getTime()) / 86400000;
    const oldest = Math.max(dF, dL, 0);
    const newest = Math.max(Math.min(dF, dL), 0);
    const lambda = Math.LN2 / HALF_LIFE;
    const span = oldest - newest;
    if (span < 1) return Math.pow(0.5, newest / HALF_LIFE);
    return (Math.exp(-lambda * newest) - Math.exp(-lambda * oldest)) / (lambda * span);
  };

  const weight = (ms, durMs, completed, skipped) => {
    if (skipped && ms < 10000) return -1;
    if (completed) return 2;
    if (durMs > 0 && ms / durMs > 0.5) return 1.2;
    return 0.4;
  };

  return {
    async recomputeTasteViaSql(userId) {
      const artists = new Map();
      const genres = new Map();
      const add = (m, k, v) => k && m.set(k, (m.get(k) ?? 0) + v);

      const raw = await client.query(
        `SELECT h."msPlayed",h.completed,h.skipped,h."playedAt",t."artistId",t.duration,a.genres
           FROM "ListeningHistory" h JOIN "Track" t ON t.id=h."trackId"
           LEFT JOIN "Artist" a ON a.id=t."artistId" WHERE h."userId"=$1`,
        [userId]
      );
      for (const p of raw.rows) {
        const w = weight(p.msPlayed, (p.duration || 0) * 1000, p.completed, p.skipped);
        if (w === 0) continue;
        const d = w * decay(p.playedAt);
        add(artists, p.artistId, d);
        for (const g of p.genres ?? []) add(genres, g.toLowerCase(), d / (p.genres.length || 1));
      }

      const agg = await client.query(
        `SELECT pa.plays,pa."signalSum",pa."firstPlayedAt",pa."lastPlayedAt",
                t."artistId",a.genres
           FROM "PlayAggregate" pa JOIN "Track" t ON t.id=pa."trackId"
           LEFT JOIN "Artist" a ON a.id=t."artistId" WHERE pa."userId"=$1`,
        [userId]
      );
      for (const p of agg.rows) {
        const sig = Number(p.signalSum) || 0;
        if (sig === 0) continue;
        const d = sig * meanDecay(p.firstPlayedAt, p.lastPlayedAt);
        add(artists, p.artistId, d);
        for (const g of p.genres ?? []) add(genres, g.toLowerCase(), d / (p.genres.length || 1));
      }

      return { artists, genres };
    },
    weight,
  };
}
