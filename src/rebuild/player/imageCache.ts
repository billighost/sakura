// Only recent full-player sleeves need to remain decoded. Keeping dozens of
// full-size covers alive can consume hundreds of megabytes on a phone.
const MAX_RETAINED_ARTWORK = 12;
export const MAX_RETAINED_ARTWORK_BYTES = 48 * 1024 * 1024;
const ARTWORK_TIMEOUT_MS = 15000;

type ArtworkOptions = { signal?: AbortSignal; timeoutMs?: number };

type RetainedArtwork = {
  image: HTMLImageElement;
  ready: Promise<void>;
  pending: boolean;
  subscribers: number;
  decodedBytes: number;
  cancel: (reason: unknown) => void;
};

const retainedArtwork = new Map<string, RetainedArtwork>();

export function artworkMemoryStats() {
  return { entries: retainedArtwork.size, decodedBytes: [...retainedArtwork.values()].reduce((sum, entry) => sum + entry.decodedBytes, 0) };
}

function trimArtwork() {
  while (retainedArtwork.size > MAX_RETAINED_ARTWORK || artworkMemoryStats().decodedBytes > MAX_RETAINED_ARTWORK_BYTES) {
    const oldest = retainedArtwork.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = retainedArtwork.get(oldest)!;
    retainedArtwork.delete(oldest);
    // Pending callers still own their load. Once it settles, finish releases
    // the detached decode. Loaded entries are hidden retention images only.
    if (!entry.pending) entry.image.removeAttribute("src");
  }
}

function timeoutError() { return new DOMException("Artwork took too long to load.", "TimeoutError"); }
function abortError(signal: AbortSignal) { return signal.reason ?? new DOMException("Artwork preparation stopped.", "AbortError"); }
function consumerDeadline(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, ARTWORK_TIMEOUT_MS) : ARTWORK_TIMEOUT_MS;
}

/** Each caller owns its wait, while the image remains shared with other callers. */
function subscribe(entry: RetainedArtwork, options: ArtworkOptions): Promise<void> {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!entry.pending) return entry.ready;
  entry.subscribers++;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      entry.subscribers--;
    };
    const fail = (reason: unknown, departed = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
      if (departed && entry.pending && entry.subscribers === 0) entry.cancel(reason);
    };
    const abort = () => fail(abortError(signal!), true);
    const timer = setTimeout(() => fail(timeoutError(), true), consumerDeadline(options.timeoutMs));
    signal?.addEventListener("abort", abort, { once: true });
    entry.ready.then(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, reason => fail(reason));
    // Also cover a signal that changed while its listener was being attached.
    if (signal?.aborted) abort();
  });
}

/**
 * Keep recently used artwork decoded for the lifetime of the listening session.
 * This complements the HTTP cache: a newly opened player can paint from the
 * same decoded image instead of briefly presenting an empty image element.
 */
export function retainArtwork(src: string, priority = false, options: ArtworkOptions = {}): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  if (typeof Image === "undefined") return Promise.resolve();
  const existing = retainedArtwork.get(src);
  if (existing) {
    retainedArtwork.delete(src);
    retainedArtwork.set(src, existing);
    if (priority) existing.image.fetchPriority = "high";
    return subscribe(existing, options);
  }

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority ? "high" : "auto";
  let resolveReady: () => void = () => {}, rejectReady: (reason: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const entry: RetainedArtwork = { image, ready, pending: true, subscribers: 0, decodedBytes: 0, cancel: reason => finish(reason, true) };
  const finish = (reason?: unknown, failed = false) => {
    if (!entry.pending) return;
    entry.pending = false;
    clearTimeout(timer);
    image.removeEventListener("load", load);
    image.removeEventListener("error", error);
    if (failed) {
      // An evicted image may finish after a fresh attempt has taken its key.
      if (retainedArtwork.get(src) === entry) retainedArtwork.delete(src);
      image.removeAttribute("src");
      rejectReady(reason);
    } else {
      const width = image.naturalWidth || 0, height = image.naturalHeight || 0;
      entry.decodedBytes = width * height * 4;
      if (retainedArtwork.get(src) !== entry) image.removeAttribute("src");
      trimArtwork();
      resolveReady();
    }
  };
  const load = () => {
    // A loaded image remains usable when a browser declines an explicit decode.
    void Promise.resolve().then(() => image.decode?.()).catch(() => undefined).then(() => finish());
  };
  const error = () => finish(new Error("Artwork could not be decoded"), true);
  const timer = setTimeout(() => finish(timeoutError(), true), ARTWORK_TIMEOUT_MS);
  image.addEventListener("load", load, { once: true });
  image.addEventListener("error", error, { once: true });
  retainedArtwork.set(src, entry);
  // Cancellation can reject the underlying operation after its last caller left.
  void ready.catch(() => undefined);
  const consumer = subscribe(entry, options);
  try { image.src = src; } catch (reason) { finish(reason, true); }

  trimArtwork();
  return consumer;
}
