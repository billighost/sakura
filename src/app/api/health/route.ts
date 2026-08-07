import { NextResponse } from "next/server";
import { sql } from "@/lib/sql";

/**
 * Health check for load balancers, monitoring, and the SW's periodic sync.
 *
 * Checks the things that can fail independently: Postgres is reachable and the
 * pool has free connections. Redis and Telegram are left to the monitoring
 * they already have — a Redis outage manifests as slower pages (cache misses
 * everywhere), not a dead app, and a failing health check wouldn't help there.
 */
export async function GET() {
  let dbOk = false;
  let poolStats: Record<string, unknown> = {};

  try {
    const result = await sql.query("SELECT 1 AS ok");
    dbOk = result.rows[0]?.ok === 1;
    poolStats = {
      total: (sql as unknown as { totalCount?: number }).totalCount ?? -1,
      idle: (sql as unknown as { idleCount?: number }).idleCount ?? -1,
      waiting: (sql as unknown as { waitingCount?: number }).waitingCount ?? -1,
    };
  } catch (err) {
    dbOk = false;
    poolStats = { error: err instanceof Error ? err.message : String(err) };
  }

  const healthy = dbOk;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      db: { ok: dbOk, pool: poolStats },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
