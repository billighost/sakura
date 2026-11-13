/** A provider outage is different from a completed, empty lookup. */
export type LyricResponse =
  | { status: "ok"; data: unknown }
  | { status: "missing" }
  | { status: "unavailable"; reason: string; retryAfterMs?: number };

export interface LyricProviderOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const cooldowns = new Map<string, number>();
export const LYRIC_PROVIDER_MAX_BYTES = 8 * 1024 * 1024;

/** Error responses have no useful lyric data. Release the stream without waiting
 * for a stalled provider's cancellation acknowledgement. */
export function discardLyricResponse(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}

/** Bound the entire provider envelope, rather than truncating lyric candidates. */
export async function readLyricProviderJson(response: Response, signal: AbortSignal, maximumBytes = LYRIC_PROVIDER_MAX_BYTES): Promise<unknown> {
  if (signal.aborted) { discardLyricResponse(response); signal.throwIfAborted(); }
  if (Number(response.headers.get("Content-Length")) > maximumBytes) {
    discardLyricResponse(response);
    throw new RangeError("Lyrics provider response is too large");
  }
  if (!response.body) throw new SyntaxError("Lyrics provider response is empty");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "", rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); rejectAbort(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new RangeError("Lyrics provider response is too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* An ignored abort can leave a read pending. */ }
  }
}
export const LYRIC_PROVIDER_TIMEOUT_MS = 12_000;
// Primary providers run together, followed by the plain-text fallback.
// Leave time for both stages plus the request/response overhead.
export const LYRIC_REQUEST_TIMEOUT_MS = LYRIC_PROVIDER_TIMEOUT_MS * 2 + 5000;
export function lyricRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.min(24 * 60 * 60 * 1000, Math.max(250, milliseconds)) : undefined;
}

export function waitForLyrics(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Respect server cooldowns, but return long waits to the client instead of holding a route open. */
export function createLyricTransport(options: LyricProviderOptions, provider: string) {
  const fetcher = options.fetch || fetch, now = options.now || Date.now, wait = options.wait || waitForLyrics;
  // Injected providers are isolated so deterministic tests never inherit production cooldowns.
  const limits = options.fetch ? new Map<string, number>() : cooldowns;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? LYRIC_PROVIDER_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const read = async (url: string): Promise<LyricResponse> => {
    const origin = new URL(url).origin;
    let last: LyricResponse = { status: "unavailable", reason: `${provider} could not be reached` };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const remaining = (limits.get(origin) || 0) - now();
        if (remaining > 1500) return { status: "unavailable", reason: `${provider} is waiting for its rate limit to reset`, retryAfterMs: remaining };
        if (remaining > 0) await wait(remaining, signal);
        signal.throwIfAborted();
        const responseSignal = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
        const response = await fetcher(url, { signal: responseSignal, headers: { "User-Agent": "Sakura/2.0 (https://github.com/billighost/sakura)", "Accept": "application/json" }, cache: "no-store" });
        if (responseSignal.aborted) { discardLyricResponse(response); responseSignal.throwIfAborted(); }
        if (response.status === 404) { discardLyricResponse(response); return { status: "missing" }; }
        if (response.ok) {
          const data = await readLyricProviderJson(response, responseSignal);
          if (data === null || typeof data !== "object") return { status: "unavailable", reason: `${provider} returned an invalid response` };
          return { status: "ok", data };
        }
        const retryAfterMs = lyricRetryAfter(response.headers.get("Retry-After"), now());
        discardLyricResponse(response);
        last = { status: "unavailable", reason: `${provider} HTTP ${response.status}`, ...(retryAfterMs ? { retryAfterMs } : {}) };
        if (response.status === 429 || retryAfterMs) limits.set(origin, now() + (retryAfterMs ?? 1000));
        if (response.status !== 429 && response.status < 500) return last;
        if (attempt === 0 && !retryAfterMs) await wait(response.status === 429 ? 1000 : 150, signal);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        last = { status: "unavailable", reason: signal.aborted ? `${provider} timed out` : `${provider} could not be reached` };
        if (signal.aborted) return last;
        if (attempt === 0) await wait(150, signal).catch(() => undefined);
      }
    }
    return last;
  };
  return { read, signal };
}
