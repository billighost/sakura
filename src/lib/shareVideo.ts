"use client";

import { drawBlossom, drawWordmark } from "./brandMark";
import { parseColor, rgb, shift, ensureFonts, DISPLAY, BODY } from "./shareCard";
import { lineIndexAt, type LyricLine } from "./lyrics";

/**
 * Video share rendering.
 *
 * ── Two encoders ────────────────────────────────────────────────────────────
 *
 * **WebCodecs (`fastEncode.ts`), preferred.** Frames are handed to a hardware
 * encoder as fast as the CPU manages, so a 30-second clip typically exports in
 * 2–6 seconds rather than 30. Used wherever the browser supports it.
 *
 * **MediaRecorder, fallback.** Captures a canvas stream in real time — a
 * 30-second clip takes 30 seconds. Kept because it works essentially
 * everywhere, and an export that is slow is better than one that is impossible.
 *
 * Note what is *not* done: playing the audio at 10× and recording, then slowing
 * the result down. MediaRecorder timestamps frames from the wall clock, so that
 * yields a genuinely 10×-fast file — chipmunk audio and all — and undoing it
 * means re-encoding with ffmpeg.wasm plus a phase vocoder to fix the pitch.
 * More work than it saves. WebCodecs is the real answer, because it decouples
 * encoding from playback entirely.
 *
 * ── Shared constraints ──────────────────────────────────────────────────────
 *
 * **Taint.** A canvas that has drawn a cross-origin image without CORS produces
 * a stream MediaRecorder refuses to encode, and a cross-origin `<audio>` can't
 * be routed through Web Audio at all. Both media are fetched to same-origin
 * blobs first (see `toSameOriginUrl`).
 *
 * **Drift.** In the MediaRecorder path every frame is timed from
 * `audio.currentTime` rather than a frame counter, because rAF is throttled on
 * blur and a busy main thread drops frames — by the end of a long clip a
 * counter-based loop can be a second out. The WebCodecs path has no drift by
 * construction: it assigns its own timestamps.
 */

import {
  detectFastEncode,
  decodeRegion,
  encodeFast,
  estimateVideoBytes,
  videoBitrateFor,
  AUDIO_BITRATE,
} from "./fastEncode";

export type CoverStyle = "bloom" | "vinyl" | "field" | "pulse" | "type" | "frame";

export const COVER_STYLES: { key: CoverStyle; label: string; hint: string }[] = [
  { key: "bloom", label: "Bloom", hint: "Artwork behind a floating card" },
  { key: "vinyl", label: "Vinyl", hint: "The record, turning" },
  { key: "field", label: "Field", hint: "Colour drifting from the artwork" },
  { key: "pulse", label: "Pulse", hint: "Moves with the music" },
  { key: "type", label: "Type", hint: "Words only, no artwork" },
  { key: "frame", label: "Frame", hint: "Artwork, full bleed" },
];

export interface VideoTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
}

