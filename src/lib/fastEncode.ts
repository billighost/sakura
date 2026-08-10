"use client";

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";

/**
 * Offline video encoding via WebCodecs.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `MediaRecorder` captures a canvas stream in *real time*: a 30-second clip
 * takes 30 seconds, because it's recording a live stream rather than encoding
 * frames. For a share flow that's the whole cost of the feature.
 *
 * The tempting shortcut — play the audio at 10× and record — does not work.
 * MediaRecorder timestamps frames from the wall clock as they arrive, so you
 * get a genuinely 10×-fast file: chipmunk audio, sped-up video. Slowing it back
 * down means re-encoding (ffmpeg.wasm, ~25MB) and de-pitching the audio with a
 * phase vocoder. More work than was saved, and worse quality.
 *
 * WebCodecs solves it properly: frames are handed to a hardware encoder as fast
 * as the CPU manages, with timestamps *we* assign. Encoding 30 seconds of video
 * typically takes 2–6 seconds, the audio is copied at its natural rate so pitch
 * is untouched, and quality is the encoder's, not a screen capture's.
 *
 * The catch is that WebCodecs produces raw encoded chunks, not a playable file
 * — hence the muxers. `mp4-muxer` and `webm-muxer` are ~150KB together and are
 * loaded dynamically, so a browser that never takes this path never pays.
 *
 * `shareVideo.ts` falls back to MediaRecorder wherever this isn't supported.
 */

