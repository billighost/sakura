"use client";

import { useDrag, type DragBind } from "./useDrag";

/**
 * Long-press with a progress ramp, for a hold indicator.
 *
 * A preset over `useDrag` rather than a second recogniser, so the two can never
 * disagree about what counts as "the finger moved" — a component that has both
 * (the mini player: long-press for the menu, swipe to skip) uses one pointer
 * stream, and a component that only needs the hold doesn't pay for a separate
 * implementation that will drift from this one.
 *
 * `progress` runs 0→1 over the delay and is driven by rAF, so a ring or fill
 * can track it directly. It stops at 0 under prefers-reduced-motion — the press
 * still fires on schedule, it just doesn't animate toward it.
 */

export interface UseLongPressOptions {
  onLongPress: (point: { x: number; y: number }) => void;
  /** Hold duration. 450ms is the app's standard — long enough not to fire on a slow tap. */
  delay?: number;
  onTap?: (point: { x: number; y: number }) => void;
  disabled?: boolean;
  /** Descendants that own their own pointer events. */
  blockSelector?: string;
}

export interface UseLongPressResult {
  bind: DragBind;
  /** 0→1 while charging. */
  progress: number;
  /** The press has fired and the finger is still down. */
  fired: boolean;
}

export function useLongPress({
  onLongPress,
  delay = 450,
  onTap,
  disabled = false,
  blockSelector,
}: UseLongPressOptions): UseLongPressResult {
  const drag = useDrag({
    // No axis commits anything: this is a press, and any real travel should
    // cancel it rather than turn into a drag the caller never asked for.
    axis: "both",
    commitDirections: [],
    enabled: !disabled,
    blockSelector,
    longPressDelay: delay,
    onLongPress,
    onTap,
  });

  return {
    bind: drag.bind,
    progress: drag.longPressProgress,
    fired: drag.longPressed,
  };
}
