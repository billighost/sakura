export interface AudioInputMetadata {
  durationSeconds: number;
  numberOfChannels: number;
  sampleRate: number;
  codec: string | null;
  canDecode: boolean;
  /** Native media metadata exposes duration, but not PCM geometry. Such
   * previews budget stereo at the decode context rate and validate the actual
   * decoded dimensions before allocating an excerpt. */
  estimatedDimensions?: boolean;
}

/** Container inspection does not allocate decoded PCM. Import the demuxer only
 * for an explicitly selected file and dispose it on completion or cancellation.
 * A native metadata probe preserves supported formats and first offline use
 * when this optional lazy chunk is unavailable. It never starts playback. */
export async function inspectAudioInput(bytes: ArrayBuffer, signal: AbortSignal): Promise<AudioInputMetadata> {
  signal.throwIfAborted();
  if (!bytes.byteLength || bytes.byteLength > 120 * 1024 * 1024) throw new Error("size");
  try { return await inspectContainer(bytes, signal); }
  catch (error) {
    signal.throwIfAborted();
    if (typeof Audio === "undefined") throw error;
    return inspectNativeAudioInput(bytes, signal);
  }
}

async function inspectContainer(bytes: ArrayBuffer, signal: AbortSignal): Promise<AudioInputMetadata> {
  const started = performance.now();
  let importTimer: ReturnType<typeof setTimeout> | undefined;
  let importAbort: (() => void) | undefined;
  const imported = await Promise.race([import("mediabunny"), new Promise<never>((_, reject) => {
    importAbort = () => reject(signal.reason ?? new DOMException("Canceled", "AbortError"));
    signal.addEventListener("abort", importAbort, { once: true });
    importTimer = setTimeout(() => reject(new Error("Audio metadata inspection timed out.")), 10_000);
    if (signal.aborted) importAbort();
  })]).finally(() => { clearTimeout(importTimer); if (importAbort) signal.removeEventListener("abort", importAbort); });
  const { Input, BufferSource, ALL_FORMATS } = imported;
  signal.throwIfAborted();
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const canceled = new Promise<never>((_, reject) => {
      abort = () => { input.dispose(); reject(signal.reason ?? new DOMException("Canceled", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { input.dispose(); reject(new Error("Audio metadata inspection timed out.")); }, Math.max(1, 10_000 - (performance.now() - started)));
      if (signal.aborted) abort();
    });
    const read = async () => {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error("This file has no audio track.");
      const [durationSeconds, numberOfChannels, sampleRate, codec, canDecode] = await Promise.all([
        track.computeDuration({ skipLiveWait: true }), track.getNumberOfChannels(), track.getSampleRate(), track.getCodec(), track.canDecode(),
      ]);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isSafeInteger(numberOfChannels)
        || numberOfChannels < 1 || numberOfChannels > 32 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
        throw new Error("This file has invalid audio dimensions.");
      return { durationSeconds, numberOfChannels, sampleRate, codec, canDecode };
    };
    return await Promise.race([read(), canceled]);
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); input.dispose(); }
}

export async function inspectNativeAudioInput(bytes: ArrayBuffer, signal: AbortSignal): Promise<AudioInputMetadata> {
  signal.throwIfAborted();
  if (!bytes.byteLength || bytes.byteLength > 120 * 1024 * 1024) throw new Error("size");
  const element = new Audio(), url = URL.createObjectURL(new Blob([bytes]));
  element.preload = "metadata";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let loaded: (() => void) | undefined;
  let failed: (() => void) | undefined;
  try {
    return await new Promise<AudioInputMetadata>((resolve, reject) => {
      loaded = () => {
        if (!Number.isFinite(element.duration) || element.duration <= 0) {
          reject(new Error("This file has invalid audio duration.")); return;
        }
        resolve({ durationSeconds: element.duration, numberOfChannels: 2, sampleRate: 48000,
          codec: null, canDecode: true, estimatedDimensions: true });
      };
      failed = () => reject(new Error("This browser could not read the audio metadata."));
      abort = () => reject(signal.reason ?? new DOMException("Canceled", "AbortError"));
      element.addEventListener("loadedmetadata", loaded, { once: true });
      element.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Audio metadata inspection timed out.")), 10_000);
      if (signal.aborted) abort();
      else { element.src = url; element.load(); }
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    if (loaded) element.removeEventListener("loadedmetadata", loaded);
    if (failed) element.removeEventListener("error", failed);
    try { element.pause(); element.removeAttribute("src"); element.load(); }
    finally { URL.revokeObjectURL(url); }
  }
}

/** Native decodeAudioData resamples to its context rate. Include the encoded
 * copy and multiple excerpt/render/worker buffers, not only retained PCM. */
export function previewWorkingBytes(metadata: AudioInputMetadata, contextRate: number, encodedBytes: number, excerptSeconds = 24) {
  if (!Number.isFinite(contextRate) || contextRate < 8000 || contextRate > 192000 || !Number.isSafeInteger(encodedBytes) || encodedBytes < 0)
    throw new Error("Invalid audio working-memory dimensions.");
  const channels = metadata.numberOfChannels;
  return Math.ceil(metadata.durationSeconds * contextRate) * channels * 4 + encodedBytes * 2
    + Math.ceil(Math.min(metadata.durationSeconds, excerptSeconds) * contextRate) * (channels * 4 * 3 + 8);
}

export const MAX_PREVIEW_WORKING_BYTES = 256 * 1024 * 1024;
