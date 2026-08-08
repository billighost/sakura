/**
 * Behavioural check for the local-first rate limiter.
 *
 * The optimisation only counts requests locally below a soft budget, then folds
 * the accumulated delta into the shared counter with INCRBY. That is the part
 * worth testing: if the delta accounting is wrong the effective limit silently
 * becomes 1/LOCAL_BUDGET_FRACTION times what it should be, and the limiter
 * stops limiting while still looking like it works.
 *
 * Talks to real Redis, using a unique key per run so it never collides with
 * live counters.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Mirror of src/lib/rateLimit.ts, so this can run without the Next build.
const LOCAL_BUDGET_FRACTION = 0.25;
const local = new Map();
let redisCalls = 0;

async function rateLimit(key, limit, windowSeconds) {
  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  const redisKey = `rl:${key}:${bucket}`;
  const resetInSeconds = windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds);

  let entry = local.get(redisKey);
  if (!entry || entry.bucket !== bucket) {
    entry = { bucket, count: 0, blockedUntil: 0, syncedAt: 0 };
    local.set(redisKey, entry);
  }
  entry.count += 1;

  if (entry.blockedUntil > nowMs) return { allowed: false, remaining: 0, resetInSeconds };

  const softLimit = Math.max(1, Math.floor(limit * LOCAL_BUDGET_FRACTION));
  if (entry.count <= softLimit) {
    return { allowed: true, remaining: limit - entry.count, resetInSeconds, viaRedis: false };
  }

  const delta = entry.count - entry.syncedAt;
  entry.syncedAt = entry.count;

  redisCalls++;
  const pipe = redis.pipeline();
  pipe.incrby(redisKey, delta);
  pipe.expire(redisKey, windowSeconds, "NX");
  const [count] = await pipe.exec();

  const allowed = count <= limit;
  if (!allowed) entry.blockedUntil = nowMs + resetInSeconds * 1000;
  return { allowed, remaining: Math.max(0, limit - count), resetInSeconds, viaRedis: true };
}

(async () => {
  const LIMIT = 20;
  const key = `selftest-${Date.now()}`;

  console.log(`\n  limit=${LIMIT}/60s, soft budget=${Math.floor(LIMIT * LOCAL_BUDGET_FRACTION)}`);

  let allowed = 0;
  let denied = 0;
  let firstDenyAt = null;
  for (let i = 1; i <= 40; i++) {
    const r = await rateLimit(key, LIMIT, 60);
    if (r.allowed) allowed++;
    else {
      denied++;
      if (firstDenyAt === null) firstDenyAt = i;
    }
  }

  console.log(`  40 requests → allowed ${allowed}, denied ${denied}`);
  console.log(`  first denial at request #${firstDenyAt}`);
  console.log(`  Redis round trips used: ${redisCalls}  (naive impl would use 40)`);

  const finalCount = await redis.get(`rl:${key}:${Math.floor(Date.now() / 1000 / 60)}`);
  console.log(`  shared counter value: ${finalCount}`);

  /**
   * The shared counter deliberately does NOT equal the total request count.
   *
   * Once a key is known to be over its limit, further requests are refused from
   * local state and never reported — that's the saving, and it's safe: the
   * counter only has to be high enough that any *other* instance reading it
   * also concludes "over limit". Anything >= limit does that, and it can never
   * drift back down within a window. Requiring an exact total would mean paying
   * a round trip per request precisely when a client is hammering hardest.
   */
  const checks = [
    ["limit enforced exactly", allowed === LIMIT],
    ["denials begin at limit+1", firstDenyAt === LIMIT + 1],
    ["all excess refused", denied === 40 - LIMIT],
    ["shared counter >= limit (other instances also deny)", Number(finalCount) >= LIMIT],
    ["fewer Redis round trips than naive", redisCalls < 40],
  ];

  console.log("");
  for (const [name, pass] of checks) console.log(`  ${pass ? "✓" : "✖"} ${name}`);

  const ok = checks.every(([, p]) => p);
  console.log(
    `\n  ${ok ? "PASS" : "FAIL"} — ${(((40 - redisCalls) / 40) * 100).toFixed(0)}% fewer Redis calls than one-per-request`
  );

  await redis.del(`rl:${key}:${Math.floor(Date.now() / 1000 / 60)}`);
  console.log("");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
