"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp01, rubberBand } from "./motion";
import { haptic } from "./haptics";

/**
 * The shared drag/swipe recogniser. See the vocabulary doc in `motion.ts`.
 *
 * Factored out of MiniPlayer, which had the only correct implementation in the
 * codebase, and generalised rather than flattened: callers differ enough
 * (a bar that skips tracks, a sheet that dismisses, a row that reorders) that
 * forcing one shape on them would have meant every caller working around it.
 * What's genuinely shared is the physics — axis locking, velocity against the
 * previous sample, per-direction resistance, and the commit test — so that's
 * what lives here.
 */

export type DragDirection = "up" | "down" | "left" | "right";

export interface DragState {
  /** Live offset from the gesture origin, after resistance. */
  dx: number;
  dy: number;
  /** Raw offset, before resistance. Use for hit-testing, not for transforms. */
  rawDx: number;
  rawDy: number;
  /** px/ms, measured against the previous sample. */
  vx: number;
  vy: number;
  /** Locked axis, or null before the finger has travelled far enough to tell. */
  axis: "x" | "y" | null;
  direction: DragDirection | null;
  /** 0→1 toward the commit threshold on the locked axis. The live feedback. */
  progress: number;
  /** True once releasing now would commit — distance *or* velocity. */
  armed: boolean;
  active: boolean;
  /** 0→1 while a long press is charging. */
  longPressProgress: number;
  longPressed: boolean;
}

const IDLE: DragState = {
  dx: 0,
  dy: 0,
  rawDx: 0,
  rawDy: 0,
  vx: 0,
  vy: 0,
  axis: null,
  direction: null,
  progress: 0,
  armed: false,
  active: false,
  longPressProgress: 0,
  longPressed: false,
};

export interface UseDragOptions {
  /** Which axes may lock. "both" decides from the first movement. */
  axis?: "x" | "y" | "both";
  /** Distance in px that commits on release. */
  threshold?: number;
  /** Flick speed in px/ms that commits regardless of distance. */
  velocity?: number;
  /** Travel before an axis is chosen. Below this, nothing moves and a tap is still possible. */
  lockAfter?: number;
  /**
   * How freely each direction follows the finger: 1 is 1:1, 0 is pinned.
   * Anything below 1 rubber-bands (see `rubberBand`). A bottom sheet wants
   * `{ up: 0.12 }` — it should give slightly upward but never look draggable
   * in a direction that does nothing.
   */
  resistance?: Partial<Record<DragDirection, number>>;
  /** Directions that may commit. Defaults to every direction the axis allows. */
  commitDirections?: DragDirection[];
  enabled?: boolean;
  /**
   * Descendants that own their own pointer events — controls, links, scrubbers,
   * nested scrollers. A pointerdown inside one of these never starts a drag.
   */
  blockSelector?: string;
  /** Enables long-press detection and its progress ramp. */
  longPressDelay?: number;
  onLongPress?: (point: { x: number; y: number }) => void;
  onStart?: (state: DragState) => void;
  onMove?: (state: DragState) => void;
  /** Fired on release past the threshold, before state resets. */
  onCommit?: (direction: DragDirection, state: DragState) => void;
  /** Fired on every release, committed or not. */
  onEnd?: (state: DragState) => void;
  /** No axis ever locked and no long press fired — the user tapped. */
  onTap?: (point: { x: number; y: number }) => void;
  /** Set false to run silent; on by default. */
  haptics?: boolean;
}

