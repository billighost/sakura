import type { MusicTrack } from "../app/types";
import type { TimedLyric } from "../lyrics/parse";
import { sameOriginArtworkUrl } from "./imageUrl";

export interface ShareCardInput { track: MusicTrack; lines: readonly TimedLyric[]; colorMode: "light" | "dark"; layout: "portrait" | "square" }
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Canceled", "AbortError"); }
function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const rows: string[] = [];
  const words = new Intl.Segmenter(undefined, { granularity: "word" });
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // Wrap at words, falling back to complete graphemes for an unusually long
  // word. Explicit lyric boundaries and all actual words remain intact.
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const { segment } of words.segment(paragraph)) {
      if (line && context.measureText(line + segment).width > width) { rows.push(line.trimEnd());line = ""; }
      if (context.measureText(segment).width > width) {
        for (const { segment: glyph } of graphemes.segment(segment)) { if (line && context.measureText(line + glyph).width > width) { rows.push(line.trimEnd());line = ""; }line += glyph; }
      } else line += !line ? segment.trimStart() : segment;
    }
    rows.push(line.trimEnd());
  }
  return rows;
}
function botanical(context: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string) {
  context.save();context.translate(x, y);context.scale(scale, scale);context.strokeStyle = color;context.lineWidth = 1.5;
  context.beginPath();context.moveTo(0, 120);context.bezierCurveTo(15, 74, 66, 39, 90, 0);context.stroke();
  for (let index = 0; index < 5; index++) { const a = index * 17;const direction = index % 2 ? -1 : 1;context.beginPath();context.moveTo(a, 120 - a);context.bezierCurveTo(a + direction * 34, 94 - a, a + direction * 35, 76 - a, a + direction * 13, 67 - a);context.bezierCurveTo(a + direction * 2, 88 - a, a - direction * 4, 103 - a, a, 120 - a);context.stroke(); }
  context.restore();
}
async function loadArtwork(url: string | null, signal?: AbortSignal) {
  const src = sameOriginArtworkUrl(url);
  if (!src) return null;
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("The artwork could not be loaded. Choose a lyric card or try again.");
  const blob = await response.blob();
  abort(signal);
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image();image.onload = () => resolve(image);image.onerror = () => reject(new Error("The artwork could not be decoded."));image.src = objectUrl; });
  } finally { URL.revokeObjectURL(objectUrl); }
}
export async function renderShareCard(input: ShareCardInput, signal?: AbortSignal) {
  abort(signal);
  if (document.fonts) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1080;canvas.height = input.layout === "square" ? 1080 : 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is unavailable in this browser.");
  const dark = input.colorMode === "dark";
  const background = dark ? "#17231c" : "#f5f5ec";
  const foreground = dark ? "#e4e9df" : "#273b34";
  const muted = dark ? "#a7b4a7" : "#65776b";
  const accent = dark ? "#b2c9b0" : "#446b57";
  context.fillStyle = background;context.fillRect(0, 0, canvas.width, canvas.height);
  // Deterministic sparse paper fibres render once, keeping export smooth.
  context.fillStyle = dark ? "#ffffff08" : "#233d3208";
  for (let index = 0; index < 2000; index++) context.fillRect((index * 83 + index * index * 7) % 1080, (index * 163 + index * index * 3) % canvas.height, 1, index % 3 + 1);
  context.strokeStyle = dark ? "#34483a" : "#d4ded1";context.lineWidth = 2;context.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);
  botanical(context, 847, 65, 1.35, muted);
  const displayFont = getComputedStyle(document.documentElement).getPropertyValue("--font-fraunces").trim() || "Georgia";
  context.textAlign = "left";context.fillStyle = muted;context.font = "19px Arial,sans-serif";context.fillText(input.lines.length ? "A LITTLE PIECE OF THE WORDS" : "A LITTLE GOOD SOUND", 100, 112);
  let metadataY: number;
  if (input.lines.length) {
    const text = input.lines.map((line) => line.text).join("\n");
    const maxHeight = canvas.height - 520;
    let fontSize = 53;
    let rows: string[];
    do { context.font = `italic ${fontSize}px ${displayFont},Georgia,serif`;rows = wrap(context, text, 840);if (rows.length * fontSize * 1.6 <= maxHeight) break;fontSize -= 2; } while (fontSize >= 16);
    if (rows!.length * fontSize * 1.6 > maxHeight) throw new Error("These lines are too long to fit clearly. Choose fewer lines for this card.");
    context.fillStyle = foreground;
    const textHeight = rows!.length * fontSize * 1.6;
    const top = 180 + Math.max(0, (maxHeight - textHeight) / 2);
    rows!.forEach((line, index) => context.fillText(line, 120, top + index * fontSize * 1.6));
    metadataY = canvas.height - 290;
  } else {
    const image = await loadArtwork(input.track.coverUrl, signal);
    abort(signal);
    const size = canvas.height === 1080 ? 500 : 745;
    const left = (1080 - size) / 2;
    if (image) {
      const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
      const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
      const crop = Math.min(width, height);
      context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, left, 176, size, size);
      if ("close" in image) image.close();
    } else {
      context.fillStyle = dark ? "#23372a" : "#e5eadf";context.fillRect(left, 176, size, size);botanical(context, left + size * .24, 176 + size * .22, size / 150, accent);
    }
    metadataY = 176 + size + 76;
  }
  context.fillStyle = foreground;context.font = `35px ${displayFont},Georgia,serif`;
  const titleRows = wrap(context, input.track.title, 860);
  if (titleRows.length > 2) throw new Error("This song title needs a larger card. Choose portrait format.");
  titleRows.forEach((line, index) => context.fillText(line, 100, metadataY + index * 42));
  const artistsY = metadataY + titleRows.length * 42 + 10;
  context.fillStyle = muted;context.font = "20px Arial,sans-serif";
  const artistRows = wrap(context, input.track.artists.join(", "), 860);
  if (artistRows.length > 2) throw new Error("The artist credits need more space. Choose a lyric card or portrait format.");
  artistRows.forEach((line, index) => context.fillText(line, 100, artistsY + index * 26));
  context.font = `italic 18px ${displayFont},Georgia,serif`;context.fillText(input.track.versionLabel, 100, Math.min(canvas.height - 137, artistsY + artistRows.length * 26 + 13), 860);
  context.fillStyle = accent;context.font = `35px ${displayFont},Georgia,serif`;context.fillText("sakura", 100, canvas.height - 82);
  context.fillStyle = muted;context.font = "17px Arial,sans-serif";context.textAlign = "right";context.fillText("music, with a little soul.", 980, canvas.height - 85);
  abort(signal);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The card could not be exported.")), "image/png"));
  abort(signal);
  return { canvas, blob, file: new File([blob], `sakura-${input.lines.length ? "lyrics" : "song"}.png`, { type: "image/png" }) };
}