export interface VideoShareOptions {
  track: VideoTrack;
  /** Same-origin blob URL. Use `toSameOriginUrl` before calling. */
  audioUrl: string;
  startTime: number;
  durationSeconds: number;
  coverStyle: CoverStyle;
  accentColor?: string | null;
  /** Present and non-empty enables lyric mode. */
  lyricLines?: LyricLine[];
  showLyrics?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const FPS = 30;
const WIDTH = 720;
const HEIGHT = 1280;

/** What an export of this length will roughly weigh, in bytes. */
export function estimateShareVideoBytes(seconds: number): number {
  return estimateVideoBytes(seconds, WIDTH, HEIGHT, FPS);
}

/** Human-readable size, for setting expectations before an export runs. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Past this, a clip is awkward to keep and several share targets refuse it
 * outright (WhatsApp caps at 16 MB, Discord's free tier at 25 MB). Not a hard
 * limit — a whole-song export is a legitimate thing to want — but worth saying
 * before the user waits for one.
 */
export const LARGE_EXPORT_BYTES = 25 * 1024 ** 2;

/* ── Codec selection ─────────────────────────────────────────────────────── */

/**
 * Best container this browser will actually encode.
 *
 * MP4/H.264 first because it's the only format every social target accepts
 * without re-encoding, and it's what Safari produces. WebM variants follow for
 * Chrome and Firefox, which handle it natively but where the file may be
 * rejected by some upload flows — a tradeoff worth taking over failing.
 */
export function pickMimeType(): string | null {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  if (typeof MediaRecorder === "undefined") return null;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function isVideoShareSupported(): boolean {
  return (
    (typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined") ||
    (typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function" &&
      pickMimeType() !== null)
  );
}

/** File extension matching the chosen container. */
export function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/* ── Render ──────────────────────────────────────────────────────────────── */

export interface VideoResult {
  blob: Blob;
  extension: string;
}

/**
 * Export a clip, using the fastest encoder this browser supports.
 *
 * Returns the extension alongside the blob because the two encoders can pick
 * different containers, and the filename has to match what's actually inside.
 */
export async function renderShareVideo(options: VideoShareOptions): Promise<VideoResult> {
  const fast = await detectFastEncode();
  if (fast) {
    try {
      return await renderFast(options);
    } catch (err) {
      // A cancel is the user's choice; anything else falls back rather than
      // failing outright, since MediaRecorder may still manage it.
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      console.warn("Fast export failed, falling back to recording:", err);
    }
  }

  const blob = await renderViaRecorder(options);
  return { blob, extension: extensionFor(pickMimeType() ?? "video/webm") };
}

/**
 * WebCodecs path — encodes offline, as fast as the machine allows.
 *
 * The `pulse` style is the one complication: it reads a live `AnalyserNode`,
 * which only exists during playback. Here the spectrum is computed from the
 * decoded samples for each frame's window instead, which is the same
 * information arrived at without playing anything.
 */
async function renderFast(options: VideoShareOptions): Promise<VideoResult> {
  const {
    track,
    audioUrl,
    startTime,
    durationSeconds,
    coverStyle,
    accentColor,
    lyricLines = [],
    showLyrics = false,
    onProgress,
    signal,
  } = options;

  await ensureFonts();

  const [cover, audio] = await Promise.all([
    track.coverUrl ? loadImage(track.coverUrl) : Promise.resolve(null),
    decodeRegion(audioUrl, startTime, durationSeconds, signal),
  ]);

  const actualDuration = Math.max(1, audio.length / audio.sampleRate);
  const freqData = new Uint8Array(64);

  const scene: VideoScene = {
    // Assigned per frame by the encoder; the placeholder is never drawn to.
    ctx: null as unknown as CanvasRenderingContext2D,
    W: WIDTH,
    H: HEIGHT,
    track,
    cover,
    accent: parseColor(accentColor || "#F2789F"),
    freqData,
    lyricLines,
    showLyrics: showLyrics && lyricLines.length > 0,
    blurCache: new Map(),
  };

  const samples = audio.getChannelData(0);

  const { blob, extension } = await encodeFast({
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration: actualDuration,
    audio,
    onProgress,
    signal,
    drawFrame: (ctx, t) => {
      scene.ctx = ctx;
      if (coverStyle === "pulse") {
        fillSpectrum(freqData, samples, audio.sampleRate, t);
      }
      drawVideoFrame(scene, coverStyle, startTime + t, t, Math.min(1, t / actualDuration));
    },
  });

  return { blob, extension };
}

/**
 * Approximate a spectrum for one frame, for the offline path.
 *
 * A real FFT would be more accurate and is not worth it here: this drives a
 * decorative bar ring, and band energy from a windowed sample average is
 * visually indistinguishable at 30fps while costing a fraction as much.
 */
function fillSpectrum(
  out: Uint8Array,
  samples: Float32Array,
  sampleRate: number,
  t: number
): void {
  const windowSize = Math.floor(sampleRate / 30);
  const start = Math.min(samples.length - 1, Math.max(0, Math.floor(t * sampleRate)));
  const end = Math.min(samples.length, start + windowSize);

  const bands = out.length;
  const perBand = Math.max(1, Math.floor((end - start) / bands));

  for (let b = 0; b < bands; b++) {
    const from = start + b * perBand;
    const to = Math.min(end, from + perBand);

    let peak = 0;
    for (let i = from; i < to; i += 4) {
      const v = samples[i] < 0 ? -samples[i] : samples[i];
      if (v > peak) peak = v;
    }

    // Lower bands carry more energy in real music; weighting the curve keeps
    // the ring from looking uniformly flat.
    const weighted = peak * (1.4 - (b / bands) * 0.7);
    out[b] = Math.min(255, Math.round(weighted * 320));
  }
}

/** MediaRecorder path — real-time capture, used where WebCodecs is absent. */
async function renderViaRecorder(options: VideoShareOptions): Promise<Blob> {
  const {
    track,
    audioUrl,
    startTime,
    durationSeconds,
    coverStyle,
    accentColor,
    lyricLines = [],
    showLyrics = false,
    onProgress,
    signal,
  } = options;

  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error("This browser can't record video. Try Chrome, or save an image instead.");
  }

  await ensureFonts();

  const cleanup: Array<() => void> = [];
  const runCleanup = () => {
    for (const fn of cleanup.reverse()) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
  };

  try {
    /* ── Audio graph ──────────────────────────────────────────────────── */

    const audio = new Audio();
    audio.src = audioUrl;
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out loading the audio.")), 20000);
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Couldn't decode the audio for this track."));
      };
    });

    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtor();
    cleanup.push(() => void audioCtx.close().catch(() => {}));

    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;

