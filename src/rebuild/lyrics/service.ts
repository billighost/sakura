import { lyricCacheKey, type LyricIdentity, type LyricMatch } from "./provider";
import { fetchVerifiedLyrics } from "./fallbacks";
import { parseTimedLyrics } from "./parse";

export const LYRICS_WEEKLY_REFRESH_MS=7*24*60*60*1000;
function resultLifetime(value:LyricMatch){
  return value.status==="matched"&&value.track.syncedLyrics&&parseTimedLyrics(value.track.syncedLyrics).some(line=>line.text.trim())?Infinity:LYRICS_WEEKLY_REFRESH_MS;
}

/** Synced results stay reusable; plain/missing results refresh weekly. Explicit
 * retries bypass both policies, and provider outages never become negatives. */
export function createLyricsResolver(options: {
  load?: (identity: LyricIdentity) => Promise<LyricMatch>;
  now?: () => number;
  maxEntries?: number;
} = {}) {
  const load = options.load || fetchVerifiedLyrics;
  const now = options.now || Date.now;
  const maxEntries = options.maxEntries ?? 256;
  const cache = new Map<string, { value: LyricMatch; expires: number }>();
  const inFlight = new Map<string, Promise<LyricMatch>>();
  const resolve = async (identity: LyricIdentity, refresh = false) => {
    const key = lyricCacheKey(identity);
    const hit = cache.get(key);
    if (!refresh && hit && hit.expires > now()) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.value;
    }
    const previousMatch = hit?.value.status === "matched" ? hit.value : undefined;
    if (!previousMatch) cache.delete(key);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const before=cache.get(key);
    const promise = load(identity).then((value) => {
      const newer=cache.get(key);
      if(newer!==before&&newer?.value.status==="matched")return newer.value;
      // A temporary outage or an incomplete provider index cannot erase words
      // already verified for this exact recording identity.
      if (value.status !== "matched" && previousMatch) return previousMatch;
      if (value.status !== "unavailable") {
        const ttl = resultLifetime(value);
        cache.set(key, { value, expires: now() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      }
      return value;
    }).catch((error: unknown) => { if (previousMatch) return previousMatch; throw error; }).finally(() => { if(inFlight.get(key)===promise)inFlight.delete(key); });
    inFlight.set(key, promise);
    return promise;
  };
  return Object.assign(resolve,{remember(identity:LyricIdentity,value:Extract<LyricMatch,{status:"matched"}>){
    const key=lyricCacheKey(identity);
    cache.set(key,{value,expires:now()+resultLifetime(value)});
    inFlight.delete(key);
    while(cache.size>maxEntries)cache.delete(cache.keys().next().value!);
  }});
}

export const resolveVerifiedLyrics = createLyricsResolver();
