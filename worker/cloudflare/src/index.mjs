import { DurableObject } from 'cloudflare:workers';
import { connect } from 'cloudflare:sockets';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import telegram from 'telegram';
import sessions from 'telegram/sessions/index.js';
import connections from 'telegram/network/connection/index.js';
import logger from 'telegram/extensions/Logger.js';
import plainSender from 'telegram/network/MTProtoPlainSender.js';
import aes from 'telegram/crypto/IGE.js';
import bigInt from 'big-integer';
import service from '../../rebuild/service.cjs';
import queues from '../../rebuild/serial-queue.cjs';
import { socketClass } from './socket.mjs';
import { Ownership } from './ownership.mjs';
import { DurableSession } from './session.mjs';
import { needsTagRecovery, recoverEmbeddedMetadata } from './tags.mjs';
import { guardSender, guardClientSenders, withDeadline } from './deadline.mjs';
import { authorized, audioRoute, audioHeaders, json, readBody, signature, validTag, CORS, features } from './http.mjs';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (['/', '/health', '/healthz'].includes(path)) return json({ ok: true, service: 'sakura-audio', audioProtocol: 'v2' });
    if (!authorized(request, env.WORKER_SECRET)) return json({ error: 'Unauthorized' }, 401);
    if (!env.TELEGRAM_OWNER_ID) return json({ status: 'unavailable', reason: 'audio-worker-not-configured', retryable: false }, 503);
    // All previews, production requests and media reads for this authorization
    // use exactly this named object. Never derive an owner from the URL/region.
    const id = env.TELEGRAM_OWNER.idFromName(env.TELEGRAM_OWNER_ID);
    return env.TELEGRAM_OWNER.get(id).fetch(request);
  }
};

