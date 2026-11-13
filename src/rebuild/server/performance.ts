import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { after } from "next/server";
import { withPublicCacheWrites } from "./redisCache";

interface TimingContext {
  active: boolean;
  stages: Map<string, { duration: number; count: number }>;
}

const runtime = globalThis as typeof globalThis & {
  sakuraApiTiming?: AsyncLocalStorage<TimingContext>;
};
const timing = runtime.sakuraApiTiming ||= new AsyncLocalStorage<TimingContext>();
const validStage = /^[a-z][a-z0-9_]{0,31}$/;

/** Timings contain fixed stage names and numbers, never query or account data. */
export async function measureApiStage<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
  const context = timing.getStore();
  if (!context?.active || !validStage.test(name)) return operation();
  const start = performance.now();
  try {
    return await operation();
  } finally {
    if (context.active && (context.stages.has(name) || context.stages.size < 12)) {
      const prior = context.stages.get(name) || { duration: 0, count: 0 };
      context.stages.set(name, { duration: prior.duration + performance.now() - start, count: prior.count + 1 });
    }
  }
}

/** Measures handler completion/headers; it deliberately never consumes a stream.
 * The caller supplies a static route template so optional logs cannot contain
 * provider IDs, share slugs, search terms, cookies, or signed media addresses. */
export async function withApiTiming(
  route: string,
  request: Request,
  operation: () => Promise<Response> | Response,
): Promise<Response> {
  const context: TimingContext = { active: true, stages: new Map() };
  const started = performance.now();
  return timing.run(context, async () => {
    let status = 500;
    try {
      // A verified public cache write can finish after headers without delaying
      // useful data. The adapter falls back to awaited writes outside a route.
      const response = await withPublicCacheWrites(flush => after(flush), async () => operation());
      status = response.status;
      const appDuration = performance.now() - started;
      const values = [`app;dur=${appDuration.toFixed(1)}`];
      for (const [name, value] of context.stages) {
        values.push(`${name};dur=${value.duration.toFixed(1)};desc="${value.count} calls"`);
      }
      try {
        response.headers.append("Server-Timing", values.join(", "));
        return response;
      } catch {
        // Upstream fetch responses can have immutable headers. Forward the body
        // unchanged, retaining range, cache, cookies and redirect information.
        const headers = new Headers(response.headers);
        headers.append("Server-Timing", values.join(", "));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    } finally {
      context.active = false;
      if (process.env.SAKURA_PERFORMANCE_LOG === "1") {
        console.info("[Sakura performance]", JSON.stringify({
          route,
          method: request.method,
          status,
          handlerMs: Number((performance.now() - started).toFixed(1)),
          stages: Object.fromEntries([...context.stages].map(([name, value]) => [name, {
            ms: Number(value.duration.toFixed(1)), count: value.count,
          }])),
        }));
      }
    }
  });
}
