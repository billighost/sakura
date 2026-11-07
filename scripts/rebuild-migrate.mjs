import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const schemaFiles = ['../src/rebuild/data/schema-auth.sql', '../src/rebuild/server/schema-proposal.sql', '../src/rebuild/data/schema.sql'];
export async function installSchema(client) {
  for (const relative of schemaFiles) {
    const sql = await readFile(new URL(relative, import.meta.url), 'utf8');
    // The caller owns one transaction for all DDL and optional reset.
    await client.query(sql.replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, ''));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--apply')) {
    console.log('Usage: node scripts/rebuild-migrate.mjs --apply (additive schema only; does not reset data)');
    process.exitCode = 1;
  } else {
    const pool = new pg.Pool({ connectionString: process.env.SAKURA_REBUILD_DATABASE_URL || process.env.DATABASE_URL,
      max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
    let client;
    try {
      if (!(process.env.SAKURA_REBUILD_DATABASE_URL || process.env.DATABASE_URL)) throw new Error('missing-config');
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sakura-v2-schema'))");
      await installSchema(client);
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'installed', schemaVersion: 1, legacyDataChanged: false }));
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      console.error(JSON.stringify({ status: 'failed', code: error.code || 'schema-or-configuration' }));
      process.exitCode = 1;
    } finally { client?.release(); await pool.end(); }
  }
}
