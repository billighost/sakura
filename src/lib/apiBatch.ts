/**
 * Client-side request coalescing: many GETs in the same tick become one POST
 * to /api/batch.
 *
 * Two bugs in the previous version made this actively harmful:
 *
 *  1. `clearTimeout` ran on *every* call, restarting the 5ms window each time.
 *     A component tree that issues requests as it mounts (which is exactly the
 *     case this exists for) could push the flush out indefinitely — the batch
 *     only went out once there was a 5ms gap with no new calls. The window now
 *     starts on the first queued request and is never extended.
 *
 *  2. Identical paths were sent as separate entries, so a shared resource
 *     requested by three components cost three server-side handler runs. Now
 *     they're deduplicated by path and the single result fans out.
 *
 * There's also a hard cap: /api/batch rejects oversized payloads, and silently
 * dropping the overflow would be worse than sending two batches.
 */

type Pending = {
  path: string;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

/** Must not exceed the server's own cap in /api/batch. */
const MAX_BATCH_SIZE = 20;
const BATCH_WINDOW_MS = 8;

let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;

  // Collapse duplicate paths — one request, many waiters.
  const byPath = new Map<string, Pending[]>();
  for (const entry of batch) {
    const existing = byPath.get(entry.path);
    if (existing) existing.push(entry);
    else byPath.set(entry.path, [entry]);
  }

  const paths = [...byPath.keys()];

  // Respect the server cap by splitting rather than truncating.
  for (let i = 0; i < paths.length; i += MAX_BATCH_SIZE) {
    const slice = paths.slice(i, i + MAX_BATCH_SIZE);
    void sendChunk(slice, byPath);
  }
}

async function sendChunk(paths: string[], byPath: Map<string, Pending[]>) {
  const settle = (path: string, fn: (w: Pending) => void) =>
    (byPath.get(path) ?? []).forEach(fn);

  try {
    const res = await fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: paths.map((path) => ({ key: path, path })),
      }),
    });

    if (!res.ok) {
      throw new Error(`Batch endpoint returned ${res.status}`);
    }

    const data = await res.json();

    for (const path of paths) {
      const result = data?.results?.[path];
      if (result && result.status >= 200 && result.status < 300) {
        settle(path, (w) => w.resolve(result.data));
      } else {
        const status = result?.status ?? "no result";
        settle(path, (w) =>
          w.reject(new Error(`Request failed for ${path} (${status})`))
        );
      }
    }
  } catch {
    // The batch endpoint itself failed. Fall back to direct fetches rather
    // than failing every caller — a batching optimisation should never be a
    // single point of failure for the whole page.
    await Promise.all(
      paths.map(async (path) => {
        try {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`${path} returned ${res.status}`);
          const json = await res.json();
          settle(path, (w) => w.resolve(json));
        } catch (e) {
          settle(path, (w) => w.reject(e));
        }
      })
    );
  }
}

/**
 * Queue a GET for batching.
 *
 * `key` is accepted for call-site readability but is no longer used for
 * routing results — paths are the identity, which is what makes dedup work.
 */
export function apiBatch(key: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    queue.push({ path, resolve, reject });

    // Start the window on the first request only; never extend it.
    if (timer === null) {
      timer = setTimeout(flush, BATCH_WINDOW_MS);
    }

    // A burst big enough to fill a batch goes immediately — no reason to wait.
    if (queue.length >= MAX_BATCH_SIZE) {
      if (timer !== null) clearTimeout(timer);
      void flush();
    }
  });
}
