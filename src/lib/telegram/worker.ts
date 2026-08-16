import { Readable } from "node:stream";
import type { MusicResult, TelegramMusicClient } from "./types";

/**
 * HTTP client for the Telegram worker.
 *
 * This file is the entire Telegram surface of the Next.js app. There is no
 * MTProto here — no `telegram` package, no session string, no auth key. That is
 * the point: the failure this replaces (`AUTH_KEY_DUPLICATED`, ten-plus times)
 * happened because a horizontally-scaling serverless fleet cannot hold a
 * single-owner credential, and no lock can make it able to. Code that cannot
 * open an MTProto connection cannot duplicate an auth key.
 *
 * It also makes the Vercel bundle smaller and its cold starts faster, since
 * `telegram` and `big-integer` no longer ship in the function.
 *
 * Error messages from the worker are re-thrown **verbatim**. Callers match on
 * their text — `api/music/download` decides between "try the next bot",
 * "404 to the client" and "429 to the client" by looking for `rate-limited`,
 * `Bot responded:` and `No results found` — so rewording an error here silently
 * changes routing decisions three files away.
 */

const DEFAULT_BOT = "musicshuntersbot";

interface WorkerConfig {
  baseUrl: string;
  secret: string;
  /** Redirect listeners straight to the worker instead of proxying bytes. */
  directAudio: boolean;
}

function readConfig(): WorkerConfig | null {
  const baseUrl = (process.env.TELEGRAM_WORKER_URL || "").trim().replace(/\/+$/, "");
  const secret = (process.env.WORKER_SECRET || "").trim();
  if (!baseUrl || !secret) return null;
  return {
    baseUrl,
    secret,
    directAudio: process.env.TELEGRAM_WORKER_DIRECT_AUDIO === "1",
  };
}

export class MissingWorkerError extends Error {
  constructor() {
    super(
      "Telegram is not configured: set TELEGRAM_WORKER_URL and WORKER_SECRET. " +
        "MTProto runs in the dedicated worker (see worker/README.md) — it is " +
        "deliberately not possible to talk to Telegram from here.",
    );
    this.name = "MissingWorkerError";
  }
}

/**
 * The worker's `{error}` body is the useful part of a failure; the status code
 * alone loses the distinction between "bot said no results" and "bot is down".
 */
