import type { Readable } from "node:stream";

/**
 * One track the Telegram bot handed back.
 *
 * Shape is unchanged from when this lived in `src/lib/telegram.ts`, because it
 * is written straight into `Track` rows and compared against `telegramMessageId`
 * across half the app.
 */
export interface MusicResult {
  messageId: number;
  title: string;
  artist: string;
  duration: number;
  fileId: string;
  buttonIndex: number;
}

/**
 * What the rest of the app is allowed to know about Telegram.
 *
 * `acquire`/`release` are kept even though the worker makes them no-ops. Six
 * call sites pair them in `try`/`finally`, and rewriting all of them to drop a
 * pair of awaits would be a bigger, riskier diff than leaving two methods that
 * resolve immediately. They also still express something true — "I am about to
 * use Telegram" — which is the right place to put a future concurrency limit.
 */
export interface TelegramMusicClient {
  acquire(): Promise<void>;
  release(): Promise<void>;
  disconnect(): Promise<void>;

  searchMusic(
    query: string,
    timeoutMs?: number,
  ): Promise<{
    buttonMessageId: number;
    buttons: Array<{ index: number; text: string }>;
  }>;

  searchAndSelect(
    query: string,
    targetDuration?: number,
    searchTimeoutMs?: number,
    selectTimeoutMs?: number,
    expectedTitle?: string,
    expectedArtist?: string,
    targetBotUsername?: string,
  ): Promise<MusicResult>;

  selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs?: number,
    targetBotUsername?: string,
  ): Promise<MusicResult>;

  importPlaylist(
    url: string,
    onTrack?: (track: MusicResult) => void,
  ): Promise<MusicResult[]>;

  downloadAudio(messageId: number): Promise<Buffer>;

  /** `size` is the *whole file's* size, not the length of the returned range. */
  getAudioStream(
    messageId: number,
    offsetBytes?: number,
    limitBytes?: number,
  ): Promise<{ stream: Readable; size: number }>;

  /**
   * An absolute, expiring URL a browser can fetch directly.
   *
   * Returns null when direct audio is disabled, which is the default — callers
   * must be able to fall back to proxying.
   */
  signedAudioUrl(messageId: number, ttlSeconds?: number): Promise<string | null>;
}
