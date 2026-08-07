/**
 * Resilience primitives for every outbound dependency.
 *
 * Three layers, composable and each useful alone:
 *
 *   1. `withRetry`      — bounded exponential backoff with jitter, and it only
 *                         retries things that are actually worth retrying.
 *   2. `CircuitBreaker` — stops hammering a provider that is already down, so
 *                         one dead dependency costs one timeout instead of one
 *                         timeout per request.
 *   3. `callProvider`   — the two above plus a hard timeout and one structured
 *                         log line per attempt, so a failing provider is
 *                         visible in logs rather than silently degrading.
 *
 * The design rule throughout: an optional dependency must never be able to
 * fail a request. Callers get `null` and decide what a missing answer means.
 */

export type ProviderOutcome = "ok" | "error" | "timeout" | "rejected" | "open";

export interface ProviderLog {
  provider: string;
  op: string;
  outcome: ProviderOutcome;
  ms: number;
  attempt: number;
  status?: number;
  error?: string;
  /** Set when the value came from cache rather than the provider. */
  cache?: "hit" | "stale" | "miss";
}

/**
 * One line per external call, prefixed so it can be grepped or shipped to a
 * log drain without parsing prose. Deliberately not JSON-only: these are read
 * by a human in a terminal far more often than by a machine.
 */
export function logProvider(entry: ProviderLog): void {
  const bits = [
    `[ext:${entry.provider}]`,
    entry.op,
    entry.outcome,
    `${entry.ms}ms`,
  ];
  if (entry.attempt > 1) bits.push(`attempt=${entry.attempt}`);
  if (entry.status !== undefined) bits.push(`status=${entry.status}`);
  if (entry.cache) bits.push(`cache=${entry.cache}`);
  if (entry.error) bits.push(`err="${entry.error.slice(0, 160)}"`);

  const line = bits.join(" ");
  if (entry.outcome === "ok") {
    // Only the slow successes are worth a line in steady state; logging every
    // cache-warm Deezer hit buries the failures we actually care about.
    if (entry.ms > 1500 || entry.attempt > 1) console.warn(line);
  } else {
    console.error(line);
  }
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens. */
  threshold?: number;
  /** How long to stay open before allowing a probe request. */
  cooldownMs?: number;
  /** Successful probes needed in half-open before fully closing. */
  probeSuccesses?: number;
}

/**
 * Per-process breaker. Deliberately in-memory rather than in Redis: the state
 * that matters is "is this instance wasting time on a dead host", and paying a
 * Redis round trip to find that out would defeat the purpose. Multiple
 * instances each learning independently is an acceptable cost.
 */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly probeSuccesses: number;

  constructor(
    public readonly name: string,
    opts: BreakerOptions = {},
  ) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.probeSuccesses = opts.probeSuccesses ?? 2;
  }

  /** True when a call should be short-circuited instead of attempted. */
  shouldReject(now = Date.now()): boolean {
    if (this.state === "closed") return false;

    if (this.state === "open") {
      if (now - this.openedAt >= this.cooldownMs) {
        // Cooldown elapsed — let exactly one wave of probes through.
        this.state = "half-open";
        this.successes = 0;
        return false;
      }
      return true;
    }

    // half-open: allow probes through.
    return false;
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.successes += 1;
      if (this.successes >= this.probeSuccesses) this.close();
      return;
    }
    this.failures = 0;
  }

  recordFailure(now = Date.now()): void {
    if (this.state === "half-open") {
      // A probe failed — go straight back to open, don't burn the whole
      // threshold again proving what we just learned.
      this.trip(now);
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.trip(now);
  }

  private trip(now: number): void {
    if (this.state !== "open") {
      console.error(
        `[breaker:${this.name}] OPEN after ${this.failures} failures — ` +
          `short-circuiting for ${Math.round(this.cooldownMs / 1000)}s`,
      );
    }
    this.state = "open";
    this.openedAt = now;
    this.successes = 0;
  }

  private close(): void {
    if (this.state !== "closed") {
      console.warn(`[breaker:${this.name}] CLOSED — provider recovered`);
    }
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
  }

  snapshot(): { name: string; state: BreakerState; failures: number } {
    return { name: this.name, state: this.state, failures: this.failures };
  }
}

