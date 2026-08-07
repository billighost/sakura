"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  /** Set false to suspend the gesture (e.g. while a modal is open). */
  enabled?: boolean;
}

/**
 * Pull-to-refresh, bound to a scroll container via the returned ref.
 *
 * The previous implementation declared `handlePointerDown/Move/Up` inside an
 * effect and then returned an empty cleanup without ever calling
 * `addEventListener` — the whole hook was inert, and every page using it
 * silently had no pull-to-refresh. It also read `e.currentTarget` in a handler
 * that was never bound to anything, so `scrollTop` was always read off the
 * wrong node.
 *
 * Attach with `<div ref={containerRef}>` on the element that actually scrolls.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  enabled = true,
}: PullToRefreshOptions) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Held in a ref so the listeners can stay attached across renders instead of
  // being torn down and rebuilt every time `onRefresh` is redefined inline by
  // the calling component. Assigned inside an effect — writing a ref during
  // render is what the react-hooks/refs rule catches, and it is never needed
  // on the very first render anyway.
  const onRefreshRef = useRef(onRefresh);

  const stateRef = useRef({ startY: 0, active: false, distance: 0 });

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      // Only arm the gesture when already scrolled to the very top, and only
      // for a single finger (two fingers is a pinch, not a pull).
      if (refreshing || el.scrollTop > 0 || e.touches.length !== 1) {
        stateRef.current.active = false;
        return;
      }
      stateRef.current.startY = e.touches[0].clientY;
      stateRef.current.active = true;
      stateRef.current.distance = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s.active || refreshing) return;

      const dy = e.touches[0].clientY - s.startY;

      // Scrolled back up into content, or pulling upward — hand the gesture
      // back to the scroller.
      if (dy <= 0 || el.scrollTop > 0) {
        s.active = false;
        s.distance = 0;
        setPullDistance(0);
        return;
      }

      // Rubber-band past the threshold so it never feels unbounded.
      const distance = dy > threshold ? threshold + (dy - threshold) * 0.35 : dy;
      s.distance = distance;
      setPullDistance(distance);

      // Claim the gesture so the browser doesn't also run its own overscroll.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      const s = stateRef.current;
      if (!s.active || refreshing) return;
      s.active = false;

      if (s.distance >= threshold) {
        setRefreshing(true);
        setPullDistance(threshold);
        import("@/lib/haptics").then((h) => h.vibrate(12));

        Promise.resolve(onRefreshRef.current()).finally(() => {
          setRefreshing(false);
          setPullDistance(0);
          s.distance = 0;
        });
      } else {
        setPullDistance(0);
        s.distance = 0;
      }
    };

    // `touchmove` must be non-passive — it calls preventDefault.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [threshold, refreshing, enabled]);

  const setContainer = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  return {
    /** Attach to the scrolling element: `<div ref={setContainer}>`. */
    setContainer,
    containerRef,
    pullDistance,
    refreshing,
    /** 0→1, for driving spinner rotation/opacity. */
    progress: Math.min(1, pullDistance / threshold),
  };
}
