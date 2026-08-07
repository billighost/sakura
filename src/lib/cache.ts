import { redis } from "./redis";

/**
 * Typed Redis cache wrapper. All errors are swallowed — cache is always
 * best-effort. If Redis is unavailable the app continues correctly, just
 * without cache hits.
 */

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // non-critical
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length === 1) {
      await redis.del(keys[0]);
    } else if (keys.length > 1) {
      await Promise.all(keys.map((k) => redis.del(k)));
    }
  } catch {
    // non-critical
  }
}

/** Build a cache key with a consistent prefix */
export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(":");
}

/** TTL constants (seconds) */
export const TTL = {
  CHARTS: 5 * 60,      // 5 min — charts change infrequently
  PROFILE: 30,         // 30 s  — near-realtime for counts
  FAVORITES: 30,       // 30 s  — invalidated on like/unlike
  HISTORY: 15,         // 15 s  — high churn
  PLAYLISTS: 60,       // 60 s  — invalidated on mutations
  PLAYLIST: 60,        // 60 s
  ARTIST: 2 * 60,      // 2 min — catalogue data is stable
  ALBUM: 2 * 60,       // 2 min
  TRACKS: 60,          // 60 s
  ARTISTS: 60,         // 60 s
  ALBUMS: 60,          // 60 s
  HOME: 5 * 60,        // 5 min — home aggregates eight queries plus precomputed
                       //         mixes that regenerate every few days. At 30s
                       //         nearly every visit paid full cost for
                       //         unchanged data. Everything that should bust
                       //         it does so explicitly: liking a track,
                       //         editing a playlist, and regenerating mixes
                       //         all call cacheDel / invalidateTasteCaches.
  LIBRARY: 30,         // 30 s  — aggregated library
} as const;
