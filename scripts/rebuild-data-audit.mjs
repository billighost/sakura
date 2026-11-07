import 'dotenv/config';
import pg from 'pg';

// Only SELECTs run inside a repeatable-read, read-only transaction. The public
// report contains counts, never account names, addresses, IDs or credentials.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  query_timeout: 15000,
});
pool.on('error', () => {});
let client;
const rows = async (sql) => (await client.query(sql)).rows;
try {
  if (!process.env.DATABASE_URL) throw new Error('Database configuration is missing.');
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables = new Set((await rows("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map(r => r.table_name));
  const report = { generatedAt: new Date().toISOString(), mode: 'read-only', counts: {} };
  for (const table of ['User', 'Track', 'Artist', 'Album', 'Favorite', 'Playlist', 'PlaylistTrack', 'ListeningHistory', 'PlayAggregate', 'UserMix', 'TasteProfile', 'SpotifyConnection']) {
    report.counts[table] = tables.has(table)
      ? (await rows(`SELECT COUNT(*)::text AS count FROM "${table}"`))[0].count
      : 'table absent';
  }
  if (tables.has('ListeningHistory') && tables.has('PlayAggregate')) {
    report.listening = (await rows(`
      SELECT
        (SELECT COALESCE(SUM("msPlayed"),0)::text FROM "ListeningHistory") AS "rawAudibleMs",
        (SELECT COALESCE(SUM("totalMsPlayed"),0)::text FROM "PlayAggregate") AS "aggregatedAudibleMs",
        (SELECT COUNT(*)::text FROM "ListeningHistory" WHERE "msPlayed" = 0) AS "zeroDurationHistoryRows",
        (SELECT COUNT(DISTINCT "userId")::text FROM (
          SELECT "userId" FROM "ListeningHistory" UNION SELECT "userId" FROM "PlayAggregate"
        ) u) AS "accountsWithListeningData",
        (SELECT COALESCE(SUM(t.duration),0)::text FROM "ListeningHistory" h JOIN "Track" t ON t.id = h."trackId") AS "legacyDisplayedDurationSeconds"
    `))[0];
  }
  if (tables.has('Track')) {
    report.catalog = (await rows(`
      SELECT
        COUNT(*) FILTER (WHERE "audioUrl" IN ('','pending') OR "audioUrl" IS NULL)::text AS "unresolvedAudioRows",
        COUNT(*) FILTER (WHERE "isrc" IS NOT NULL AND "isrc" <> '')::text AS "tracksWithIsrc",
        COUNT(*) FILTER (WHERE "deezerId" IS NOT NULL)::text AS "tracksWithDeezerId",
        COUNT(*) FILTER (WHERE "coverUrl" IS NULL)::text AS "tracksWithoutOwnCover"
      FROM "Track"
    `))[0];
    report.duplicateCandidates = {};
    for (const field of ['deezerId', 'isrc', 'telegramMessageId']) {
      const valid = field === 'telegramMessageId' ? ` AND "${field}" ~ '^[1-9][0-9]*$'` : '';
      report.duplicateCandidates[field] = (await rows(`
        SELECT COUNT(*)::text AS groups, COALESCE(SUM(n - 1),0)::text AS "extraRows"
        FROM (SELECT COUNT(*) AS n FROM "Track" WHERE "${field}" IS NOT NULL AND "${field}" <> '' ${valid} GROUP BY "${field}" HAVING COUNT(*) > 1) d
      `))[0];
    }
    report.catalog.nonNumericTelegramReferences = (await rows(`SELECT COUNT(*)::text AS count FROM "Track" WHERE "telegramMessageId" IS NOT NULL AND "telegramMessageId" <> '' AND "telegramMessageId" !~ '^[0-9]+$'`))[0].count;
    report.catalog.zeroTelegramReferences = (await rows(`SELECT COUNT(*)::text AS count FROM "Track" WHERE "telegramMessageId" = '0'`))[0].count;
    report.duplicateCandidates.sameTitleArtistAndDuration = (await rows(`
      SELECT COUNT(*)::text AS groups, COALESCE(SUM(n - 1),0)::text AS "extraRows"
      FROM (SELECT COUNT(*) AS n FROM "Track"
        GROUP BY LOWER(TRIM(title)), "artistId", duration HAVING COUNT(*) > 1) d
    `))[0];
  }
  if (tables.has('Artist')) {
    report.artistArtwork = (await rows(`
      SELECT COUNT(*) FILTER (WHERE "imageUrl" IS NULL OR "imageUrl" = '')::text AS "missingImages",
        COUNT(*) FILTER (WHERE ("imageUrl" IS NULL OR "imageUrl" = '') AND "deezerId" IS NULL)::text AS "missingImagesAndProviderId"
      FROM "Artist"
    `))[0];
  }
  if (tables.has('UserMix')) {
    report.mixes = (await rows(`
      SELECT COUNT(*) FILTER (WHERE cardinality("trackIds") = 0)::text AS "emptyMixes",
        COUNT(*) FILTER (WHERE "expiresAt" < NOW())::text AS "expiredMixes",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest("trackIds") x WHERE x LIKE 'deezer-%'))::text AS "mixesWithVirtualTracks"
      FROM "UserMix"
    `))[0];
    report.mixOverlap = (await rows(`
      WITH pairs AS (
        SELECT
          cardinality(ARRAY(SELECT unnest(a."trackIds") INTERSECT SELECT unnest(b."trackIds")))::float AS shared,
          LEAST(cardinality(a."trackIds"), cardinality(b."trackIds")) AS shorter
        FROM "UserMix" a JOIN "UserMix" b ON a."userId" = b."userId" AND a.id < b.id
        WHERE cardinality(a."trackIds") > 0 AND cardinality(b."trackIds") > 0
      )
      SELECT COUNT(*)::text AS pairs, ROUND(COALESCE(AVG(shared/shorter),0)::numeric,4)::text AS "meanOverlapOfShorterMix",
        ROUND(COALESCE(MAX(shared/shorter),0)::numeric,4)::text AS "maximumOverlapOfShorterMix" FROM pairs
    `))[0];
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ error: 'Read-only audit failed.', code: error.code ?? 'configuration-or-network' }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
