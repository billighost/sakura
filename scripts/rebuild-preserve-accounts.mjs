import 'dotenv/config';
import pg from 'pg';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Run only for an explicitly authorized backup. Excludes password hashes,
// OAuth tokens, session data, audio URLs, and transient playback state.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
pool.on('error', () => {});
let client;
let temporaryPath;
const sum = (rows, key) => rows.reduce((total, row) => total + BigInt(row[key] ?? 0), 0n).toString();
try {
  if (!process.env.DATABASE_URL) throw new Error('Database configuration is missing.');
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const get = async sql => (await client.query(sql)).rows;
  const existing = new Set((await get("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map(r => r.table_name));
  const data = {};
  data.users = await get('SELECT id, username, email, "avatarUrl", bio, "createdAt" FROM "User" ORDER BY id');
  data.tracks = await get('SELECT id, title, "artistId", "albumId", duration, "trackNumber", genre, "coverUrl", "sourceHash", source, "telegramMessageId", "deezerId", isrc, "createdAt" FROM "Track" ORDER BY id');
  const mappings = [
    ['artists', 'Artist'], ['albums', 'Album'], ['trackArtists', 'TrackArtist'],
    ['settings', 'UserSettings'], ['favorites', 'Favorite'], ['playlists', 'Playlist'],
    ['playlistFolders', 'PlaylistFolder'], ['playlistTracks', 'PlaylistTrack'],
    ['history', 'ListeningHistory'], ['aggregates', 'PlayAggregate'],
    ['tasteProfiles', 'TasteProfile'], ['artistAffinities', 'ArtistAffinity'],
    ['genreAffinities', 'GenreAffinity'], ['tasteFeedback', 'TasteFeedback'], ['snoozedTracks', 'SnoozedTrack'],
  ];
  for (const [key, table] of mappings) data[key] = existing.has(table) ? await get(`SELECT * FROM "${table}"`) : [];
  const databaseTotals = (await get(`SELECT
    (SELECT COALESCE(SUM("msPlayed"),0)::text FROM "ListeningHistory") AS raw,
    (SELECT COALESCE(SUM("totalMsPlayed"),0)::text FROM "PlayAggregate") AS aggregated`))[0];
  const totals = { rawAudibleMs: sum(data.history, 'msPlayed'), aggregatedAudibleMs: sum(data.aggregates, 'totalMsPlayed') };
  if (totals.rawAudibleMs !== databaseTotals.raw || totals.aggregatedAudibleMs !== databaseTotals.aggregated) throw new Error('Listening totals do not reconcile.');
  totals.totalAudibleMs = (BigInt(totals.rawAudibleMs) + BigInt(totals.aggregatedAudibleMs)).toString();
  const payload = {
    format: 'sakura-account-preservation', version: 1, createdAt: new Date().toISOString(),
    scope: 'all-authorized-accounts', excluded: ['passwordHash', 'SpotifyConnection', 'PlaybackState', 'audioUrl', 'telegramFileId', 'previewUrl'],
    totals, data,
  };
  await client.query('ROLLBACK');
  const directory = resolve('.local/rebuild-backups');
  await mkdir(directory, { recursive: true });
  const filename = `accounts-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}.json`;
  const finalPath = join(directory, filename);
  temporaryPath = finalPath + '.partial';
  const bytes = Buffer.from(JSON.stringify(payload, null, 2) + '\n');
  const file = await open(temporaryPath, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const saved = await readFile(temporaryPath);
  const checksum = createHash('sha256').update(saved).digest('hex');
  if (checksum !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Backup checksum mismatch.');
  await rename(temporaryPath, finalPath);
  temporaryPath = undefined;
  const manifest = { filename, sha256: checksum, byteLength: saved.length, accounts: data.users.length, historyRows: data.history.length, aggregateRows: data.aggregates.length, totals };
  const manifestFile = await open(finalPath + '.manifest.json', 'wx', 0o600);
  try { await manifestFile.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await manifestFile.sync(); } finally { await manifestFile.close(); }
  console.log(JSON.stringify({ backupPath: finalPath, ...manifest, reconciled: true, databaseMode: 'read-only' }, null, 2));
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => {});
  console.error(JSON.stringify({ error: 'Private backup failed.', code: error.code ?? 'validation-or-network' }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
