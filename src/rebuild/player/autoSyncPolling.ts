export interface SyncPollHint { phase?: "queued" | "waiting" | "running"; retryAfterMs?: number }
export interface SyncPollEnvironment {
  active: () => boolean;
  subscribe: (listener: () => void) => () => void;
  now?: () => number;
}
const browserEnvironment: SyncPollEnvironment = {
  active: () => (typeof document === "undefined" || document.visibilityState !== "hidden") && (typeof navigator === "undefined" || navigator.onLine !== false),
  subscribe: listener => {
    if (typeof document === "undefined" || typeof window === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  },
};

/** Use bounded server hints; older servers still receive an adaptive cadence. */
export function syncPollDelay(hint: SyncPollHint, pendingReplies: number) {
  if (typeof hint.retryAfterMs === "number" && Number.isFinite(hint.retryAfterMs)) return Math.min(10_000, Math.max(1000, hint.retryAfterMs));
  return Math.min(10_000, 2000 * 1.5 ** Math.min(5, Math.max(0, pendingReplies)));
}

/** No timer/request work while hidden or disconnected; visibility/reconnection
 * wakes the accepted job promptly without starting another transcription. */
export function waitForSyncPoll(delayMs: number, signal: AbortSignal, environment = browserEnvironment): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const now = environment.now || Date.now;
    let due = now() + Math.max(0, delayMs), timer: ReturnType<typeof setTimeout> | undefined, settled = false;
    let unsubscribe = () => {};
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); unsubscribe(); signal.removeEventListener("abort", abort);
      if (error === undefined) resolve(); else reject(error);
    };
    const abort = () => finish(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const check = (wake = false) => {
      if (settled) return;
      clearTimeout(timer);
      if (signal.aborted) { abort(); return; }
      if (!environment.active()) return;
      if (wake) due = now();
      const remaining = due - now();
      if (remaining <= 0) finish(); else timer = setTimeout(check, remaining);
    };
    unsubscribe = environment.subscribe(() => check(true));
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}

/** Pausing a poll cancels only its HTTP read; the account-bound remote job and
 * its token remain owned by the surrounding operation. */
export async function pollSyncWhenVisible<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, environment = browserEnvironment): Promise<T | null> {
  await waitForSyncPoll(0, signal, environment);
  const controller = new AbortController(), activeSignal = AbortSignal.any([signal, controller.signal]);
  const paused = () => { if (!environment.active()) controller.abort(new DOMException("Sync polling paused", "AbortError")); };
  const unsubscribe = environment.subscribe(paused);
  let rejectAbort: (reason: unknown) => void = () => {};
  const abandoned = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void abandoned.catch(() => {});
  const aborted = () => rejectAbort(activeSignal.reason);
  activeSignal.addEventListener("abort", aborted, { once: true });
  try {
    paused(); activeSignal.throwIfAborted();
    const value = await Promise.race([work(activeSignal), abandoned]);
    activeSignal.throwIfAborted();
    return value;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (controller.signal.aborted) return null;
    throw error;
  } finally { activeSignal.removeEventListener("abort", aborted); unsubscribe(); }
}
