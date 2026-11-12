import type { MusicTrack } from "../app/types";
import { SharedFlight } from "../app/sharedFlight";
import { localRead, validOfflineAudio } from "../app/offline";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_RETAINED_PCM_BYTES = 96 * 1024 * 1024;
const RETAIN_MS = 2 * 60_000;

/** A different account, file revision or active Blob must prepare its own audio. */
export function shareAudioSourceKey(track: MusicTrack, accountId?: string | null) {
  return JSON.stringify([accountId || null, track.id, track.reference.provider, track.reference.id,
    track.readyPlayback?.assetId || null, track.readyPlayback?.sha256 || null, track.audioUrl || null]);
}

async function verifiedLocalAudio(track: MusicTrack, accountId: string | null | undefined) {
  if (!accountId || !track.readyPlayback?.sha256) return null;
  const saved = await localRead(accountId, "audio:" + track.id).catch(() => undefined);
  return validOfflineAudio(saved) && saved.track.id === track.id && saved.sha256 === track.readyPlayback.sha256
    && saved.blob.size <= MAX_AUDIO_BYTES ? saved.blob : null;
}

async function audioBytes(track: MusicTrack, accountId: string | null | undefined, signal: AbortSignal, preparedBlob?: Blob) {
  const saved = preparedBlob || await verifiedLocalAudio(track, accountId);
  signal.throwIfAborted();
  if (saved) return saved.arrayBuffer();
  if (!track.audioUrl) throw new Error("Let this recording load before preparing a clip.");
  const response = await fetch(track.audioUrl, { signal });
  if (!response.ok) throw new Error("The audio for this clip could not be loaded.");
  if (Number(response.headers.get("Content-Length")) > MAX_AUDIO_BYTES) throw new Error("This recording is too large for a browser clip. Save the PNG card instead.");
  if (!response.body) throw new Error("The recording has no audio data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error("This recording is too large for a browser clip. Save the PNG card instead.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

type AudioLoader = (track: MusicTrack, accountId: string | null | undefined, signal: AbortSignal, blob?: Blob) => Promise<AudioBuffer>;
async function decodeShareAudio(track: MusicTrack, accountId: string | null | undefined, signal: AbortSignal, blob?: Blob) {
  const bytes = await audioBytes(track, accountId, signal, blob);
  signal.throwIfAborted();
  // Offline decoding never attaches to or changes the listening player's graph.
  const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);
  signal.throwIfAborted();
  return decoded;
}

/** Dialog-owned preparation: one retained recording, released on close/account change. */
export class ShareAudioPreparation {
  private flights = new SharedFlight<AudioBuffer>();
  private cached: { key: string; buffer: AudioBuffer; expires: number } | null = null;
  private version = 0;
  private currentKey = "";
  private expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(private options: { load?: AudioLoader; now?: () => number; maxBytes?: number; retainMs?: number } = {}) {}

  prepare(track: MusicTrack, accountId: string | null | undefined, signal: AbortSignal, blob?: Blob) {
    signal.throwIfAborted();
    const key = shareAudioSourceKey(track, accountId), now = this.options.now || Date.now;
    if (this.currentKey !== key) { this.currentKey = key; this.version++; this.cached = null; clearTimeout(this.expiry); }
    if (this.cached?.key === key && this.cached.expires > now()) return Promise.resolve(this.cached.buffer);
    if (this.cached?.key !== key) { this.cached = null; clearTimeout(this.expiry); }
    const version = this.version;
    return this.flights.run(key, signal, async sharedSignal => {
      const deadline = AbortSignal.any([sharedSignal, AbortSignal.timeout(30_000)]);
      const buffer = await (this.options.load || decodeShareAudio)(track, accountId, deadline, blob);
      deadline.throwIfAborted();
      const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (version === this.version && bytes <= (this.options.maxBytes ?? MAX_RETAINED_PCM_BYTES)) {
        const retainMs = this.options.retainMs ?? RETAIN_MS;
        this.cached = { key, buffer, expires: now() + retainMs };
        clearTimeout(this.expiry);
        this.expiry = setTimeout(() => { this.cached = null; }, retainMs);
      }
      return buffer;
    });
  }

  /** Warm only device-local files, so choosing Video cannot compete with streaming. */
  async warm(track: MusicTrack, accountId: string | null | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    if (track.audioUrl?.startsWith("blob:")) return this.prepare(track, accountId, signal);
    const blob = await verifiedLocalAudio(track, accountId);
    signal.throwIfAborted();
    return blob ? this.prepare(track, accountId, signal, blob) : null;
  }

  clear() {
    this.version++;
    this.currentKey = "";
    this.cached = null;
    clearTimeout(this.expiry);
    this.flights.clear();
  }
}
