import { TelegramClient as GramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { Readable } from "stream";

export interface MusicResult {
  messageId: number;
  title: string;
  artist: string;
  duration: number;
  fileId: string;
  buttonIndex: number;
}

/**
 * Simple async mutex for serializing bot interactions.
 * The Telegram bot (musicshuntersbot) processes one search at a time;
 * sending multiple queries concurrently confuses its state machine and
 * causes BOT_RESPONSE_TIMEOUT errors. All bot interactions (search →
 * click button → wait for audio) are serialized through this queue.
 * Actual file streaming (the bandwidth-heavy part) is NOT gated and
 * remains fully concurrent, so 100+ simultaneous downloads are supported.
 */
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryLock = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            if (this.queue.length > 0) {
              const next = this.queue.shift()!;
              next();
            }
          });
        } else {
          this.queue.push(tryLock);
        }
      };
      tryLock();
    });
  }
}

export class TelegramClient {
  private client: GramClient;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private botUsername: string;
  // Shared mutex — bot interactions from ALL concurrent downloads are serialized
  private static botMutex = new AsyncMutex();

  constructor(
    private apiId: number,
    private apiHash: string,
    private sessionString: string,
    botUsername?: string,
  ) {
    this.botUsername = botUsername || process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
    this.client = new GramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        autoReconnect: true,
      },
    );
  }

  async init(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      try {
        await this.client.connect();
        this.connected = true;
        console.log("[Telegram] Connected");
      } catch (error: any) {
        this.connectPromise = null;
        this.connected = false;
        if (
          error?.errorMessage === "AUTH_KEY_DUPLICATED" ||
          error?.code === 406 ||
          String(error).includes("AUTH_KEY_DUPLICATED")
        ) {
          console.warn("[Telegram] AUTH_KEY_DUPLICATED during connect, waiting 2s before retry...");
          await new Promise((r) => setTimeout(r, 2000));
          try {
            await this.client.connect();
            this.connected = true;
            console.log("[Telegram] Connected on retry");
            return;
          } catch (retryErr) {
            console.error("[Telegram] Connection retry failed:", retryErr);
            throw retryErr;
          }
        }
        console.error("[Telegram] Connection failed:", error);
        throw error;
      }
    })();

    return this.connectPromise;
  }

  /**
   * Send a search query to the bot and wait for the response with inline buttons.
   * Serialized via mutex to prevent bot state confusion.
   */
  async searchMusic(query: string, timeoutMs = 20000): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }> {
    await this.ensureConnected();
    const release = await TelegramClient.botMutex.acquire();
    try {
      return await this._searchMusic(query, timeoutMs);
    } finally {
      // Don't release here — the caller must call selectResult, which releases
      // This is handled by the wrapper in searchAndSelect
    }
    // Note: release is returned to the caller via searchAndSelect
    // This method shouldn't be called directly; use searchAndSelect instead.
    release();
    throw new Error("Unreachable");
  }

  /**
   * Atomically search and select a result, releasing the mutex after the audio arrives.
   * This is the correct way to perform a full download with concurrency safety.
   * Scores and selects the best matching inline button to avoid previews and low quality.
   */
  async searchAndSelect(
    query: string,
    targetDuration?: number,
    searchTimeoutMs = 20000,
    selectTimeoutMs = 45000
  ): Promise<MusicResult> {
    await this.ensureConnected();
    const release = await TelegramClient.botMutex.acquire();
    try {
      const { buttonMessageId, buttons } = await this._searchMusic(query, searchTimeoutMs);
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
      release();
    }
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
        if (!msg || !msg.id || msg.id <= lastKnownId) continue;

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
    await this.ensureConnected();

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
  }

  /**
   * Download audio for a specific message (after it's been sent by the bot).
   */
  async downloadAudio(messageId: number): Promise<Buffer> {
    await this.ensureConnected();

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
  }

  async getAudioStream(messageId: number): Promise<Readable> {
    await this.ensureConnected();

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
      return Readable.from(result);
    }

    if (result && (result as any) instanceof Readable) {
      return result as unknown as Readable;
    }

    if (result && typeof result === "object" && (Symbol.asyncIterator in result || Symbol.iterator in result)) {
      return Readable.from(result as AsyncIterable<Uint8Array>);
    }

    throw new Error(`Unexpected download result type: ${typeof result}`);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.init();
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

    globalForTelegram.telegramClient = new TelegramClient(apiId, apiHash, sessionString, process.env.TELEGRAM_BOT_USERNAME);
  }
  return globalForTelegram.telegramClient;
}
