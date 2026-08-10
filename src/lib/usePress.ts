"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./haptics";

/**
 * Press state for controls that need to *know* they're pressed, rather than
 * just look pressed. `.pressable` in globals.css covers the common case with
 * pure CSS and should stay the default; reach for this when the press has to
 * change what's rendered — swap a glyph, hold a row highlighted, drive a
 * custom press visual that `:active` can't express.
 *
 * What it gets right that a bare onPointerDown/onPointerUp pair does not:
 *
 *  - The finger sliding off the control cancels the press. Without this the
 *    control stays visually pressed while the user's finger is somewhere else,
 *    which reads as a frozen UI.
 *  - A scroll starting under the finger cancels it. On touch, a press that
 *    turns into a list scroll must not fire — and `pointercancel` is what the
 *    browser sends when the scroller claims the gesture, so it's the signal to
 *    trust rather than a movement threshold of our own.
 *  - Pointer capture is deliberately *not* taken, because capturing would stop
 *    the scroller from ever claiming the gesture.
 */

export interface UsePressOptions {
  onPress?: () => void;
  /** Fires a selection haptic on press-down. Off by default: most presses shouldn't buzz. */
  haptics?: boolean;
  disabled?: boolean;
  /** Travel in px that cancels the press. Matches the browser's own tap slop. */
  slop?: number;
}

export interface UsePressResult {
  pressed: boolean;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
  };
}

export function usePress({
  onPress,
  haptics = false,
  disabled = false,
  slop = 12,
}: UsePressOptions = {}): UsePressResult {
  const [pressed, setPressed] = useState(false);
  const origin = useRef({ x: 0, y: 0, id: -1 });

  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  });

  const cancel = useCallback(() => setPressed(false), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      setPressed(true);
      if (haptics) haptic("selection");
    },
    [disabled, haptics]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pressed || e.pointerId !== origin.current.id) return;
      const dx = Math.abs(e.clientX - origin.current.x);
      const dy = Math.abs(e.clientY - origin.current.y);
      if (dx > slop || dy > slop) setPressed(false);
    },
    [pressed, slop]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== origin.current.id) return;
      // Only a press that survived to release counts. `pressed` going false
      // above is the cancellation.
      const wasPressed = pressed;
      setPressed(false);
      if (wasPressed && !disabled) onPressRef.current?.();
    },
    [pressed, disabled]
  );

  return {
    pressed,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  };
}
