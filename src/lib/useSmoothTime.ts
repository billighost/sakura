"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

/**
 * A playback clock smooth enough to drive word-level lyric highlighting.
 *
 * The audio element's `timeupdate` fires roughly four times a second. That is
 * fine for a progress bar, and visibly wrong for word sync: sung words are
 * often 200ms apart, so a highlight driven straight off `timeupdate` jumps two
 * or three words at a time and then sits still — it reads as stuttering rather
 * than as following the voice.
 *
 * So between updates the time is *extrapolated* from the wall clock, and each
 * real `timeupdate` re-anchors it. The audio element stays the source of truth;
 * this only fills the gaps it leaves.
 *
 * Two details that matter:
 *   - It never runs while paused. A frame loop that ticks a frozen number is
 *     pure battery cost, and on a phone that's the difference between the
 *     lyrics view being cheap and it being the reason the screen gets warm.
 *   - Extrapolation is clamped. If a `timeupdate` is late — a stalled buffer,
 *     a backgrounded tab — an unbounded estimate runs ahead of the audio and
 *     the highlight ends up lighting words before they're sung, which is worse
 *     than being slightly behind.
 */

/** Never extrapolate further than this past the last real update, in seconds. */
const MAX_DRIFT = 0.5;

export function useSmoothTime(progress: number, isPlaying: boolean): number {
  /*
   * The interpolated value is state because the caller renders from it; the
   * anchor is a ref because it's written from an effect and read from a frame
   * loop, neither of which should force a render on its own.
   */
  const anchor = useRef({ time: progress, at: 0 });
  const [smooth, setSmooth] = useState(progress);

  // Re-anchor on every real update.
  useEffect(() => {
    anchor.current = { time: progress, at: performance.now() };
  }, [progress]);

  useEffect(() => {
    // Paused: the anchor is exact and nothing needs interpolating. Reduced
    // motion also opts out — the frame loop exists purely to make movement
    // look continuous, which is the thing that setting asks us not to do.
    if (!isPlaying || prefersReducedMotion()) return;

    let raf = 0;
    const tick = () => {
      const { time, at } = anchor.current;
      const elapsed = (performance.now() - at) / 1000;
      const next = time + Math.min(elapsed, MAX_DRIFT);
      /*
       * Monotonic within a track. Anchoring happens in an effect, so for one
       * frame after each `timeupdate` this loop can still be reading the
       * previous anchor — and a raw assignment there would step the clock
       * backward four times a second, which is the stutter this hook exists to
       * remove. Taking the max absorbs that gap. A real seek moves the value
       * backward legitimately, so `progress` is compared too: when the audio
       * jumps back, the clamp yields rather than pinning the highlight to the
       * pre-seek position.
       */
      setSmooth((prev) => (next < prev && prev - next < MAX_DRIFT ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  /*
   * While paused the anchor is exact, so the raw value is used directly — the
   * interpolated one would be whatever the last frame happened to compute
   * before the loop stopped, which can sit a fraction ahead of the audio.
   */
  return isPlaying ? smooth : progress;
}
