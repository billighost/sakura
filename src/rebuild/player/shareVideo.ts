import { botanical, renderShareCard, type ShareCardInput, type ShareVideoOptions } from "./shareRender";
import { checkExportCanceled as abort, exportCheckpoint, yieldExport } from "./exportWork";

const capabilities = new Map<ShareCardInput["layout"], Promise<string | null>>();
/** Probe each actual export size once, after video has been requested. */
export function videoExportMime(layout: ShareCardInput["layout"] = "portrait") {
  if (!globalThis.isSecureContext || typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return Promise.resolve(null);
  let pending = capabilities.get(layout);
  if (!pending) {
    pending = (async () => {
      const { getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, Quality } = await import("mediabunny");
      const quality = new Quality("high");
      const [video, audio] = await Promise.all([
        getFirstEncodableVideoCodec(["vp8", "vp9"], { width: 1080, height: layout === "square" ? 1080 : 1350, quality, frameRate: 24 }),
        getFirstEncodableAudioCodec(["opus"], { numberOfChannels: 2, sampleRate: 48000, quality }),
      ]);
      return video && audio ? `video/webm;codecs=${video},opus` : null;
    })().catch(error => { capabilities.delete(layout);throw error; });
    capabilities.set(layout, pending);
  }
  return pending;
}

async function boundedAudio(url: string, signal: AbortSignal) {
  const limit = 20 * 1024 * 1024;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The audio for this clip could not be loaded.");
  if (Number(response.headers.get("Content-Length")) > limit) { await response.body?.cancel();throw new Error("This recording is too large for a browser clip. Save the PNG card instead."); }
  if (!response.body) throw new Error("The recording has no audio data.");
  const reader = response.body.getReader();const chunks: Uint8Array[] = [];let size = 0;
  try {
    for (;;) {
      abort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("This recording is too large for a browser clip. Save the PNG card instead.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {});reader.releaseLock(); }
  const bytes = new Uint8Array(size);let offset = 0;
  const checkpoint = exportCheckpoint(signal);
  for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength;await checkpoint(); }
  return bytes.buffer;
}

interface VideoCard { source: CanvasImageSource; dispose: () => void }
async function prepareCard(input: ShareCardInput, signal: AbortSignal, blob?: Blob): Promise<VideoCard> {
  if (!blob) {
    const result = await renderShareCard(input, signal);
    return { source: result.canvas, dispose: () => { result.canvas.width = 0;result.canvas.height = 0; } };
  }
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    if (signal.aborted) { image.close();abort(signal); }
    if (image.width !== 1080 || image.height !== (input.layout === "square" ? 1080 : 1350)) { image.close();throw new Error("The prepared card does not match this video layout."); }
    return { source: image, dispose: () => image.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();image.src = url;await image.decode();abort(signal);
    if (image.naturalWidth !== 1080 || image.naturalHeight !== (input.layout === "square" ? 1080 : 1350)) throw new Error("The prepared card does not match this video layout.");
    return { source: image, dispose: () => { image.src = ""; } };
  } finally { URL.revokeObjectURL(url); }
}

/** Exact selected audio and authored 24fps frames, with bounded work between input turns. */
export async function renderShareVideo(input: ShareCardInput, options: ShareVideoOptions) {
  abort(options.signal);
  if (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 12 || !Number.isFinite(options.startSeconds)) throw new Error("Choose a clip between one and twelve seconds.");
  if (!input.track.audioUrl) throw new Error("Let this recording load before preparing a clip.");
  const mimeType = await videoExportMime(input.layout);abort(options.signal);
  if (!mimeType) throw new Error("Video export is not supported here. Save the PNG card instead.");
  const { Output, BufferTarget, WebMOutputFormat, CanvasSource, AudioBufferSource, Quality, getFirstEncodableAudioCodec } = await import("mediabunny");
  const work = new AbortController();const canceled = () => work.abort();
  options.signal.addEventListener("abort", canceled, { once: true });
  if (options.signal.aborted) canceled();
  let card: VideoCard | undefined, canvas: HTMLCanvasElement | undefined, output: InstanceType<typeof Output> | undefined;
  const checkpoint = exportCheckpoint(work.signal);
  try {
    const [, audioBytes] = await Promise.all([
      prepareCard(input, work.signal, options.cardBlob).then(value => { card = value; }),
      boundedAudio(input.track.audioUrl, work.signal),
    ]);
    abort(work.signal);await yieldExport(work.signal);
    // Offline decoding never needs activation or interrupts the listening player.
    const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(audioBytes);abort(work.signal);
    if (options.startSeconds >= decoded.duration) throw new Error("There is no audio at this clip position. Choose an earlier moment.");
    const startFrame = Math.max(0, Math.min(Math.floor(options.startSeconds * decoded.sampleRate), decoded.length - 1));
    const frameCount = Math.min(Math.round(options.seconds * decoded.sampleRate), decoded.length - startFrame);
    if (frameCount < 1) throw new Error("There is no audio at this clip position.");
    const clip = new AudioBuffer({ numberOfChannels: decoded.numberOfChannels, length: frameCount, sampleRate: decoded.sampleRate });
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) { clip.copyToChannel(decoded.getChannelData(channel).subarray(startFrame, startFrame + frameCount), channel);await checkpoint(); }
    const quality = new Quality("high");
    const audioCodec = await getFirstEncodableAudioCodec(["opus"], { numberOfChannels: clip.numberOfChannels, sampleRate: clip.sampleRate, quality });abort(work.signal);
    if (!audioCodec) throw new Error("This browser cannot encode the recording's audio. Save the PNG card instead.");
    canvas = document.createElement("canvas");canvas.width = 1080;canvas.height = input.layout === "square" ? 1080 : 1350;
    const context = canvas.getContext("2d");if (!context) throw new Error("Video canvas is unavailable.");
    const target = new BufferTarget();
    output = new Output({ format: new WebMOutputFormat(), target });
    const activeOutput = output;
    const video = new CanvasSource(canvas, { codec: mimeType.includes("vp9") ? "vp9" : "vp8", quality });
    const audio = new AudioBufferSource({ codec: audioCodec, quality });
    output.addVideoTrack(video, { frameRate: 24 });output.addAudioTrack(audio);
    const cancelEncoding = () => { void activeOutput.cancel().catch(() => {}); };
    work.signal.addEventListener("abort", cancelEncoding, { once: true });
    try {
      abort(work.signal);await output.start();
      const duration = frameCount / decoded.sampleRate, frames = Math.ceil(duration * 24);
      let audioFrame = 0;
      for (let index = 0; index < frames; index++) {
        abort(work.signal);
        const time = index / 24;
        context.drawImage(card!.source, 0, 0);context.save();context.globalAlpha = .14;
        botanical(context, 835 + Math.sin(time / duration * Math.PI * 2) * 16, 52, 1.5, input.colorMode === "dark" ? "#e4e9df" : "#446b57");context.restore();
        await video.add(time, Math.min(1 / 24, duration - time));
        const nextAudioFrame = Math.min(frameCount, Math.round((index + 1) / 24 * clip.sampleRate));
        if (nextAudioFrame > audioFrame) {
          const chunk = new AudioBuffer({ numberOfChannels: clip.numberOfChannels, length: nextAudioFrame - audioFrame, sampleRate: clip.sampleRate });
          for (let channel = 0; channel < clip.numberOfChannels; channel++) chunk.copyToChannel(clip.getChannelData(channel).subarray(audioFrame, nextAudioFrame), channel);
          await audio.add(chunk);audioFrame = nextAudioFrame;
        }
        options.onProgress((index + 1) / frames * .95);
        await checkpoint();
      }
      video.close();audio.close();abort(work.signal);await output.finalize();abort(work.signal);
      const bytes = target.buffer;
      if (!bytes?.byteLength) throw new Error("Video export produced no frames.");
      const blob = new Blob([bytes], { type: mimeType });options.onProgress(1);
      return { blob, file: new File([blob], "sakura-lyric-card.webm", { type: mimeType }) };
    } finally { work.signal.removeEventListener("abort", cancelEncoding); }
  } catch (error) {
    work.abort();await output?.cancel().catch(() => {});abort(options.signal);throw error;
  } finally {
    work.abort();options.signal.removeEventListener("abort", canceled);
    card?.dispose();if (canvas) { canvas.width = 0;canvas.height = 0; }
  }
}