    const destination = audioCtx.createMediaStreamDestination();
    source.connect(analyser);
    analyser.connect(destination);
    // Deliberately NOT connected to audioCtx.destination — exporting should
    // not blast the clip out of the speakers while it renders.

    const freqData = new Uint8Array(analyser.frequencyBinCount);

    /* ── Canvas ───────────────────────────────────────────────────────── */

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas unavailable.");

    const cover = track.coverUrl ? await loadImage(track.coverUrl) : null;
    const accent = parseColor(accentColor || "#F2789F");

    const clipEnd = Math.min(
      startTime + durationSeconds,
      Number.isFinite(audio.duration) ? audio.duration : startTime + durationSeconds
    );
    const actualDuration = Math.max(1, clipEnd - startTime);

    const scene: VideoScene = {
      ctx,
      W: WIDTH,
      H: HEIGHT,
      track,
      cover,
      accent,
      freqData,
      lyricLines,
      showLyrics: showLyrics && lyricLines.length > 0,
      blurCache: new Map(),
    };

    /* ── Recording ────────────────────────────────────────────────────── */

    const videoStream = canvas.captureStream(FPS);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    cleanup.push(() => combined.getTracks().forEach((t) => t.stop()));

    const recorder = new MediaRecorder(combined, {
      mimeType,
      // The same rate the WebCodecs path uses, derived from the frame size
      // rather than a flat 4.5 Mbps — see the note on BITS_PER_PIXEL in
      // fastEncode.ts. A recorded clip is the fallback, not a lesser product,
      // so it shouldn't be five times the size of the fast one either.
      videoBitsPerSecond: videoBitrateFor(WIDTH, HEIGHT, FPS),
      audioBitsPerSecond: AUDIO_BITRATE,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    let stopped = false;
    const stopAll = () => {
      if (stopped) return;
      stopped = true;
      audio.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => reject(new Error("Recording failed partway through."));
    });

    // Cancellation has to reach the recorder, not just the caller's await —
    // otherwise the encode keeps running in the background after the user
    // pressed cancel.
    if (signal) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const onAbort = () => stopAll();
      signal.addEventListener("abort", onAbort);
      cleanup.push(() => signal.removeEventListener("abort", onAbort));
    }

    audio.currentTime = startTime;
    await audioCtx.resume();
    await audio.play();
    // Timeslice so chunks arrive during the recording rather than as one blob
    // at the end — a long clip otherwise spikes memory at stop.
    recorder.start(250);

    let rafId = 0;
    cleanup.push(() => cancelAnimationFrame(rafId));

    const drawFrame = () => {
      /*
       * Timed from the audio element, NOT from a frame counter or
       * `performance.now()`. Those two both drift against the recorded audio
       * the moment a frame is dropped or rAF is throttled, and drift is the
       * failure mode people notice — the lyrics slide out of sync and the clip
       * looks broken. `audio.currentTime` is the same clock the recorder is
       * capturing, so a dropped frame costs one frame rather than
       * accumulating.
       */
      const elapsed = audio.currentTime - startTime;
      const progress = Math.min(1, Math.max(0, elapsed / actualDuration));

      analyser.getByteFrequencyData(freqData);
      drawVideoFrame(scene, coverStyle, audio.currentTime, elapsed, progress);

      onProgress?.(progress);

      if (progress >= 1 || audio.ended) {
        stopAll();
        return;
      }
      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);