/** Check the actual browser encoder at our exported dimensions. */
export async function videoExportMime(layout: ShareCardInput["layout"] = "portrait") {
  if (!globalThis.isSecureContext || typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return null;
  const { getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, Quality } = await import("mediabunny");
  const quality = new Quality("high");
  const video = await getFirstEncodableVideoCodec(["vp8", "vp9"], { width: 1080, height: layout === "square" ? 1080 : 1350, quality, frameRate: 24 });
  const audio = await getFirstEncodableAudioCodec(["opus"], { numberOfChannels: 2, sampleRate: 48000, quality });
  return video && audio ? `video/webm;codecs=${video},opus` : null;
}
async function boundedAudio(url: string, signal: AbortSignal) {
  const limit = 20 * 1024 * 1024;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The audio for this clip could not be loaded.");
  if (Number(response.headers.get("Content-Length")) > limit) throw new Error("This recording is too large for a browser clip. Save the PNG card instead.");
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
  for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength; }
  return bytes.buffer;
}
/** Deterministic offline frames and the exact selected recording, with backpressure. */
export async function renderShareVideo(input: ShareCardInput, options: { seconds: number; startSeconds: number; signal: AbortSignal; onProgress: (progress: number) => void }) {
  abort(options.signal);
  if (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 12 || !Number.isFinite(options.startSeconds)) throw new Error("Choose a clip between one and twelve seconds.");
  if (!input.track.audioUrl) throw new Error("Let this recording load before preparing a clip.");
  const mimeType = await videoExportMime(input.layout);
  abort(options.signal);
  if (!mimeType) throw new Error("Video export is not supported here. Save the PNG card instead.");
  const { Output, BufferTarget, WebMOutputFormat, CanvasSource, AudioBufferSource, Quality, getFirstEncodableAudioCodec } = await import("mediabunny");
  const card = await renderShareCard(input, options.signal);
  const audioBytes = await boundedAudio(input.track.audioUrl, options.signal);
  // Decoding is offline: it needs no playback activation and never interrupts the player.
  const decoder = new OfflineAudioContext(2, 1, 48000);
  const decoded = await decoder.decodeAudioData(audioBytes);
  abort(options.signal);
  if (options.startSeconds >= decoded.duration) throw new Error("There is no audio at this clip position. Choose an earlier moment.");
  const startFrame = Math.max(0, Math.min(Math.floor(options.startSeconds * decoded.sampleRate), decoded.length - 1));
  const frameCount = Math.min(Math.round(options.seconds * decoded.sampleRate), decoded.length - startFrame);
  if (frameCount < 1) throw new Error("There is no audio at this clip position.");
  const clip = new AudioBuffer({ numberOfChannels: decoded.numberOfChannels, length: frameCount, sampleRate: decoded.sampleRate });
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) clip.copyToChannel(decoded.getChannelData(channel).subarray(startFrame, startFrame + frameCount), channel);
  const quality = new Quality("high");
  const audioCodec = await getFirstEncodableAudioCodec(["opus"], { numberOfChannels: clip.numberOfChannels, sampleRate: clip.sampleRate, quality });
  if (!audioCodec) throw new Error("This browser cannot encode the recording's audio. Save the PNG card instead.");
  const canvas = document.createElement("canvas");canvas.width = card.canvas.width;canvas.height = card.canvas.height;
  const context = canvas.getContext("2d");if (!context) throw new Error("Video canvas is unavailable.");
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: mimeType.includes("vp9") ? "vp9" : "vp8", quality });
  const audio = new AudioBufferSource({ codec: audioCodec, quality });
  output.addVideoTrack(video, { frameRate: 24 });output.addAudioTrack(audio);
  const cancel = () => { void output.cancel().catch(() => {}); };
  options.signal.addEventListener("abort", cancel, { once: true });
  try {
    abort(options.signal);await output.start();
    const duration = frameCount / decoded.sampleRate;
    const frames = Math.ceil(duration * 24);
    // Add small audio chunks alongside frames; avoid buffering an entire track
    // while the other track is awaiting its first packet.
    let audioFrame = 0;
    for (let index = 0; index < frames; index++) {
      abort(options.signal);
      const time = index / 24;
      context.drawImage(card.canvas, 0, 0);context.save();context.globalAlpha = .14;
      botanical(context, 835 + Math.sin(time / duration * Math.PI * 2) * 16, 52, 1.5, input.colorMode === "dark" ? "#e4e9df" : "#446b57");context.restore();
      await video.add(time, Math.min(1 / 24, duration - time));
      const nextAudioFrame = Math.min(frameCount, Math.round((index + 1) / 24 * clip.sampleRate));
      if (nextAudioFrame > audioFrame) {
        const chunk = new AudioBuffer({ numberOfChannels: clip.numberOfChannels, length: nextAudioFrame - audioFrame, sampleRate: clip.sampleRate });
        for (let channel = 0; channel < clip.numberOfChannels; channel++) chunk.copyToChannel(clip.getChannelData(channel).subarray(audioFrame, nextAudioFrame), channel);
        await audio.add(chunk);audioFrame = nextAudioFrame;
      }
      options.onProgress((index + 1) / frames * .95);
      // Yield even when native encoding resolves quickly so Cancel and painting work.
      if (index % 3 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    video.close();audio.close();abort(options.signal);await output.finalize();abort(options.signal);
    const bytes = output.target.buffer;
    if (!bytes?.byteLength) throw new Error("Video export produced no frames.");
    const blob = new Blob([bytes], { type: mimeType });options.onProgress(1);
    return { blob, file: new File([blob], "sakura-lyric-card.webm", { type: mimeType }) };
  } catch (error) {
    await output.cancel().catch(() => {});abort(options.signal);throw error;
  } finally { options.signal.removeEventListener("abort", cancel);canvas.width = 0;canvas.height = 0; }
}
