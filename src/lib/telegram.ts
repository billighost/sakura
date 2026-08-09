import { TelegramClient as GramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { Readable } from "stream";

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
}

export class TelegramClient {
  private client: GramClient;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private botUsername: string;
  // Stored so we can recreate the GramClient on AUTH_KEY_DUPLICATED
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly sessionString: string;
  private readonly proxyConfig?: {
    ip: string;
    port: number;
    socksType: 5 | 4;
    username?: string;
    password?: string;
  };
  private activeCount = 0;
  // Shared mutex — bot interactions from ALL concurrent downloads are serialized
  private static botMutex = new RedisMutex();

  constructor(
    apiId: number,
    apiHash: string,
    sessionString: string,
    botUsername?: string,
    proxyConfig?: TelegramClient["proxyConfig"]
  ) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.sessionString = sessionString;
    this.botUsername = botUsername || process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
    this.proxyConfig = proxyConfig;
    this.client = new GramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        autoReconnect: true,
        ...(proxyConfig ? { proxy: proxyConfig } : {}),
      },
    );
  }

  async init(): Promise<void> {
    if (this.connected && this.client?.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (!this.client?.connected) {
            await this.client.connect();
          }
          this.connected = true;
          this.connectPromise = null; // clear so future reconnects re-enter
          console.log("[Telegram] Connected");
          return;
        } catch (error: any) {
          this.connected = false;
          const isAuthKeyDuplicated =
            error?.errorMessage === "AUTH_KEY_DUPLICATED" ||
            error?.code === 406 ||
            String(error).includes("AUTH_KEY_DUPLICATED");

          if (isAuthKeyDuplicated && attempt < 3) {
            const jitterMs = 1500 + Math.floor(Math.random() * 2000);
            console.warn(`[Telegram] AUTH_KEY_DUPLICATED (attempt ${attempt}/3), retrying in ${jitterMs}ms...`);
            // The auth key on this client instance is poisoned — Telegram has
            // invalidated it. We must recreate the underlying GramJS client
            // (new MTProto session object) rather than reconnecting the same one.
            try { await this.client.disconnect(); } catch { /* ignore */ }
            this.client = new GramClient(
              new StringSession(this.sessionString),
              this.apiId,
              this.apiHash,
              {
                connectionRetries: 5,
                autoReconnect: true,
                ...(this.proxyConfig ? { proxy: this.proxyConfig } : {}),
              },
            );
            await new Promise((r) => setTimeout(r, jitterMs));
          } else {
            this.connectPromise = null;
            console.error("[Telegram] Connection failed:", error);
            throw error;
          }
        }
      }
      // All retries exhausted
      this.connectPromise = null;
      throw new Error("[Telegram] Failed to connect after 3 attempts");
    })();

    return this.connectPromise;
  }

  async acquire(): Promise<void> {
    this.activeCount++;
    await this.ensureConnected();
  }

  async release(): Promise<void> {
    this.activeCount--;
    if (this.activeCount <= 0) {
      this.activeCount = 0;
      await this.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectPromise = null;
    if (this.client) {
      try {
        await this.client.disconnect();
        console.log("[Telegram] Disconnected cleanly");
      } catch (err) {
        console.warn("[Telegram] Error during disconnect:", err);
      }
    }
  }

  /**
   * Send a search query to the bot and wait for the response with inline buttons.
   * Serialized via mutex to prevent bot state confusion.
   */
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
        await this.ensureConnected();
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const isRetriableError =
          err?.code === 406 ||
          err?.errorMessage === "AUTH_KEY_DUPLICATED" ||
          String(err).includes("AUTH_KEY_DUPLICATED") ||
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
              ...(this.proxyConfig ? { proxy: this.proxyConfig } : {}),
            }
          );

          if (attempt < 3) {
            const jitterMs = 1500 + Math.floor(Math.random() * 2000);
            console.warn(`[Telegram] Retriable error (${err.message || err.errorMessage || "AUTH_KEY_DUPLICATED"}), attempt ${attempt}/3. Recreated client and retrying in ${jitterMs}ms...`);
            await new Promise((r) => setTimeout(r, jitterMs));
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr || new Error("Unreachable");
  }

  /**
   * Atomically search and select a result, releasing the mutex after the audio arrives.
   * This is the correct way to perform a full download with concurrency safety.
   * Scores and selects the best matching inline button to avoid previews and low quality.
   */
  async searchAndSelect(
    query: string,
    targetDuration?: number,
    searchTimeoutMs = 10000,
    selectTimeoutMs = 45000
  ): Promise<MusicResult> {
    return this.withRetry(async () => {
      const release = await TelegramClient.botMutex.acquire();
      try {
        let buttonResult: { buttonMessageId: number; buttons: Array<{ index: number; text: string }> };

        // Helper to strip honorifics (King, Dr, Sir, Chief, DJ, MC, Prof) and brackets/symbols
        const cleanQueryString = (str: string) => {
          return str
            .replace(/\b(king|dr\.|dr|sir|chief|dj|mc|prof\.|prof)\b/gi, "")
            .replace(/[\(\[\{].*?[\)\]\}]/g, "")
            .replace(/[-_]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        };

        try {
          buttonResult = await this._searchMusic(query, searchTimeoutMs);
        } catch (err: any) {
          const cleaned = cleanQueryString(query);
          if (cleaned && cleaned.toLowerCase() !== query.toLowerCase()) {
            console.warn(`[Telegram AutoDownload] Initial search timed out or failed. Retrying with cleaned query: "${cleaned}"`);
            buttonResult = await this._searchMusic(cleaned, searchTimeoutMs);
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

        // 1. Avoid previews/snippets
        const isPreview = text.includes("preview") || text.includes("30s") || text.includes("30 sec") || text.includes("clip");
        if (isPreview) {
          score -= 1000;
        }

        // 2. Parse duration from button text if present, e.g. "Artist - Title [03:45]"
        const durationRegex = /(?:\[|\()(\d{1,2}):(\d{2})(?:\]|\))/;
        const match = btn.text.match(durationRegex);
        if (match) {
          const min = parseInt(match[1], 10);
          const sec = parseInt(match[2], 10);
          const duration = min * 60 + sec;

          if (targetDuration && targetDuration > 0) {
            const diff = Math.abs(duration - targetDuration);
            if (diff <= 5) {
              score += 200; // Perfect/near perfect match
            } else if (diff <= 15) {
              score += 100;
            } else if (diff > 45 && targetDuration > 45 && duration < 45) {
              // Target is full length but this is a short preview clip
              score -= 500;
            } else {
              score -= diff; // Small penalty proportional to duration mismatch
            }
          } else {
            // Avoid very short durations by default unless they are expected
            if (duration < 45) {
              score -= 300;
            }
          }
        }

        // 3. Prefer high quality (e.g. 320kbps, flac)
        if (text.includes("320") || text.includes("flac") || text.includes("kbps")) {
          score += 10;
        }

        if (score > bestScore) {
          bestScore = score;
          selectedIndex = i;
        }
      }

      console.log(`[Telegram AutoDownload] Got ${buttons.length} results. Selecting index ${selectedIndex}: "${buttons[selectedIndex]?.text}" (score: ${bestScore}) for query "${query}"`);
      const result = await this._selectResult(buttonMessageId, selectedIndex, selectTimeoutMs);
      return result;
    } finally {
      await release();
    }
    });
  }

  private async _searchMusic(query: string, timeoutMs: number): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }> {
    const botEntity = await this.client.getEntity(this.botUsername);

    // Get last message ID before sending
    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    // Send search query
    await this.client.sendMessage(botEntity, { message: query });

    // Poll for the bot's response (message with inline buttons)
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1200));

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 10,
      });

      for (const msg of newMessages) {
        // Fast detection if bot sent a text response indicating no results found
        if (msg.message && !msg.replyMarkup && !msg.media) {
          if (/not found|no result|nothing found|sorry|no tracks|unsupported/i.test(msg.message)) {
            throw new Error(`Bot responded: ${msg.message.trim()}`);
          }
        }

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
            return { buttonMessageId: msg.id, buttons };
          }
        }

        // Bot sent audio directly
        if (msg.media && "document" in msg.media) {
          const doc = (msg.media as Api.MessageMediaDocument).document;
          if (doc instanceof Api.Document) {
            const isAudio = doc.mimeType?.startsWith("audio/") ||
              doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);
            if (isAudio) {
              const audioAttr = doc.attributes.find(
                (a) => a instanceof Api.DocumentAttributeAudio,
              ) as Api.DocumentAttributeAudio | undefined;

              return {
                buttonMessageId: msg.id,
                buttons: [{ index: 0, text: audioAttr?.title || "Download" }],
              };
            }
          }
        }
      }
    }

    throw new Error(`Bot did not respond with buttons within ${timeoutMs}ms`);
  }

  /**
   * Click a button on the bot's response message to trigger the audio download.
   * Waits for the audio file to be sent back.
   * @deprecated Use searchAndSelect for proper concurrency. Called internally.
   */
  async selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs = 45000,
  ): Promise<MusicResult> {
    await this.ensureConnected();
    return this._selectResult(buttonMessageId, buttonIndex, timeoutMs);
  }

  private async _selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs: number,
  ): Promise<MusicResult> {
    const botEntity = await this.client.getEntity(this.botUsername);

    const messages = await this.client.getMessages(botEntity, {
      ids: [buttonMessageId],
    });
    const buttonMsg = messages[0];

    if (!buttonMsg?.replyMarkup ||
        !(buttonMsg.replyMarkup instanceof Api.ReplyInlineMarkup)) {
      // The bot sent audio directly (no buttons), try treating buttonMessageId as the audio msg
      const audioMsg = messages[0];
      if (audioMsg?.media && "document" in audioMsg.media) {
        const doc = (audioMsg.media as Api.MessageMediaDocument).document;
        if (doc instanceof Api.Document) {
          const audioAttr = doc.attributes.find(
            (a) => a instanceof Api.DocumentAttributeAudio,
          ) as Api.DocumentAttributeAudio | undefined;
          return {
            messageId: audioMsg.id,
            title: audioAttr?.title || "Unknown",
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

    // Click the button via callback query — retry once on BOT_RESPONSE_TIMEOUT
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

    // Wait for the audio file to arrive
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 10,
      });

      for (const msg of newMessages) {
        if (!msg || !msg.media || !("document" in msg.media)) continue;
        if (msg.id <= buttonMessageId) continue;

        const doc = (msg.media as Api.MessageMediaDocument).document;
        if (!(doc instanceof Api.Document)) continue;

        const isAudio = doc.mimeType?.startsWith("audio/") ||
          doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);

        if (!isAudio) continue;

        const audioAttr = doc.attributes.find(
          (a) => a instanceof Api.DocumentAttributeAudio,
        ) as Api.DocumentAttributeAudio | undefined;

        return {
          messageId: msg.id,
          title: audioAttr?.title || "Unknown",
          artist: audioAttr?.performer || "Unknown",
          duration: audioAttr?.duration || 0,
          fileId: doc.id.toString(),
          buttonIndex,
        };
      }
    }

    throw new Error(`Audio not received within ${timeoutMs}ms after clicking button`);
  }

  /**
   * Send a Spotify/Deezer playlist URL to the bot.
   * The bot will automatically download all tracks one by one.
   * Polls for audio files until no more arrive for a while.
   */
  async importPlaylist(url: string, onTrack?: (track: MusicResult) => void): Promise<MusicResult[]> {
    return this.withRetry(async () => {

    const botEntity = await this.client.getEntity(this.botUsername);

    // Get last message before sending
    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    // Send the playlist URL
    await this.client.sendMessage(botEntity, { message: url });

    // Poll for audio files arriving one by one
    const results: MusicResult[] = [];
    let lastNewAudioTime = Date.now();
    const idleTimeout = 20000; // If no new audio for 20s, assume done

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

        const isAudio = doc.mimeType?.startsWith("audio/") ||
          doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);

        if (!isAudio) continue;

        const msgId = msg.id || 0;
        if (results.some((r) => r.messageId === msgId)) continue;

        const audioAttr = doc.attributes.find(
          (a) => a instanceof Api.DocumentAttributeAudio,
        ) as Api.DocumentAttributeAudio | undefined;

        const track: MusicResult = {
          messageId: msgId,
          title: audioAttr?.title || "Unknown",
          artist: audioAttr?.performer || "Unknown",
          duration: audioAttr?.duration || 0,
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

  /**
   * Download audio for a specific message (after it's been sent by the bot).
   */
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

  async getAudioStream(messageId: number, offsetBytes?: number, limitBytes?: number): Promise<{ stream: Readable; size: number }> {
    return this.withRetry(async () => {

    const botEntity = await this.client.getEntity(this.botUsername);
    const messages = await this.client.getMessages(botEntity, {
      ids: [messageId],
    });

    const msg = messages[0];
    if (!msg || !msg.media) {
      throw new Error(`Message ${messageId} not found or has no media`);
    }

    let size = 0;
    if ("document" in msg.media) {
      size = Number((msg.media as any).document.size) || 0;
    }

    if (offsetBytes !== undefined) {
      // GramJS requires big-integer for offsets
      const bigInt = require("big-integer");
      const iter = this.client.iterDownload({
        file: msg.media,
        offset: bigInt(offsetBytes),
        limit: limitBytes,
        requestSize: 512 * 1024,
      });
      return { stream: Readable.from(iter), size };
    }

    const result = await this.client.downloadMedia(msg);

    if (Buffer.isBuffer(result)) {
      return { stream: Readable.from(result), size };
    }

    if (result && (result as any) instanceof Readable) {
      return { stream: result as unknown as Readable, size };
    }

    if (result && typeof result === "object" && (Symbol.asyncIterator in result || Symbol.iterator in result)) {
      return { stream: Readable.from(result as AsyncIterable<Uint8Array>), size };
    }

    throw new Error(`Unexpected download result type: ${typeof result}`);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.client?.connected) {
      this.connected = false;
      // Only null-out connectPromise if there isn't one in flight already —
      // concurrent callers should join the same promise, not each start their own.
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

    const proxyHost = process.env.TELEGRAM_PROXY_HOST || "";
    const proxyPort = process.env.TELEGRAM_PROXY_PORT ? parseInt(process.env.TELEGRAM_PROXY_PORT, 10) : undefined;
    const proxyUsername = process.env.TELEGRAM_PROXY_USERNAME || undefined;
    const proxyPassword = process.env.TELEGRAM_PROXY_PASSWORD || undefined;
    const proxySocksTypeInput = process.env.TELEGRAM_PROXY_SOCKS_TYPE ? parseInt(process.env.TELEGRAM_PROXY_SOCKS_TYPE, 10) : 5;
    const proxySocksType: 5 | 4 = (proxySocksTypeInput === 4) ? 4 : 5;

    const proxyConfig = proxyHost && proxyPort ? {
      ip: proxyHost,
      port: proxyPort,
      socksType: proxySocksType,
      username: proxyUsername,
      password: proxyPassword,
    } : undefined;

    globalForTelegram.telegramClient = new TelegramClient(
      apiId,
      apiHash,
      sessionString,
      process.env.TELEGRAM_BOT_USERNAME,
      proxyConfig,
    );
  }
  return globalForTelegram.telegramClient;
}