    // Belt and braces: if rAF is throttled to nothing (backgrounded tab) the
    // loop above may never reach progress >= 1, and the recorder would run
    // until the tab closed.
    const guard = setTimeout(() => stopAll(), (actualDuration + 5) * 1000);
    cleanup.push(() => clearTimeout(guard));

    const blob = await finished;

    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (blob.size === 0) throw new Error("The export came out empty. Try a shorter clip.");

    return blob;
  } finally {
    runCleanup();
  }
}

/* ── Frame composition ───────────────────────────────────────────────────── */

interface VideoScene {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  track: VideoTrack;
  cover: HTMLImageElement | null;
  accent: [number, number, number];
  freqData: Uint8Array;
  lyricLines: LyricLine[];
  showLyrics: boolean;
  /**
   * Blurred copies of the artwork, rendered once and re-blitted every frame.
   *
   * `ctx.filter = "blur(56px)"` over a full-bleed image is the single most
   * expensive thing in a frame — it was costing more than the encoder, and doing
   * it 900 times per export is what made a clip take tens of seconds and the
   * sheet feel dead. The blur depends only on the cover, the radius and the
   * size, none of which change during an export, so it is cached here and the
   * per-frame cost drops to one drawImage.
   */
  blurCache: Map<string, HTMLCanvasElement | null>;
}

/**
 * A pre-blurred square of the artwork, sized so its soft edges stay off-frame.
 *
 * Returns null when there's no cover, so callers fall back to a flat fill.
 */
function blurredCover(
  s: VideoScene,
  size: number,
  blurPx: number,
  saturate: number
): HTMLCanvasElement | null {
  if (!s.cover) return null;

  const key = `${size}|${blurPx}|${saturate}`;
  const cached = s.blurCache.get(key);
  if (cached !== undefined) return cached;

  let result: HTMLCanvasElement | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.filter = `blur(${blurPx}px) saturate(${saturate})`;
      ctx.drawImage(s.cover, 0, 0, size, size);
      ctx.filter = "none";
      result = canvas;
    }
  } catch {
    // A browser without canvas filters draws the artwork sharp instead of
    // failing the export; the scrim on top still carries readability.
    result = null;
  }

  s.blurCache.set(key, result);
  return result;
}

function drawVideoFrame(
  s: VideoScene,
  style: CoverStyle,
  absoluteTime: number,
  elapsed: number,
  progress: number
): void {
  const { ctx, W, H } = s;

  ctx.fillStyle = "#0E0B10";
  ctx.fillRect(0, 0, W, H);

  switch (style) {
    case "vinyl":
      drawVinyl(s, elapsed);
      break;
    case "field":
      drawField(s, elapsed);
      break;
    case "pulse":
      drawPulse(s);
      break;
    case "type":
      drawTypeOnly(s);
      break;
    case "frame":
      drawFrameStyle(s);
      break;
    default:
      drawBloom(s, elapsed);
  }

  if (s.showLyrics) drawLyricOverlay(s, absoluteTime);
  else drawCredit(s);

  drawProgressRail(s, progress);
}

/* ── Cover styles ────────────────────────────────────────────────────────── */

/** Artwork blurred behind a floating card of the artwork itself. */
function drawBloom(s: VideoScene, elapsed: number): void {
  const { ctx, W, H, cover, accent } = s;

  const size = Math.max(W, H) * 1.5;
  const backdrop = blurredCover(s, size, 56, 1.5);

  if (backdrop) {
    // The blur is pre-rendered (see blurredCover); the drift is slow and the
    // square generous enough that the soft edges never enter frame.
    const drift = Math.sin(elapsed * 0.12) * 24;
    ctx.drawImage(backdrop, (W - size) / 2 + drift, (H - size) / 2);

    ctx.fillStyle = "rgba(12,9,14,0.52)";
    ctx.fillRect(0, 0, W, H);
  } else if (cover) {
    // No filter support: the artwork itself, under a heavier scrim.
    drawCover(s, 0, 0, W, H);
    ctx.fillStyle = "rgba(12,9,14,0.7)";
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = rgb(shift(accent, -0.6));
    ctx.fillRect(0, 0, W, H);
  }

  // The card, breathing very slightly so the frame is never fully static.
  const cardSize = W * 0.62;
  const bob = Math.sin(elapsed * 0.9) * 5;
  const x = (W - cardSize) / 2;
  const y = H * 0.24 + bob;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, x, y, cardSize, cardSize, 18);
  ctx.fillStyle = "#1C1620";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, cardSize, cardSize, 18);
  ctx.clip();
  drawCover(s, x, y, cardSize, cardSize);
  ctx.restore();
}

