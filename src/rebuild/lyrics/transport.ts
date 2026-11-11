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
        const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), headers: { "User-Agent": "Sakura/2.0 (https://github.com/billighost/sakura)", "Accept": "application/json" }, cache: "no-store" });
        if (response.status === 404) return { status: "missing" };
        if (response.ok) {
          const data: unknown = await response.json();
          if (data === null || typeof data !== "object") return { status: "unavailable", reason: `${provider} returned an invalid response` };
          return { status: "ok", data };
        }
        const retryAfterMs = lyricRetryAfter(response.headers.get("Retry-After"), now());
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
