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

export class TelegramClient {
  private client: GramClient;
  private connected = false;
  private botUsername: string;

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
    try {
      await this.client.connect();
      this.connected = true;
      console.log("[Telegram] Connected");
    } catch (error) {
      console.error("[Telegram] Connection failed:", error);
      throw error;
    }
  }

  /**
   * Send a search query to the bot and wait for the response with inline buttons.
   * Returns the message with buttons (not the audio yet).
   */
  async searchMusic(query: string, timeoutMs = 15000): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }> {
    await this.ensureConnected();

    const botEntity = await this.client.getEntity(this.botUsername);

    // Get last message ID before sending
    const before = await this.client.getMessages(botEntity, { limit: 1 });
    const lastKnownId = before[0]?.id || 0;

    // Send search query
    await this.client.sendMessage(botEntity, { message: query });

    // Poll for the bot's response (the message with inline buttons)
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 5,
        minId: lastKnownId,
      });

      for (const msg of newMessages) {
        if (!msg || !msg.id || msg.id <= lastKnownId) continue;

        // Check if this message has a reply markup with inline buttons
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
            return {
              buttonMessageId: msg.id,
              buttons,
            };
          }
        }

        // If the bot sent audio directly (some queries trigger immediate audio)
        if (msg.media && "document" in msg.media) {
          const doc = (msg.media as Api.MessageMediaDocument).document;
          if (doc instanceof Api.Document) {
            const isAudio = doc.mimeType?.startsWith("audio/") ||
              doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);
            if (isAudio) {
              // Return a single "result" - the audio itself
              const audioAttr = doc.attributes.find(
                (a) => a instanceof Api.DocumentAttributeAudio,
              ) as Api.DocumentAttributeAudio | undefined;

              return {
                buttonMessageId: msg.id,
                buttons: [{
                  index: 0,
                  text: audioAttr?.title || "Download",
                }],
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
   */
  async selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs = 30000,
  ): Promise<MusicResult> {
    await this.ensureConnected();

    const botEntity = await this.client.getEntity(this.botUsername);

    // Get the message with buttons to extract callback data
    const messages = await this.client.getMessages(botEntity, {
      ids: [buttonMessageId],
    });
    const buttonMsg = messages[0];

    if (!buttonMsg?.replyMarkup ||
        !(buttonMsg.replyMarkup instanceof Api.ReplyInlineMarkup)) {
      throw new Error("Message does not have inline buttons");
    }

    // Find the callback data for the button at buttonIndex
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

    // Click the button via callback query
    await this.client.invoke(
      new Api.messages.GetBotCallbackAnswer({
        peer: botEntity,
        msgId: buttonMsg.id,
        data: Buffer.from(callbackData),
      }),
    );

    // Wait for the audio file to arrive
    const deadline = Date.now() + timeoutMs;
    const afterClick = Date.now();

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      const newMessages = await this.client.getMessages(botEntity, {
        limit: 5,
        minId: buttonMessageId,
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

      let foundNew = false;
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
        foundNew = true;

        if (onTrack) onTrack(track);
      }

      if (!foundNew && results.length > 0) {
        // No new tracks this cycle - playlist might be done
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

    const chunks: Uint8Array[] = [];
    const stream = await this.client.downloadMedia(msg);

    if (stream instanceof Readable) {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }

    if (Buffer.isBuffer(stream)) return stream;
    throw new Error("Unexpected download result type");
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

    const stream = await this.client.downloadMedia(msg);
    if (stream instanceof Readable) return stream;

    if (Buffer.isBuffer(stream)) {
      const readable = new Readable();
      readable.push(stream);
      readable.push(null);
      return readable;
    }

    throw new Error("Unexpected download result type");
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.init();
  }
}

let instance: TelegramClient | null = null;

export function getTelegramClient(): TelegramClient {
  if (!instance) {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
    const apiHash = process.env.TELEGRAM_API_HASH || "";
    const sessionString = process.env.TELEGRAM_SESSION_STRING || "";

    if (!apiId || !apiHash) {
      throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH");
    }

    instance = new TelegramClient(apiId, apiHash, sessionString, process.env.TELEGRAM_BOT_USERNAME);
  }
  return instance;
}
