import { createHash } from "node:crypto";
import { approvedArtworkUrl } from "./imagePolicy";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
export const ARTWORK_MAX_BYTES = 8 * 1024 * 1024;
export const ARTWORK_CACHE_SECONDS = 604800;
export class ArtworkDeliveryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export interface DeliveredArtwork { bytes: Buffer<ArrayBuffer>; type: string; etag: string }

/** Cache only validated bytes; conditional requests reuse their already computed hash. */
export function createArtworkDelivery(options: { fetch?: typeof fetch; now?: () => number; maxEntries?: number; maxBytes?: number } = {}) {
  // Resolve the framework's patched fetch at request time, after route initialization.
  const fetcher: typeof fetch = options.fetch || ((input, init) => fetch(input, init));
  const now = options.now || Date.now;
  const maximumEntries = options.maxEntries ?? 64, maximumBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const values = new Map<string, { value: DeliveredArtwork; expires: number }>();
  const flights = new Map<string, Promise<DeliveredArtwork>>();
  let retainedBytes = 0;
  const remove = (key: string) => { const item = values.get(key); if (item) retainedBytes -= item.value.bytes.length; values.delete(key); };
  return async (raw: string): Promise<DeliveredArtwork> => {
    let url = approvedArtworkUrl(raw); url.hash = "";
    const key = url.toString(), hit = values.get(key);
    if (hit && hit.expires > now()) { values.delete(key); values.set(key, hit); return hit.value; }
    remove(key);
    let pending = flights.get(key);
    if (!pending) {
      pending = (async () => {
        const signal = AbortSignal.timeout(8000);
        let response: Response | undefined;
        for (let redirects = 0; redirects < 4; redirects++) {
          response = await fetcher(url, { signal, redirect: "manual", cache: "force-cache", next: { revalidate: ARTWORK_CACHE_SECONDS }, headers: { "User-Agent": "Sakura/2.0 artwork", Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
          if (response.status < 300 || response.status > 399) break;
          const location = response.headers.get("Location");
          await response.body?.cancel();
          if (!location) throw new Error("Artwork redirect is missing");
          url = approvedArtworkUrl(new URL(location, url).toString());
        }
        if (!response?.ok || !response.body) throw new ArtworkDeliveryError("Artwork is unavailable", 404);
        const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() || "";
        if (!TYPES.has(type)) { await response.body.cancel(); throw new ArtworkDeliveryError("Artwork format is unsupported", 415); }
        if (Number(response.headers.get("Content-Length")) > ARTWORK_MAX_BYTES) { await response.body.cancel(); throw new ArtworkDeliveryError("Artwork is too large", 413); }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            length += next.value.byteLength;
            if (length > ARTWORK_MAX_BYTES) throw new ArtworkDeliveryError("Artwork is too large", 413);
            chunks.push(next.value);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        const bytes = Buffer.concat(chunks, length);
        const value = { bytes, type, etag: `"${createHash("sha256").update(bytes).digest("hex")}"` };
        if (maximumEntries > 0 && bytes.length <= maximumBytes) {
          remove(key); values.set(key, { value, expires: now() + ARTWORK_CACHE_SECONDS * 1000 }); retainedBytes += bytes.length;
          while (values.size > maximumEntries || retainedBytes > maximumBytes) remove(values.keys().next().value!);
        }
        return value;
      })().finally(() => { if (flights.get(key) === pending) flights.delete(key); });
      if (flights.size < 64) flights.set(key, pending);
    }
    return pending;
  };
}

export const deliverArtwork = createArtworkDelivery();
