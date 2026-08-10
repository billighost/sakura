import { redis } from "./redis";

/**
 * Redis-backed fixed-window rate limiting, with a local pre-filter.
 *
 * Fixed windows can allow up to 2× the limit across a boundary. That's an
 * acceptable trade here — the goal is stopping a client from hammering the
 * Telegram bot or the signal ingest, not precise quota accounting, and a
 * fixed window costs one round trip instead of the several a sliding log
 * would need.
 *
 * Fails **open**: if Redis is unreachable the request is allowed. A cache
 * outage taking down playback would be a worse failure than the abuse this
 * prevents.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
};

/**
 * Per-instance view of a counter, so the common case costs nothing.
 *
 * Two observations make this safe. First, a caller nowhere near their limit
 * does not need a network round trip to be told so — the answer cannot be "no"
 * until far more requests have happened. Second, once a caller is over, the
 * answer cannot become "yes" until the window rolls, so that case needs no
 * round trip either.
 *
 * That leaves only the band near the threshold actually needing Redis, which is
 * a small fraction of traffic and exactly where accuracy matters. On a metered
 * plan this is the difference between the limiter being the single largest
 * consumer of the quota and being a rounding error.
 *
 * `softLimit` is what makes it correct across instances: local counting only
 * governs the first `limit × LOCAL_BUDGET_FRACTION` requests an instance sees.
 * With several instances running, the worst case is each admitting up to its
 * own soft budget before any of them consults Redis, so the fraction is set low
 * enough that the sum stays under the real limit for a plausible fleet. Past
 * the soft limit every call checks Redis and the shared counter decides.
 */
const LOCAL_BUDGET_FRACTION = 0.25;

type LocalCounter = {
  bucket: number;
  count: number;
  blockedUntil: number;
  /** How much of `count` has already been reported to the shared counter. */
  syncedAt: number;
};

const globalForRlCache = globalThis as unknown as {
  rlLocal?: Map<string, LocalCounter>;
};
if (!globalForRlCache.rlLocal) globalForRlCache.rlLocal = new Map();
const local = globalForRlCache.rlLocal;

function sweepLocal(nowBucket: number): void {
  if (local.size < 5000) return;
  for (const [k, v] of local) {
    if (v.bucket !== nowBucket) local.delete(k);
  }
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  const redisKey = `rl:${key}:${bucket}`;
  const resetInSeconds = windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds);

  let entry = local.get(redisKey);
  if (!entry || entry.bucket !== bucket) {
    sweepLocal(bucket);
    entry = { bucket, count: 0, blockedUntil: 0, syncedAt: 0 };
    local.set(redisKey, entry);
  }
  entry.count += 1;

  // Already known to be over for this window — the shared counter cannot have
  // gone down, so there is nothing to ask.
  if (entry.blockedUntil > nowMs) {
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  // Comfortably under, on this instance's share of the budget.
  const softLimit = Math.max(1, Math.floor(limit * LOCAL_BUDGET_FRACTION));
  if (entry.count <= softLimit) {
    return { allowed: true, remaining: limit - entry.count, resetInSeconds };
  }

  try {
    // INCR and EXPIRE in one pipelined round trip. Upstash bills a pipeline as
    // a single request. EXPIRE is NX so a sustained stream of requests cannot
    // keep sliding the expiry forward and leave the key immortal.
    //
    // The local count is folded in with INCRBY rather than INCR, because the
    // requests admitted locally above still happened and the shared counter has
    // to learn about them or the limit would be silently multiplied by
    // 1/LOCAL_BUDGET_FRACTION.
    const delta = entry.count - entry.syncedAt;
    entry.syncedAt = entry.count;

    const pipe = redis.pipeline();
    pipe.incrby(redisKey, delta);
    pipe.expire(redisKey, windowSeconds, "NX");
    const [count] = (await pipe.exec()) as [number, number];

    const allowed = count <= limit;
    if (!allowed) entry.blockedUntil = nowMs + resetInSeconds * 1000;

    return { allowed, remaining: Math.max(0, limit - count), resetInSeconds };
  } catch {
    return { allowed: true, remaining: limit, resetInSeconds: windowSeconds };
  }
}

/** Standard 429 with the headers clients actually look for. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.resetInSeconds),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    }
  );
}

/** Limits, grouped so the cost of each endpoint is visible in one place. */
export const LIMITS = {
  /** Drives a Telegram bot with retries and 60s timeouts — the expensive one. */
  download: { limit: 20, window: 60 },
  /** Cheap writes, but a buggy client could loop. */
  signals: { limit: 60, window: 60 },
  /** Several scoring queries per call. */
  radio: { limit: 40, window: 60 },
  /** Full profile rebuild. */
  taste: { limit: 10, window: 60 },
  /** Third-party search. */
  search: { limit: 60, window: 60 },
  /** Regenerates every mix for a user. */
  mixes: { limit: 6, window: 300 },
  /** Pure string transformation, no upstream — this only stops runaway loops. */
  transliterate: { limit: 30, window: 60 },
} as const;
