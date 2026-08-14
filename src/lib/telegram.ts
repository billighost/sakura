import { TelegramClient as GramClient, sessions } from "telegram";
const { StringSession } = sessions;
import { Api } from "telegram/tl";
import { Readable } from "node:stream";

// Prevent GramJS background _recvLoop RPC errors (406 AUTH_KEY_DUPLICATED) from bringing down Node process
if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("unhandledRejection", (reason: any) => {
    if (
      reason?.code === 406 ||
      reason?.errorMessage === "AUTH_KEY_DUPLICATED" ||
      String(reason).includes("AUTH_KEY_DUPLICATED")
    ) {
      console.warn("[Telegram] Intercepted GramJS background AUTH_KEY_DUPLICATED error");
    }
  });
}

export interface MusicResult {
  messageId: number;
  title: string;
  artist: string;
  duration: number;
  fileId: string;
  buttonIndex: number;
}

import { Redis } from "@upstash/redis";

/**
 * Global distributed mutex for serializing bot interactions across all
 * serverless instances. The Telegram bot processes one search at a time;
 * sending multiple queries concurrently (e.g. from 10 Vercel edge functions)
 * triggers 406 AUTH_KEY_DUPLICATED and revokes the session.
 */
class RedisMutex {
  private redis: Redis | null = null;
  private localQueue: (() => void)[] = [];
  private localLocked = false;

  constructor() {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } else {
      console.warn("[RedisMutex] Missing Upstash Redis credentials. Falling back to local locking.");
    }
  }

  async acquire(): Promise<() => Promise<void>> {
    if (!this.redis) {
      return new Promise<() => Promise<void>>((resolve) => {
        const tryLock = () => {
          if (!this.localLocked) {
            this.localLocked = true;
            resolve(async () => {
              this.localLocked = false;
              if (this.localQueue.length > 0) {
                const next = this.localQueue.shift()!;
                next();
              }
            });
          } else {
            this.localQueue.push(tryLock);
          }
        };
        tryLock();
      });
    }

    const lockKey = "telegram:bot:mutex";
    const token = Math.random().toString(36).slice(2);
    const lockTimeoutMs = 60000; 

    while (true) {
      const acquired = await this.redis.set(lockKey, token, { nx: true, px: lockTimeoutMs });
      
      if (acquired) {
        return async () => {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          try {
            await this.redis!.eval(script, [lockKey], [token]);
          } catch (err) {
            console.error("[RedisMutex] Failed to release lock", err);
          }
        };
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * Distributed lock specifically for the MTProto connect() call.
   *
   * Vercel spins up many serverless instances concurrently. Each gets its own
   * GramClient (globalThis is per-process) and all race to call connect() with
   * the same session string. Telegram sees the same auth key arriving from
   * multiple IPs simultaneously and responds with AUTH_KEY_DUPLICATED.
   *
   * This lock serialises connect() across all instances: one wins, connects,
   * then releases. The others wait, see the connect lock is free, and by that
   * time the winning instance has already torn down its connection (serverless
   * idle disconnect) or the subsequent request reuses the warm connection.
   */
  async acquireConnectLock(): Promise<() => Promise<void>> {
    if (!this.redis) {
      // No Redis — local dev, no concurrent instances, no problem.
      return async () => {};
    }

    const lockKey = "telegram:connect:lock";
    const token = Math.random().toString(36).slice(2);
    // 30 s is long enough for a cold connect but short enough that a crashed
    // instance doesn't block everything indefinitely.
    const lockTimeoutMs = 30_000;
    const maxWaitMs = 25_000;
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      const acquired = await this.redis.set(lockKey, token, { nx: true, px: lockTimeoutMs });
      if (acquired) {
        return async () => {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          try {
            await this.redis!.eval(script, [lockKey], [token]);
          } catch { /* best-effort */ }
        };
      }
      await new Promise(r => setTimeout(r, 800));
    }

    // Couldn't get the lock in time — another instance is connecting.
    // Return a no-op release so the caller doesn't hang.
    console.warn("[RedisMutex] Connect lock timed out — proceeding without lock");
    return async () => {};
  }

  /**
   * Mark the current Telegram session as poisoned in Redis (AUTH_KEY_DUPLICATED).
   * All instances will fast-fail Telegram calls until the key is manually cleared
   * (i.e. after the operator regenerates the session string).
   */
  async markSessionPoisoned(): Promise<void> {
    if (!this.redis) return;
    try {
      // 10-minute TTL — short enough that a new session survives the deployment.
      await this.redis.set("telegram:session:poisoned", "1", { px: 10 * 60 * 1000 });
    } catch { /* best-effort */ }
  }

  async isSessionPoisoned(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const v = await this.redis.get("telegram:session:poisoned");
      return !!v;
    } catch { return false; }
  }

  /**
   * Save the latest GramJS session string to Redis.
   */
  async saveSession(sessionString: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set("telegram:session:latest", sessionString);
    } catch (err) {
      console.error("[RedisMutex] Failed to save session string", err);
    }
  }

  /**
   * Load the latest GramJS session string from Redis.
   */
  async loadSession(): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const val = await this.redis.get<string>("telegram:session:latest");
      return val ?? null;
    } catch (err) {
      console.error("[RedisMutex] Failed to load session string", err);
      return null;
    }
  }
}