export interface DragBind {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

export interface UseDragResult extends DragState {
  bind: DragBind;
  /**
   * Apply to the dragged element's style. Without it the browser's own
   * scrolling wins the gesture on touch and the drag never starts: a
   * horizontal swipe needs `pan-y` so vertical scrolling still works, and a
   * two-axis drag needs `none`.
   */
  touchAction: "pan-x" | "pan-y" | "none";
  /** Force the gesture back to rest — e.g. when the underlying track changes. */
  reset: () => void;
}

export function useDrag(options: UseDragOptions = {}): UseDragResult {
  const {
    axis: axisMode = "both",
    threshold = 56,
    velocity: velocityThreshold = 0.5,
    lockAfter = 6,
    resistance,
    commitDirections,
    enabled = true,
    blockSelector,
    longPressDelay,
    haptics = true,
  } = options;

  const [state, setState] = useState<DragState>(IDLE);

  /*
   * Callbacks live in a ref so a caller can pass inline arrow functions —
   * which every caller does — without the handlers being rebuilt each render.
   * Written in an effect rather than during render; assigning a ref while
   * rendering is what react-hooks flags, and the values are never needed
   * before the first commit.
   */
  const cb = useRef(options);
  useEffect(() => {
    cb.current = options;
  });

  const g = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
    axis: null as "x" | "y" | null,
    armed: false,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressRaf: 0,
    longPressStart: 0,
    longPressed: false,
    frame: 0,
    pending: null as DragState | null,
  });

  /*
   * Pointer events fire far faster than React can usefully re-render — an
   * uncoalesced setState per move turns a smooth drag into a render storm on a
   * mid-range phone. Latest-wins into a rAF keeps at most one commit per frame.
   */
  const publish = useCallback((next: DragState) => {
    const s = g.current;
    s.pending = next;
    if (s.frame) return;
    s.frame = requestAnimationFrame(() => {
      s.frame = 0;
      const pending = s.pending;
      s.pending = null;
      if (pending) setState(pending);
    });
  }, []);

  const clearTimers = useCallback(() => {
    const s = g.current;
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
    if (s.longPressRaf) {
      cancelAnimationFrame(s.longPressRaf);
      s.longPressRaf = 0;
    }
  }, []);

  const reset = useCallback(() => {
    const s = g.current;
    s.active = false;
    s.axis = null;
    s.armed = false;
    s.longPressed = false;
    clearTimers();
    if (s.frame) {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
    }
    s.pending = null;
    setState(IDLE);
  }, [clearTimers]);

  // Nothing may outlive the component: a pending rAF or long-press timer that
  // fires after unmount sets state on a dead component and, worse, leaves a
  // half-finished gesture that never releases pointer capture.
  useEffect(() => {
    const s = g.current;
    return () => {
      if (s.longPressTimer) clearTimeout(s.longPressTimer);
      if (s.longPressRaf) cancelAnimationFrame(s.longPressRaf);
      if (s.frame) cancelAnimationFrame(s.frame);
    };
  }, []);

  const buildState = useCallback(
    (rawDx: number, rawDy: number, longPressProgress: number): DragState => {
      const s = g.current;
      const direction = directionOf(s.axis, rawDx, rawDy);

      // Resistance applies along the locked axis only; the other stays pinned
      // so a locked drag can't drift diagonally.
      const res = direction && resistance ? resistance[direction] ?? 1 : 1;
      const dx = s.axis === "x" ? rubberBand(rawDx, res) : 0;
      const dy = s.axis === "y" ? rubberBand(rawDy, res) : 0;

      const travel = s.axis === "x" ? Math.abs(rawDx) : s.axis === "y" ? Math.abs(rawDy) : 0;
      const speed = s.axis === "x" ? Math.abs(s.vx) : s.axis === "y" ? Math.abs(s.vy) : 0;
      const committable = !direction || canCommit(direction, commitDirections);

      return {
        dx,
        dy,
        rawDx,
        rawDy,
        vx: s.vx,
        vy: s.vy,
        axis: s.axis,
        direction,
        progress: committable ? clamp01(travel / threshold) : 0,
        armed: committable && (travel >= threshold || speed > velocityThreshold),
        active: s.active,
        longPressProgress,
        longPressed: s.longPressed,
      };
    },
    [resistance, commitDirections, threshold, velocityThreshold]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Secondary mouse buttons produce nonsense drags; touch has no button.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (blockSelector && (e.target as HTMLElement).closest?.(blockSelector)) return;

      const s = g.current;
      s.active = true;
      s.pointerId = e.pointerId;
      s.startX = s.lastX = e.clientX;
      s.startY = s.lastY = e.clientY;
      s.lastT = performance.now();
      s.vx = s.vy = 0;
      s.axis = null;
      s.armed = false;
      s.longPressed = false;

      // Capture on the element the handler is bound to, so the gesture keeps
      // receiving moves after the finger leaves it.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

      clearTimers();
      if (longPressDelay) {
        const startedAt = performance.now();
        s.longPressStart = startedAt;

        // The ramp is a real animation, so it's the part reduced-motion drops;
        // the press itself still fires on schedule below.
        const tick = () => {
          const cur = g.current;
          if (!cur.active || cur.axis || cur.longPressed) return;
          const p = clamp01((performance.now() - startedAt) / longPressDelay);
          publish(buildState(cur.lastX - cur.startX, cur.lastY - cur.startY, p));
          if (p < 1) cur.longPressRaf = requestAnimationFrame(tick);
        };
        s.longPressRaf = requestAnimationFrame(tick);

        s.longPressTimer = setTimeout(() => {
          const cur = g.current;
          // Only a press that stayed put counts — travel means they meant to drag.
          if (!cur.active || cur.axis) return;
          if (Math.abs(cur.lastX - cur.startX) > 10 || Math.abs(cur.lastY - cur.startY) > 10) return;

          cur.longPressed = true;
          if (haptics) haptic("impact");
          cb.current.onLongPress?.({ x: cur.lastX, y: cur.lastY });
          publish(buildState(0, 0, 1));
        }, longPressDelay);
      }

      cb.current.onStart?.(buildState(0, 0, 0));
    },
    [enabled, blockSelector, longPressDelay, haptics, clearTimers, publish, buildState]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = g.current;
      if (!s.active || s.pointerId !== e.pointerId) return;

      const rawDx = e.clientX - s.startX;
      const rawDy = e.clientY - s.startY;

      /*
       * Velocity is measured against the *previous sample*. MiniPlayer's
       * original bug was assigning `lastX = e.clientX` before computing
       * `(e.clientX - lastX) / dt`, which is always exactly zero — so
       * flick-to-skip never fired on velocity and only a slow drag past the
       * distance threshold worked. Order matters here; don't reorder these.
       */
      const now = performance.now();
      const dt = Math.max(1, now - s.lastT);
      s.vx = (e.clientX - s.lastX) / dt;
      s.vy = (e.clientY - s.lastY) / dt;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.lastT = now;

      if (Math.abs(rawDx) > 10 || Math.abs(rawDy) > 10) clearTimers();
      if (s.longPressed) return;

      if (!s.axis) {
        if (Math.abs(rawDx) < lockAfter && Math.abs(rawDy) < lockAfter) return;
        const wantsX = Math.abs(rawDx) > Math.abs(rawDy);
        if (axisMode === "both") s.axis = wantsX ? "x" : "y";
        else if (axisMode === "x" && wantsX) s.axis = "x";
        else if (axisMode === "y" && !wantsX) s.axis = "y";
        else {
          // Movement was mostly along an axis this gesture doesn't handle.
          // Give up cleanly so the scroller underneath keeps the gesture.
          s.active = false;
          publish(IDLE);
          return;
        }
        clearTimers();
      }

      const next = buildState(rawDx, rawDy, 0);

      // Tell the user the threshold has been reached *before* they let go.
      // This is the whole reason `armed` exists: the old swipe gave no signal
      // until it was over, so a swipe that didn't reach 46px read as broken.
      if (next.armed !== s.armed) {
        s.armed = next.armed;
        if (next.armed && haptics) haptic("selection");
      }

      publish(next);
      cb.current.onMove?.(next);
    },
    [axisMode, lockAfter, haptics, clearTimers, publish, buildState]
  );

  const finish = useCallback(
    (e: React.PointerEvent, cancelled: boolean) => {
      const s = g.current;
      clearTimers();
      if (!s.active || s.pointerId !== e.pointerId) return;

      s.active = false;
      const wasLongPress = s.longPressed;
      const rawDx = e.clientX - s.startX;
      const rawDy = e.clientY - s.startY;
      const final = buildState(rawDx, rawDy, 0);

      s.axis = null;
      s.armed = false;
      s.longPressed = false;

      if (!cancelled && !wasLongPress) {
        if (final.direction && final.armed) {
          if (haptics) haptic("impact");
          cb.current.onCommit?.(final.direction, final);
        } else if (!final.axis) {
          // Never locked an axis and never long-pressed: a tap.
          cb.current.onTap?.({ x: e.clientX, y: e.clientY });
        }
      }

      cb.current.onEnd?.(final);
      publish({ ...IDLE, active: false });
    },
    [clearTimers, buildState, haptics, publish]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: React.PointerEvent) => finish(e, true), [finish]);

  const touchAction = axisMode === "x" ? "pan-y" : axisMode === "y" ? "pan-x" : "none";

  return {
    ...state,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    touchAction,
    reset,
  };
}

function directionOf(
  axis: "x" | "y" | null,
  dx: number,
  dy: number
): DragDirection | null {
  if (axis === "x") return dx < 0 ? "left" : dx > 0 ? "right" : null;
  if (axis === "y") return dy < 0 ? "up" : dy > 0 ? "down" : null;
  return null;
}

function canCommit(direction: DragDirection, allowed?: DragDirection[]): boolean {
  return !allowed || allowed.includes(direction);
}
