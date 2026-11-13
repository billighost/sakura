import { lyricCacheKey, type LyricIdentity, type LyricMatch } from "./provider";
import { fetchVerifiedLyrics } from "./fallbacks";
import { parseTimedLyrics } from "./parse";
import { LyricMemory } from "../player/lyricMemory";
import { ProviderFlight } from "../server/provider-flight";
import { AbortableAdmission } from "../server/abortableAdmission";
import { LYRIC_REQUEST_TIMEOUT_MS } from "./transport";

export const LYRICS_WEEKLY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
function resultLifetime(value: LyricMatch) {
  return value.status === "matched" && value.track.syncedLyrics && parseTimedLyrics(value.track.syncedLyrics).some(line => line.text.trim()) ? Infinity : LYRICS_WEEKLY_REFRESH_MS;
}

/** Public lookups share work, but each request owns its cancellation. Accepted
 * publication changes the generation even if the previous value was evicted. */
export function createLyricsResolver(options: {
  load?: (identity: LyricIdentity, signal?: AbortSignal) => Promise<LyricMatch>;
  now?: () => number; maxEntries?: number; maxBytes?: number;
} = {}) {
  const load = options.load || ((identity: LyricIdentity, signal?: AbortSignal) => fetchVerifiedLyrics(identity, { signal }));
  const now = options.now || Date.now;
  const cache = new LyricMemory<{ key: string; value: LyricMatch; expires: number }>(options.maxEntries ?? 256, options.maxBytes ?? 16 * 1024 * 1024);
  const flights = new ProviderFlight<LyricMatch>(64), admission = new AbortableAdmission(4, 32);
  const ids = new WeakMap<object, number>(); let nextId = 0;
  const resolve = async (identity: LyricIdentity, refresh = false, callerSignal?: AbortSignal) => {
    callerSignal?.throwIfAborted();
    const key = lyricCacheKey(identity), owner = cache.acquire(key), generation = owner.snapshot();
    try {
      const hit = cache.get(key);
      if (!refresh && hit && hit.expires > now()) return hit.value;
      const previousMatch = hit?.value.status === "matched" ? hit.value : undefined;
      if (!previousMatch) cache.delete(key);
      let id = ids.get(generation.generation);
      if (id === undefined) { id = ++nextId; ids.set(generation.generation, id); }
      const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(LYRIC_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(LYRIC_REQUEST_TIMEOUT_MS);
      return await flights.run(`${key}:${id}:${generation.publication}`, signal, sharedSignal => admission.run(sharedSignal, async () => {
        try {
          const value = await load(identity, sharedSignal);
          sharedSignal.throwIfAborted();
          if (!cache.publicationCurrent(generation)) {
            const current = cache.get(key)?.value;
            if (current?.status === "matched") return current;
            throw new DOMException("Lyrics changed during this lookup", "AbortError");
          }
          if (value.status !== "matched" && previousMatch) return previousMatch;
          if (value.status !== "unavailable") cache.set({ key, value, expires: now() + resultLifetime(value) });
          return value;
        } catch (error) {
          if (sharedSignal.aborted) throw error;
          const newer = cache.get(key)?.value;
          if (!cache.publicationCurrent(generation)) {
            if (newer?.status === "matched") return newer;
            throw error;
          }
          if (previousMatch) return previousMatch;
          throw error;
        }
      }));
    } finally { owner.release(); }
  };
  return Object.assign(resolve, {
    remember(identity: LyricIdentity, value: Extract<LyricMatch, { status: "matched" }>) {
      const key = lyricCacheKey(identity), owner = cache.acquire(key);
      try { owner.publish(); cache.set({ key, value, expires: now() + resultLifetime(value) }); }
      finally { owner.release(); }
    },
    invalidate(identity: LyricIdentity) {
      const key = lyricCacheKey(identity), owner = cache.acquire(key);
      try { owner.publish(); cache.delete(key); } finally { owner.release(); }
    },
  });
}

export const resolveVerifiedLyrics = createLyricsResolver();