export interface FastEncodeOptions {
  width: number;
  height: number;
  fps: number;
  /** Total clip length in seconds. */
  duration: number;
  /** Decoded audio for the selected region, already trimmed. */
  audio: AudioBuffer | null;
  /**
   * Draws one frame. `t` is the clip-relative time in seconds — the encoder
   * drives it, so the caller never has to think about wall-clock timing.
   */
  drawFrame: (ctx: CanvasRenderingContext2D, t: number) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface FastEncodeResult {
  blob: Blob;
  extension: "mp4" | "webm";
}

/** Codec probe results, cached — `isConfigSupported` is async and not cheap. */
let supportCache: Promise<FastEncodeSupport | null> | null = null;

interface FastEncodeSupport {
  container: "mp4" | "webm";
  videoCodec: string;
  audioCodec: string;
}

/**
 * What this browser can encode, or null if WebCodecs isn't usable.
 *
 * MP4/H.264 is preferred: it's the only format every social target accepts
 * without re-encoding. WebM/VP9 is the fallback for browsers without an H.264
 * encoder (Firefox, some Linux Chrome builds).
 */
export async function detectFastEncode(): Promise<FastEncodeSupport | null> {
  if (supportCache) return supportCache;

  supportCache = (async () => {
    if (
      typeof VideoEncoder === "undefined" ||
      typeof AudioEncoder === "undefined" ||
      typeof VideoFrame === "undefined"
    ) {
      return null;
    }

    const candidates: FastEncodeSupport[] = [
      // avc1.42002A — Baseline profile, level 4.2. Chosen over High profile
      // because every phone decodes it, and at this bitrate the difference is
      // invisible.
      { container: "mp4", videoCodec: "avc1.42002A", audioCodec: "mp4a.40.2" },
      { container: "webm", videoCodec: "vp09.00.10.08", audioCodec: "opus" },
      { container: "webm", videoCodec: "vp8", audioCodec: "opus" },
    ];

    for (const candidate of candidates) {
      try {
        const video = await VideoEncoder.isConfigSupported({
          codec: candidate.videoCodec,
          width: 720,
          height: 1280,
          bitrate: 4_500_000,
          framerate: 30,
        });
        if (!video.supported) continue;

        const audio = await AudioEncoder.isConfigSupported({
          codec: candidate.audioCodec,
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate: 128_000,
        });
        if (!audio.supported) continue;

        return candidate;
      } catch {
        // A browser that throws on probing is one we shouldn't use.
      }
    }

    return null;
  })();

  return supportCache;
}

export async function encodeFast(options: FastEncodeOptions): Promise<FastEncodeResult> {
  const { width, height, fps, duration, audio, drawFrame, onProgress, signal } = options;

  const support = await detectFastEncode();
  if (!support) throw new Error("This browser can't use fast export.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas unavailable.");

  const totalFrames = Math.max(1, Math.round(duration * fps));

  /* ── Muxer ────────────────────────────────────────────────────────────── */

  const isMp4 = support.container === "mp4";
  const target = isMp4 ? new Mp4Target() : new WebmTarget();

  const muxer = isMp4
    ? new Mp4Muxer({
        target: target as Mp4Target,
        video: { codec: "avc", width, height },
        audio: audio
          ? { codec: "aac", sampleRate: audio.sampleRate, numberOfChannels: 2 }
          : undefined,
        // Required for a file that plays before it's fully downloaded, which
        // is what a share target does when it previews the video.
        fastStart: "in-memory",
      })
    : new WebmMuxer({
        target: target as WebmTarget,
        video: { codec: support.videoCodec.startsWith("vp09") ? "V_VP9" : "V_VP8", width, height },
        audio: audio
          ? { codec: "A_OPUS", sampleRate: audio.sampleRate, numberOfChannels: 2 }
          : undefined,
      });

  /* ── Video ────────────────────────────────────────────────────────────── */

  let encodeError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
    },
  });

  videoEncoder.configure({
    codec: support.videoCodec,
    width,
    height,
    bitrate: 4_500_000,
    framerate: fps,
    // Realtime latency mode lets the encoder emit chunks without buffering a
    // long GOP, which keeps memory flat over a long clip.
    latencyMode: "realtime",
  });

  const frameDuration = 1_000_000 / fps; // microseconds

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      videoEncoder.close();
      throw new DOMException("Cancelled", "AbortError");
    }
    if (encodeError) throw encodeError;

    const t = i / fps;
    drawFrame(ctx, t);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });

    // A keyframe every two seconds. Without periodic keyframes, seeking in the
    // exported file is unusable and some targets refuse to generate a preview.
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    /*
     * Backpressure. `encode()` is synchronous but the encoder works on its own
     * thread; queueing 900 frames at once spikes memory into the hundreds of
     * megabytes and gets the tab killed on a phone. Yielding whenever the queue
     * runs deep keeps it bounded, and yields to the UI thread at the same time
     * so the progress bar actually paints.
     */
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Video is the bulk of the work, so it owns most of the progress bar.
    if (i % 5 === 0) onProgress?.((i / totalFrames) * 0.85);
  }

  await videoEncoder.flush();
  videoEncoder.close();
  if (encodeError) throw encodeError;

  /* ── Audio ────────────────────────────────────────────────────────────── */

  if (audio) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        encodeError = e instanceof Error ? e : new Error(String(e));
      },
    });

    audioEncoder.configure({
      codec: support.audioCodec,
      sampleRate: audio.sampleRate,
      numberOfChannels: 2,
      bitrate: 128_000,
    });

    /*
     * Fed in chunks rather than as one buffer: `AudioData` copies its input, so
     * a single four-minute allocation would briefly double the decoded audio in
     * memory. A second at a time keeps that flat.
     *
     * Interleaved f32 because that's what the AAC encoder wants; WebAudio hands
     * us planar per-channel arrays, hence the manual weave.
     */
    const CHUNK_SECONDS = 1;
    const sampleRate = audio.sampleRate;
    const chunkFrames = sampleRate * CHUNK_SECONDS;
    const totalAudioFrames = audio.length;

    const left = audio.getChannelData(0);
    // Mono sources: reuse the single channel for both sides rather than
    // exporting a file that only plays out of one ear.
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;

    for (let offset = 0; offset < totalAudioFrames; offset += chunkFrames) {
      if (signal?.aborted) {
        audioEncoder.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      if (encodeError) throw encodeError;

      const count = Math.min(chunkFrames, totalAudioFrames - offset);
      const interleaved = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        interleaved[i * 2] = left[offset + i];
        interleaved[i * 2 + 1] = right[offset + i];
      }

      const data = new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: count,
        numberOfChannels: 2,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: interleaved,
      });

      audioEncoder.encode(data);
      data.close();

      onProgress?.(0.85 + (offset / totalAudioFrames) * 0.14);
    }

    await audioEncoder.flush();
    audioEncoder.close();
    if (encodeError) throw encodeError;
  }

  muxer.finalize();
  onProgress?.(1);

  const buffer = (target as Mp4Target | WebmTarget).buffer;
  if (!buffer) throw new Error("Export produced no data.");

  return {
    blob: new Blob([buffer], { type: isMp4 ? "video/mp4" : "video/webm" }),
    extension: isMp4 ? "mp4" : "webm",
  };
}

/**
 * Decode just the selected region of a track into an AudioBuffer.
 *
 * The whole file has to be decoded to slice it — there's no partial decode in
 * the platform — but only the region is *kept*, so the buffer handed to the
 * encoder is the clip rather than the song.
 */
export async function decodeRegion(
  audioUrl: string,
  startTime: number,
  duration: number,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  const res = await fetch(audioUrl, { signal });
  if (!res.ok) throw new Error("Couldn't load the audio for this track.");
  const arrayBuffer = await res.arrayBuffer();

  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtor();

  try {
    const full = await ctx.decodeAudioData(arrayBuffer);

    const sampleRate = full.sampleRate;
    const startSample = Math.max(0, Math.floor(startTime * sampleRate));
    const frameCount = Math.min(
      Math.floor(duration * sampleRate),
      Math.max(0, full.length - startSample)
    );

    const channels = Math.min(2, full.numberOfChannels);
    const region = new AudioBuffer({
      length: Math.max(1, frameCount),
      numberOfChannels: channels,
      sampleRate,
    });

    for (let c = 0; c < channels; c++) {
      region.copyToChannel(
        full.getChannelData(c).subarray(startSample, startSample + frameCount),
        c
      );
    }

    return region;
  } finally {
    void ctx.close().catch(() => {});
  }
}
