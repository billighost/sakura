import { createHash } from "node:crypto";
import { approvedArtworkUrl } from "./imagePolicy";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
export const ARTWORK_MAX_BYTES = 8 * 1024 * 1024;
export const ARTWORK_CACHE_SECONDS = 604800;
export class ArtworkDeliveryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export interface DeliveredArtwork { bytes: Buffer<ArrayBuffer>; type: string; etag: string }
interface ArtworkFlight {
  key: string;
  url: URL;
  controller: AbortController;
  promise: Promise<DeliveredArtwork>;
  resolve: (value: DeliveredArtwork) => void;
  reject: (error: unknown) => void;
  consumers: number;
  started: boolean;
  complete: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/** Validated byte retention and active/queued transfers have independent bounds.
 * A departing consumer never cancels work another request is still using. */
export function createArtworkDelivery(options: { fetch?: typeof fetch; now?: () => number; maxEntries?: number; maxBytes?: number; maxConcurrent?: number; maxQueued?: number; timeoutMs?: number } = {}) {
  // Resolve the framework's patched fetch at request time, after route initialization.
  const fetcher: typeof fetch = options.fetch || ((input, init) => fetch(input, init));
  const now = options.now || Date.now;
  const maximumEntries = options.maxEntries ?? 64, maximumBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const values = new Map<string, { value: DeliveredArtwork; expires: number }>();
  const maximumConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 4));
  const maximumQueued = Math.max(0, Math.floor(options.maxQueued ?? 64));
  const flights = new Map<string, ArtworkFlight>();
  const queued: ArtworkFlight[] = [];
  let retainedBytes = 0, active = 0;
  const remove = (key: string) => { const item = values.get(key); if (item) retainedBytes -= item.value.bytes.length; values.delete(key); };
  const forget = (entry: ArtworkFlight) => { if (flights.get(entry.key) === entry) flights.delete(entry.key); };
  const load = async (entry: ArtworkFlight): Promise<DeliveredArtwork> => {
        let url = entry.url;
        const signal = entry.controller.signal, key = entry.key;
        signal.throwIfAborted();
        let response: Response | undefined;
        for (let redirects = 0; redirects < 4; redirects++) {
          response = await fetcher(url, { signal, redirect: "manual", cache: "force-cache", next: { revalidate: ARTWORK_CACHE_SECONDS }, headers: { "User-Agent": "Sakura/2.0 artwork", Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
          if (signal.aborted) { await response.body?.cancel().catch(() => undefined); signal.throwIfAborted(); }
          if (response.status < 300 || response.status > 399) break;
          const location = response.headers.get("Location");
          await response.body?.cancel();
          if (!location) throw new Error("Artwork redirect is missing");
          url = approvedArtworkUrl(new URL(location, url).toString());
        }
        if (!response?.ok || !response.body) { await response?.body?.cancel().catch(() => undefined); throw new ArtworkDeliveryError("Artwork is unavailable", 404); }
        const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() || "";
        if (!TYPES.has(type)) { await response.body.cancel(); throw new ArtworkDeliveryError("Artwork format is unsupported", 415); }
        if (Number(response.headers.get("Content-Length")) > ARTWORK_MAX_BYTES) { await response.body.cancel(); throw new ArtworkDeliveryError("Artwork is too large", 413); }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
        signal.addEventListener("abort", abort, { once: true });
        let length = 0;
        try {
          for (;;) {
            signal.throwIfAborted();
            const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
            length += next.value.byteLength;
            if (length > ARTWORK_MAX_BYTES) throw new ArtworkDeliveryError("Artwork is too large", 413);
            chunks.push(next.value);
          }
        } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        signal.throwIfAborted();
        const bytes = Buffer.concat(chunks, length);
        const value = { bytes, type, etag: `"${createHash("sha256").update(bytes).digest("hex")}"` };
        if (maximumEntries > 0 && bytes.length <= maximumBytes) {
          remove(key); values.set(key, { value, expires: now() + ARTWORK_CACHE_SECONDS * 1000 }); retainedBytes += bytes.length;
          while (values.size > maximumEntries || retainedBytes > maximumBytes) remove(values.keys().next().value!);
        }
        return value;
  };
  const pump = () => {
    while (active < maximumConcurrent && queued.length) {
      const entry = queued.shift()!;
      if (entry.complete || entry.controller.signal.aborted) continue;
      entry.started = true; active++;
      void Promise.resolve().then(() => load(entry)).then(value => { entry.complete = true; entry.resolve(value); }, error => { entry.complete = true; entry.reject(error); }).finally(() => {
        entry.complete = true; clearTimeout(entry.timer); forget(entry); active--; pump();
      });
    }
  };
  const create = (key: string, url: URL): ArtworkFlight => {
    let resolve!: ArtworkFlight["resolve"], reject!: ArtworkFlight["reject"];
    const promise = new Promise<DeliveredArtwork>((done, fail) => { resolve = done; reject = fail; });
    const controller = new AbortController();
    const entry: ArtworkFlight = { key, url, controller, promise, resolve, reject, consumers: 0, started: false, complete: false,
      timer: setTimeout(() => controller.abort(new DOMException("Artwork preparation timed out", "TimeoutError")), options.timeoutMs ?? 8000) };
    // Abandoned/rejected queued jobs must release their queue slot and timer.
    controller.signal.addEventListener("abort", () => {
      if (entry.started || entry.complete) return;
      const index = queued.indexOf(entry); if (index >= 0) queued.splice(index, 1);
      entry.complete = true; clearTimeout(entry.timer); forget(entry); reject(controller.signal.reason);
    }, { once: true });
    void promise.catch(() => undefined);
    flights.set(key, entry); queued.push(entry);
    return entry;
  };
  return async (raw: string, signal?: AbortSignal): Promise<DeliveredArtwork> => {
    signal?.throwIfAborted();
    const url = approvedArtworkUrl(raw); url.hash = "";
    const key = url.toString(), hit = values.get(key);
    if (hit && hit.expires > now()) { values.delete(key); values.set(key, hit); return hit.value; }
    remove(key);
    let entry = flights.get(key);
    if (!entry || entry.controller.signal.aborted) {
      if (active >= maximumConcurrent && queued.length >= maximumQueued) throw new ArtworkDeliveryError("Artwork preparation is busy. Try again shortly.", 503);
      entry = create(key, url);
    }
    const shared = entry; shared.consumers++;
    const result = new Promise<DeliveredArtwork>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return; settled = true;
        signal?.removeEventListener("abort", departed); shared.controller.signal.removeEventListener("abort", interrupted);
        shared.consumers--; operation();
        if (!shared.complete && shared.consumers === 0) { forget(shared); shared.controller.abort(new DOMException("Artwork no longer needed", "AbortError")); }
      };
      const departed = () => finish(() => reject(signal?.reason ?? new DOMException("Canceled", "AbortError")));
      const interrupted = () => finish(() => reject(shared.controller.signal.reason));
      signal?.addEventListener("abort", departed, { once: true });
      shared.controller.signal.addEventListener("abort", interrupted, { once: true });
      shared.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      if (signal?.aborted) departed(); else if (shared.controller.signal.aborted) interrupted();
    });
    pump();
    return result;
  };
}

export const deliverArtwork = createArtworkDelivery();
