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
  const [smooth, setSmooth] = useState(progress);

  const anchor = useRef({ time: progress, at: 0 });

  // Re-anchor whenever the real clock reports in. Written in an effect rather
  // than during render so the anchor timestamp is taken at commit, alongside
  // the frame the value will first be used in.
  useEffect(() => {
    anchor.current = { time: progress, at: performance.now() };
    setSmooth(progress);
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
      setSmooth(time + Math.min(elapsed, MAX_DRIFT));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  return isPlaying ? smooth : progress;
}
