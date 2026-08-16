"use strict";

/**
 * The one and only owner of the Telegram MTProto session.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Telegram permanently revokes an auth key the moment it observes that key on
 * two live connections from different IPs. It does not warn, it does not rate
 * limit — it revokes, and the only cure is generating a new session by hand.
 *
 * The previous design ran MTProto inside Next.js route handlers on Vercel.
 * That cannot work, and no amount of locking can make it work:
 *
 *   - Vercel runs many instances concurrently, each with its own `globalThis`,
 *     each on its own IP.
 *   - A distributed lock around `connect()` only serialises the handshake. The
 *     socket outlives the lock, so instance A is still connected (holding the
 *     key on IP A) when instance B takes the lock and connects on IP B.
 *   - Preview deployments inherit the same env vars by default, so they are a
 *     third fleet using the same key.
 *
 * The fix is structural rather than defensive: exactly one process, for its
 * whole lifetime, holds exactly one connection. That process is this one. It
 * never scales horizontally, so the failure mode is not "prevented" — it is
 * unreachable. Everything else talks to it over HTTP.
 *
 * ── What was deliberately kept ─────────────────────────────────────────────
 *
 * The bot-interaction logic below is ported almost verbatim from
 * `src/lib/telegram.ts`, because it encodes things that were expensive to
 * learn: the 4KB offset alignment Telegram requires, the fact that
 * `iterDownload`'s `limit` counts chunks rather than bytes, the strict
 * title+artist match on the shared history fast path, and the
 * FILE_REFERENCE_EXPIRED re-resolve. Those are not incidental.
 *
 * ── What was deliberately dropped ──────────────────────────────────────────
 *
 * Every piece of distributed machinery: the Redis mutex, the connect lock, the
 * session-poisoned flag, the reconnect-with-a-fresh-session retry path, and the
 * `unhandledRejection` swallow that hid AUTH_KEY_DUPLICATED from the operator.
 * All of that existed to coordinate processes that no longer exist. The bot
 * still handles one search at a time, so serialisation remains — as a ~15-line
 * in-process queue rather than a network round trip per lock.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const bigInt = require("big-integer");
const { TelegramClient: GramClient, sessions } = require("telegram");
const { Api } = require("telegram/tl");

const { StringSession } = sessions;

const DEFAULT_BOT = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";

// Telegram's `upload.GetFile` granularity. Both are protocol constants, not
// tuning knobs: a larger chunk is rejected outright, and an offset that is not
// a multiple of ALIGN is refused with OFFSET_INVALID.
const CHUNK = 512 * 1024;
const ALIGN = 4096;

/**
 * Serialises async work in arrival order.
 *
 * The bot answers one query at a time — sending it a second search while the
 * first is still resolving gets the two conversations interleaved in the same
 * chat history, and the poller cannot tell whose audio is whose. That
 * constraint is about the bot, not about auth keys, so it survives the move to
 * a single process. What it no longer needs is Redis: one process means one
 * queue, and `Promise` chaining is the whole implementation.
 */
class SerialQueue {
  constructor(label) {
    this.label = label;
    this.tail = Promise.resolve();
    this.depth = 0;
  }

  run(fn) {
    this.depth += 1;
    // `tail` is kept permanently non-rejecting so one failed job cannot wedge
    // the queue for every job behind it.
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => {},
      () => {},
    );
    result.then(
      () => {
        this.depth -= 1;
      },
      () => {
        this.depth -= 1;
      },
    );
    return result;
  }
}