async function throwFromResponse(res: Response, op: string): Promise<never> {
  let detail = "";
  try {
    const body = await res.json();
    detail = typeof body?.error === "string" ? body.error : "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  const message = detail || `Telegram worker returned ${res.status} for ${op}`;
  const err = new Error(message);
  (err as Error & { status?: number }).status = res.status;
  throw err;
}

export class WorkerTelegramClient implements TelegramMusicClient {
  constructor(private readonly cfg: WorkerConfig) {}

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      // Next's fetch caches aggressively by default; a bot conversation is the
      // least cacheable thing in the system.
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) await throwFromResponse(res, path);
    return (await res.json()) as T;
  }

  /**
   * `acquire`/`release`/`disconnect` are no-ops.
   *
   * They used to reference-count a shared MTProto socket and tear it down after
   * an idle window. There is no socket in this process any more — the worker
   * holds one for its whole lifetime — so there is nothing to count and nothing
   * to disconnect. Kept because six call sites pair them in `try`/`finally`.
   */
  async acquire(): Promise<void> {}
  async release(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async searchMusic(query: string, timeoutMs = 20000) {
    return this.post<{
      buttonMessageId: number;
      buttons: Array<{ index: number; text: string }>;
    }>("/search", { query, timeoutMs }, timeoutMs + 15_000);
  }

  async searchAndSelect(
    query: string,
    targetDuration?: number,
    searchTimeoutMs = 10000,
    selectTimeoutMs = 60000,
    expectedTitle?: string,
    expectedArtist?: string,
    targetBotUsername?: string,
  ): Promise<MusicResult> {
    /*
     * Headroom on top of the worker's own deadlines, for two reasons.
     *
     * The worker may sit in its serial queue behind another user's search before
     * its clock even starts, and when it does give up it produces an error whose
     * text the caller routes on ("rate-limited", "Bot responded:"). A local
     * abort would replace that with a generic TimeoutError and send the caller
     * down the wrong branch. So this timeout exists only to catch a worker that
     * has stopped answering at all.
     */
    const budget = searchTimeoutMs + selectTimeoutMs + 60_000;
    return this.post<MusicResult>(
      "/search-and-select",
      {
        query,
        targetDuration,
        searchTimeoutMs,
        selectTimeoutMs,
        expectedTitle,
        expectedArtist,
        botUsername: targetBotUsername || undefined,
      },
      budget,
    );
  }

  async selectResult(
    buttonMessageId: number,
    buttonIndex: number,
    timeoutMs = 60000,
    targetBotUsername?: string,
  ): Promise<MusicResult> {
    return this.post<MusicResult>(
      "/select",
      {
        buttonMessageId,
        buttonIndex,
        timeoutMs,
        botUsername: targetBotUsername || undefined,
      },
      timeoutMs + 30_000,
    );
  }

  /**
   * Stream the worker's NDJSON import so `onTrack` fires as each track lands.
   *
   * An import runs for minutes and the UI shows tracks arriving, so the response
   * cannot be awaited whole. NDJSON keeps the reader trivial — split on newlines,
   * parse each line — with no streaming JSON parser involved.
   *
   * No `AbortSignal.timeout` here: the length is genuinely unbounded (it depends
   * how many songs are in the playlist), and the worker ends the stream itself
   * after 20s of silence from the bot.
   */
  async importPlaylist(
    url: string,
    onTrack?: (track: MusicResult) => void,
  ): Promise<MusicResult[]> {
    const res = await fetch(`${this.cfg.baseUrl}/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      cache: "no-store",
    });

    if (!res.ok) await throwFromResponse(res, "/import");
    if (!res.body) throw new Error("Telegram worker returned an empty import stream");

    const tracks: MusicResult[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError: string | null = null;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: { type?: string; track?: MusicResult; message?: string };
      try {
        event = JSON.parse(trimmed);
      } catch {
        // A truncated final line is not worth failing an otherwise good import.
        console.warn("[telegram] unparseable import line, ignoring");
        return;
      }
      if (event.type === "track" && event.track) {
        tracks.push(event.track);
        onTrack?.(event.track);
      } else if (event.type === "error") {
        streamError = event.message || "Import failed";
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    handleLine(buffer);

    // Reported after draining, so a playlist that failed half-way still gives
    // the caller the tracks that did arrive alongside the reason it stopped.
    if (streamError && tracks.length === 0) throw new Error(streamError);
    if (streamError) console.warn(`[telegram] import ended early: ${streamError}`);

    return tracks;
  }

  async downloadAudio(messageId: number): Promise<Buffer> {
    const res = await fetch(`${this.cfg.baseUrl}/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId }),
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) await throwFromResponse(res, "/download");
    return Buffer.from(await res.arrayBuffer());
  }

  async getAudioStream(
    messageId: number,
    offsetBytes?: number,
    limitBytes?: number,
  ): Promise<{ stream: Readable; size: number }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.secret}`,
    };

    if (offsetBytes !== undefined) {
      const end =
        limitBytes !== undefined ? offsetBytes + Math.max(0, limitBytes) - 1 : "";
      headers.Range = `bytes=${offsetBytes}-${end}`;
    }

    const res = await fetch(`${this.cfg.baseUrl}/audio/${messageId}`, {
      headers,
      cache: "no-store",
      // Time-to-first-byte only. Telegram's first chunk can take a few seconds;
      // once bytes flow the stream is not on a clock, which is what a listener
      // seeking through a long track needs.
      signal: AbortSignal.timeout(45_000),
    });

    /*
     * 416 is not an error to propagate.
     *
     * The caller (`api/stream/telegram/[messageId]`) builds its own 416 with the
     * real file size, and it needs that size to do so. `Content-Range: bytes
     * *\/<size>` carries it, so hand back the size with an empty stream and let
     * the caller's existing `offsetBytes >= size` branch answer.
     */
    if (res.status === 416) {
      res.body?.cancel().catch(() => {});
      const total = /\*\/(\d+)/.exec(res.headers.get("content-range") || "");
      return {
        stream: Readable.from([], { objectMode: false }),
        size: total ? parseInt(total[1], 10) : 0,
      };
    }

    if (!res.ok) await throwFromResponse(res, `/audio/${messageId}`);
    if (!res.body) throw new Error(`Telegram worker returned no audio body for ${messageId}`);

    // The *whole file's* size, not this range's length — that is the contract
    // `getAudioStream` has always had, and Content-Range/416 depend on it.
    const size = parseInt(res.headers.get("x-audio-size") || "0", 10) || 0;

    return {
      stream: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      size,
    };
  }

  async signedAudioUrl(messageId: number, ttlSeconds = 3600): Promise<string | null> {
    if (!this.cfg.directAudio) return null;
    try {
      const { path } = await this.post<{ path: string; expiresAt: number }>(
        "/sign-audio",
        { messageId, ttlSeconds },
        10_000,
      );
      return `${this.cfg.baseUrl}${path}`;
    } catch (err) {
      // Falling back to proxying is always correct, so a signing failure should
      // cost latency rather than playback.
      console.warn(
        `[telegram] could not sign audio URL for ${messageId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async health(): Promise<{ ok: boolean; [k: string]: unknown }> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      return (await res.json()) as { ok: boolean };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export { readConfig, DEFAULT_BOT };
