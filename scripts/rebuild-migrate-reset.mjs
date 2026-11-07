import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { installSchema } from './rebuild-migrate.mjs';

// The user explicitly authorized wiping Sakura application data. The CLI still
// binds that action to one reviewed target and exact locked inventory. It never
// drops tables, migrates credentials, or restores the earlier private snapshot.
const allowedPublic = new Set(['User','UserSettings','Artist','Album','Track','Playlist','PlaylistTrack',
  'PlaylistFolder','Favorite','SnoozedTrack','ListeningHistory','TasteProfile','ArtistAffinity',
  'GenreAffinity','TasteFeedback','UserMix','SystemPlaylist','PlaybackState','Share','PlayAggregate','SpotifyConnection',
  'SampledTrack','TrackArtist','TrackCredit']);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function inventory(client) {
  const tables = (await client.query(`SELECT n.nspname AS schema,c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','sakura_v2')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')
    ORDER BY n.nspname,c.relname`)).rows;
  if (!tables.some(t => t.schema === 'public' && t.name === 'User') || !tables.some(t => t.schema === 'public' && t.name === 'Track')) throw new Error('wrong-target-schema');
  const unknown = tables.filter(t => t.schema === 'public' && !allowedPublic.has(t.name) && !['_prisma_migrations','_migrations'].includes(t.name));
  if (unknown.length) throw new Error('unreviewed-public-table');
  const app = tables.filter(t => t.schema === 'public' ? allowedPublic.has(t.name) : t.name !== 'SchemaVersion');
  const identity = (await client.query(`SELECT current_database() AS database,inet_server_addr()::text AS server,
    inet_server_port() AS port,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`)).rows[0];
  const targetFingerprint = digest(identity);
  const counts = [];
  for (const t of app) {
    const count = (await client.query(`SELECT COUNT(*)::text AS n FROM ${quote(t.schema)}.${quote(t.name)}`)).rows[0].n;
    counts.push({ ...t, count });
  }
  return { targetFingerprint, counts, inventoryFingerprint: digest(counts) };
}

const apply = process.argv.includes('--apply');
const planIndex = process.argv.indexOf('--plan');
const planPath = planIndex >= 0 ? path.resolve(process.argv[planIndex+1] || '') : null;
const pool = new pg.Pool({ connectionString: process.env.SAKURA_REBUILD_DATABASE_URL || process.env.DATABASE_URL,
  max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
let client;
try {
  if (!(process.env.SAKURA_REBUILD_DATABASE_URL || process.env.DATABASE_URL)) throw new Error('missing-config');
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('sakura-v2-schema'))");
  if (!apply) {
    const result = await inventory(client);
    await client.query('ROLLBACK');
    const directory = path.resolve('.local/rebuild-reset');
    await mkdir(directory, { recursive: true });
    const output = path.join(directory, `plan-${Date.now()}.json`);
    const payload = { version: 1, createdAt: new Date().toISOString(), ...result };
    await writeFile(output + '.tmp', JSON.stringify(payload, null, 2), { mode: 0o600 });
    await rename(output + '.tmp', output);
    console.log(JSON.stringify({ mode: 'read-only-plan', planFile: path.relative(process.cwd(),output), ...result }));
  } else {
    if (!planPath) throw new Error('reviewed-plan-required');
    const plan = JSON.parse(await readFile(planPath,'utf8'));
    if (plan.version !== 1 || !Array.isArray(plan.counts) || Date.now()-Date.parse(plan.createdAt)>24*60*60*1000) throw new Error('invalid-or-expired-plan');
    // Lock before counting: new account creation/listening cannot race the check.
    const preflight = await inventory(client);
    const lockTables = preflight.counts.map(t=>`${quote(t.schema)}.${quote(t.name)}`).join(',');
    await client.query(`LOCK TABLE ${lockTables} IN ACCESS EXCLUSIVE MODE`);
    const current = await inventory(client);
    if (plan.targetFingerprint !== current.targetFingerprint || plan.inventoryFingerprint !== current.inventoryFingerprint) throw new Error('target-or-data-changed-refresh-plan');
    await client.query(`TRUNCATE TABLE ${lockTables} RESTART IDENTITY`);
    await installSchema(client);
    const after = await inventory(client);
    if (after.counts.some(t=>t.count !== '0')) throw new Error('reset-reconciliation-failed');
    await client.query('COMMIT');
    console.log(JSON.stringify({ status:'reset-complete', targetFingerprint:current.targetFingerprint,
      clearedTables:current.counts.length, schemaVersion:1, restoredOldData:false, allApplicationRowsEmpty:true }));
  }
} catch (error) {
  await client?.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({ status:'failed', code:error.code || error.message || 'configuration-or-network' }));
  process.exitCode=1;
} finally { client?.release(); await pool.end(); }
