"use client";

import { renderShareCard, type CardTrack } from "./shareCard";

/**
 * Animated video shares: a short clip of the artwork reacting to the actual
 * audio, with the current lyric line burned in.
 *
 * How it works: a canvas is animated at 30fps, `canvas.captureStream()` gives a
 * video track, a Web Audio `MediaStreamAudioDestinationNode` gives a matching
 * audio track, and `MediaRecorder` muxes the two.
 *
 * The important constraint is **taint**. A canvas that has drawn a cross-origin
 * image without CORS produces a stream that `MediaRecorder` refuses to encode,
 * and an `<audio>` element sourced cross-origin can't be routed through Web
 * Audio at all. Both media are therefore fetched to same-origin blobs first —
 * slower to start, but it's the difference between working and throwing.
 */

export interface VideoShareOptions {
  track: CardTrack;
  /** Same-origin blob URL or CORS-enabled audio URL. */
  audioUrl: string;
  /** Where in the track to start the clip, in seconds. */
  startTime: number;
  /** Clip length. Kept short — this is for social, and encoding is real work. */
  durationSeconds?: number;
  accentColor?: string | null;
  /** Lyric lines with timings, for the burned-in caption. */
  lyricLines?: { time: number; text: string }[];
  seed?: string;
  onProgress?: (fraction: number) => void;
}

const FPS = 30;
const WIDTH = 720;
const HEIGHT = 1280;

/** Picks the best container the browser will actually encode. */
function pickMimeType(): string | null {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // Safari, and best for sharing
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return null;
}

export function isVideoShareSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickMimeType() !== null
  );
}

/** Fetch to a blob URL so the resulting element is same-origin and untainted. */
async function toSameOriginUrl(url: string): Promise<string> {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load audio (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export async function renderShareVideo(
  options: VideoShareOptions
): Promise<Blob> {
  const {
    track,
    audioUrl,
    startTime,
    durationSeconds = 15,
    accentColor,
    lyricLines = [],
    seed = track.id,
    onProgress,
  } = options;

  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("Video export isn't supported on this browser.");

  const cleanup: Array<() => void> = [];

  try {
    /* ── Audio graph ──────────────────────────────────────────────────── */

    const localAudioUrl = await toSameOriginUrl(audioUrl);
    if (localAudioUrl !== audioUrl) {
      cleanup.push(() => URL.revokeObjectURL(localAudioUrl));
    }

    const audio = new Audio();
    audio.src = localAudioUrl;
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Could not decode audio for export."));
      setTimeout(() => reject(new Error("Timed out loading audio.")), 15000);
    });

    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    cleanup.push(() => void audioCtx.close().catch(() => {}));

    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;

    const destination = audioCtx.createMediaStreamDestination();
    source.connect(analyser);
    analyser.connect(destination);
    // Deliberately NOT connected to audioCtx.destination — exporting shouldn't
    // blast the clip out of the speakers while it renders.

    const freqData = new Uint8Array(analyser.frequencyBinCount);

    /* ── Canvas ───────────────────────────────────────────────────────── */

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");

    // The static card is rendered once into an offscreen canvas and blitted
    // each frame — re-rendering gradients and petals 30 times a second would
    // drop frames on a phone.
    const backdrop = document.createElement("canvas");
    await renderShareCard(backdrop, {
      track,
      accentColor,
      format: "story",
      seed,
      scale: WIDTH / 1080,
      lines: [],
    });

    const clipEnd = Math.min(
      startTime + durationSeconds,
      isFinite(audio.duration) ? audio.duration : startTime + durationSeconds
    );
    const actualDuration = Math.max(1, clipEnd - startTime);

    /* ── Recording ────────────────────────────────────────────────────── */

    const videoStream = canvas.captureStream(FPS);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 3_500_000,
      audioBitsPerSecond: 128_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => reject(new Error("Recording failed."));
    });

    audio.currentTime = startTime;
    await audioCtx.resume();
    await audio.play();
    recorder.start(200);

    let rafId = 0;
    const startedAt = performance.now();

    const drawFrame = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const progress = Math.min(1, elapsed / actualDuration);

      ctx.drawImage(backdrop, 0, 0, WIDTH, HEIGHT);
      analyser.getByteFrequencyData(freqData);

      drawReactiveBars(ctx, freqData, accentColor);
      drawCaption(ctx, lyricLines, startTime + elapsed);
      drawProgressBar(ctx, progress, accentColor);

      onProgress?.(progress);

      if (progress < 1) {
        rafId = requestAnimationFrame(drawFrame);
      } else {
        audio.pause();
        if (recorder.state !== "inactive") recorder.stop();
      }
    };

    rafId = requestAnimationFrame(drawFrame);
    cleanup.push(() => cancelAnimationFrame(rafId));

    // Belt-and-braces stop: if rAF is throttled (backgrounded tab) the loop
    // above may never reach progress >= 1.
    const guard = setTimeout(() => {
      audio.pause();
      if (recorder.state !== "inactive") recorder.stop();
    }, (actualDuration + 3) * 1000);
    cleanup.push(() => clearTimeout(guard));

    const blob = await finished;
    if (blob.size === 0) throw new Error("Export produced an empty file.");
    return blob;
  } finally {
    for (const fn of cleanup) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
  }
}

/* ── Frame elements ─────────────────────────────────────────────────────── */

function drawReactiveBars(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  accentColor?: string | null
) {
  const barCount = 48;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const centerY = h * 0.63;
  const maxBar = h * 0.1;
  const gap = (w * 0.8) / barCount;
  const barW = gap * 0.45;
  const startX = w * 0.1;

  ctx.save();
  for (let i = 0; i < barCount; i++) {
    // Log-ish sampling: low bins carry most of the energy, so a linear map
    // leaves the right-hand half of the display permanently flat.
    const bin = Math.floor(Math.pow(i / barCount, 1.6) * data.length);
    const amplitude = (data[bin] ?? 0) / 255;
    const envelope = Math.sin((i / barCount) * Math.PI);
    const bh = Math.max(4, amplitude * maxBar * envelope * 2.2);

    ctx.fillStyle = accentColor || "#F2789F";
    ctx.globalAlpha = 0.35 + amplitude * 0.6;
    const x = startX + i * gap;
    ctx.beginPath();
    ctx.roundRect(x, centerY - bh / 2, barW, bh, barW / 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  lines: { time: number; text: string }[],
  atTime: number
) {
  if (lines.length === 0) return;

  let active = "";
  for (const line of lines) {
    if (line.time <= atTime) active = line.text;
    else break;
  }
  if (!active) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const maxWidth = w * 0.82;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(w * 0.058)}px "Fraunces", ui-serif, Georgia, serif`;

  // Wrap to at most three lines.
  const words = active.split(/\s+/);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      if (current) wrapped.push(current);
      current = word;
    }
  }
  if (current) wrapped.push(current);
  const shown = wrapped.slice(0, 3);

  const lineHeight = w * 0.078;
  let y = h * 0.76 - ((shown.length - 1) * lineHeight) / 2;

  for (const line of shown) {
    // Shadow rather than a plate — keeps the artwork visible behind the text.
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }
  ctx.restore();
}

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  progress: number,
  accentColor?: string | null
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const barW = w * 0.8;
  const x = w * 0.1;
  const y = h * 0.87;
  const barH = 5;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.roundRect(x, y, barW, barH, barH / 2);
  ctx.fill();

  ctx.fillStyle = accentColor || "#F2789F";
  ctx.beginPath();
  ctx.roundRect(x, y, barW * progress, barH, barH / 2);
  ctx.fill();
  ctx.restore();
}