const breakers = new Map<string, CircuitBreaker>();

/** Breakers are shared per provider name for the lifetime of the process. */
export function getBreaker(name: string, opts?: BreakerOptions): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name, opts);
    breakers.set(name, b);
  }
  return b;
}

export function breakerSnapshots() {
  return Array.from(breakers.values()).map((b) => b.snapshot());
}

// ── Retry ───────────────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return false to stop retrying immediately (e.g. a 404). */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * Full jitter backoff: `random(0, base * 2^n)`.
 *
 * Equal jitter and fixed backoff both leave clients synchronised, so when a
 * provider recovers every waiting request hits it in the same instant and
 * knocks it over again. Full jitter spreads the retry wave out.
 */
function backoffDelay(attempt: number, base: number, max: number): number {
  const ceiling = Math.min(max, base * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 4000;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err)) break;
      await sleep(backoffDelay(attempt, base, max));
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── HTTP errors ─────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/**
 * A 4xx means we asked wrongly — retrying sends the identical bad request and
 * just spends the provider's rate limit budget. 429 and 408 are the exceptions:
 * both are explicitly "try again".
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpError) {
    if (err.status === 429 || err.status === 408) return true;
    return err.status >= 500;
  }
  if (err instanceof Error) {
    // AbortSignal.timeout produces TimeoutError; network resets are transient.
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i.test(
      err.message,
    );
  }
  return false;
}

// ── The composed call ───────────────────────────────────────────────────────

export interface ProviderCallOptions<T> {
  provider: string;
  op: string;
  timeoutMs?: number;
  attempts?: number;
  breaker?: BreakerOptions;
  /** Returned instead of throwing when every attempt fails. */
  fallback?: () => T | Promise<T>;
}

/**
 * Run an outbound call with timeout + retry + breaker + logging.
 *
 * Resolves to `fallback()` (default `null`) rather than throwing, because
 * every provider behind this helper is optional by design. The caller decides
 * what a null means; nothing here can take down a request.
 */
export async function callProvider<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: ProviderCallOptions<T | null>,
): Promise<T | null> {
  const { provider, op } = opts;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const breaker = getBreaker(provider, opts.breaker);
  const fallback = opts.fallback ?? (() => null);

  if (breaker.shouldReject()) {
    logProvider({ provider, op, outcome: "open", ms: 0, attempt: 0 });
    return fallback();
  }

  try {
    return await withRetry(
      async (attempt) => {
        const started = Date.now();
        try {
          const result = await fn(AbortSignal.timeout(timeoutMs));
          breaker.recordSuccess();
          logProvider({ provider, op, outcome: "ok", ms: Date.now() - started, attempt });
          return result;
        } catch (err) {
          const ms = Date.now() - started;
          const isTimeout =
            err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          breaker.recordFailure();
          logProvider({
            provider,
            op,
            outcome: isTimeout ? "timeout" : "error",
            ms,
            attempt,
            status: err instanceof HttpError ? err.status : undefined,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
      { attempts: opts.attempts ?? 3, isRetryable: isRetryableError },
    );
  } catch {
    return fallback();
  }
}

/**
 * JSON GET with the full resilience stack.
 *
 * `next.revalidate` is passed through so Next's data cache still absorbs the
 * repeat traffic — the retry/breaker layer only ever sees genuine misses.
 */
export async function fetchJsonResilient<T>(
  url: string,
  opts: {
    provider: string;
    op: string;
    headers?: Record<string, string>;
    revalidate?: number;
    timeoutMs?: number;
    attempts?: number;
  },
): Promise<T | null> {
  return callProvider<T>(
    async (signal) => {
      const res = await fetch(url, {
        headers: opts.headers,
        signal,
        ...(opts.revalidate !== undefined ? { next: { revalidate: opts.revalidate } } : {}),
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    },
    {
      provider: opts.provider,
      op: opts.op,
      timeoutMs: opts.timeoutMs,
      attempts: opts.attempts,
    },
  );
}

