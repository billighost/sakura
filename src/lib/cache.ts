import { redis } from "./redis";

/**
 * Two-layer cache: an in-process L1 in front of Upstash as L2.
 *
 * The L1 layer is not a micro-optimisation here, it is the thing that makes the
 * free plan viable at all. Upstash meters *commands*, so at 1000 concurrent
 * users the monthly bill is decided by the L1 hit rate and almost nothing else.
 * A measured 2.26 commands/request projects to ~98M commands/month against a
 * 500K allowance — so every command L1 absorbs is the point of this file.
 *
 * All Redis errors are swallowed. Cache is best-effort by construction: if
 * Upstash is unreachable the app serves correctly, just more expensively.
 */

const globalForMemoryCache = globalThis as unknown as {
  memoryCache?: Map<string, { value: any; expiresAt: number }>;
  cacheInflight?: Map<string, Promise<any>>;
};

if (!globalForMemoryCache.memoryCache) {
  globalForMemoryCache.memoryCache = new Map();
}
if (!globalForMemoryCache.cacheInflight) {
  globalForMemoryCache.cacheInflight = new Map();
}
const memoryCache = globalForMemoryCache.memoryCache;

/**
 * In-flight loads, keyed by cache key — the single-flight table.
 *
 * Without this, an expiring hot key is an outage waiting to happen: 300 requests
 * arrive in the same second, all miss, and all run the same 11-query rebuild or
 * the same Deezer call. The database sees a burst 300× larger than the actual
 * demand for one piece of data. Sharing the first caller's promise turns that
 * back into one load, which is the difference between a cache expiry being
 * invisible and it being a latency spike.
 */
const inflight = globalForMemoryCache.cacheInflight;

const MAX_MEMORY_CACHE_SIZE = 10000;

/**
 * How long a value may live in L1.
 *
 * The number that matters is not how long the data stays *valid* but how long a
 * stale copy on one instance can survive an invalidation performed on another.
 * `cacheDel` clears Redis globally but can only clear the L1 of the instance
 * that ran it, so L1 lifetime is a direct upper bound on cross-instance
 * staleness after a mutation.
 *
 * The existing TTL table already sorts data by exactly that property, so the L2
 * TTL is used as the signal:
 *
 *   < 1 hour   user-scoped and invalidated on write (favourites, home,
 *              playlists, profile) → keep L1 short so a like or a rename shows
 *              up promptly on every instance.
 *   >= 1 hour  external catalogue facts (search results, lyrics, credits,
 *              artist metadata) that nothing in the app ever invalidates →
 *              hold them far longer, because these are the high-volume reads
 *              and they cannot go stale in a way anyone notices.
 */
const L1_VOLATILE_SECONDS = 15;
const L1_CATALOGUE_SECONDS = 300;
const CATALOGUE_TTL_THRESHOLD = 60 * 60;

function l1TtlFor(l2TtlSeconds: number): number {
  return l2TtlSeconds >= CATALOGUE_TTL_THRESHOLD
    ? Math.min(l2TtlSeconds, L1_CATALOGUE_SECONDS)
    : Math.min(l2TtlSeconds, L1_VOLATILE_SECONDS);
}

const globalForCacheStats = globalThis as unknown as {
  cacheStats?: { l1Hits: number; l1Misses: number; l2Hits: number; coalesced: number };
};

if (!globalForCacheStats.cacheStats) {
  globalForCacheStats.cacheStats = { l1Hits: 0, l1Misses: 0, l2Hits: 0, coalesced: 0 };
}
const stats = globalForCacheStats.cacheStats;

/**
 * L1 hit rate decides whether Upstash's per-command quota is survivable, so
 * it's reported directly rather than inferred from the raw command count.
 */
export function memoryCacheStats() {
  const total = stats.l1Hits + stats.l1Misses;
  return {
    size: memoryCache.size,
    inflight: inflight.size,
    l1Hits: stats.l1Hits,
    l1Misses: stats.l1Misses,
    l2Hits: stats.l2Hits,
    coalesced: stats.coalesced,
    l1HitRate: total ? +((stats.l1Hits / total) * 100).toFixed(1) : 0,
  };
}

/**
 * Evict before inserting.
 *
 * The previous version dropped `memoryCache.keys().next().value` — the
 * oldest-*inserted* key, which is FIFO, not LRU, and evicts a permanently hot
 * entry simply for having been added early. It also never removed expired
 * entries, so a cache full of dead keys would evict live ones to make room for
 * more dead keys. Sweeping expired entries first means eviction usually costs
 * nothing, and only a genuinely full cache of live entries falls back to
 * dropping the oldest.
 */
function evictIfNeeded(now: number): void {
  if (memoryCache.size < MAX_MEMORY_CACHE_SIZE) return;

  let swept = 0;
  for (const [k, v] of memoryCache) {
    if (now >= v.expiresAt) {
      memoryCache.delete(k);
      swept++;
      if (swept >= 256) break;
    }
  }
  if (memoryCache.size < MAX_MEMORY_CACHE_SIZE) return;

  const oldestKey = memoryCache.keys().next().value;
  if (oldestKey !== undefined) memoryCache.delete(oldestKey);
}

