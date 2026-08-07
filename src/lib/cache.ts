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

/**
 * Stale-while-error cache.
 *
 * A plain TTL cache is the wrong shape for an optional upstream: the moment
 * the entry expires, a provider outage turns into a visibly empty section even
 * though we held a perfectly serviceable copy a minute ago. This stores a
 * `staleAt` alongside the value and keeps the row itself alive far longer, so
 * "expired" and "gone" become different states:
 *
 *   fresh          → return it, no upstream call
 *   stale + upstream ok    → refresh and return new
 *   stale + upstream down  → return the stale copy, log it as such
 *   absent + upstream down → null, and the caller degrades
 *
 * This is the single biggest availability win available here, because almost
 * everything this app reads from outside is catalogue data that ages in days.
 */
type Envelope<T> = { v: T; staleAt: number };

/** Hard row lifetime as a multiple of the freshness window. */
const STALE_RETENTION_FACTOR = 12;

export async function cachedWithStale<T>(
  key: string,
  freshSeconds: number,
  load: () => Promise<T | null>,
  opts: { label?: string } = {},
): Promise<T | null> {
  const label = opts.label ?? key;
  const envelope = await cacheGet<Envelope<T>>(key);
  const now = Date.now();

  if (envelope && typeof envelope.staleAt === "number") {
    if (now < envelope.staleAt) return envelope.v;

    const fresh = await load();
    if (fresh !== null && fresh !== undefined) {
      await cacheSetStale(key, fresh, freshSeconds);
      return fresh;
    }

    console.warn(`[cache:${label}] upstream unavailable — serving stale copy`);
    return envelope.v;
  }

  const fresh = await load();
  if (fresh !== null && fresh !== undefined) {
    await cacheSetStale(key, fresh, freshSeconds);
  }
  return fresh;
}

export async function cacheSetStale(
  key: string,
  value: unknown,
  freshSeconds: number,
): Promise<void> {
  const envelope: Envelope<unknown> = {
    v: value,
    staleAt: Date.now() + freshSeconds * 1000,
  };
  await cacheSet(key, envelope, freshSeconds * STALE_RETENTION_FACTOR);
}

/**
 * Read a stale-aware entry without supplying a loader.
 *
 * For call sites that need to decide *between* refreshing and serving stale
 * themselves — e.g. when the refresh is only worth attempting under some
 * condition. Returns null when there's no usable entry at all.
 */
export async function cacheGetStale<T>(
  key: string,
): Promise<{ value: T; fresh: boolean } | null> {
  const envelope = await cacheGet<Envelope<T>>(key);
  if (!envelope || typeof envelope.staleAt !== "number") return null;
  return { value: envelope.v, fresh: Date.now() < envelope.staleAt };
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

  // Search results. Long freshness on purpose: a query for the same term
  // returns the same catalogue for days, and this is the single hottest
  // external call in the app.
  search: 6 * 60 * 60, // 6 h

  // Credits never change once published.
  credits: 7 * 24 * 60 * 60, // 7 d

  // ── External catalogue data (used with cachedWithStale) ──────────────────
  // These are freshness windows, not lifetimes: the row survives
  // STALE_RETENTION_FACTOR× longer so a provider outage degrades to slightly
  // old data instead of no data. Catalogue facts age in days, so the freshness
  // window can be generous without anyone noticing.
  EXT_TRACK_SEARCH: 24 * 60 * 60,   // 24 h — a track's identity doesn't change
  EXT_ARTIST: 7 * 24 * 60 * 60,     // 7 d  — name/image/genres are near-static
  EXT_ALBUM: 7 * 24 * 60 * 60,      // 7 d
  EXT_ARTIST_TOP: 12 * 60 * 60,     // 12 h — top tracks drift slowly
  EXT_RELATED: 24 * 60 * 60,        // 24 h — similar-artist graph is stable
  EXT_GENRE_POOL: 12 * 60 * 60,     // 12 h — genre → artists, for mix seeding
  EXT_CREDITS: 30 * 24 * 60 * 60,   // 30 d — credits are historical facts
} as const;
