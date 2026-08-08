/**
 * Post-migration integrity check. Confirms the dedupe preserved playable audio
 * and left no dangling references behind.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const one = async (sql) => (await pool.query(sql)).rows[0].n;

  const playable = await one(
    `SELECT COUNT(*)::int AS n FROM "Track" WHERE "audioUrl" IS NOT NULL AND "audioUrl" <> 'pending'`
  );
  const total = await one(`SELECT COUNT(*)::int AS n FROM "Track"`);

  console.log(`\n  Tracks total     : ${total}`);
  console.log(`  Playable tracks  : ${playable}   (was 95 pre-migration, 94 distinct songs)`);

  // Every FK referencing Track must still resolve.
  const refs = [
    ["Favorite", "trackId"],
    ["ListeningHistory", "trackId"],
    ["PlaylistTrack", "trackId"],
    ["SnoozedTrack", "trackId"],
    ["TrackArtist", "trackId"],
    ["TrackCredit", "trackId"],
    ["SampledTrack", "trackId"],
    ["SampledTrack", "sampledTrackId"],
  ];

  console.log(`\n  Dangling references:`);
  let bad = 0;
  for (const [table, col] of refs) {
    const n = await one(
      `SELECT COUNT(*)::int AS n FROM "${table}" x
        WHERE x."${col}" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Track" t WHERE t.id = x."${col}")`
    );
    if (n > 0) bad += n;
    console.log(`    ${n === 0 ? "✓" : "✖"} ${table}.${col}: ${n}`);
  }

  // System playlists store track ids in an array, outside FK enforcement — so
  // they can point at deleted rows without the database objecting.
  const { rows: sp } = await pool.query(`
    SELECT "systemId",
           COALESCE(array_length("trackIds", 1), 0) AS listed,
           (SELECT COUNT(*)::int FROM UNNEST("trackIds") tid
             WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t.id = tid)) AS alive
      FROM "SystemPlaylist" ORDER BY "systemId"
  `);
  console.log(`\n  System playlists (array refs, not FK-enforced):`);
  for (const r of sp) {
    const stale = r.listed - r.alive;
    console.log(`    ${stale === 0 ? "✓" : "⚠"} ${r.systemId}: ${r.alive}/${r.listed} still valid`);
  }

  /**
   * Mix track ids are not all Track rows.
   *
   * Radio and mixes deliberately include "virtual" candidates — catalogue
   * entries from the provider that were never persisted, carrying `deezer-` /
   * `dz-` ids. Counting those as dangling made this check report 17/112 valid
   * and look like the dedupe had wrecked something, when nothing was wrong.
   * Only an id that is neither a live Track nor a virtual id is a real problem.
   */
  const { rows: um } = await pool.query(`
    SELECT COUNT(*)::int AS mixes,
           COALESCE(SUM(array_length("trackIds",1)),0)::int AS listed,
           COALESCE(SUM((SELECT COUNT(*) FROM UNNEST("trackIds") tid
              WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t.id = tid))),0)::int AS real_rows,
           COALESCE(SUM((SELECT COUNT(*) FROM UNNEST("trackIds") tid
              WHERE tid LIKE 'deezer-%' OR tid LIKE 'dz-%')),0)::int AS virtual
      FROM "UserMix"
  `);
  const orphaned = um[0].listed - um[0].real_rows - um[0].virtual;
  console.log(
    `\n  User mixes: ${um[0].mixes} mixes, ${um[0].listed} refs = ` +
      `${um[0].real_rows} real + ${um[0].virtual} virtual` +
      (orphaned > 0 ? `  ✖ ${orphaned} orphaned` : "  ✓")
  );
  if (orphaned > 0) bad += orphaned;

  console.log(`\n  ${bad === 0 ? "✓ No dangling foreign keys" : `✖ ${bad} dangling references`}\n`);
  await pool.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
