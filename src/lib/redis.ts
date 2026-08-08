import { Redis } from '@upstash/redis'

/**
 * Command counters.
 *
 * Upstash's free plan is metered in *commands*, not bytes or time, so the
 * number that decides whether this app survives on it is "Redis commands per
 * HTTP request" — a figure nothing else in the stack reports. These counters
 * make it observable (`GET /api/health?stats=1`) so capacity work can be aimed
 * at the real amplifier instead of guessed at.
 *
 * Incrementing an integer per call is free relative to a REST round trip, so
 * this stays on in production rather than hiding behind a flag.
 */
const globalForRedisStats = globalThis as unknown as {
  redisStats?: { commands: number; byMethod: Record<string, number> };
};

if (!globalForRedisStats.redisStats) {
  globalForRedisStats.redisStats = { commands: 0, byMethod: {} };
}

export const redisStats = globalForRedisStats.redisStats;

export function resetRedisStats(): void {
  redisStats.commands = 0;
  redisStats.byMethod = {};
}

const base = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

/**
 * A Proxy rather than hand-wrapped methods: the surface we use grows over time
 * (get/set/del/incr/expire/eval/pipeline…) and a wrapper that has to be updated
 * per method would silently under-count the moment someone reaches for a new
 * one. Intercepting at the property level counts whatever gets called.
 *
 * `pipeline()` and `multi()` are deliberately counted as *one* command at call
 * time and then corrected by the caller, because Upstash bills a pipeline as a
 * single request regardless of how many commands ride in it — that's precisely
 * why pipelining is the main lever available here.
 */
export const redis = new Proxy(base, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function' || typeof prop !== 'string') return value;
    if (prop === 'pipeline' || prop === 'multi') {
      return (...args: unknown[]) => {
        redisStats.commands += 1;
        redisStats.byMethod[prop] = (redisStats.byMethod[prop] ?? 0) + 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
    return (...args: unknown[]) => {
      redisStats.commands += 1;
      redisStats.byMethod[prop] = (redisStats.byMethod[prop] ?? 0) + 1;
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
}) as Redis;
