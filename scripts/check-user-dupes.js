/**
 * What duplicates actually show up in a user's library?
 *
 * The deezerId dedupe catches rows that share a provider id. It will NOT catch
 * two rows for the same song that both have a NULL deezerId (Telegram imports,
 * for instance), so this reports both populations before anything is deleted.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const users = (await pool.query(`SELECT id, username FROM "User"`)).rows;

  for (const u of users) {
    const { rows } = await pool.query(
      `SELECT t.title, COALESCE(a.name,'?') AS artist, COUNT(*)::int AS copies,
              COUNT(DISTINCT t."deezerId")::int AS distinct_dz,
              COUNT(*) FILTER (WHERE t."deezerId" IS NULL)::int AS null_dz
         FROM "Favorite" f
         JOIN "Track" t ON t.id = f."trackId"
         LEFT JOIN "Artist" a ON a.id = t."artistId"
        WHERE f."userId" = $1
        GROUP BY lower(t.title), t.title, a.name
       HAVING COUNT(*) > 1
        ORDER BY copies DESC`,
      [u.id]
    );
    const total = (
      await pool.query(`SELECT COUNT(*)::int AS n FROM "Favorite" WHERE "userId" = $1`, [u.id])
    ).rows[0].n;

    console.log(`\n  ${u.username}: ${total} liked songs, ${rows.length} duplicated titles`);
    for (const r of rows.slice(0, 15)) {
      console.log(
        `    ${r.copies}x  "${r.title}" — ${r.artist}   (distinct deezerId: ${r.distinct_dz}, null: ${r.null_dz})`
      );
    }
  }

  // Same-song rows that share no deezerId — invisible to the deezerId dedupe.
  const { rows: nullDupes } = await pool.query(`
    SELECT lower(t.title) AS title, lower(COALESCE(a.name,'')) AS artist, COUNT(*)::int AS n
      FROM "Track" t LEFT JOIN "Artist" a ON a.id = t."artistId"
     WHERE t."deezerId" IS NULL
     GROUP BY lower(t.title), lower(COALESCE(a.name,''))
    HAVING COUNT(*) > 1
     ORDER BY n DESC LIMIT 15
  `);
  console.log(`\n  Duplicate groups with NULL deezerId: ${nullDupes.length}`);
  for (const r of nullDupes) console.log(`    ${r.n}x  "${r.title}" — ${r.artist}`);

  // And title/artist duplicates that span different deezerIds (same song listed
  // twice by the provider, e.g. single + album release).
  const { rows: crossDz } = await pool.query(`
    SELECT lower(t.title) AS title, lower(COALESCE(a.name,'')) AS artist,
           COUNT(DISTINCT t."deezerId")::int AS distinct_dz, COUNT(*)::int AS n
      FROM "Track" t LEFT JOIN "Artist" a ON a.id = t."artistId"
     WHERE t."deezerId" IS NOT NULL
     GROUP BY lower(t.title), lower(COALESCE(a.name,''))
    HAVING COUNT(DISTINCT t."deezerId") > 1
     ORDER BY distinct_dz DESC LIMIT 15
  `);
  console.log(`\n  Same title+artist across DIFFERENT deezerIds: ${crossDz.length}`);
  for (const r of crossDz) {
    console.log(`    "${r.title}" — ${r.artist}: ${r.distinct_dz} deezerIds, ${r.n} rows`);
  }

  await pool.end();
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
