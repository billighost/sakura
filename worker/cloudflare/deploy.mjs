import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import dotenv from '../node_modules/dotenv/lib/main.js';
import sessions from '../node_modules/telegram/sessions/index.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const wrangler = resolve(process.env.APPDATA || '', 'npm/node_modules/wrangler/bin/wrangler.js');
const args = process.argv.slice(2), proof = args.includes('--proof'), enable = args.includes('--enable');
if (enable && !args.includes('--old-owner-stopped')) throw new Error('Activation requires --old-owner-stopped after confirming Render and local workers are stopped.');
const local = resolve(root, '.local/cloudflare-deploy'); mkdirSync(local, { recursive: true });
const configuration = resolve(directory, proof ? 'wrangler.proof.jsonc' : 'wrangler.jsonc');
const env = dotenv.parse(readFileSync(resolve(root, '.env')));
const secrets = proof ? { WORKER_SECRET: 'synthetic-runtime-proof-secret-123456' } : Object.fromEntries(['WORKER_SECRET', 'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING'].map(name => [name, env[name] || '']));
if (!proof) {
  for (const [name, value] of Object.entries(secrets)) if (!value) throw new Error(`${name} is missing from the private root .env`);
  const session = new sessions.StringSession(secrets.TELEGRAM_SESSION_STRING); await session.load();
  const key = session.authKey?.getKey(); if (!key || key.length !== 256) throw new Error('Telegram session is invalid.');
  secrets.TELEGRAM_OWNER_ID = 'sakura-key-' + createHash('sha256').update(key).digest('hex');
}
const run = extra => execFileSync(process.execPath, [wrangler, ...extra, '--config', configuration], { cwd: directory, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
// Upload in disabled mode first. Secret bulk files are private and removed even
// on failure; no secret is put in CLI args, shell expansions, or console output.
run(['deploy']);
const path = resolve(local, proof ? 'proof-secrets.json' : 'worker-secrets.json');
writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
try { run(['secret', 'bulk', path]); } finally { unlinkSync(path); }
if (!proof) {
  const vars = ['--var', 'TELEGRAM_ENABLED:' + String(enable), '--var', 'TELEGRAM_BOT_USERNAME:' + (env.TELEGRAM_BOT_USERNAME || 'musicshuntersbot'), '--var', 'TELEGRAM_FALLBACK_BOTS:' + (env.TELEGRAM_FALLBACK_BOTS || '')];
  run(['deploy', ...vars]);
}