function isAuthKeyDuplicated(err) {
  return (
    err?.code === 406 ||
    err?.errorMessage === "AUTH_KEY_DUPLICATED" ||
    String(err?.message || err).includes("AUTH_KEY_DUPLICATED")
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** First 16 hex of the sha256, so two session strings can be compared in logs
 *  without ever printing one. */
function fingerprint(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

const FORCE_JOIN_PATTERNS = [
  "join our channel",
  "join channel",
  "subscribe",
  "must join",
  "join to use",
  "join the channel",
  "join group",
  "subscrib",
];

function forceJoinMessage(msg) {
  if (!msg?.message) return null;
  const txt = msg.message.toLowerCase();
  return FORCE_JOIN_PATTERNS.some((p) => txt.includes(p))
    ? msg.message.split("\n")[0]
    : null;
}

function audioAttrOf(doc) {
  return doc.attributes.find((a) => a instanceof Api.DocumentAttributeAudio);
}

function trackFromMessage(msg, doc, audioAttr, buttonIndex = 0) {
  return {
    messageId: msg.id,
    title: audioAttr?.title || (audioAttr?.voice ? "Voice" : "Unknown"),
    artist: audioAttr?.performer || "Unknown",
    duration: audioAttr?.duration || 0,
    fileId: doc.id.toString(),
    buttonIndex,
  };
}

class TelegramWorkerClient {
  constructor({ apiId, apiHash, sessionString, sessionFile }) {
    if (!apiId || !apiHash) {
      throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH");
    }
    if (!sessionString) {
      throw new Error(
        "Missing TELEGRAM_SESSION_STRING. Run `npm run login` to generate one.",
      );
    }

    this.apiId = apiId;
    this.apiHash = apiHash;
    this.envSession = sessionString;
    this.sessionFile = sessionFile;
    this.envFingerprint = fingerprint(sessionString);

    /**
     * Set once, never cleared, when Telegram tells us the key is gone.
     *
     * The old code marked this in Redis with a 10-minute TTL so instances would
     * eventually start trying again. That was wrong: a revoked key does not come
     * back, so the TTL only guaranteed a fresh wave of doomed handshakes every
     * ten minutes. Here it is terminal — the worker reports itself unhealthy and
     * refuses work until an operator deploys a new session.
     */
    this.fatal = null;

    this.connected = false;
    this.connectPromise = null;
    this.startedAt = Date.now();

    /** Bot conversations, one at a time. */
    this.botQueue = new SerialQueue("bot");

    /**
     * messageId → document location + size.
     *
     * Resolving a message id costs a `getEntity` plus a `getMessages`, and the
     * browser sends one Range request per seek for the same song. The id,
     * accessHash and size are stable, so caching them turns a seek into a
     * single `upload.GetFile`. `fileReference` is the one field Telegram does
     * expire (hours), which `getAudioStream` handles by dropping the entry and
     * resolving again.
     *
     * Unlike the serverless version this cache actually survives between
     * requests, because the process does.
     */
    this.docCache = new Map();

    this.client = this._makeClient(this._initialSession());
  }

  _makeClient(session) {
    return new GramClient(new StringSession(session), this.apiId, this.apiHash, {
      connectionRetries: 10,
      // Safe here in a way it never was on Vercel: reconnecting from a single
      // long-lived process reuses the same IP, which is exactly the case
      // Telegram permits. On a serverless fleet the same flag meant background
      // reconnects racing each other from different IPs.
      autoReconnect: true,
      retryDelay: 2000,
      // gramJS defaults this to 1, which funnels every `upload.GetFile` through
      // one sender: two listeners streaming different songs take turns chunk by
      // chunk instead of downloading in parallel.
      maxConcurrentDownloads: 8,
      useWSS: false,
    });
  }

  /**
   * Prefer the on-disk session, but only when it descends from the session
   * currently in the environment.
   *
   * A DC migration mutates the session, and a restart that threw that away
   * would repeat the migration handshake every boot. Caching it on disk avoids
   * that. The fingerprint check is the important half: when an operator rotates
   * TELEGRAM_SESSION_STRING, the stale file must lose. Reviving a superseded
   * session is how the previous Redis-backed version resurrected a key the
   * operator had already replaced.
   */
  _initialSession() {
    if (!this.sessionFile) return this.envSession;

    try {
      const raw = fs.readFileSync(this.sessionFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.envFingerprint === this.envFingerprint && parsed.session) {
        console.log(
          `[tg] resuming cached session (env fp ${this.envFingerprint})`,
        );
        return parsed.session;
      }
      console.log(
        `[tg] cached session belongs to a different key (cached ${parsed?.envFingerprint ?? "?"} != env ${this.envFingerprint}) — ignoring it`,
      );
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`[tg] could not read session cache: ${err.message}`);
      }
    }
    return this.envSession;
  }

  _persistSession() {
    if (!this.sessionFile) return;
    let session;
    try {
      session = this.client.session.save();
    } catch {
      return;
    }
    if (!session) return;
    try {
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
      fs.writeFileSync(
        this.sessionFile,
        JSON.stringify({ envFingerprint: this.envFingerprint, session }),
        { mode: 0o600 },
      );
    } catch (err) {
      // Losing the cache costs one extra handshake on the next boot. Not worth
      // failing a request over, and on a read-only filesystem it is expected.
      console.warn(`[tg] could not persist session: ${err.message}`);
    }
  }

  /** Called at boot. Throws so the process can refuse to serve traffic. */
  async start() {
    await this._connect();
    const me = await this.client.getMe();
    console.log(
      `[tg] connected as ${me?.username ? "@" + me.username : me?.id} — this process now owns the session`,
    );
    this._persistSession();
    return me;
  }

  async _connect() {
    if (this.fatal) throw new Error(this.fatal);
    if (this.connected && this.client.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      try {
        await this.client.connect();
        this.connected = true;
        this._persistSession();
      } catch (err) {
        this.connected = false;
        if (isAuthKeyDuplicated(err)) this._goFatal(err);
        throw err;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  _goFatal(err) {
    if (this.fatal) return;
    this.fatal =
      "AUTH_KEY_DUPLICATED — the Telegram session has been revoked. " +
      "Generate a new one with `npm run login` and redeploy the worker. " +
      "If this happened on a single-instance worker, something else is using " +
      "the same TELEGRAM_SESSION_STRING (an old Vercel deployment, a local " +
      "dev server, or a second worker instance).";
    console.error(`[tg] FATAL: ${this.fatal}`);
    console.error(`[tg] underlying error: ${err?.errorMessage || err?.message || err}`);
    this.connected = false;
    this.client.disconnect().catch(() => {});
  }

  async _ensureConnected() {
    if (this.fatal) throw new Error(this.fatal);
    if (!this.connected || !this.client.connected) {
      this.connected = false;
      await this._connect();
    }
  }

  /**
   * Retry wrapper for transient faults only.
   *
   * The serverless version rebuilt the whole GramClient from a possibly-newer
   * Redis session on every retry, which is what turned a dropped socket into a
   * revoked key. Here a retry is just a reconnect of the same client with the
   * same key from the same IP — which is the one thing Telegram is fine with.
   */
  async _withRetry(fn, attempts = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this._ensureConnected();
        return await fn();
      } catch (err) {
        lastErr = err;

        if (isAuthKeyDuplicated(err)) {
          this._goFatal(err);
          throw err;
        }

        const msg = String(err?.message || err?.errorMessage || "");
        const retriable =
          /ECONNRESET|ETIMEDOUT|EPIPE|socket|network|Not connected|Disconnect|TIMEOUT|Bot did not respond/i.test(
            msg,
          );

        if (!retriable || attempt === attempts) throw err;

        console.warn(
          `[tg] retriable error (${msg.slice(0, 120)}), attempt ${attempt}/${attempts}`,
        );
        this.connected = false;
        await sleep(1000 * attempt);
      }
    }
    throw lastErr;
  }

  async stop() {
    this._persistSession();
    try {
      await this.client.disconnect();
      console.log("[tg] disconnected cleanly — session released");
    } catch (err) {
      console.warn(`[tg] disconnect failed: ${err.message}`);
    }
    this.connected = false;
  }

  health() {
    return {
      ok: !this.fatal && this.connected,
      connected: this.connected,
      fatal: this.fatal,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      sessionFingerprint: this.envFingerprint,
      queueDepth: this.botQueue.depth,
      cachedDocs: this.docCache.size,
    };
  }

  // ── Bot conversations ─────────────────────────────────────────────────────

  async searchMusic(query, timeoutMs = 20000, botUsername) {
    return this.botQueue.run(() =>
      this._withRetry(() => this._searchMusic(query, timeoutMs, botUsername)),
    );
  }

  async _searchMusic(query, timeoutMs, botUsername = DEFAULT_BOT) {
    const botEntity = await this.client.getEntity(botUsername);

    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    console.log(`[tg] search "${query}" (after msg ${lastKnownId})`);
    await this.client.sendMessage(botEntity, { message: query });

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(3000);

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 20,
        minId: lastKnownId,
      });

      for (const msg of newMessages) {
        if (!msg || msg.id <= lastKnownId || msg.out) continue;

        const join = forceJoinMessage(msg);
        if (join) throw new Error(`Bot requires channel subscription: ${join}`);

        if (msg.message && !msg.replyMarkup && !msg.media) {
          const txt = msg.message.trim();
          if (/daily.*(limit|search limit)/i.test(txt) || /limit reached/i.test(txt)) {
            throw new Error(`Bot rate-limited: ${txt.split("\n")[0]}`);
          }
          if (/download|process|fetch|wait|please/i.test(txt)) continue;
          if (/not found|no result|nothing found|sorry|no tracks|unsupported|error/i.test(txt)) {
            throw new Error(`Bot responded: ${txt}`);
          }
        }

        if (msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
          const buttons = [];
          let idx = 0;
          for (const row of msg.replyMarkup.rows) {
            for (const btn of row.buttons) {
              if (btn instanceof Api.KeyboardButtonCallback) {
                buttons.push({ index: idx, text: btn.text || `Option ${idx + 1}` });
                idx++;
              }
            }
          }
          if (buttons.length > 0) {
            return { buttonMessageId: msg.id, buttons };
          }
        }

        if (msg.media && "document" in msg.media) {
          const doc = msg.media.document;
          if (doc instanceof Api.Document) {
            const mime = doc.mimeType || "";
            const size = Number(doc.size) || 0;
            const attr = audioAttrOf(doc);
            const isNonMedia =
              !mime.startsWith("image/") && !mime.startsWith("video/");

            if (attr || (isNonMedia && size > 500 * 1024)) {
              const title = attr?.title || (attr?.voice ? "Voice" : "Audio");
              return { buttonMessageId: msg.id, buttons: [{ index: 0, text: title }] };
            }
          }
        }
      }
    }

    // Timed out waiting for a reply. The bot sometimes answers a query it never
    // acknowledged, so sweep recent history for anything audio-shaped before
    // giving up.
    console.warn(`[tg] search timed out after ${timeoutMs}ms — fallback scan`);
    const fallback = await this.client.getMessages(botEntity, { limit: 20 });
    for (const msg of fallback) {
      if (msg.out) continue;
      if (msg.media && "document" in msg.media) {
        const doc = msg.media.document;
        if (doc instanceof Api.Document) {
          const mime = doc.mimeType || "";
          const size = Number(doc.size) || 0;
          if (
            audioAttrOf(doc) ||
            (size > 500 * 1024 &&
              !mime.startsWith("image/") &&
              !mime.startsWith("video/"))
          ) {
            return { buttonMessageId: msg.id, buttons: [{ index: 0, text: "Audio" }] };
          }
        }
      }
    }

    throw new Error(`Bot did not respond with buttons or audio within ${timeoutMs}ms`);
  }

  async searchAndSelect(opts) {
    return this.botQueue.run(() => this._withRetry(() => this._searchAndSelect(opts)));
  }

  async _searchAndSelect({
    query,
    targetDuration,
    searchTimeoutMs = 10000,
    selectTimeoutMs = 60000,
    expectedTitle,
    expectedArtist,
    botUsername = DEFAULT_BOT,
  }) {
    const botEntity = await this.client.getEntity(botUsername);

    /*
     * Fast path: the bot may already have this exact song in recent history, in
     * which case the whole search-and-select round trip can be skipped.
     *
     * The matching has to be strict, because the history is *shared* — one bot
     * serves every user, so the last 15 messages are whatever anyone happened
     * to download. A loose match does not merely miss the fast path, it serves
     * somebody else's song. Both title and artist must agree; when the artist is
     * known but the Telegram attribute carries no performer, the match is
     * refused, because an unverifiable hit is worth less than the search it
     * would save.
     */
    if (expectedTitle) {
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      // Containment is allowed because the bot's copy often carries an extra tag
      // ("(2012 Remaster)"), but the shorter side must be most of the longer one
      // — that is what stops a three-letter title matching everything.
      const closeEnough = (a, b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        if (!a.includes(b) && !b.includes(a)) return false;
        return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6;
      };

      const wantTitle = norm(expectedTitle);
      const wantArtist = expectedArtist ? norm(expectedArtist) : "";

      const recent = await this.client.getMessages(botEntity, { limit: 15 });
      for (const msg of recent) {
        if (!msg.media || !("document" in msg.media)) continue;
        const doc = msg.media.document;
        if (!(doc instanceof Api.Document)) continue;
        const attr = audioAttrOf(doc);
        if (!attr?.title) continue;

        const gotTitle = norm(attr.title);
        const gotArtist = attr.performer ? norm(attr.performer) : "";

        // Four characters is the floor for a meaningful title comparison.
        const titleOk =
          wantTitle.length >= 4 &&
          gotTitle.length >= 4 &&
          closeEnough(gotTitle, wantTitle);
        const artistOk = wantArtist
          ? gotArtist !== "" && closeEnough(gotArtist, wantArtist)
          : true;

        if (titleOk && artistOk) {
          console.log(
            `[tg] fast path: reusing "${attr.performer ?? "?"} - ${attr.title}" for "${query}"`,
          );
          return trackFromMessage(msg, doc, attr, 0);
        }
      }
    }

    const cleanQuery = (str) =>
      str
        .replace(/\b(king|dr\.|dr|sir|chief|dj|mc|prof\.|prof)\b/gi, "")
        .replace(/[\(\[\{].*?[\)\]\}]/g, "")
        .replace(/[-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    let buttonResult;
    try {
      buttonResult = await this._searchMusic(query, searchTimeoutMs, botUsername);
    } catch (err) {
      const cleaned = cleanQuery(query);
      if (cleaned && cleaned.toLowerCase() !== query.toLowerCase()) {
        console.warn(`[tg] retrying with cleaned query "${cleaned}"`);
        buttonResult = await this._searchMusic(cleaned, searchTimeoutMs, botUsername);
      } else {
        throw err;
      }
    }

    const { buttonMessageId, buttons } = buttonResult;
    if (buttons.length === 0) throw new Error("No results found on Telegram");

    let selectedIndex = 0;
    let bestScore = -999999;

    for (let i = 0; i < buttons.length; i++) {
      const text = buttons[i].text.toLowerCase();
      let score = 0;

      const isPreview =
        text.includes("preview") ||
        text.includes("30s") ||
        text.includes("30 sec") ||
        text.includes("clip");
      if (isPreview) score -= 1000;

      const match = buttons[i].text.match(/(?:\[|\()(\d{1,2}):(\d{2})(?:\]|\))/);
      if (match) {
        const duration = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        if (targetDuration && targetDuration > 0) {
          const diff = Math.abs(duration - targetDuration);
          if (diff <= 5) score += 200;
          else if (diff <= 15) score += 100;
          else if (diff > 45 && targetDuration > 45 && duration < 45) score -= 500;
          else score -= diff;
        } else if (duration < 45) {
          score -= 300;
        }
      }

      if (text.includes("320") || text.includes("flac") || text.includes("kbps")) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        selectedIndex = i;
      }
    }

    console.log(
      `[tg] ${buttons.length} results, picking #${selectedIndex} "${buttons[selectedIndex]?.text}" (score ${bestScore})`,
    );
    return this._selectResult(buttonMessageId, selectedIndex, botUsername, selectTimeoutMs);
  }

  async selectResult(buttonMessageId, buttonIndex, timeoutMs = 60000, botUsername) {
    return this.botQueue.run(() =>
      this._withRetry(() =>
        this._selectResult(
          buttonMessageId,
          buttonIndex,
          botUsername || DEFAULT_BOT,
          timeoutMs,
        ),
      ),
    );
  }

  async _selectResult(buttonMessageId, buttonIndex, botUsername, timeoutMs) {
    const botEntity = await this.client.getEntity(botUsername);
    const messages = await this.client.getMessages(botEntity, { ids: [buttonMessageId] });
    const buttonMsg = messages[0];

    if (!(buttonMsg?.replyMarkup instanceof Api.ReplyInlineMarkup)) {
      // No buttons — the message may already *be* the audio.
      if (buttonMsg?.media && "document" in buttonMsg.media) {
        const doc = buttonMsg.media.document;
        if (doc instanceof Api.Document) {
          return trackFromMessage(buttonMsg, doc, audioAttrOf(doc), buttonIndex);
        }
      }
      throw new Error("Message does not have inline buttons");
    }

    let callbackData;
    let btnIdx = 0;
    for (const row of buttonMsg.replyMarkup.rows) {
      for (const btn of row.buttons) {
        if (btn instanceof Api.KeyboardButtonCallback) {
          if (btnIdx === buttonIndex) {
            callbackData = btn.data;
            break;
          }
          btnIdx++;
        }
      }
      if (callbackData) break;
    }
    if (!callbackData) throw new Error(`Button at index ${buttonIndex} not found`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.client.invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: botEntity,
            msgId: buttonMsg.id,
            data: Buffer.from(callbackData),
          }),
        );
        break;
      } catch (err) {
        if (attempt === 0 && err?.errorMessage === "BOT_RESPONSE_TIMEOUT") {
          console.warn("[tg] BOT_RESPONSE_TIMEOUT on button click, retrying");
          await sleep(2000);
        } else {
          throw err;
        }
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(3000);

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 10,
        minId: buttonMessageId,
      });

      for (const msg of newMessages) {
        const join = forceJoinMessage(msg);
        if (join) throw new Error(`Bot requires channel subscription: ${join}`);

        if (!msg?.media || !("document" in msg.media)) continue;
        if (msg.id <= buttonMessageId) continue;

        const doc = msg.media.document;
        if (!(doc instanceof Api.Document)) continue;

        const attr = audioAttrOf(doc);
        if (!attr) continue;

        return trackFromMessage(msg, doc, attr, buttonIndex);
      }
    }

    throw new Error(`Audio not received within ${timeoutMs}ms after clicking button`);
  }

  /**
   * Send a playlist link and collect every audio file the bot sends back.
   *
   * `onTrack` fires as each one lands so the caller can stream progress — the
   * HTTP layer turns those calls into NDJSON lines. There is no total to count
   * down from, so the loop ends on idleness: 20s with no new audio means done.
   */
  async importPlaylist(url, onTrack, botUsername = DEFAULT_BOT) {
    return this.botQueue.run(() =>
      this._withRetry(async () => {
        const botEntity = await this.client.getEntity(botUsername);

        const before = await this.client.getMessages(botEntity, { limit: 1 });
        const lastKnownId = before[0]?.id || 0;

        await this.client.sendMessage(botEntity, { message: url });

        const results = [];
        let lastNewAudioTime = Date.now();
        const idleTimeout = 20000;

        while (Date.now() - lastNewAudioTime < idleTimeout) {
          await sleep(3000);

          const newMessages = await this.client.getMessages(botEntity, {
            limit: 20,
            minId:
              results.length > 0
                ? results[results.length - 1].messageId
                : lastKnownId,
          });

          for (const msg of newMessages) {
            const join = forceJoinMessage(msg);
            if (join) throw new Error(`Bot requires channel subscription: ${join}`);

            if (!msg?.media || !("document" in msg.media)) continue;
            const doc = msg.media.document;
            if (!(doc instanceof Api.Document)) continue;
            const attr = audioAttrOf(doc);
            if (!attr) continue;

            const msgId = msg.id || 0;
            if (results.some((r) => r.messageId === msgId)) continue;

            const track = trackFromMessage(msg, doc, attr, 0);
            results.push(track);
            lastNewAudioTime = Date.now();
            if (onTrack) {
              try {
                onTrack(track);
              } catch {
                /* a broken client stream must not abort the import */
              }
            }
          }
        }

        return results;
      }),
    );
  }

  // ── File access ───────────────────────────────────────────────────────────

  /** Resolve a message id to its document location, hitting Telegram only on a miss. */
  async _resolveDocument(messageId, forceRefresh = false, botUsername = DEFAULT_BOT) {
    if (!forceRefresh) {
      const hit = this.docCache.get(messageId);
      if (hit) return hit;
    }

    const botEntity = await this.client.getEntity(botUsername);
    const messages = await this.client.getMessages(botEntity, { ids: [messageId] });
    const msg = messages[0];
    if (!msg || !msg.media) {
      throw new Error(`Message ${messageId} not found or has no media`);
    }

    const doc = msg.media.document;
    if (!doc) throw new Error(`Message ${messageId} has no document`);

    const attr = audioAttrOf(doc);
    const entry = {
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
      size: Number(doc.size) || 0,
      dcId: doc.dcId,
      mimeType: doc.mimeType || "audio/mpeg",
      title: attr?.title || null,
      artist: attr?.performer || null,
      duration: attr?.duration || 0,
    };
    this.docCache.set(messageId, entry);
    return entry;
  }

  /** Size and metadata without transferring any bytes — for HEAD requests. */
  async getAudioInfo(messageId) {
    return this._withRetry(async () => {
      const doc = await this._resolveDocument(messageId);
      return {
        size: doc.size,
        mimeType: doc.mimeType,
        title: doc.title,
        artist: doc.artist,
        duration: doc.duration,
      };
    });
  }

  /**
   * Stream audio out of the bot chat, forwarding bytes as they arrive.
   *
   * Two properties of `iterDownload` are easy to get wrong and both were paid
   * for in production:
   *
   * 1. `limit` counts *chunks*, not bytes. gramJS derives it as
   *    `ceil(fileSize / chunkSize)` when omitted and decrements once per chunk
   *    yielded, so passing a byte count made a 64KB Range request ask for 64K
   *    chunks of 512KB — it read to end-of-file while the response advertised
   *    64KB. Every seek downloaded the rest of the track and left the connection
   *    wrong-sized.
   *
   * 2. Telegram requires a 4KB-aligned offset. The request is therefore widened
   *    down to the previous boundary and the extra head bytes are dropped here
   *    rather than shipped to the client, so what goes out matches the
   *    Content-Length the caller advertises exactly.
   */
  async getAudioStream(messageId, offsetBytes, limitBytes) {
    return this._withRetry(async () => {
      let doc = await this._resolveDocument(messageId);
      const size = doc.size;

      const start = Math.max(0, offsetBytes ?? 0);
      const wanted =
        limitBytes !== undefined && limitBytes !== null
          ? Math.max(0, Math.min(limitBytes, Math.max(0, size - start)))
          : Math.max(0, size - start);

      const alignedStart = Math.floor(start / ALIGN) * ALIGN;
      const skip = start - alignedStart;
      const chunkCount = Math.max(1, Math.ceil((skip + wanted) / CHUNK));

      const openIter = (location, dcId) =>
        this.client.iterDownload({
          file: location,
          dcId,
          fileSize: bigInt(size),
          offset: bigInt(alignedStart),
          limit: chunkCount,
          requestSize: CHUNK,
          chunkSize: CHUNK,
        });

      let iter = openIter(doc.location, doc.dcId);
      const self = this;

      async function* trimmed() {
        let toSkip = skip;
        let sent = 0;
        let started = false;
        while (true) {
          try {
            for await (const raw of iter) {
              started = true;
              let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
              if (toSkip > 0) {
                if (buf.length <= toSkip) {
                  toSkip -= buf.length;
                  continue;
                }
                buf = buf.subarray(toSkip);
                toSkip = 0;
              }
              const remaining = wanted - sent;
              if (remaining <= 0) return;
              if (buf.length > remaining) buf = buf.subarray(0, remaining);
              sent += buf.length;
              yield buf;
              if (sent >= wanted) return;
            }
            return;
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            // A cached fileReference went stale. Safe to retry only if nothing
            // has been emitted yet — otherwise the client already holds a prefix
            // and restarting would corrupt it.
            if (!started && /FILE_REFERENCE|FILEREF/i.test(m)) {
              console.warn(`[tg] stale file reference for ${messageId}, re-resolving`);
              self.docCache.delete(messageId);
              doc = await self._resolveDocument(messageId, true);
              iter = openIter(doc.location, doc.dcId);
              continue;
            }
            throw err;
          }
        }
      }

      return {
        stream: Readable.from(trimmed(), { objectMode: false }),
        size,
        mimeType: doc.mimeType,
      };
    });
  }

  /** Whole file as one Buffer. Only for callers that genuinely need it (Cloudinary offload). */
  async downloadAudio(messageId) {
    const { stream } = await this.getAudioStream(messageId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
}

module.exports = { TelegramWorkerClient, isAuthKeyDuplicated, fingerprint, DEFAULT_BOT };
