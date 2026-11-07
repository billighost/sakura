import { fetchLrcLibLyrics, lyricCacheKey, type LyricIdentity, type LyricMatch } from "./provider";

/** New bounded resolver cache; misses expire quickly and outages are never cached. */
export function createLyricsResolver(options: {
  load?: (identity: LyricIdentity) => Promise<LyricMatch>;
  now?: () => number;
  maxEntries?: number;
} = {}) {
  const load = options.load || fetchLrcLibLyrics;
  const now = options.now || Date.now;
  const maxEntries = options.maxEntries ?? 256;
  const cache = new Map<string, { value: LyricMatch; expires: number }>();
  const inFlight = new Map<string, Promise<LyricMatch>>();
  return async (identity: LyricIdentity) => {
    const key = lyricCacheKey(identity);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.value;
    }
    cache.delete(key);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = load(identity).then((value) => {
      if (value.status !== "unavailable") {
        const ttl = value.status === "matched" ? 30 * 24 * 60 * 60 * 1000 : 30_000;
        cache.set(key, { value, expires: now() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      }
      return value;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, promise);
    return promise;
  };
}

export const resolveVerifiedLyrics = createLyricsResolver();