export class TelegramClient {
  private client: GramClient;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly sessionString: string;
  private activeCount = 0;
  private static botMutex = new RedisMutex();

  /**
   * How long the MTProto connection is kept after the last reader lets go.
   *
   * Long enough that seeking around a track, or an audio element's follow-up
   * Range request, reuses one connection; short enough that an idle instance
   * isn't holding a socket open indefinitely.
   */
  private static readonly IDLE_DISCONNECT_MS = 60_000;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * messageId → the file location and size needed to start a download.
   *
   * Resolving a message id to its document costs a `getEntity` plus a
   * `getMessages` round trip, and every Range request the browser sends for the
   * same song repeated both. The document's id/accessHash/fileReference don't
   * change between those requests, so caching them turns a seek into a single
   * `upload.GetFile` call.
   *
   * `fileReference` is the one part Telegram does expire (hours, not minutes).
   * A stale one surfaces as FILE_REFERENCE_EXPIRED, which `getAudioStream`
   * treats as "drop the entry and resolve again" rather than as a failure.
   */
  private docCache = new Map<number, { location: Api.InputDocumentFileLocation; size: number; dcId?: number }>();

  constructor(
    apiId: number,
    apiHash: string,
    sessionString: string
  ) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.sessionString = sessionString;
    this.client = new GramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        autoReconnect: true,
        // gramJS defaults this to 1, which serialises every `upload.GetFile`
        // through a single sender: two listeners streaming different songs
        // take turns chunk by chunk instead of downloading in parallel.
        maxConcurrentDownloads: 8,
      },
    );
  }

  async init(): Promise<void> {
    if (this.connected && this.client?.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      // Fast-fail if a previous instance already poisoned this session.
      if (await TelegramClient.botMutex.isSessionPoisoned()) {
        this.connectPromise = null;
        throw new Error(
          "[Telegram] Session is poisoned (AUTH_KEY_DUPLICATED). " +
          "Regenerate TELEGRAM_SESSION_STRING and redeploy."
        );
      }

      // Serialise connect() across all concurrent Vercel instances.
      // Without this every cold-start simultaneously opens a TCP+MTProto
      // handshake with the same auth key → Telegram revokes it.
      const releaseConnectLock = await TelegramClient.botMutex.acquireConnectLock();
      try {
        // Re-check: a sibling instance may have connected (and disconnected)
        // while we waited for the lock.
        if (this.connected && this.client?.connected) {
          this.connectPromise = null;
          return;
        }

        // Pull the absolute latest session string from Redis. If a previous
        // serverless invocation connected and mutated the session (e.g. DC migration),
        // we MUST use their updated string or Telegram will see a sequence mismatch.
        const latestSession = await TelegramClient.botMutex.loadSession();
        const sessionToUse = latestSession || this.sessionString;
        
        if (latestSession && latestSession !== this.client.session.save()) {
          console.log("[Telegram] Reloading client with newer session string from Redis");
          this.client = new GramClient(
            new StringSession(sessionToUse),
            this.apiId,
            this.apiHash,
            {
              connectionRetries: 5,
              autoReconnect: true,
              maxConcurrentDownloads: 8,
            }
          );
        }

        if (!this.client?.connected) {
          await this.client.connect();
          
          // Save the fresh session string back to Redis so the next serverless
          // container uses this exact state.
          const newSessionString = (this.client.session as unknown as { save: () => string }).save();
          if (newSessionString) {
            await TelegramClient.botMutex.saveSession(newSessionString);
          }
        }
        this.connected = true;
        this.connectPromise = null;
        console.log("[Telegram] Connected");
      } catch (error: any) {
        this.connected = false;
        this.connectPromise = null;

        const isAuthKeyDuplicated =
          error?.errorMessage === "AUTH_KEY_DUPLICATED" ||
          error?.code === 406 ||
          String(error).includes("AUTH_KEY_DUPLICATED");

        if (isAuthKeyDuplicated) {
          // Retrying with the same session string cannot work — the key is
          // already revoked by Telegram. Mark it poisoned in Redis so every
          // other instance fast-fails instead of hammering Telegram further.
          console.error(
            "[Telegram] AUTH_KEY_DUPLICATED during connect(). " +
            "Session poisoned. Regenerate TELEGRAM_SESSION_STRING and redeploy."
          );
          await TelegramClient.botMutex.markSessionPoisoned();
          try { await this.client.disconnect(); } catch { /* ignore */ }
        } else {
          console.error("[Telegram] Connection failed:", error);
        }
        throw error;
      } finally {
        await releaseConnectLock();
      }
    })();

    return this.connectPromise;
  }

  async acquire(): Promise<void> {
    this.activeCount++;
    // A request arriving during the idle window keeps the existing connection.
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    await this.ensureConnected();
  }

  /**
   * Release a user of the connection — but don't tear it down immediately.
   *
   * This used to `disconnect()` the moment the last caller finished, which made
   * every request pay a full MTProto handshake (TCP + auth + layer negotiation)
   * before it could ask for a single byte. Measured against the live bot that
   * was ~3s of pure setup on a request whose useful work is a 512KB read, and
   * it actively broke back-to-back requests: an audio element sending a second
   * Range request while the first response was still being torn down hit a
   * client that had just been disconnected underneath it, and got a connection
   * error rather than audio.
   *
   * Holding the connection for a short idle window instead makes the handshake
   * a per-listening-session cost rather than a per-request one, which is what
   * seeking through a track actually needs. The window is short enough that an
   * idle serverless instance still lets the socket go.
   */
  async release(): Promise<void> {
    this.activeCount--;
    if (this.activeCount <= 0) {
      this.activeCount = 0;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.activeCount <= 0) {
          this.disconnect().catch((err) =>
            console.warn("[Telegram] Idle disconnect failed:", err),
          );
        }
      }, TelegramClient.IDLE_DISCONNECT_MS);
      // Node shouldn't be held alive purely by this timer.
      this.idleTimer.unref?.();
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectPromise = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.docCache.clear();
    if (this.client) {
      try {
        await this.client.disconnect();
        console.log("[Telegram] Disconnected cleanly");
      } catch (err) {
        console.warn("[Telegram] Error during disconnect:", err);
      }
    }
  }

  async searchMusic(query: string, timeoutMs = 20000): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }> {
    return this.withRetry(async () => {
      const release = await TelegramClient.botMutex.acquire();
      try {
        return await this._searchMusic(query, timeoutMs);
      } finally {
        await release();
      }
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Fast-fail before even trying if the session is known-poisoned.
        if (await TelegramClient.botMutex.isSessionPoisoned()) {
          throw new Error(
            "[Telegram] Session is poisoned (AUTH_KEY_DUPLICATED). " +
            "Regenerate TELEGRAM_SESSION_STRING and redeploy."
          );
        }
        await this.ensureConnected();
        return await fn();
      } catch (err: any) {
        lastErr = err;

        const isAuthKeyDuplicated =
          err?.code === 406 ||
          err?.errorMessage === "AUTH_KEY_DUPLICATED" ||
          String(err).includes("AUTH_KEY_DUPLICATED");

        // AUTH_KEY_DUPLICATED means the session is revoked by Telegram.
        // Retrying with the same session string — even with a new GramClient —
        // cannot recover: the auth key is already gone. Stop immediately,
        // mark the session as poisoned, and let the operator regenerate.
        if (isAuthKeyDuplicated) {
          console.error(
            "[Telegram] AUTH_KEY_DUPLICATED in withRetry — session poisoned. " +
            "Not retrying. Regenerate TELEGRAM_SESSION_STRING and redeploy."
          );
          await TelegramClient.botMutex.markSessionPoisoned();
          this.connected = false;
          this.connectPromise = null;
          try { await this.client.disconnect(); } catch { /* ignore */ }
          throw err;
        }

        const isRetriableError =
          err?.message?.includes("ECONNRESET") ||
          err?.message?.includes("ETIMEDOUT") ||
          err?.message?.includes("socket") ||
          err?.message?.includes("network") ||
          err?.message?.includes("Bot did not respond") ||
          err?.message?.includes("TIMEOUT");

        if (isRetriableError) {
          this.connected = false;
          this.connectPromise = null;
          try { await this.client.disconnect(); } catch { /* ignore */ }
          
          this.client = new GramClient(
            new StringSession(this.sessionString),
            this.apiId,
            this.apiHash,
            {
              connectionRetries: 5,
              autoReconnect: true,
            }
          );

          if (attempt < 3) {
            const jitterMs = 1500 + Math.floor(Math.random() * 2000);
            console.warn(`[Telegram] Retriable error (${err.message || err.errorMessage}), attempt ${attempt}/3. Retrying in ${jitterMs}ms...`);
            await new Promise((r) => setTimeout(r, jitterMs));
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr || new Error("Unreachable");
  }

  async searchAndSelect(
    query: string,
    targetDuration?: number,
    searchTimeoutMs = 10000,
    selectTimeoutMs = 60000,
    expectedTitle?: string,
    expectedArtist?: string,
    targetBotUsername?: string
  ): Promise<MusicResult> {
    return this.withRetry(async () => {
      const release = await TelegramClient.botMutex.acquire();
      try {
        const botUsername = targetBotUsername || process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
        let buttonResult: { buttonMessageId: number; buttons: Array<{ index: number; text: string }> };

        const botEntity = await this.client.getEntity(botUsername);

        /*
         * Fast path: the bot may already have this exact song sitting in its
         * recent history, in which case we can skip the whole search-and-select
         * round trip and reuse that message.
         *
         * The matching here has to be strict, because this history is *shared* —
         * one bot serves every user, so the last 15 messages are whatever anyone
         * happened to download. A loose match doesn't just miss the fast path,
         * it silently serves somebody else's song.
         *
         * It previously OR'd three conditions, and each was wrong on its own:
         *   - `wanted.includes(got)` matched a history entry titled "Die"
         *     against a request for "Born to Die";
         *   - the artist branch stood alone, so *any* Kelly Clarkson track
         *     satisfied a request for any other Kelly Clarkson track;
         *   - nothing ever required the artist to agree, which is how a request
         *     for Kelly Clarkson's "Born to Die" was answered with Lana Del
         *     Rey's.
         *
         * Now both title and artist must agree. When we know the artist but the
         * Telegram attribute doesn't carry a performer, the match is refused —
         * an unverifiable hit is worth less than the search it would skip.
         */
        if (expectedTitle) {
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

          /**
           * Containment is allowed because the bot's copy often carries an extra
           * tag ("(2012 Remaster)"), but the shorter side must be most of the
           * longer one — that's what stops a three-letter title matching.
           */
          const closeEnough = (a: string, b: string) => {
            if (!a || !b) return false;
            if (a === b) return true;
            if (!a.includes(b) && !b.includes(a)) return false;
            return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6;
          };

          const wantTitle = norm(expectedTitle);
          const wantArtist = expectedArtist ? norm(expectedArtist) : "";

          const recent = await this.client.getMessages(botEntity, { limit: 15 });
          for (const msg of recent) {
            if (msg.media && "document" in msg.media) {
              const doc = (msg.media as Api.MessageMediaDocument).document;
              if (doc instanceof Api.Document) {
                const audioAttr = doc.attributes.find((a) => a instanceof Api.DocumentAttributeAudio) as Api.DocumentAttributeAudio | undefined;
                if (audioAttr && audioAttr.title) {
                  const gotTitle = norm(audioAttr.title);
                  const gotArtist = audioAttr.performer ? norm(audioAttr.performer) : "";

                  // Four characters is the floor for a meaningful title compare.
                  const titleOk =
                    wantTitle.length >= 4 &&
                    gotTitle.length >= 4 &&
                    closeEnough(gotTitle, wantTitle);

                  const artistOk = wantArtist
                    ? gotArtist !== "" && closeEnough(gotArtist, wantArtist)
                    : true;

                  if (titleOk && artistOk) {
                    console.log(
                      `[Telegram AutoDownload] FAST PATH: reusing "${audioAttr.performer ?? "?"} - ${audioAttr.title}" from recent history for "${query}"`,
                    );
                    return {
                      messageId: msg.id,
                      title: audioAttr.title,
                      artist: audioAttr.performer || "Unknown",
                      duration: audioAttr.duration || 0,
                      fileId: doc.id.toString(),
                      buttonIndex: 0
                    };
                  }
                }
              }
            }
          }
        }

        const cleanQueryString = (str: string) => {
          return str
            .replace(/\b(king|dr\.|dr|sir|chief|dj|mc|prof\.|prof)\b/gi, "")
            .replace(/[\(\[\{].*?[\)\]\}]/g, "")
            .replace(/[-_]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        };

        try {
          buttonResult = await this._searchMusic(query, searchTimeoutMs, botUsername);
        } catch (err: any) {
          const cleaned = cleanQueryString(query);
          if (cleaned && cleaned.toLowerCase() !== query.toLowerCase()) {
            console.warn(`[Telegram AutoDownload] Initial search timed out or failed. Retrying with cleaned query: "${cleaned}"`);
            buttonResult = await this._searchMusic(cleaned, searchTimeoutMs, botUsername);
          } else {
            throw err;
          }
        }
        const { buttonMessageId, buttons } = buttonResult;
      if (buttons.length === 0) {
        throw new Error("No results found on Telegram");
      }

      let selectedIndex = 0;
      let bestScore = -999999;

      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const text = btn.text.toLowerCase();
        let score = 0;

        const isPreview = text.includes("preview") || text.includes("30s") || text.includes("30 sec") || text.includes("clip");
        if (isPreview) {
          score -= 1000;
        }

        const durationRegex = /(?:\[|\()(\d{1,2}):(\d{2})(?:\]|\))/;
        const match = btn.text.match(durationRegex);
        if (match) {
          const min = parseInt(match[1], 10);
          const sec = parseInt(match[2], 10);
          const duration = min * 60 + sec;

          if (targetDuration && targetDuration > 0) {
            const diff = Math.abs(duration - targetDuration);
            if (diff <= 5) {
              score += 200;
            } else if (diff <= 15) {
              score += 100;
            } else if (diff > 45 && targetDuration > 45 && duration < 45) {
              score -= 500;
            } else {
              score -= diff;
            }
          } else {
            if (duration < 45) {
              score -= 300;
            }
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

      console.log(`[Telegram AutoDownload] Got ${buttons.length} results. Selecting index ${selectedIndex}: "${buttons[selectedIndex]?.text}" (score: ${bestScore}) for query "${query}"`);
      const result = await this._selectResult(buttonMessageId, selectedIndex, botUsername, selectTimeoutMs);
      return result;
    } finally {
      await release();
    }
    });
  }

  private async _searchMusic(query: string, timeoutMs: number, targetBotUsername?: string): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }> {
    const botUsername = targetBotUsername || process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
    await this.ensureConnected();
    const botEntity = await this.client.getEntity(botUsername);

    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    console.log(`[Telegram _searchMusic] Sending query: "${query}", lastKnownId=${lastKnownId}`);

    await this.ensureConnected();
    await this.client.sendMessage(botEntity, { message: query });

    const deadline = Date.now() + timeoutMs;
    let pollCount = 0;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      pollCount++;

      await this.ensureConnected();
      const newMessages = await this.client.getMessages(botEntity, {
        limit: 20,
        minId: lastKnownId,
      });

      console.log(`[Telegram _searchMusic] Poll #${pollCount}: got ${newMessages.length} new messages (minId=${lastKnownId})`);

      for (const msg of newMessages) {
        if (!msg || msg.id <= lastKnownId) continue;
        if (msg.out) continue;

        console.log(`[Telegram _searchMusic]   msg ${msg.id}: out=${msg.out}, text="${msg.message?.substring(0, 40) || ''}", hasMedia=${!!msg.media}, hasReplyMarkup=${!!msg.replyMarkup}`);

        // Check for text responses
        if (msg.message && !msg.replyMarkup && !msg.media) {
          const txt = msg.message.trim();
          if (/daily.*(limit|search limit)/i.test(txt) || /limit reached/i.test(txt)) {
            throw new Error(`Bot rate-limited: ${txt.split('\n')[0]}`);
          }
          if (/download|process|fetch|wait|please/i.test(txt)) {
            console.log(`[Telegram _searchMusic]   -> progress message, continuing`);
            continue;
          }
          if (/not found|no result|nothing found|sorry|no tracks|unsupported|error/i.test(txt)) {
            throw new Error(`Bot responded: ${txt}`);
          }
        }

        // Check for inline buttons
        const replyMarkup = msg.replyMarkup;
        if (replyMarkup instanceof Api.ReplyInlineMarkup) {
          const buttons: Array<{ index: number; text: string }> = [];
          let idx = 0;

          for (const row of replyMarkup.rows) {
            for (const btn of row.buttons) {
              if (btn instanceof Api.KeyboardButtonCallback) {
                buttons.push({
                  index: idx,
                  text: btn.text || `Option ${idx + 1}`,
                });
                idx++;
              }
            }
          }

          if (buttons.length > 0) {
            console.log(`[Telegram _searchMusic] Found ${buttons.length} buttons in msg ${msg.id}`);
            return { buttonMessageId: msg.id, buttons };
          }
        }

        // Check for media (audio)
        if (msg.media && "document" in msg.media) {
          const doc = (msg.media as Api.MessageMediaDocument).document;
          if (doc instanceof Api.Document) {
            const mime = doc.mimeType || '';
            const size = Number(doc.size) || 0;
            const attrNames = doc.attributes.map(a => a.className).join(', ');
            console.log(`[Telegram _searchMusic]   doc mimeType: ${mime}, size: ${size}, attributes: ${attrNames}`);

            // Check if any attribute is DocumentAttributeAudio (covers music and voice)
            const audioAttr = doc.attributes.find((a) => a instanceof Api.DocumentAttributeAudio) as Api.DocumentAttributeAudio | undefined;

            // Also accept if it's not an image/video and size > 500 KB (likely audio)
            const isNonMedia = !mime.startsWith("image/") && !mime.startsWith("video/");

            if (audioAttr || (isNonMedia && size > 500 * 1024)) {
              const title = audioAttr?.title || (audioAttr?.voice ? "Voice" : "Audio");
              const performer = audioAttr?.performer || "Unknown";
              const duration = audioAttr?.duration || 0;

              console.log(`[Telegram _searchMusic] Recognised as audio: "${title}" by ${performer}, duration ${duration}s`);
              return {
                buttonMessageId: msg.id,
                buttons: [{ index: 0, text: title }],
              };
            } else {
              console.log(`[Telegram _searchMusic]   not recognised as audio, skipping`);
            }
          }
        }
      }
    }

    // Timeout fallback: scan recent messages for any audio-like document
    console.warn(`[Telegram _searchMusic] Polling timed out after ${timeoutMs}ms. Doing final fallback scan.`);
    const fallbackMessages = await this.client.getMessages(botEntity, { limit: 20 });
    for (const msg of fallbackMessages) {
      if (msg.out) continue;
      if (msg.media && "document" in msg.media) {
        const doc = (msg.media as Api.MessageMediaDocument).document;
        if (doc instanceof Api.Document) {
          const mime = doc.mimeType || '';
          const size = Number(doc.size) || 0;
          const audioAttr = doc.attributes.find((a) => a instanceof Api.DocumentAttributeAudio);
          if (audioAttr || (size > 500 * 1024 && !mime.startsWith("image/") && !mime.startsWith("video/"))) {
            console.log(`[Telegram _searchMusic] FALLBACK: found audio in msg ${msg.id}`);
            return {
              buttonMessageId: msg.id,
              buttons: [{ index: 0, text: "Audio" }],
            };
          }
        }
      }
    }

    throw new Error(`Bot did not respond with buttons or audio within ${timeoutMs}ms`);
  }

  async selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs = 60000,
    targetBotUsername?: string
  ): Promise<MusicResult> {
    await this.ensureConnected();
    return this._selectResult(buttonMessageId, buttonIndex, targetBotUsername || process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot", timeoutMs);
  }

  private async _selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    botUsername: string,
    timeoutMs: number,
  ): Promise<MusicResult> {
    const botEntity = await this.client.getEntity(botUsername);

    const messages = await this.client.getMessages(botEntity, {
      ids: [buttonMessageId],
    });
    const buttonMsg = messages[0];

    if (!buttonMsg?.replyMarkup ||
        !(buttonMsg.replyMarkup instanceof Api.ReplyInlineMarkup)) {
      // Try direct audio
      const audioMsg = messages[0];
      if (audioMsg?.media && "document" in audioMsg.media) {
        const doc = (audioMsg.media as Api.MessageMediaDocument).document;
        if (doc instanceof Api.Document) {
          const audioAttr = doc.attributes.find(
            (a) => a instanceof Api.DocumentAttributeAudio,
          ) as Api.DocumentAttributeAudio | undefined;
          return {
            messageId: audioMsg.id,
            title: audioAttr?.title || (audioAttr?.voice ? "Voice" : "Unknown"),
            artist: audioAttr?.performer || "Unknown",
            duration: audioAttr?.duration || 0,
            fileId: doc.id.toString(),
            buttonIndex,
          };
        }
      }
      throw new Error("Message does not have inline buttons");
    }

    let callbackData: Uint8Array | undefined;
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

    if (!callbackData) {
      throw new Error(`Button at index ${buttonIndex} not found`);
    }

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
      } catch (err: any) {
        if (attempt === 0 && err?.errorMessage === "BOT_RESPONSE_TIMEOUT") {
          console.warn("[Telegram] BOT_RESPONSE_TIMEOUT on button click, retrying...");
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));

      await this.ensureConnected();
      const newMessages = await this.client.getMessages(botEntity, {
        limit: 10,
        minId: buttonMessageId,
      });

      for (const msg of newMessages) {
        if (!msg || !msg.media || !("document" in msg.media)) continue;
        if (msg.id <= buttonMessageId) continue;

        const doc = (msg.media as Api.MessageMediaDocument).document;
        if (!(doc instanceof Api.Document)) continue;

        const audioAttr = doc.attributes.find(
          (a) => a instanceof Api.DocumentAttributeAudio,
        ) as Api.DocumentAttributeAudio | undefined;

        if (!audioAttr) continue;

        return {
          messageId: msg.id,
          title: audioAttr.title || (audioAttr.voice ? "Voice" : "Unknown"),
          artist: audioAttr.performer || "Unknown",
          duration: audioAttr.duration || 0,
          fileId: doc.id.toString(),
          buttonIndex,
        };
      }
    }

    throw new Error(`Audio not received within ${timeoutMs}ms after clicking button`);
  }

  async importPlaylist(url: string, onTrack?: (track: MusicResult) => void): Promise<MusicResult[]> {
    return this.withRetry(async () => {

    const botEntity = await this.client.getEntity(this.botUsername);

    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    await this.client.sendMessage(botEntity, { message: url });

    const results: MusicResult[] = [];
    let lastNewAudioTime = Date.now();
    const idleTimeout = 20000;

    while (Date.now() - lastNewAudioTime < idleTimeout) {
      await new Promise((r) => setTimeout(r, 3000));

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 20,
        minId: results.length > 0
          ? results[results.length - 1].messageId
          : lastKnownId,
      });

      for (const msg of newMessages) {
        if (!msg || !msg.media || !("document" in msg.media)) continue;

        const doc = (msg.media as Api.MessageMediaDocument).document;
        if (!(doc instanceof Api.Document)) continue;

        const audioAttr = doc.attributes.find(
          (a) => a instanceof Api.DocumentAttributeAudio,
        ) as Api.DocumentAttributeAudio | undefined;

        if (!audioAttr) continue;

        const msgId = msg.id || 0;
        if (results.some((r) => r.messageId === msgId)) continue;

        const track: MusicResult = {
          messageId: msgId,
          title: audioAttr.title || (audioAttr.voice ? "Voice" : "Unknown"),
          artist: audioAttr.performer || "Unknown",
          duration: audioAttr.duration || 0,
          fileId: doc.id.toString(),
          buttonIndex: 0,
        };

        results.push(track);
        lastNewAudioTime = Date.now();

        if (onTrack) onTrack(track);
      }
    }

    return results;
    });
  }

  async downloadAudio(messageId: number): Promise<Buffer> {
    return this.withRetry(async () => {

    const botEntity = await this.client.getEntity(this.botUsername);
    const messages = await this.client.getMessages(botEntity, {
      ids: [messageId],
    });

    const msg = messages[0];
    if (!msg || !msg.media) {
      throw new Error(`Message ${messageId} not found or has no media`);
    }

    const result = await this.client.downloadMedia(msg);

    if (Buffer.isBuffer(result)) {
      return result;
    }

    if (result && typeof result === "object" && (Symbol.asyncIterator in result || Symbol.iterator in result)) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of result as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }

    throw new Error(`Unexpected download result type: ${typeof result}`);
    });
  }

  /** Resolve a message id to its document location, going to Telegram only on a miss. */
  private async resolveDocument(
    messageId: number,
    forceRefresh = false,
  ): Promise<{ location: Api.InputDocumentFileLocation; size: number; dcId?: number }> {
    if (!forceRefresh) {
      const hit = this.docCache.get(messageId);
      if (hit) return hit;
    }

    const botEntity = await this.client.getEntity(this.botUsername);
    const messages = await this.client.getMessages(botEntity, { ids: [messageId] });
    const msg = messages[0];
    if (!msg || !msg.media) {
      throw new Error(`Message ${messageId} not found or has no media`);
    }

    const doc = (msg.media as Api.MessageMediaDocument).document as Api.Document;
    if (!doc) throw new Error(`Message ${messageId} has no document`);

    const entry = {
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
      size: Number(doc.size) || 0,
      dcId: doc.dcId as number | undefined,
    };
    this.docCache.set(messageId, entry);
    return entry;
  }

  /**
   * Stream audio out of the bot chat, forwarding bytes as they arrive.
   *
   * Two things used to make this slow enough to look broken:
   *
   * 1. With no Range header it called `downloadMedia`, which resolves only once
   *    the *entire* file has been pulled into a Buffer. The user waited for all
   *    ~9MB to land on the server before receiving byte one, even though the
   *    client was perfectly happy to consume a stream. Now every path goes
   *    through `iterDownload`, so the first chunk ships as soon as it arrives.
   *
   * 2. `iterDownload`'s `limit` counts *chunks*, not bytes — gramJS derives it
   *    as `ceil(fileSize / chunkSize)` when omitted, and decrements it once per
   *    chunk yielded. Passing a byte count meant a 64KB Range request asked for
   *    64K chunks of 512KB, so it kept pulling to end-of-file while the response
   *    advertised a Content-Length of 64KB. Every seek downloaded the whole
   *    remainder of the track, and the mismatch left the connection wrong-sized.
   *    `limit` is now a real chunk count derived from the requested range.
   *
   * Telegram also requires the read offset to be 4KB-aligned, so the request is
   * widened down to the previous boundary and the extra head bytes are dropped
   * here rather than sent to the client.
   */
  async getAudioStream(
    messageId: number,
    offsetBytes?: number,
    limitBytes?: number,
  ): Promise<{ stream: Readable; size: number }> {
    return this.withRetry(async () => {
      const bigInt = require("big-integer");
      const CHUNK = 512 * 1024; // gramJS MAX_CHUNK_SIZE; larger is rejected
      const ALIGN = 4096; // Telegram's required offset granularity

      let doc = await this.resolveDocument(messageId);
      const size = doc.size;

      const start = Math.max(0, offsetBytes ?? 0);
      const wanted =
        limitBytes !== undefined
          ? Math.max(0, Math.min(limitBytes, Math.max(0, size - start)))
          : Math.max(0, size - start);

      const alignedStart = Math.floor(start / ALIGN) * ALIGN;
      const skip = start - alignedStart;
      const chunkCount = Math.max(1, Math.ceil((skip + wanted) / CHUNK));

      const openIter = (location: Api.InputDocumentFileLocation, dcId?: number) =>
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

      // Trim the alignment padding and stop at exactly the requested length, so
      // what goes out matches the Content-Length the route advertises.
      const self = this;
      async function* trimmed(): AsyncGenerator<Buffer> {
        let toSkip = skip;
        let sent = 0;
        let started = false;
        while (true) {
          try {
            for await (const raw of iter as AsyncIterable<Buffer>) {
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
            // has been emitted yet, otherwise the client already holds a prefix.
            if (!started && /FILE_REFERENCE|FILEREF/i.test(m)) {
              console.warn(`[Telegram] Stale file reference for ${messageId}, re-resolving`);
              self.docCache.delete(messageId);
              doc = await self.resolveDocument(messageId, true);
              iter = openIter(doc.location, doc.dcId);
              continue;
            }
            throw err;
          }
        }
      }

      return { stream: Readable.from(trimmed(), { objectMode: false }), size };
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.client?.connected) {
      this.connected = false;
      if (!this.connectPromise) {
        await this.init();
      } else {
        await this.connectPromise;
      }
    }
  }
}

const globalForTelegram = globalThis as unknown as { telegramClient?: TelegramClient };

export function getTelegramClient(): TelegramClient {
  if (!globalForTelegram.telegramClient) {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
    const apiHash = process.env.TELEGRAM_API_HASH || "";
    const sessionString = process.env.TELEGRAM_SESSION_STRING || "";

    if (!apiId || !apiHash) {
      throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH");
    }

    globalForTelegram.telegramClient = new TelegramClient(
      apiId,
      apiHash,
      sessionString
    );
  }
  return globalForTelegram.telegramClient;
}

export function getBotFallbackChain(): string[] {
  const primary = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
  const fallbackEnv = process.env.TELEGRAM_FALLBACK_BOTS || "";
  const fallbacks = fallbackEnv
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b && b !== primary);
  return [primary, ...fallbacks];
}