function l1Set(key: string, value: unknown, ttlSeconds: number): void {
  const now = Date.now();
  evictIfNeeded(now);
  // Re-insert so Map iteration order tracks recency of write, which is what
  // makes the fallback eviction above approximate LRU rather than pure FIFO.
  memoryCache.delete(key);
  memoryCache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const cached = memoryCache.get(key);

  if (cached && now < cached.expiresAt) {
    stats.l1Hits += 1;
    return cached.value as T;
  }
  stats.l1Misses += 1;

  try {
    const val = await redis.get<T>(key);
    if (val !== null && val !== undefined) {
      stats.l2Hits += 1;

      // A stale-while-error envelope knows its own freshness deadline, so L1
      // can be held exactly until the value goes stale — never past the point
      // where a refresh is due, and never needlessly re-fetched before it.
      let ttl = L1_VOLATILE_SECONDS;
      if (val && typeof val === "object" && "staleAt" in val && typeof (val as any).staleAt === "number") {
        const msRemaining = (val as any).staleAt - now;
        ttl = msRemaining > 0 ? Math.min(Math.ceil(msRemaining / 1000), L1_CATALOGUE_SECONDS) : 0;
      }

      if (ttl > 0) l1Set(key, val, ttl);
    }
    return val;
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
    l1Set(key, value, l1TtlFor(ttlSeconds));
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // non-critical
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  for (const k of keys) {
    memoryCache.delete(k);
    // Drop any in-flight load too: it was started against pre-mutation state
    // and would otherwise repopulate the key with the value we just invalidated.
    inflight.delete(k);
  }
  try {
    // One variadic DEL rather than N parallel ones. Upstash bills per command,
    // and invalidation runs on every write path, so this is the difference
    // between a like costing 1 command and costing 3.
    if (keys.length === 1) {
      await redis.del(keys[0]);
    } else if (keys.length > 1) {
      await redis.del(...keys);
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
 * Run `load` at most once per key across all concurrent callers.
 *
 * Exported because the pattern is needed by call sites that cache in their own
 * shape (the artist route, for instance) and not only by `cachedWithStale`.
 */
export async function singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    stats.coalesced += 1;
    return existing as Promise<T>;
  }

  const p = (async () => {
    try {
      return await load();
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
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

  if (envelope && typeof envelope.staleAt === "number" && now < envelope.staleAt) {
    return envelope.v;
  }

  // Everything past this point is a miss or a refresh, i.e. the expensive path,
  // so it runs under single-flight. Concurrent callers for the same key wait on
  // one load instead of each starting their own.
  return singleFlight(key, async () => {
    // Re-check after acquiring: a load that finished while this caller was
    // queued has already populated L1, and repeating it would waste the very
    // round trip the coalescing exists to avoid.
    const rechecked = memoryCache.get(key);
    if (rechecked && Date.now() < rechecked.expiresAt) {
      const env = rechecked.value as Envelope<T>;
      if (env && typeof env.staleAt === "number" && Date.now() < env.staleAt) return env.v;
    }

    const fresh = await load();
    if (fresh !== null && fresh !== undefined) {
      await cacheSetStale(key, fresh, freshSeconds);
      return fresh;
    }

    if (envelope && typeof envelope.staleAt === "number") {
      console.warn(`[cache:${label}] upstream unavailable — serving stale copy`);
      return envelope.v;
    }
    return null;
  });
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

/**
 * Cache a value that is expensive to compute but not sourced from an external
 * provider — database aggregates, scoring passes, and the like.
 *
 * `cachedWithStale` is the wrong tool for those: its whole purpose is surviving
 * a provider outage, and a query against our own database either succeeds or
 * fails the request anyway. This is the plain read-through, with the two things
 * that actually matter under load — single-flight and L1.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null && hit !== undefined) return hit;

  return singleFlight(key, async () => {
    const rechecked = memoryCache.get(key);
    if (rechecked && Date.now() < rechecked.expiresAt) return rechecked.value as T;

    const value = await load();
    if (value !== null && value !== undefined) {
      await cacheSet(key, value, ttlSeconds);
    }
    return value;
  });
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

  /**
   * Radio continuations. Measured at 17 Postgres round trips per call with no
   * cache at all, which made it by far the most expensive endpoint in the app.
   * Short on purpose: the response is a *queue*, and the exclusion list the
   * client sends changes as it plays, so this only needs to absorb the burst of
   * repeat calls that happen while someone is skipping through tracks.
   */
  RADIO: 45,

  /**
   * The radio candidate pool — several wide scans plus, on a thin library, a
   * fan-out of provider lookups. Longer than RADIO because it's the expensive
   * half and it turns over far more slowly: the pool is "what could plausibly
   * play for this person", which changes as taste changes, not as songs play.
   * Variety between consecutive radios comes from scoring over the pool, not
   * from rebuilding it.
   */
  RADIO_POOL: 10 * 60,

  /** Local catalogue lookups that back search — cheap to recompute, hot. */
  SEARCH_LOCAL: 120,

  /** Track credits assembled from local tables. */
  TRACK_CREDITS: 10 * 60,

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
