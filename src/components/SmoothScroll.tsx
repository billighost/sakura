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
 * the event path. Several places need it and each for its own reason:
 *   - the lyrics list, which runs its own scroll choreography (see
 *     `useLyricsScroll`) and would fight an outside animator over `scrollTop`;
 *   - sheet bodies, which are short and already scroll-locked behind a modal;
 *   - horizontal rails, which scroll on x where this has nothing to offer;
 *   - the full player's body, the credits modal, onboarding's chip grids and
 *     the import track list, which are all `max-height` boxes inside a page.
 *
 * `allowNestedScroll` backs that up: it makes Lenis defer to any nested
 * scroller that still has room to move in the gesture's direction, so a panel
 * added later without the attribute degrades to native scrolling instead of
 * silently scrolling the page behind it.
 *
 * **Reduced motion disables it entirely.** Animating a scroll the user asked
 * to be instant is exactly what that setting exists to prevent.
 *
 * ── Why dimensions are read naively ────────────────────────────────────────
 *
 * `naiveDimensions` makes Lenis compute its scroll limit straight from the DOM
 * (`scrollHeight - clientHeight`) on every access, instead of caching it from a
 * debounced ResizeObserver.
 *
 * The cached path is subtly wrong for this app and produced the bug where the
 * wheel scrolled a short distance and then stopped dead while touch kept
 * working. Lenis observes only the element passed as `content`, and its wheel
 * path clamps every target against the cached limit — so if that limit is
 * measured once, early, it is wrong forever. Both halves of that went wrong
 * here: the scroller is resolved a frame after navigation, when the page is
 * still a skeleton and its scrollHeight is barely more than its height. Touch
 * was unaffected because `syncTouch` is off, which is exactly why the symptom
 * looked like a pointer-input problem rather than a measurement one.
 *
 * Reading the DOM each frame costs a layout query on an element whose layout is
 * already current, and removes the whole class of staleness rather than one
 * instance of it.
 *
 * ── Why it re-binds per route ───────────────────────────────────────────────
 *
 * The scrolling element isn't always the shell: several pages declare their own
 * `overflow-y: auto` root, so `resolveScroller` decides at the point of use.
 * That means the Lenis instance has to be rebuilt when the route changes, since
 * it holds a reference to one element.
 *
 * Route changes aren't the only time the scroller can move, though — onboarding
 * swaps its whole step subtree on React state with the URL unchanged. So the
 * frame loop also watches for the bound element leaving the document and
 * re-resolves when it does.
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
    let bound: HTMLElement | null = null;
    let disposed = false;

    const stop = () => {
      cancelAnimationFrame(frameLoop);
      frameLoop = 0;
      lenis?.destroy();
      lenis = null;
      bound = null;
      lenisRef.current = null;
    };

    const start = () => {
      if (disposed) return;

      const wrapper = resolveScroller();
      if (!wrapper) return;

      bound = wrapper;
      lenis = new Lenis({
        wrapper,
        // Deliberately the wrapper itself, not its first child: Lenis observes
        // only this element for resizes, and a header or progress bar — which is
        // what `firstElementChild` is on several pages here — never changes size
        // as the content below it loads.
        content: wrapper,

        // Touch untouched — see the note above.
        syncTouch: false,
        smoothWheel: true,

        // Read the scroll limit from the DOM rather than a debounced cache.
        // See "Why dimensions are read naively" above.
        naiveDimensions: true,

        // Let a scrollable child keep its own gesture.
        allowNestedScroll: true,

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
        /*
         * The bound element can be removed without the route changing — an
         * in-page step transition swaps its subtree out. Left alone, Lenis goes
         * on animating a detached node and the live page never scrolls, so
         * re-resolve as soon as that happens.
         */
        if (bound && !bound.isConnected) {
          stop();
          raf = requestAnimationFrame(start);
          return;
        }

        lenis?.raf(time);
        frameLoop = requestAnimationFrame(frame);
      };
      frameLoop = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(start);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      stop();
    };
  }, [routeKey]);

  return null;
}
