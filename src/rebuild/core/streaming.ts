export type ByteRange = { status: "range"; start: number; end: number } | { status: "unsatisfiable" } | { status: "ignore" };

/** HTTP single byte ranges, including suffixes. Never label a rangeless response 206. */
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Audio size must be a non-negative safe integer");
  if (!header) return { status: "ignore" };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { status: "ignore" };
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix)) return { status: "ignore" };
    if (suffix <= 0 || size === 0) return { status: "unsatisfiable" };
    return { status: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (match[2] && start > end)) return { status: "ignore" };
  if (start >= size) return { status: "unsatisfiable" };
  return { status: "range", start, end: Math.min(end, size - 1) };
}

export interface PlaybackAsset {
  recordingId: string;
  kind: "full" | "preview";
  state: "ready" | "resolving" | "unavailable";
  url?: string;
  /** Opaque storage artifact checked for completeness by the offline adapter. */
  offlineArtifactId?: string;
}
export type PlaybackPlan =
  | { kind: "offline"; artifactId: string }
  | { kind: "stream"; url: string }
  | { kind: "resolve" }
  | { kind: "unavailable"; reason: "preview-only" | "unavailable" | "invalid-url" };

export function planPlayback(asset: PlaybackAsset): PlaybackPlan {
  if (asset.kind !== "full") return { kind: "unavailable", reason: "preview-only" };
  if (asset.offlineArtifactId) return { kind: "offline", artifactId: asset.offlineArtifactId };
  if (asset.state === "resolving") return { kind: "resolve" };
  if (asset.state === "unavailable") return { kind: "unavailable", reason: "unavailable" };
  if (!asset.url || (!/^https:\/\//i.test(asset.url) && !/^\/api\/v2\/audio\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(asset.url))) return { kind: "unavailable", reason: "invalid-url" };
  return { kind: "stream", url: asset.url };
}

/**
 * A header deadline is cleared after fetch resolves. Caller cancellation stays
 * attached until the body is consumed or cancelled; it still stops byte delivery.
 */
export async function fetchAudioHeaders(
  input: string,
  options: RequestInit & { headerTimeoutMs?: number } = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const { headerTimeoutMs = 8000, signal: callerSignal, ...init } = options;
  if (!Number.isFinite(headerTimeoutMs) || headerTimeoutMs <= 0) throw new Error("Header timeout must be positive");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error("Audio headers timed out")); }, headerTimeoutMs);
  try {
    const response = await fetcher(input, { ...init, signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!response.body) {
      callerSignal?.removeEventListener("abort", abort);
      return response;
    }
    const reader = response.body.getReader();
    const cleanup = () => callerSignal?.removeEventListener("abort", abort);
    const body = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const { value, done } = await reader.read();
          if (done) { cleanup(); target.close(); }
          else target.enqueue(value);
        } catch (error) { cleanup(); target.error(error); }
      },
      async cancel(reason) { cleanup(); await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    callerSignal?.removeEventListener("abort", abort);
    if (timedOut) throw new Error("Audio headers timed out", { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
