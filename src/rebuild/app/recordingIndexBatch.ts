import { requestJson } from "./errors";
import { musicTrack, type MusicTrack } from "./types";
import type { ResolveRecordingInput } from "../server/contracts";

const MAX_ITEMS = 50;
const MAX_BODY_BYTES = 32_768;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type BatchResponse = { recordings: Record<string, unknown>[] };
export interface RecordingBatchOptions {
  accountId: string;
  signal: AbortSignal;
  known?: (track: MusicTrack) => MusicTrack | undefined;
  request?: (path: string, init: RequestInit) => Promise<BatchResponse>;
  onIndexed?: (pairs: readonly { original: MusicTrack; canonical: MusicTrack }[]) => void | Promise<void>;
}

export function recordingIndexInput(track: MusicTrack): ResolveRecordingInput {
  return { reference: track.reference, expected: {
    title: track.title, artists: track.artists, artistsComplete: track.artistsComplete,
    version: track.version, durationMs: track.durationMs || undefined,
  } };
}

/** Exact, ordered indexing of the whole selected reservoir with bounded HTTP
 * bodies. Canonical/known tracks and identical requests do not add round trips. */
export async function indexRecordingBatch(tracks: readonly MusicTrack[], options: RecordingBatchOptions): Promise<MusicTrack[]> {
  options.signal.throwIfAborted();
  const results = new Array<MusicTrack>(tracks.length);
  const pending = new Map<string, { input: ResolveRecordingInput; positions: number[] }>();
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index], known = options.known?.(track);
    if (known || uuid.test(track.id)) { results[index] = known ?? track; continue; }
    const input = recordingIndexInput(track), key = JSON.stringify(input);
    const previous = pending.get(key);
    if (previous) previous.positions.push(index);
    else pending.set(key, { input, positions: [index] });
  }
  const request = options.request ?? ((path, init) => requestJson<BatchResponse>(path, init,
    { context: "playback", accountId: options.accountId }));
  const entries = [...pending.values()];
  const encoder = new TextEncoder();
  let at = 0;
  while (at < entries.length) {
    options.signal.throwIfAborted();
    const batch: typeof entries = [];
    let body = "";
    while (at + batch.length < entries.length && batch.length < MAX_ITEMS) {
      const next = entries[at + batch.length];
      const candidate = JSON.stringify({ items: [...batch.map(item => item.input), next.input] });
      if (encoder.encode(candidate).byteLength > MAX_BODY_BYTES) {
        if (!batch.length) throw new Error("This recording's metadata exceeds the indexing limit.");
        break;
      }
      batch.push(next); body = candidate;
    }
    const response = await request("/api/v2/recordings/index/batch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, signal: options.signal,
    });
    options.signal.throwIfAborted();
    if (!Array.isArray(response.recordings) || response.recordings.length !== batch.length)
      throw new Error("The indexed collection response is incomplete.");
    const pairs: { original: MusicTrack; canonical: MusicTrack }[] = [];
    for (let index = 0; index < batch.length; index++) {
      const recording = response.recordings[index];
      if (!recording || typeof recording.recordingId !== "string" || !uuid.test(recording.recordingId)
        || !recording.metadata || typeof recording.metadata !== "object")
        throw new Error("The indexed recording response is invalid.");
      for (const position of batch[index].positions) {
        const original = tracks[position], canonical = { ...original, ...musicTrack(recording) };
        results[position] = canonical; pairs.push({ original, canonical });
      }
    }
    await options.onIndexed?.(pairs);
    options.signal.throwIfAborted();
    at += batch.length;
  }
  return results;
}
