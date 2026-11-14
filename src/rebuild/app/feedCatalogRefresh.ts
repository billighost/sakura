import { pollSyncWhenVisible, waitForSyncPoll } from "../player/autoSyncPolling";

export interface FeedCatalogRefresh { pending: boolean; completedAt: number | null; retryAfterMs: number }

export function parseFeedCatalogRefresh(raw: unknown): FeedCatalogRefresh | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  if (typeof value.pending !== "boolean") return;
  return { pending: value.pending,
    completedAt: typeof value.completedAt === "number" && Number.isFinite(value.completedAt) ? value.completedAt : null,
    retryAfterMs: typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs)
      ? Math.min(60_000, Math.max(1000, value.retryAfterMs)) : 2000 };
}

/** Observe catalogue completion and bounded retries without creating feed
 * sessions per poll. Hidden/offline views pause and account changes abort it. */
export async function waitForFeedCatalog(initial: FeedCatalogRefresh, signal: AbortSignal,
  read: (signal: AbortSignal) => Promise<Record<string, unknown>>,
  wait = waitForSyncPoll, poll = pollSyncWhenVisible<Record<string, unknown>>) {
  let hint = initial, failures = 0;
  for (let attempt = 0; attempt < 30 && hint.pending; attempt++) {
    const delay = hint.retryAfterMs > 10_000 ? hint.retryAfterMs : Math.min(10_000, hint.retryAfterMs * 1.25 ** Math.min(attempt, 8));
    await wait(delay, signal);
    signal.throwIfAborted();
    try {
      const raw = await poll(read, signal);
      signal.throwIfAborted();
      if (!raw) { attempt--; continue; }
      const status = parseFeedCatalogRefresh(raw.catalogRefresh);
      if (!status) return false;
      hint = status; failures = 0;
    } catch {
      signal.throwIfAborted();
      if (++failures >= 3) return false;
    }
  }
  return !hint.pending;
}