/** The record itself, turning at 33⅓ rpm. */
function drawVinyl(s: VideoScene, elapsed: number): void {
  const { ctx, W, H, cover, accent } = s;

  ctx.fillStyle = rgb(shift(accent, -0.72));
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H * 0.36;
  const radius = W * 0.36;

  // 33⅓ rpm is 0.5556 rev/s — the real speed, because a record turning at an
  // arbitrary rate is the kind of detail that reads as wrong without being
  // identifiable.
  const angle = elapsed * 0.5556 * Math.PI * 2;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#0B0910";
  ctx.fill();

  // Grooves. Flat strokes at stepped alpha rather than a radial gradient.
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let r = radius * 0.42; r < radius * 0.97; r += 6) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The label, rotating with the disc.
  ctx.rotate(angle);
  const labelRadius = radius * 0.38;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
  ctx.clip();
  if (cover) {
    ctx.drawImage(cover, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  } else {
    ctx.fillStyle = rgb(accent);
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  }
  ctx.restore();

  // Spindle hole.
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.035, 0, Math.PI * 2);
  ctx.fillStyle = "#0E0B10";
  ctx.fill();

  ctx.restore();

  // A highlight sweep across the disc, fixed while the record turns under it.
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -0.7, 0.5);
  ctx.lineTo(cx, cy);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();
}

/** Slow colour field derived from the artwork's own palette. */
function drawField(s: VideoScene, elapsed: number): void {
  const { ctx, W, H, accent } = s;

  const bands = 7;
  const bandH = H / bands;

  for (let i = 0; i < bands; i++) {
    // Each band breathes on its own phase, so the field never pulses as one
    // block — which would read as a flash rather than as drift.
    const phase = Math.sin(elapsed * 0.35 + i * 0.9) * 0.5 + 0.5;
    const amount = -0.58 + (i / (bands - 1)) * 0.42 + phase * 0.12;
    ctx.fillStyle = rgb(shift(accent, amount));
    ctx.fillRect(0, i * bandH, W, bandH + 1);
  }
}

/** Bars driven by the live analyser — genuinely audio-reactive. */
function drawPulse(s: VideoScene): void {
  const { ctx, W, H, accent, freqData, cover } = s;

  ctx.fillStyle = rgb(shift(accent, -0.78));
  ctx.fillRect(0, 0, W, H);

  const size = Math.max(W, H) * 1.3;
  const backdrop = blurredCover(s, size, 40, 1);
  if (backdrop) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.drawImage(backdrop, (W - size) / 2, (H - size) / 2);
    ctx.restore();
  } else if (cover) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    drawCover(s, 0, 0, W, H);
    ctx.restore();
  }

  const cx = W / 2;
  const cy = H * 0.38;
  const baseRadius = W * 0.2;
  const bars = 64;

  // Overall energy drives the artwork disc's scale.
  let energy = 0;
  for (let i = 0; i < freqData.length; i++) energy += freqData[i];
  energy = energy / freqData.length / 255;

  const discRadius = baseRadius * (1 + energy * 0.08);

  ctx.save();
  for (let i = 0; i < bars; i++) {
    // Log-ish sampling: low bins carry most of the energy, so a linear map
    // leaves the outer half of the ring permanently flat.
    const bin = Math.floor(Math.pow(i / bars, 1.7) * freqData.length);
    const amplitude = (freqData[bin] ?? 0) / 255;
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const inner = discRadius + 10;
    const outer = inner + amplitude * W * 0.16;

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.strokeStyle = rgb(accent, 0.35 + amplitude * 0.65);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2);
  ctx.clip();
  if (cover) {
    drawCover(s, cx - discRadius, cy - discRadius, discRadius * 2, discRadius * 2);
  } else {
    ctx.fillStyle = rgb(accent);
    ctx.fillRect(cx - discRadius, cy - discRadius, discRadius * 2, discRadius * 2);
    drawBlossom(ctx, { x: cx, y: cy, size: discRadius * 0.4, color: "#FFFFFF", opacity: 0.9 });
  }
  ctx.restore();
}

