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
 *     effective connection count is `max × instances`. Postgres defaults to
 *     100 total, so 20 per instance exhausts it at the 5th concurrent
 *     instance — long before user load is the limit.
 *
 * `PG_POOL_MAX` makes this deployment-time configuration rather than a
 * hardcoded guess. The default of 10 is safe for a single server and survives
 * a modest serverless fan-out; behind a pooler (PgBouncer/Neon/Supabase in
 * transaction mode) you can raise it freely because the pooler multiplexes
 * onto a much smaller set of real backends.
 */
const POOL_MAX = Number(process.env.PG_POOL_MAX) || 10;

/**
 * Keep a couple of connections permanently open.
 *
 * The database is remote: a bare `SELECT 1` on a cold pool measured ~3.1 s
 * (TCP + TLS + auth), against ~190 ms once a connection exists. With `min: 0`
 * every idle period threw away all connections, so the first request after any
 * quiet stretch paid that full handshake — which is precisely the request a
 * person is waiting on. Holding 2 warm connections converts that into a normal
 * round trip.
 *
 * `allowExitOnIdle` has to go with it: it lets the process exit while idle
 * connections exist, which would defeat the point of holding them.
 */
const POOL_MIN = Number(process.env.PG_POOL_MIN) || 2;

function createPool(): Pool {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL,
    max: POOL_MAX,
    min: POOL_MIN,
    // Long enough that normal gaps between requests don't cycle connections.
    idleTimeoutMillis: 300_000,
    connectionTimeoutMillis: 10_000,
    // Queries that hang hold a pool slot hostage. Under load that's how a
    // slow query turns into a total outage: every slot ends up parked on the
    // same statement and healthy requests can't get a connection. These caps
    // make a hung query fail its own request instead of the whole instance.
    statement_timeout: 15000,
    query_timeout: 15000,
    allowExitOnIdle: false,
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

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  const result = await sql.query(text, params);
  const duration = Date.now() - start;
  if (duration > 200) {
    console.warn(`[SQL SLOW ${duration}ms]`, text.slice(0, 100));
  }
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(text: string, params?: any[]): Promise<{ rowCount: number }> {
  const result = await sql.query(text, params);
  return { rowCount: result.rowCount || 0 };
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
