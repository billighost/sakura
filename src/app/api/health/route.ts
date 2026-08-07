import { NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { redis } from "@/lib/redis";
import { breakerSnapshots } from "@/lib/resilience";

/**
 * Health check for load balancers, monitoring, and the SW's periodic sync.
 *
 * Postgres is the only hard dependency — it's the one whose failure means the
 * app genuinely cannot serve. Redis and the external providers are reported
 * but never fail the check: a Redis outage costs cache hits, and an open
 * provider breaker means that provider's data is stale, not that the app is
 * down. Reporting them separately is the point — it turns "the site feels
 * wrong" into a specific, visible answer.
 */
export async function GET() {
  let dbOk = false;
  let poolStats: Record<string, unknown> = {};

  const [dbResult, redisResult] = await Promise.allSettled([
    sql.query("SELECT 1 AS ok"),
    redis.ping(),
  ]);

  if (dbResult.status === "fulfilled") {
    dbOk = dbResult.value.rows[0]?.ok === 1;
    poolStats = {
      total: (sql as unknown as { totalCount?: number }).totalCount ?? -1,
      idle: (sql as unknown as { idleCount?: number }).idleCount ?? -1,
      waiting: (sql as unknown as { waitingCount?: number }).waitingCount ?? -1,
    };
  } else {
    poolStats = {
      error:
        dbResult.reason instanceof Error ? dbResult.reason.message : String(dbResult.reason),
    };
  }

  const redisOk = redisResult.status === "fulfilled";

  const breakers = breakerSnapshots();
  const degradedProviders = breakers.filter((b) => b.state !== "closed");

  const healthy = dbOk;

  return NextResponse.json(
    {
      status: healthy ? (degradedProviders.length || !redisOk ? "degraded" : "ok") : "down",
      timestamp: new Date().toISOString(),
      db: { ok: dbOk, pool: poolStats },
      redis: {
        ok: redisOk,
        error:
          redisResult.status === "rejected"
            ? redisResult.reason instanceof Error
              ? redisResult.reason.message
              : String(redisResult.reason)
            : undefined,
      },
      providers: breakers,
    },
    {
      // Only a dead database is a 503. A tripped provider breaker must not
      // pull the instance out of rotation — every other instance would be in
      // exactly the same state, and the app still serves fine without it.
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
