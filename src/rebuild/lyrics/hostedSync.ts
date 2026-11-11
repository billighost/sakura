import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TimedLyric } from "./parse";
import { canAutoSync, type AutoSyncEvidence } from "./autoSync";
import { alignWhisperLyrics, WHISPER_SYNC_ENGINE, type RecognizedWord } from "./whisperSync";

export class HostedSyncError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}
export interface VerifiedSyncAudio {
  recordingId: string; audioUrl: string; audioSha256: string; sizeBytes: number; durationSeconds: number;
}
interface SyncToken extends VerifiedSyncAudio {
  v: 1; accountId: string; eventId: string; expiresAt: number; lines: TimedLyric[];
}
type CompleteSync = { status: "complete"; lines: TimedLyric[]; evidence: AutoSyncEvidence };
const contentKey = (lines: readonly Pick<TimedLyric, "text">[]) => createHash("sha256").update(JSON.stringify(lines.map(line => line.text))).digest("hex");
export function verifiedSyncAudio(audio: VerifiedSyncAudio) {
  let url: URL;
  try { url = new URL(audio.audioUrl); } catch { throw new HostedSyncError("Verified full audio is required for auto sync.", 409); }
  if (!/^[a-f0-9-]{36}$/i.test(audio.recordingId) || !/^[a-f0-9]{64}$/.test(audio.audioSha256)
    || !Number.isSafeInteger(audio.sizeBytes) || audio.sizeBytes <= 0 || audio.sizeBytes > 30 * 1024 * 1024
    || !Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0 || audio.durationSeconds > 600
    || url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.port && url.port !== "443"
    || url.username || url.password || url.search || url.hash
    || !new RegExp(`/sakura/v2/audio/${audio.recordingId}/${audio.audioSha256}\\.(mp3|m4a|wav|flac|ogg|opus)$`).test(url.pathname))
    throw new HostedSyncError("This recording has no supported verified full audio for auto sync.", 409);
  return audio;
}

/** Stateless account-bound jobs survive serverless restarts. Only the server
 * signs CDN identities; the worker cannot be asked to acquire or upload audio. */
export function createHostedSync(options: { url: string; secret: string; fetch?: typeof fetch; now?: () => number }) {
  const fetcher = options.fetch || fetch, now = options.now || Date.now;
  let base: URL;
  try { base = new URL(options.url); } catch { throw new HostedSyncError("Auto sync needs the free hosted worker to be connected first."); }
  if (base.protocol !== "https:" || !base.hostname.endsWith(".hf.space") || base.username || base.password || base.search || base.hash || options.secret.length < 32)
    throw new HostedSyncError("Auto sync needs the free hosted worker to be connected first.");
  const root = base.origin, secret = options.secret;
  const hmac = (scope: string, value: string) => createHmac("sha256", secret).update(scope + value).digest("hex");
  function seal(job: SyncToken) {
    const encoded = Buffer.from(JSON.stringify(job)).toString("base64url");
    return encoded + "." + hmac("sakura-lyrics-token-v1:", encoded);
  }
  function open(token: unknown, accountId: string): SyncToken {
    if (typeof token !== "string" || token.length > 70_000) throw new HostedSyncError("Invalid auto-sync job.", 400);
    const [encoded, signature, extra] = token.split(".");
    const expected = hmac("sakura-lyrics-token-v1:", encoded || "");
    if (extra || !/^[a-f0-9]{64}$/.test(signature || "") || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")))
      throw new HostedSyncError("Invalid auto-sync job.", 400);
    let job: SyncToken;
    try { job = JSON.parse(Buffer.from(encoded, "base64url").toString()); } catch { throw new HostedSyncError("Invalid auto-sync job.", 400); }
    if (job.v !== 1 || job.accountId !== accountId) throw new HostedSyncError("This auto-sync job belongs to another account.", 403);
    if (job.expiresAt <= now() || job.expiresAt > now() + 15 * 60_000) throw new HostedSyncError("The auto-sync job expired. Try again.", 410);
    verifiedSyncAudio(job);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(job.eventId) || !Array.isArray(job.lines) || !canAutoSync(job.lines)) throw new HostedSyncError("Invalid auto-sync job.", 400);
    return job;
  }
  async function start(accountId: string, input: VerifiedSyncAudio, lines: TimedLyric[], signal?: AbortSignal) {
    const audio = verifiedSyncAudio(input);
    if (!canAutoSync(lines)) throw new HostedSyncError("Auto sync currently supports English lyrics up to ten minutes.", 422);
    const raw = JSON.stringify({ v: 1, ...audio, nonce: randomBytes(24).toString("base64url"), expiresAt: now() + 300_000 });
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    const response = await fetcher(root + "/gradio_api/call/transcribe", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [raw, signature] }),
    });
    if (!response.ok) throw new HostedSyncError("The free sync worker is asleep, busy or out of its daily quota. Try again later.");
    const body = await response.json() as { event_id?: string };
    if (!body.event_id || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.event_id)) throw new HostedSyncError("The sync worker returned no job identity.");
    return { status: "pending" as const, jobToken: seal({ v: 1, ...audio, accountId, lines, eventId: body.event_id, expiresAt: now() + 15 * 60_000 }) };
  }
  async function poll(accountId: string, token: unknown, signal?: AbortSignal): Promise<CompleteSync | { status: "pending" }> {
    const job = open(token, accountId), timer = AbortSignal.timeout(52_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetcher(root + "/gradio_api/call/transcribe/" + job.eventId, { cache: "no-store", redirect: "error", signal: AbortSignal.any([timer, ...(signal ? [signal] : [])]) });
      if (!response.ok || !response.body) throw new HostedSyncError("The free sync worker could not resume this job. Try again later.");
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = "", total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { status: "pending" };
        total += value.byteLength;
        if (total > 1_000_000) throw new HostedSyncError("The sync worker returned too much data.");
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = frame.match(/^event: ?(.+)$/m)?.[1];
          if (event === "error") throw new HostedSyncError("The sync worker could not analyze this recording. Your original lyrics have been kept.");
          if (event !== "complete") continue;
          let data: unknown;
          try { data = JSON.parse(frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")); } catch { throw new HostedSyncError("The sync worker returned an invalid result."); }
          const result = (Array.isArray(data) ? data[0] : null) as { recordingId?: string; audioSha256?: string; durationSeconds?: number; engine?: string; words?: RecognizedWord[]; elapsedMs?: number } | null;
          if (!result || result.recordingId !== job.recordingId || result.audioSha256 !== job.audioSha256 || result.engine !== WHISPER_SYNC_ENGINE
            || typeof result.durationSeconds !== "number" || Math.abs(result.durationSeconds - job.durationSeconds) > 1 || !Array.isArray(result.words)
            || !result.words.every(word => word && typeof word.text === "string" && word.text.length <= 300)
            || typeof result.elapsedMs !== "number" || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0)
            throw new HostedSyncError("The sync result did not match this verified recording.");
          const aligned = alignWhisperLyrics(job.lines, result.words, result.durationSeconds);
          return { status: "complete", lines: aligned.lines, evidence: { engine: aligned.engine, confidence: aligned.confidence, audioSha256: job.audioSha256, elapsedMs: result.elapsedMs, sourceContentKey: contentKey(job.lines) } };
        }
      }
    } catch (error) {
      if (timer.aborted && !signal?.aborted) return { status: "pending" };
      throw error;
    } finally { await reader?.cancel().catch(() => undefined); }
  }
  return { start, poll };
}