/** No artwork at all — flat ground and type. For lyric-led clips. */
function drawTypeOnly(s: VideoScene): void {
  const { ctx, W, H, accent } = s;
  ctx.fillStyle = rgb(shift(accent, -0.82));
  ctx.fillRect(0, 0, W, H);

  // A single accent rule high in the frame, so the composition has an anchor
  // when no lyric is currently showing.
  ctx.fillStyle = rgb(accent);
  ctx.fillRect(W * 0.1, H * 0.16, W * 0.14, 4);
}

/** Artwork full-bleed with a readability scrim. */
function drawFrameStyle(s: VideoScene): void {
  const { ctx, W, H, cover, accent } = s;

  if (cover) {
    drawCover(s, 0, 0, W, H);
  } else {
    ctx.fillStyle = rgb(shift(accent, -0.5));
    ctx.fillRect(0, 0, W, H);
  }

  // One colour, ramping opacity — the sanctioned scrim, needed because burned
  // -in type sits over arbitrary artwork.
  const scrim = ctx.createLinearGradient(0, H * 0.35, 0, H);
  scrim.addColorStop(0, "rgba(10,7,12,0)");
  scrim.addColorStop(1, "rgba(10,7,12,0.9)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);
}

/* ── Lyric overlay ───────────────────────────────────────────────────────── */

/**
 * Lyrics animating in sync, using the same language as the in-app view:
 * the active line is marked by type — weight, colour, scale — never by a
 * background fill, and neighbours recede rather than disappearing.
 */
function drawLyricOverlay(s: VideoScene, atTime: number): void {
  const { ctx, W, H, lyricLines, accent } = s;

  const index = lineIndexAt(lyricLines, atTime);
  if (index < 0) {
    drawCredit(s);
    return;
  }

  const active = lyricLines[index];
  const previous = lyricLines[index - 1];
  const next = lyricLines[index + 1];

  const centerY = H * 0.66;
  const maxWidth = W * 0.84;

  // Lines enter by rising into place. The offset is driven by how far into the
  // line we are, so the movement is tied to the song rather than to a timer.
  const lineAge = atTime - active.time;
  const enter = Math.min(1, lineAge / 0.42);
  const eased = 1 - Math.pow(1 - enter, 3);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Neighbours, dimmed and smaller — context without competition.
  if (previous) {
    drawLyricLine(ctx, previous.text, W / 2, centerY - H * 0.11, maxWidth, 30, "rgba(255,255,255,0.28)");
  }
  if (next) {
    drawLyricLine(ctx, next.text, W / 2, centerY + H * 0.11, maxWidth, 30, "rgba(255,255,255,0.22)");
  }

  // The active line.
  ctx.save();
  ctx.globalAlpha = eased;
  ctx.translate(0, (1 - eased) * 22);

  if (active.words?.length) {
    drawWordSweep(ctx, active, atTime, W / 2, centerY, maxWidth, accent);
  } else {
    // No word timings: the whole line lights at once. Deliberate — a sweep
    // interpolated across a line we have no word data for drifts out of step
    // with the voice within a couple of words.
    drawLyricLine(ctx, active.text, W / 2, centerY, maxWidth, 44, "#FFFFFF", true);
  }
  ctx.restore();
  ctx.restore();
}

/** One lyric line, wrapped and centred. Returns the height it occupied. */
function drawLyricLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  size: number,
  color: string,
  bold = false
): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${DISPLAY}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapToWidth(ctx, text, maxWidth, 3);
  const lineHeight = size * 1.3;
  let y = cy - ((lines.length - 1) * lineHeight) / 2;

  for (const line of lines) {
    // Shadow rather than a plate, so the artwork stays visible behind the type.
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 16;
    ctx.fillText(line, cx, y);
    y += lineHeight;
  }
  ctx.restore();
}

/**
 * Word-by-word highlight for lines that carry word timings.
 *
 * Measured and drawn per chunk rather than masked by percentage: chunks in
 * Japanese and Chinese are often a single glyph, and a percentage mask cuts
 * through the middle of a character.
 */
