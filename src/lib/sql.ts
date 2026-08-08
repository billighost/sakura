import { Pool } from "pg";

/**
 * A single shared pool, cached on globalThis.
 *
 * The cache is what makes dev usable: every hot reload re-evaluates this
 * module, and constructing a Pool unconditionally would leak 20 connections
 * per reload until Postgres starts refusing them. Reading the global *before*
 * constructing is the part that matters — the previous version built a new
 * pool first and only then stored it, so the guard never actually prevented
 * anything.
 */
const globalForPool = globalThis as unknown as { pgPool?: Pool };

/**
 * Pool size is the single most important knob for concurrency, and the right
 * value depends entirely on how the app is deployed:
 *
 *   - One long-lived server: the pool is the whole story. 20 is reasonable.
 *   - Serverless / many instances: each instance opens its own pool, so the
 *     effective connection count is `max × instances`. Neon's free tier caps
 *     out around 100 connections, so 10 per instance exhausts it at the 10th
 *     concurrent instance — and Vercel will happily run more than ten
 *     instances long before 1000 users are anywhere near the real limit.
 *
 * So the default is deployment-aware rather than a single number. On Vercel
 * (`VERCEL` is set in every deployment) the instance is a lambda handling a
 * handful of concurrent requests, and a small pool per instance multiplied
 * across many instances is what keeps the total inside Neon's ceiling. Anywhere
 * else, assume one long-lived server and pool properly.
 *
 * `PG_POOL_MAX` overrides both. Behind a pooler (PgBouncer, or Neon's own
 * `-pooler` endpoint) you can raise it freely, because the pooler multiplexes
 * onto a much smaller set of real backends.
 *
 * NOTE: this sizing assumes DATABASE_URL points at Neon's **pooled** endpoint —
 * the hostname containing `-pooler`. Against a direct endpoint, connections are
 * real Postgres backends and the ceiling arrives far sooner. `assertPooled()`
 * below warns when that's the case rather than letting it be discovered at peak.
 */
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const POOL_MAX =
  Number(process.env.PG_POOL_MAX) || (IS_SERVERLESS ? 3 : 20);

/**
 * Keep a couple of connections permanently open — but only where "the process"
 * is a durable thing.
 *
 * The database is remote: a bare `SELECT 1` on a cold pool measured ~3.1 s
 * (TCP + TLS + auth), against ~190 ms once a connection exists. With `min: 0`
 * every idle period threw away all connections, so the first request after any
 * quiet stretch paid that full handshake — which is precisely the request a
 * person is waiting on. Holding 2 warm connections converts that into a normal
 * round trip.
 *
 * On serverless that reasoning inverts. A frozen lambda still holds its
 * connections while serving nobody, so warm minimums across many idle instances
 * consume the connection budget that active instances need. There, the right
 * minimum is zero.
 */
const POOL_MIN = Number(process.env.PG_POOL_MIN) || (IS_SERVERLESS ? 0 : 2);

function assertPooled(connectionString: string | undefined): void {
  if (!connectionString) return;
  try {
    const host = new URL(connectionString).hostname;
    if (host.includes("neon.tech") && !host.includes("-pooler")) {
      console.warn(
        "[SQL] DATABASE_URL points at Neon's DIRECT endpoint. Every pool slot is " +
          "a real Postgres backend, and the free tier runs out of them well before " +
          "the app runs out of capacity. Use the '-pooler' hostname from the Neon " +
          "dashboard (Connection Details → Pooled connection).",
      );
    }
  } catch {
    // An unparseable URL is the connection's problem, not this warning's.
  }
}

function getValidConnectionString(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
  ].filter((url): url is string => !!url && url.trim().length > 0);

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname && parsed.hostname !== "base" && !parsed.hostname.endsWith(".base")) {
        return candidate;
      }
    } catch {
      // Skip invalid URL strings
    }
  }

  return candidates[0];
}

