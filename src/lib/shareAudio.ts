"use client";

/**
 * Audio analysis and preview for the video share flow.
 *
 * Two jobs, both of which sound simpler than they are:
 *
 *   1. Produce a real waveform to scrub against. Not a decorative fake — the
 *      whole point of a waveform is that you can see where the chorus is, and
 *      a seeded random pattern actively lies about that.
 *   2. Play the selected region while the handles move, because moving a trim
 *      handle in silence tells you nothing about what you picked.
 */

/** Bars in the waveform. Roughly one per 3px at typical widths. */
const WAVEFORM_BARS = 120;

export interface WaveformData {
  /** Normalised 0→1 peak per bar. */
  peaks: number[];
  duration: number;
}

/**
 * Decode the audio and downsample it to a peak-per-bar.
 *
 * `decodeAudioData` decodes the *entire* file into memory as float PCM — a
 * four-minute track is roughly 40MB at 44.1kHz stereo. That's acceptable once,
 * briefly, to compute 120 numbers; it would not be acceptable to hold. So the
 * AudioContext is closed as soon as the peaks are extracted and the decoded
 * buffer is allowed to be collected.
 *
 * Peak rather than RMS: RMS is a better loudness measure but visually flat,
 * and this waveform exists to make structure findable, not to be a meter.
 */
export async function extractWaveform(
  audioUrl: string,
  signal?: AbortSignal
): Promise<WaveformData> {
  const res = await fetch(audioUrl, { signal });
  if (!res.ok) throw new Error("Couldn't load the audio for this track.");

  const arrayBuffer = await res.arrayBuffer();

  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtor();

  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const channel = buffer.getChannelData(0);
    const blockSize = Math.floor(channel.length / WAVEFORM_BARS) || 1;

    const peaks: number[] = [];
    let max = 0;

    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channel.length);

      let peak = 0;
      // Stride rather than reading every sample: at 44.1kHz a block is ~1500
      // samples and the peak of every 8th is visually identical to the true
      // peak, at an eighth of the work.
      for (let j = start; j < end; j += 8) {
        const v = channel[j] < 0 ? -channel[j] : channel[j];
        if (v > peak) peak = v;
      }

      peaks.push(peak);
      if (peak > max) max = peak;
    }

    // Normalise against the track's own maximum, so a quietly-mastered song
    // still fills the display rather than reading as a flat line.
    const scale = max > 0 ? 1 / max : 1;
    return {
      peaks: peaks.map((p) => Math.min(1, p * scale)),
      duration: buffer.duration,
    };
  } finally {
    // Browsers cap concurrent AudioContexts (Safari at 4); leaking one per
    // opened share sheet makes the fifth throw.
    void ctx.close().catch(() => {});
  }
}

/**
 * Preview player for the trim region.
 *
 * Deliberately its own `<audio>` element rather than borrowing the app's:
 * hijacking the main player would fight PlayerContext's own state, and leave
 * playback somewhere unexpected when the share sheet closes. The caller pauses
 * the main player while this is open; this element is disposable.
 */
export class TrimPreview {
  private audio: HTMLAudioElement | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  /**
   * Play from `at` for `seconds`, replacing anything in flight.
   *
   * Called on every handle move, so it has to be cheap and interruption-safe:
   * the element is created once and re-seeked, not rebuilt per call.
   */
  play(at: number, seconds = 3): void {
    if (!this.audio) {
      this.audio = new Audio(this.src);
      this.audio.preload = "auto";
      // Never routed through Web Audio — this is monitoring, not export, and
      // an AudioContext here would compete with the one export needs.
      this.audio.crossOrigin = "anonymous";
    }

    this.clearTimer();

    const start = () => {
      if (!this.audio) return;
      this.audio.currentTime = at;
      void this.audio.play().catch(() => {
        // Autoplay policy, or the element was disposed mid-promise. Silent
        // preview is a degraded experience, not a broken one.
      });
      this.stopTimer = setTimeout(() => this.pause(), seconds * 1000);
    };

    // Seeking before metadata exists silently does nothing on Safari, so the
    // seek waits for the element to know how long the track is.
    if (this.audio.readyState >= 1) start();
    else this.audio.addEventListener("loadedmetadata", start, { once: true });
  }

  pause(): void {
    this.clearTimer();
    this.audio?.pause();
  }

  /** Release the element. Call when the share sheet closes. */
  dispose(): void {
    this.clearTimer();
    if (this.audio) {
      this.audio.pause();
      // Detaching the source is what actually frees the buffered audio;
      // pausing alone leaves a fully-buffered track resident.
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
  }

  private clearTimer(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }
}

/**
 * Fetch to a same-origin blob URL.
 *
 * Required for export, not an optimisation: an `<audio>` element sourced
 * cross-origin cannot be routed through Web Audio at all, and a canvas that
 * has drawn a cross-origin image produces a stream `MediaRecorder` refuses to
 * encode. Both media therefore become same-origin blobs first — slower to
 * start, but the difference between working and throwing.
 */
export async function toSameOriginUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Couldn't load the audio (${res.status}).`);
  return URL.createObjectURL(await res.blob());
}