function drawWordSweep(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  atTime: number,
  cx: number,
  cy: number,
  maxWidth: number,
  accent: [number, number, number]
): void {
  const words = line.words!;
  const size = 44;

  ctx.save();
  ctx.font = `700 ${size}px ${DISPLAY}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Greedy wrap over chunks, keeping each chunk's timing with it.
  const rows: { text: string; time: number; end?: number }[][] = [[]];
  let rowWidth = 0;

  for (const word of words) {
    const w = ctx.measureText(word.text).width;
    if (rowWidth + w > maxWidth && rows[rows.length - 1].length) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push({ text: word.text, time: word.time, end: word.end });
    rowWidth += w;
  }

  const lineHeight = size * 1.3;
  let y = cy - ((rows.length - 1) * lineHeight) / 2;

  for (const row of rows) {
    const width = row.reduce((n, w) => n + ctx.measureText(w.text).width, 0);
    let x = cx - width / 2;

    for (const word of row) {
      const lit = atTime >= word.time;
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = 16;
      // The word being sung takes the artwork's colour, so the sweep reads as
      // part of the song rather than as a generic highlight. Words already
      // sung settle to white; words still to come stay recessed.
      ctx.fillStyle = lit
        ? atTime <= (word.end ?? word.time + 0.4)
          ? rgb(accent)
          : "#FFFFFF"
        : "rgba(255,255,255,0.42)";
      ctx.fillText(word.text, x, y);
      x += ctx.measureText(word.text).width;
    }

    y += lineHeight;
  }

  ctx.restore();
}

/* ── Chrome ──────────────────────────────────────────────────────────────── */

/** Title, artist and brand mark — shown when lyrics aren't. */
function drawCredit(s: VideoScene): void {
  const { ctx, W, H, track } = s;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;

  ctx.font = `700 44px ${DISPLAY}`;
  ctx.fillStyle = "#FFFFFF";
  const title = wrapToWidth(ctx, track.title, W * 0.8, 2);
  let y = H * 0.72;
  for (const line of title) {
    ctx.fillText(line, W / 2, y);
    y += 52;
  }

  ctx.font = `500 28px ${BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(track.artist, W / 2, y + 6);

  ctx.restore();
}

/** Elapsed rail along the bottom, plus the wordmark. */
function drawProgressRail(s: VideoScene, progress: number): void {
  const { ctx, W, H, accent } = s;

  const railW = W * 0.8;
  const x = (W - railW) / 2;
  const y = H * 0.9;

  ctx.save();
  roundRect(ctx, x, y, railW, 4, 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  roundRect(ctx, x, y, Math.max(4, railW * progress), 4, 2);
  ctx.fillStyle = rgb(accent);
  ctx.fill();
  ctx.restore();

  drawWordmark(ctx, {
    x: W / 2,
    y: H * 0.945,
    fontSize: 20,
    color: "rgba(255,255,255,0.55)",
    markColor: rgb(accent),
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function drawCover(s: VideoScene, x: number, y: number, w: number, h: number): void {
  const { ctx, cover, accent } = s;
  if (!cover) {
    ctx.fillStyle = rgb(shift(accent, -0.4));
    ctx.fillRect(x, y, w, h);
    return;
  }

  const targetRatio = w / h;
  const sourceRatio = cover.width / cover.height;
  let sx = 0;
  let sy = 0;
  let sw = cover.width;
  let sh = cover.height;

  if (sourceRatio > targetRatio) {
    sw = cover.height * targetRatio;
    sx = (cover.width - sw) / 2;
  } else {
    sh = cover.width / targetRatio;
    sy = (cover.height - sh) / 2;
  }

  ctx.drawImage(cover, sx, sy, sw, sh, x, y, w, h);
}

function wrapToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";

  // No spaces (CJK): break per character or it overflows as one run.
  if (words.length <= 1 && ctx.measureText(text).width > maxWidth) {
    for (const ch of text) {
      if (ctx.measureText(current + ch).width > maxWidth && current) {
        out.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) out.push(current);
    return out.slice(0, maxLines);
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);

  return out.slice(0, maxLines);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src =
      url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")
        ? url
        : `/api/image-proxy?url=${encodeURIComponent(url)}`;
    setTimeout(() => finish(null), 8000);
  });
}