export class TelegramOwner extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env; this.sockets = new Set(); this.queues = new Map();
    this.owner = new Ownership(ctx.storage, crypto.randomUUID());
    this.active = 0; this.transfers = 0; this.lastUse = Date.now();
    this.bots = [...new Set([env.TELEGRAM_BOT_USERNAME || 'musicshuntersbot', ...(env.TELEGRAM_FALLBACK_BOTS || '').split(',')].map(v => v.trim().toLowerCase()).filter(v => /^[a-z0-9_]{3,64}$/.test(v)))];
    ctx.blockConcurrencyWhile(async () => {
      this.readyAt = await this.owner.claim();
      this.saved = await ctx.storage.get('telegram-session');
      this.fatal = await ctx.storage.get('fatal');
    });
  }
  queueFor(bot) { if (!this.queues.has(bot)) this.queues.set(bot, new queues.SerialQueue(bot)); return this.queues.get(bot); }
  async retire() {
    const client = this.client; this.client = null; this.rebuild = null;
    if (client) { client._destroyed = true; client._autoReconnect = false; }
    await Promise.allSettled([...this.sockets].map(socket => socket.close()));
    if (client) await client.destroy().catch(() => {});
  }
  async fatalError(error) {
    const message = String(error?.errorMessage || error?.message || error);
    if (/AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/.test(message)) {
      this.fatal = 'audio-worker-session-unavailable';
      await this.ctx.storage.put('fatal', this.fatal);
      await this.retire();
    }
  }
  async ensureConnected() {
    if (this.fatal) throw new Error(this.fatal);
    if (this.connecting) return this.connecting;
    if (this.client?.connected) { await this.owner.fence(); return; }
    this.connecting = this.openClient().catch(async error => { await this.fatalError(error); await this.retire(); throw error; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async openClient() {
    if (Date.now() < this.readyAt) throw new Error('Telegram owner draining');
    await this.retire();
    await this.owner.fence();
    const session = new DurableSession(this.saved?.main || this.env.TELEGRAM_SESSION_STRING || '');
    await session.load();
    if (!session.authKey?.getKey()) throw new Error('audio-worker-not-configured');
    // Preserve media-DC auth keys as well as the main DC migration state.
    await session.restore(this.saved?.keys);
    const persist = async () => {
      if (this.client !== client || client._destroyed) return;
      await this.owner.fence();
      this.saved = session.snapshot();
      await this.ctx.storage.put('telegram-session', this.saved);
    };
    session.onChange = () => { this.ctx.waitUntil(persist().catch(async () => { if (this.client === client) await this.retire(); })); };
    const quiet = new logger.Logger('none');
    const Socket = socketClass(connect, async () => {
      if (this.client !== client || client._destroyed) throw new Error('Telegram client retired');
      try { await this.owner.fence(); } catch (error) { await this.retire(); throw error; }
    }, this.sockets);
    const client = new telegram.TelegramClient(session, Number(this.env.TELEGRAM_API_ID), this.env.TELEGRAM_API_HASH, {
      connection: connections.ConnectionTCPFull, networkSocket: Socket, useWSS: false,
      autoReconnect: false, connectionRetries: 2, requestRetries: 2, downloadRetries: 2,
      retryDelay: 500, timeout: 10, floodSleepThreshold: 0, baseLogger: quiet,
      deviceModel: 'Sakura Cloudflare owner'
    });
    // GramJS's update loop reconnects even with autoReconnect:false. This worker
    // polls bot messages explicitly and controls reconnection on request only.
    client._loopStarted = true;
    this.client = client;
    const expire = () => { if (this.client === client) this.ctx.waitUntil(this.retire()); };
    guardClientSenders(client, () => this.client === client, expire);
    client.onError = async error => { await this.fatalError(error); };
    await withDeadline(client.connect(), 20000, expire);
    guardSender(client._sender, expire);
    await persist();
    this.rebuild = new service.RebuildAudioService({ telegram: () => this.client, api: telegram.Api, bigInt,
      bots: this.bots, queueFor: bot => this.queueFor(bot), ensureConnected: () => this.ensureConnected(),
      recoverMetadata: async audio => {
        if (!needsTagRecovery(audio)) return null;
        const started = Date.now();
        try {
          const stream = await this.rebuild.stream(audio.chatScope, audio.messageId, 0, Math.min(audio.size, 1024 * 1024), audio);
          const metadata = await recoverEmbeddedMetadata(audio, stream);
          this.lastRecovery = { messageId: audio.messageId, chatScope: audio.chatScope, outcome: metadata ? 'complete-tags' : 'incomplete-tags', elapsedMs: Date.now() - started };
          return metadata;
        } catch (error) {
          this.lastRecovery = { messageId: audio.messageId, chatScope: audio.chatScope, outcome: /TIMEOUT|socket|retired/.test(String(error?.message)) ? 'transport-failure' : 'parser-failure', elapsedMs: Date.now() - started };
          throw error;
        }
      },
      onFatal: error => this.ctx.waitUntil(this.fatalError(error)) });
  }
  async alarm() {
    if (this.active || this.transfers || this.connecting || Date.now() - this.lastUse < 60000) { await this.ctx.storage.setAlarm(Date.now() + 60000); return; }
    await this.retire();
  }
  async fetch(request) {
    if (!authorized(request, this.env.WORKER_SECRET)) return json({ error: 'Unauthorized' }, 401);
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/v2/capabilities') return json({ protocol: 'v2', botScopes: this.bots, features,
      acquisitionEnabled: this.env.TELEGRAM_ENABLED === 'true', ready: !this.fatal && Date.now() >= this.readyAt, connected: Boolean(this.client?.connected), revision: this.env.CF_VERSION_METADATA?.id || null, fatal: this.fatal || null });
    // Dedicated runtime proof configuration only; it cannot access a real key.
    if (request.method === 'POST' && path === '/v2/runtime-proof' && this.env.RUNTIME_PROOF === 'true' && this.env.TELEGRAM_ENABLED !== 'true') {
      const fake = new sessions.StringSession(); fake.setDC(2, '149.154.167.51', 80);
      const key = Buffer.alloc(256, 7), auth = new telegram.Api.Ping({ pingId: bigInt(1) });
      const hash = createHash('sha256').update(auth.getBytes()).digest('hex');
      const constructed = new telegram.TelegramClient(fake, 1, 'synthetic-api-hash', { baseLogger: new logger.Logger('none') });
      constructed._destroyed = true;
      const stream = Readable.toWeb(Readable.from([key], { objectMode: false }));
      const bytes = await new Response(stream).arrayBuffer();
      const encrypted = new aes.IGE(Buffer.alloc(32, 1), Buffer.alloc(32, 2)).encryptIge(key);
      const decrypted = new aes.IGE(Buffer.alloc(32, 1), Buffer.alloc(32, 2)).decryptIge(encrypted);
      return json({ ok: hash.length === 64 && bytes.byteLength === 256 && decrypted.equals(key), durableStorage: Boolean(await this.ctx.storage.get('ownership')), gramjs: constructed.__version__, streamedBytes: bytes.byteLength });
    }
    if (request.method === 'POST' && path === '/v2/tcp-proof' && this.env.RUNTIME_PROOF === 'true' && this.env.TELEGRAM_ENABLED !== 'true') {
      // req_pq is an unauthenticated handshake. No imported authorization,
      // account login, bot message, file read, or generated auth key is involved.
      const Socket = socketClass(connect, () => this.owner.fence());
      const connection = new connections.ConnectionTCPFull({ ip: '149.154.167.51', port: 80, dcId: 2, loggers: new logger.Logger('none'), socket: Socket });
      let timer;
      try {
        const result = await Promise.race([(async () => {
          await connection.connect();
          const sender = new plainSender.MTProtoPlainSender(connection, new logger.Logger('none'));
          const nonce = bigInt(crypto.randomUUID().replace(/-/g, ''), 16).shiftRight(1);
          const result = await sender.send(new telegram.Api.ReqPqMulti({ nonce }));
          return result instanceof telegram.Api.ResPQ && result.nonce.equals(nonce);
        })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Telegram TCP proof timed out')), 15000); })]);
        return json({ ok: result, transport: 'Cloudflare TCP to Telegram', authenticated: false });
      } catch { return json({ ok: false, reason: 'tcp-proof-failed' }, 502); }
      finally { clearTimeout(timer); await connection.disconnect(); await connection.socket.close(); }
    }
    if (this.env.TELEGRAM_ENABLED !== 'true') return json({ status: 'unavailable', reason: 'audio-worker-disabled', retryable: false }, 503);
    if (this.fatal) return json({ status: 'unavailable', reason: this.fatal, retryable: false }, 503);
    if (Date.now() < this.readyAt) return json({ status: 'unavailable', reason: 'audio-worker-restarting', retryable: true }, 503, { 'Retry-After': String(Math.ceil((this.readyAt - Date.now()) / 1000)) });
    const audio = audioRoute(path);
    if (!audio && (request.method !== 'POST' || !['/v2/resolve', '/v2/audio-info', '/v2/sign-audio', '/v2/source-audit'].includes(path))) return json({ error: 'Not found' }, 404);
    this.active++; this.lastUse = Date.now();
    try {
      if (audio && ['GET', 'HEAD'].includes(request.method)) {
        if (request.method === 'GET' && this.transfers >= 2) return json({ reason: 'audio-worker-busy', retryable: true }, 429, { 'Retry-After': '3' });
        await this.ensureConnected();
        const { audio: info } = await this.rebuild.info(audio[1], audio[2]);
        const prepared = audioHeaders(request, info);
        if (prepared.response) return prepared.response;
        if (request.method === 'HEAD') return new Response(null, { status: prepared.status, headers: prepared.headers });
        // Reserve before the asynchronous opening so simultaneous fetches cannot
        // all pass the transfer cap. Release only on completion or cancellation.
        if (this.transfers >= 2) return json({ reason: 'audio-worker-busy', retryable: true }, 429, { 'Retry-After': '3' });
        this.transfers++;
        let nodeStream;
        try { nodeStream = await this.rebuild.stream(audio[1], audio[2], prepared.start, prepared.length, info); }
        catch (error) { this.transfers--; throw error; }
        const reader = Readable.toWeb(nodeStream).getReader(); let finished = false;
        const finish = () => { if (!finished) { finished = true; this.transfers--; this.lastUse = Date.now(); request.signal.removeEventListener('abort', abort); } };
        const abort = () => { nodeStream.destroy(); void reader.cancel().catch(() => {}); finish(); };
        request.signal.addEventListener('abort', abort, { once: true });
        const body = new ReadableStream({
          async pull(controller) { try { const part = await reader.read(); if (part.done) { finish(); controller.close(); } else controller.enqueue(part.value); } catch (error) { finish(); nodeStream.destroy(); controller.error(error); } },
          async cancel(reason) { nodeStream.destroy(); finish(); await reader.cancel(reason).catch(() => {}); }
        });
        if (request.signal.aborted) abort();
        return new Response(body, { status: prepared.status, headers: prepared.headers });
      }
      const body = await readBody(request);
      if (path === '/v2/sign-audio') {
        const bot = String(body.chatScope || '').toLowerCase(), id = String(body.messageId);
        if (!this.bots.includes(bot) || !/^[1-9]\d{0,14}$/.test(id) || (body.documentTag !== undefined && !validTag(body.documentTag))) return json({ error: 'Invalid source request' }, 400);
        const exp = Math.floor(Date.now() / 1000) + Math.min(3600, Math.max(60, Math.floor(Number(body.ttlSeconds) || 1800)));
        const query = new URLSearchParams({ exp: String(exp), sig: signature(this.env.WORKER_SECRET, bot, id, exp, body.documentTag), ...(body.documentTag ? { documentTag: body.documentTag } : {}) });
        return json({ path: `/v2/audio/${bot}/${id}?${query}`, expiresAt: exp });
      }
      await this.ensureConnected();
      if (path === '/v2/source-audit') {
        const bot = this.rebuild.scope(body.chatScope), peer = await this.rebuild.peer(bot);
        const messages = await this.client.getMessages(peer, { limit: 64 });
        const audios = messages.map(message => this.rebuild.audio(message, bot)).filter(Boolean);
        return json({ audios, lastRecovery: this.lastRecovery || null });
      }
      if (path === '/v2/resolve') { const result = await this.rebuild.resolve(body); return json(result, result.status === 'review' ? 409 : 200); }
      const { audio: info } = await this.rebuild.info(body.chatScope, String(body.messageId), body.refresh === true);
      return json({ ...info, title: info.metadata.title, artist: info.metadata.artists[0], duration: info.metadata.durationMs / 1000 });
    } catch (error) {
      await this.fatalError(error);
      const message = String(error?.message || error);
      const reason = this.fatal || (/not-configured/.test(message) ? 'audio-worker-not-configured' : /FLOOD_WAIT/.test(message) ? 'audio-worker-rate-limited' : 'audio-worker-unavailable');
      if (/Invalid|Unknown|JSON|body too large/.test(message)) return json({ error: 'Invalid source request' }, /too large/.test(message) ? 413 : 400);
      if (/Source audio not found/.test(message)) return json({ reason: 'audio-source-unavailable' }, 404);
      return json({ status: 'unavailable', reason, retryable: !this.fatal }, 503);
    } finally { this.active--; this.lastUse = Date.now(); await this.ctx.storage.setAlarm(Date.now() + 60000); }
  }
}
