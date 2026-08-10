"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { resolveScroller } from "@/lib/appScroll";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Smooth scrolling for the app's main scroller.
 *
 * ── What this does and doesn't touch ────────────────────────────────────────
 *
 * Lenis intercepts wheel events and animates `scrollTop` toward a target with a
 * lerp, instead of letting the browser jump by its native step. On a trackpad
 * or mouse that turns a stepped scroll into a continuous one, which is the
 * whole point.
 *
 * **Touch stays native.** `syncTouch` is deliberately off. iOS momentum
 * scrolling is very finely tuned and every JS re-implementation of it feels
 * slightly wrong — on a mobile-first PWA that's a downgrade, not an
 * enhancement. It would also break `usePullToRefresh`, which claims the gesture
 * with its own non-passive touch listeners, and fight the pointer-driven
 * scrubber and trim handles.
 *
 * **Nested scrollers opt out** via `data-lenis-prevent`, which Lenis checks on
 * the event path. Three places need it and each for its own reason:
 *   - the lyrics list, which runs its own scroll choreography (see
 *     `useLyricsScroll`) and would fight an outside animator over `scrollTop`;
 *   - sheet bodies, which are short and already scroll-locked behind a modal;
 *   - horizontal rails, which scroll on x where this has nothing to offer.
 *
 * **Reduced motion disables it entirely.** Animating a scroll the user asked
 * to be instant is exactly what that setting exists to prevent.
 *
 * ── Why it re-binds per route ───────────────────────────────────────────────
 *
 * The scrolling element isn't always the shell: several pages declare their own
 * `overflow-y: auto` root, so `resolveScroller` decides at the point of use.
 * That means the Lenis instance has to be rebuilt when the route changes, since
 * it holds a reference to one element.
 */

export interface SmoothScrollProps {
  /** Changes on navigation, so the scroller is re-resolved per route. */
  routeKey: string;
  children?: React.ReactNode;
}

export function SmoothScroll({ routeKey }: SmoothScrollProps) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    /*
     * A frame's delay before resolving. On navigation this runs before the new
     * page has committed its DOM, so resolving immediately finds the *previous*
     * page's scroller — or the shell, on a page that declares its own.
     */
    let raf = 0;
    let frameLoop = 0;
    let lenis: Lenis | null = null;

    const start = () => {
      const wrapper = resolveScroller();
      if (!wrapper) return;

      lenis = new Lenis({
        wrapper,
        // The scrolled content is the wrapper's only child; Lenis measures this
        // to know how far it may travel.
        content: (wrapper.firstElementChild as HTMLElement) ?? wrapper,

        // Touch untouched — see the note above.
        syncTouch: false,
        smoothWheel: true,

        // 0.09 is a deliberate choice. Lenis defaults to 0.1, which on a long
        // page reads as slightly floaty; lower is tighter without losing the
        // continuity that justifies the library at all.
        lerp: 0.09,
        wheelMultiplier: 1,

        // Let the browser handle anchor jumps and programmatic scrollTo from
        // the rest of the app rather than intercepting them.
        autoRaf: false,
      });

      lenisRef.current = lenis;

      // Lenis needs driving from a frame loop. Its own `autoRaf` is off so the
      // loop can be torn down deterministically with the instance.
      const frame = (time: number) => {
        lenis?.raf(time);
        frameLoop = requestAnimationFrame(frame);
      };
      frameLoop = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(start);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(frameLoop);
      lenis?.destroy();
      lenis = null;
      lenisRef.current = null;
    };
  }, [routeKey]);

  return null;
}
