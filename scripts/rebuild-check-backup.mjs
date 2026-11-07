import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// A migration rehearsal that never connects to a database or writes anything.
// Checks the immutable backup and models the future aggregate totals per user.
const backupPath = process.argv[2];
if (!backupPath) throw new Error('Usage: node scripts/rebuild-check-backup.mjs <private-backup.json>');
const bytes = await readFile(resolve(backupPath));
const backup = JSON.parse(bytes);
const manifest = JSON.parse(await readFile(resolve(backupPath) + '.manifest.json', 'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
assert.equal(backup.format, 'sakura-account-preservation');
assert.equal(backup.version, 1);
const { data, totals } = backup;
const users = new Set(data.users.map(row => row.id));
const tracks = new Set(data.tracks.map(row => row.id));
const artists = new Set(data.artists.map(row => row.id));
const albums = new Set(data.albums.map(row => row.id));
const playlists = new Set(data.playlists.map(row => row.id));
const userTotals = new Map(data.users.map(row => [row.id, 0n]));
for (const row of data.users) assert.ok(!('passwordHash' in row));
for (const row of data.tracks) {
  assert.ok(!('audioUrl' in row));
  assert.ok(artists.has(row.artistId));
  if (row.albumId) assert.ok(albums.has(row.albumId));
}
let raw = 0n, aggregate = 0n;
for (const row of data.history) {
  assert.ok(users.has(row.userId)); assert.ok(tracks.has(row.trackId));
  assert.ok(BigInt(row.msPlayed) >= 0n);
  raw += BigInt(row.msPlayed);
  userTotals.set(row.userId, userTotals.get(row.userId) + BigInt(row.msPlayed));
}
for (const row of data.aggregates) {
  assert.ok(users.has(row.userId)); assert.ok(tracks.has(row.trackId));
  assert.ok(BigInt(row.totalMsPlayed) >= 0n);
  aggregate += BigInt(row.totalMsPlayed);
  userTotals.set(row.userId, userTotals.get(row.userId) + BigInt(row.totalMsPlayed));
}
for (const row of data.favorites) { assert.ok(users.has(row.userId)); assert.ok(tracks.has(row.trackId)); }
for (const row of data.playlists) assert.ok(users.has(row.userId));
for (const row of data.playlistTracks) { assert.ok(playlists.has(row.playlistId)); assert.ok(tracks.has(row.trackId)); }
assert.equal(raw.toString(), totals.rawAudibleMs);
assert.equal(aggregate.toString(), totals.aggregatedAudibleMs);
assert.equal((raw + aggregate).toString(), totals.totalAudibleMs);
assert.equal([...userTotals.values()].reduce((a,b) => a+b, 0n).toString(), totals.totalAudibleMs);
assert.equal(data.users.length, manifest.accounts);
assert.equal(data.history.length, manifest.historyRows);
assert.equal(data.aggregates.length, manifest.aggregateRows);
console.log(JSON.stringify({ valid: true, sha256: manifest.sha256, accounts: users.size, tracks: tracks.size, totals, migrationRehearsal: 'Referential integrity and per-account audible time conserved; no database accessed.' }, null, 2));
