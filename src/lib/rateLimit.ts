import { redis } from "./redis";

/**
 * Redis-backed fixed-window rate limiting.
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

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const redisKey = `rl:${key}:${bucket}`;

  try {
    const count = await redis.incr(redisKey);

    // Only set the TTL on the first hit of a window. Re-setting it on every
    // request would slide the expiry forward and the key would never expire
    // under sustained load.
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const resetInSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);

    return {
      allowed: count <= limit,
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
