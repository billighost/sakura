import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const globalForPool = globalThis as unknown as { pgPool: Pool | undefined };
if (process.env.NODE_ENV !== "production") {
  globalForPool.pgPool = pool;
}
export const sql = globalForPool.pgPool ?? pool;

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
