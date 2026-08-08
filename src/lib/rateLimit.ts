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
 * Per-instance memory of counters already known to be over the limit.
 *
 * Rate limiting ran two Redis commands (INCR, then EXPIRE) on every single
 * call to a limited endpoint. On a metered plan that is the most expensive
 * thing in the request: the limiter cost more commands than the cache it was
 * protecting. Two changes fix it, and both matter for different reasons.
 *
 * First, INCR and EXPIRE go in one pipeline — Upstash bills a pipeline as one
 * request, so the steady-state cost halves with no behavioural change at all.
 *
 * Second, once a key is known to be over its limit, further requests in that
 * same window are rejected locally. The answer cannot change until the window
 * rolls over, so asking Redis again buys nothing — and a client being actively
 * rate limited is precisely the one sending the most traffic. Without this, the
 * abusive case is also the most expensive case, which is exactly backwards.
 */
const globalForRlCache = globalThis as unknown as {
  rlBlocked?: Map<string, number>;
};
if (!globalForRlCache.rlBlocked) globalForRlCache.rlBlocked = new Map();
const blockedUntil = globalForRlCache.rlBlocked;

function sweepBlocked(now: number): void {
  if (blockedUntil.size < 5000) return;
  for (const [k, until] of blockedUntil) {
    if (now >= until) blockedUntil.delete(k);
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

  const blocked = blockedUntil.get(redisKey);
  if (blocked !== undefined && nowMs < blocked) {
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  try {
    // INCR and EXPIRE in one pipelined round trip. Setting the TTL
    // unconditionally would slide the expiry forward under sustained load and
    // the key would never expire, so it stays guarded by the first-hit check —
    // just evaluated after the fact rather than costing a second round trip to
    // decide.
    const pipe = redis.pipeline();
    pipe.incr(redisKey);
    pipe.expire(redisKey, windowSeconds, "NX");
    const [count] = (await pipe.exec()) as [number, number];

    const allowed = count <= limit;
    if (!allowed) {
      sweepBlocked(nowMs);
      blockedUntil.set(redisKey, nowMs + resetInSeconds * 1000);
    }

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      resetInSeconds,
    };
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
} as const;