function createPool(): Pool {
  const connectionString = getValidConnectionString();
  if (!connectionString || connectionString.includes("@base") || connectionString === "base") {
    console.error(
      "[SQL] Invalid DATABASE_URL or POSTGRES_URL configured (hostname is 'base'). Please set a valid PostgreSQL connection URL in your Vercel / environment variables.",
    );
  }

  assertPooled(connectionString);

  const pool = new Pool({
    connectionString,
    max: POOL_MAX,
    min: POOL_MIN,
    // Long enough that normal gaps between requests don't cycle connections.
    idleTimeoutMillis: IS_SERVERLESS ? 10_000 : 300_000,
    connectionTimeoutMillis: 10_000,
    // Queries that hang hold a pool slot hostage. Under load that's how a
    // slow query turns into a total outage: every slot ends up parked on the
    // same statement and healthy requests can't get a connection. These caps
    // make a hung query fail its own request instead of the whole instance.
    statement_timeout: 15000,
    query_timeout: 15000,
    allowExitOnIdle: IS_SERVERLESS,
  });

  // An idle client erroring (server restart, network blip) emits on the pool.
  // Without a listener Node treats it as an unhandled 'error' event and kills
  // the process.
  pool.on("error", (err) => {
    console.error("[SQL] Idle client error:", err.message);
  });

  // Open the first connection immediately rather than lazily on the first
  // request, so startup absorbs the handshake instead of a user doing so.
  pool
    .query("SELECT 1")
    .catch((err) => console.error("[SQL] Warmup failed:", err.message));

  return pool;
}

export const sql = globalForPool.pgPool ?? createPool();

// Cached unconditionally, not just in dev. The dev case (hot reload re-evaluating
// the module) is the obvious one, but production can evaluate a module more than
// once too when it lands in separate bundles, and a second pool there is invisible
// until Postgres starts refusing connections.
globalForPool.pgPool = sql;

/**
 * Query counters, for the same reason the Redis ones exist: on a metered
 * database the interesting number is round trips per HTTP request, and that is
 * invisible from either end on its own. `slow` is tracked separately so a
 * capacity report can distinguish "too many queries" from "one bad query".
 */
const globalForSqlStats = globalThis as unknown as {
  sqlStats?: { queries: number; slow: number; totalMs: number };
};

if (!globalForSqlStats.sqlStats) {
  globalForSqlStats.sqlStats = { queries: 0, slow: 0, totalMs: 0 };
}

export const sqlStats = globalForSqlStats.sqlStats;

export function resetSqlStats(): void {
  sqlStats.queries = 0;
  sqlStats.slow = 0;
  sqlStats.totalMs = 0;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  sqlStats.queries += 1;
  try {
    const result = await sql.query(text, params);
    return result.rows as T[];
  } finally {
    const duration = Date.now() - start;
    sqlStats.totalMs += duration;
    if (duration > 200) {
      sqlStats.slow += 1;
      console.warn(`[SQL SLOW ${duration}ms]`, text.slice(0, 100));
    }
  }
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(text: string, params?: any[]): Promise<{ rowCount: number }> {
  const start = Date.now();
  sqlStats.queries += 1;
  try {
    const result = await sql.query(text, params);
    return { rowCount: result.rowCount || 0 };
  } finally {
    const duration = Date.now() - start;
    sqlStats.totalMs += duration;
    if (duration > 200) {
      sqlStats.slow += 1;
      console.warn(`[SQL SLOW ${duration}ms]`, text.slice(0, 100));
    }
  }
}

/**
 * Swallow a query failure, but say so first.
 *
 * Aggregate pages deliberately degrade rather than 500 when one section's
 * query fails — a broken "Top artists" shelf shouldn't take down the whole
 * home page. The problem was doing that with a bare `.catch(() => [])`, which
 * makes a permanently-failing query indistinguishable from an empty result.
 * Two real bugs (a missing column and a missing id default) hid behind those
 * for as long as they existed, presenting as "the section is just empty".
 *
 *     query(...).catch(softFail("home:topArtists", []))
 */
export function softFail<T>(label: string, fallback: T): (err: unknown) => T {
  return (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SQL FAILED ${label}] ${message}`);
    return fallback;
  };
}
