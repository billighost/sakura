"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp01, prefersReducedMotion, rubberBand } from "./motion";
import { haptic } from "./haptics";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  /** Set false to suspend the gesture (e.g. while a sheet is open). */
  enabled?: boolean;
}

export interface PullToRefreshState {
  /** Attach to the element that actually scrolls: `<div ref={setContainer}>`. */
  setContainer: (node: HTMLElement | null) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Rubber-banded travel in px. Drive a transform from this. */
  pullDistance: number;
  refreshing: boolean;
  /** 0→1 toward the threshold. */
  progress: number;
  /** Past the threshold: releasing now refreshes. */
  armed: boolean;
}

/**
 * Pull-to-refresh, bound to a scroll container via the returned ref.
 *
 * This keeps touch listeners of its own rather than using `useDrag`, and that's
 * deliberate: claiming the gesture from the browser's native overscroll needs
 * `preventDefault` on a non-passive `touchmove`, which pointer events cannot
 * express. `touch-action` can't help either — it would have to disable
 * scrolling entirely, and this gesture only exists *because* the element
 * scrolls.
 *
 * Two earlier bugs worth not reintroducing. The original declared its handlers
 * inside an effect and never called `addEventListener`, so every page using it
 * silently had no pull-to-refresh at all. The version after that listed
 * `refreshing` in the effect's dependencies, which tore down and rebuilt the
 * listeners in the middle of the gesture that had just set it — state that the
 * handlers read now lives in a ref for that reason.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  enabled = true,
}: PullToRefreshOptions): PullToRefreshState {
  const containerRef = useRef<HTMLElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);

  // Held in refs so the listeners stay attached across renders instead of being
  // rebuilt every time the caller redefines `onRefresh` inline.
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);

  const s = useRef({ startY: 0, active: false, distance: 0, armed: false, frame: 0 });

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    // Coalesced to one state commit per frame; touchmove outruns React.
    const publish = (distance: number) => {
      s.current.distance = distance;
      if (s.current.frame) return;
      s.current.frame = requestAnimationFrame(() => {
        s.current.frame = 0;
        setPullDistance(s.current.distance);
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      // Arm only at the very top, and only for one finger — two is a pinch.
      if (refreshingRef.current || el.scrollTop > 0 || e.touches.length !== 1) {
        s.current.active = false;
        return;
      }
      s.current.startY = e.touches[0].clientY;
      s.current.active = true;
      s.current.distance = 0;
      s.current.armed = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const cur = s.current;
      if (!cur.active || refreshingRef.current) return;

      const dy = e.touches[0].clientY - cur.startY;

      // Pulling up, or the content scrolled back under the finger — hand the
      // gesture back to the scroller rather than half-owning it.
      if (dy <= 0 || el.scrollTop > 0) {
        cur.active = false;
        cur.armed = false;
        setArmed(false);
        publish(0);
        return;
      }

      /*
       * Free travel to the threshold, then rubber-band. The pull has to feel
       * like it's stretching against something: unbounded travel reads as a
       * layout bug, and a hard stop reads as a dropped touch.
       */
      const distance =
        dy > threshold ? threshold + rubberBand(dy - threshold, 0.35, 90) : dy;
      publish(distance);

      const nowArmed = distance >= threshold;
      if (nowArmed !== cur.armed) {
        cur.armed = nowArmed;
        setArmed(nowArmed);
        // Tell them it's ready before they let go, not after.
        if (nowArmed) haptic("selection");
      }

      // Claim the gesture so the browser doesn't also run its own overscroll.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      const cur = s.current;
      if (!cur.active || refreshingRef.current) return;
      cur.active = false;

      if (cur.distance >= threshold) {
        setRefreshing(true);
        refreshingRef.current = true;
        setArmed(false);
        cur.armed = false;
        publish(threshold);
        haptic("impact");

        Promise.resolve(onRefreshRef.current())
          .catch(() => {
            // A failed refresh is the caller's to report — swallowing it here
            // would be wrong, but so would leaving the spinner up forever.
            haptic("error");
          })
          .finally(() => {
            setRefreshing(false);
            refreshingRef.current = false;
            publish(0);
          });
      } else {
        setArmed(false);
        cur.armed = false;
        publish(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // Non-passive: this one calls preventDefault.
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      if (s.current.frame) cancelAnimationFrame(s.current.frame);
    };
  }, [threshold, enabled]);

  const setContainer = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  return {
    setContainer,
    containerRef,
    // Under reduced motion the indicator still appears and still reports
    // progress, it just doesn't travel with the finger.
    pullDistance: prefersReducedMotion() ? 0 : pullDistance,
    refreshing,
    progress: clamp01(pullDistance / threshold),
    armed,
  };
}
