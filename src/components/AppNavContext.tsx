"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { prefersReducedMotion } from "@/lib/motion";
import { resolveScroller } from "@/lib/appScroll";

/**
 * App-shell navigation: page transitions, scroll restoration, and the one
 * channel the tab bar uses to scroll the active page back to the top.
 *
 * ── Why the native View Transitions API, not React's <ViewTransition> ───────
 *
 * React's component is the nicer API and the Next.js guide is written around
 * it, but it isn't available here: this project pins `react@19.2.8` (stable),
 * whose `@types/react` does not declare `ViewTransition`, so importing it fails
 * `tsc --noEmit` even where the runtime would resolve it through Next's
 * vendored copy. `document.startViewTransition` is typed in TS 5.9 and is the
 * same browser feature underneath, so that's what this uses. If React's
 * component later becomes available with types, this is the one file that has
 * to change.
 *
 * ── Holding the transition open ────────────────────────────────────────────
 *
 * `startViewTransition(cb)` wants `cb` to update the DOM synchronously, but
 * App Router navigation is asynchronous — `router.push()` returns long before
 * the new route commits. So the callback returns a promise that this module
 * resolves when the pathname actually changes.
 *
 * That means the screen is frozen on the old snapshot until the route lands,
 * which is fine at 50ms and unacceptable at 3s on a slow connection. Hence the
 * timeout below: past it the transition is released and the navigation simply
 * finishes without an animation. A missing flourish is a much smaller failure
 * than a UI that appears to have hung.
 */

/**
 * Longest the old frame may be held waiting for the new route to commit.
 *
 * This was 450ms, which is roughly four times the point where a tap stops
 * feeling connected to what it did. Anything slower than this budget is better
 * served by releasing the hold and letting the route's `loading.tsx` skeleton
 * paint — the transition then animates old frame → skeleton, which reads as
 * progress, where continuing to hold reads as a dead tap.
 *
 * With the resolver race below fixed, a prefetched route resolves this hold on
 * commit in well under the budget, so the timeout now only governs genuinely
 * slow segments.
 */
const MAX_HOLD_MS = 150;

export type NavKind = "push" | "back" | "tab";

interface AppNav {
  /** Navigate with a transition appropriate to the hierarchy of the move. */
  navigate: (href: string, kind?: NavKind) => void;
  /**
   * Go back. `fallback` is used when there's nothing to pop — a deep link, a
   * shared URL, or a PWA cold-started on this route. Without it those users
   * press Back and nothing happens at all.
   */
  back: (fallback?: string) => void;
  /** Scroll the app's active scroll container to the top. */
  scrollToTop: (smooth?: boolean) => void;
  registerScroller: (el: HTMLElement | null) => void;
  /** The app shell's container. Prefer `getScroller()` for reading scroll. */
  scrollerRef: React.RefObject<HTMLElement | null>;
  /**
   * The element that actually scrolls right now — the shell's container, or a
   * page's own if it declares one. See `lib/appScroll.ts`.
   */
  getScroller: () => HTMLElement | null;
  /**
   * Claim a history entry for a full-screen overlay, so hardware/browser Back
   * closes it instead of leaving the page.
   *
   * Call when the overlay opens; call the returned function when it closes by
   * any other means, which retires the entry so Back doesn't need pressing
   * twice. Routing this through the provider — rather than each overlay calling
   * `history.pushState` itself — is what stops those entries being mistaken for
   * route pushes by the depth counter below.
   */
  pushOverlayEntry: () => () => void;
}

const AppNavContext = createContext<AppNav | null>(null);

export function useAppNav(): AppNav {
  const ctx = useContext(AppNavContext);
  if (!ctx) throw new Error("useAppNav must be used inside <AppNavProvider>");
  return ctx;
}

function supportsViewTransitions(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !prefersReducedMotion()
  );
}

export function AppNavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLElement | null>(null);

  /**
   * How deep inside the app this session actually is.
   *
   * `history.length` is no help — it counts the whole tab's history, so it's
   * non-zero even on a cold deep link. This used to count what `navigate()`
   * pushed, which sounded right and was structurally always zero: every
   * in-app link is a plain `<Link>`, and the only caller of `navigate()` is the
   * tab bar, which *replaces*. So `back(fallback)` never popped — it replaced
   * with the fallback. Settings pressed Back and went to /profile whether or
   * not that's where you came from, and the entry you were on was destroyed, so
   * the browser's own Back then left the app.
   *
   * Counting route commits instead catches every push however it was made:
   * increment when the pathname changes under us, decrement when a pop caused
   * it, and skip the ones we know were replacements.
   */
  const entriesPushed = useRef(0);

  /** Overlay entries (full player, sheets) currently on top of the stack. */
  const overlayEntries = useRef(0);

  /** Set by popstate, cleared by the pathname effect that follows it. */
  const sawPop = useRef(false);

  /** "replace" while a replacement we initiated is in flight. */
  const navIntent = useRef<"push" | "replace" | null>(null);

  /** The first [pathname] run is the initial route, not a navigation. */
  const seenFirstPath = useRef(false);

  /**
   * Resolvers waiting for a `history.back()` we issued to actually land.
   *
   * Retiring an overlay's entry is asynchronous: `history.back()` returns
   * immediately and the pop arrives later. A navigation started in between
   * would race it — the classic symptom being a Back tap that appears to do
   * nothing because the pop landed on top of it.
   */
  const popWaiters = useRef<(() => void)[]>([]);
  const popFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolves the in-flight transition's promise once the new route commits.
  const releaseTransition = useRef<(() => void) | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Scroll offsets per path. A Map rather than sessionStorage: these are only
   * meaningful for the current session's history, and writing to storage on
   * every navigation is a synchronous main-thread cost for no benefit.
   */
  const scrollPositions = useRef(new Map<string, number>());

  const finishTransition = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    releaseTransition.current?.();
    releaseTransition.current = null;
  }, []);

  const getScroller = useCallback(
    () => resolveScroller(scrollerRef.current),
    []
  );

  /* ── History bookkeeping ────────────────────────────────────────────────── */

  const flushPopWaiters = useCallback(() => {
    if (popFallbackTimer.current) {
      clearTimeout(popFallbackTimer.current);
      popFallbackTimer.current = null;
    }
    const waiters = popWaiters.current;
    popWaiters.current = [];
    for (const resolve of waiters) resolve();
  }, []);

  /**
   * Mark a `history.back()` as in flight, so navigations queue behind it.
   *
   * The timer is the safety net: a pop that never arrives — the entry was
   * already gone, the browser declined — must not leave every later navigation
   * queued forever behind a resolver nobody will call.
   */
  const expectPop = useCallback(() => {
    popWaiters.current.push(() => {});
    if (popFallbackTimer.current) clearTimeout(popFallbackTimer.current);
    popFallbackTimer.current = setTimeout(() => {
      popFallbackTimer.current = null;
      flushPopWaiters();
    }, 250);
  }, [flushPopWaiters]);

  useEffect(() => {
    const onPop = () => {
      /*
       * An overlay's entry is always the top of the stack while it's open — the
       * player covers the screen, so no route push can land above it. So a pop
       * with overlays outstanding retired one of theirs, not a route, and the
       * route depth must not move.
       */
      if (overlayEntries.current > 0) {
        overlayEntries.current -= 1;
      } else {
        sawPop.current = true;
        entriesPushed.current = Math.max(0, entriesPushed.current - 1);
      }
      flushPopWaiters();
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [flushPopWaiters]);

  /** Run `fn` once any `history.back()` we issued has actually landed. */
  const afterPendingPop = useCallback((fn: () => void) => {
    if (popWaiters.current.length === 0) {
      fn();
      return;
    }
    popWaiters.current.push(fn);
  }, []);

  const pushOverlayEntry = useCallback(() => {
    /*
     * State-only: same URL, one extra entry, so Back closes the overlay rather
     * than leaving the page. `pushState` is integrated with the App Router, so
     * this stays in step with `usePathname` — see the Native History API section
     * of the routing guide.
     */
    overlayEntries.current += 1;
    window.history.pushState({ sakuraOverlay: overlayEntries.current }, "");

    let retired = false;
    return () => {
      if (retired) return;
      retired = true;

      // Already popped by the user pressing Back: the entry is gone and the
      // counter was decremented by the listener above.
      if (!window.history.state?.sakuraOverlay) return;

      /*
       * Closed some other way (the chevron, a swipe, a keyboard shortcut), so
       * the entry we pushed is still sitting there and has to be retired or
       * Back would need pressing twice. Anything navigating in the meantime
       * queues behind the pop via `afterPendingPop`.
       */
      expectPop();
      window.history.back();
    };
  }, [expectPop]);

  /*
   * Runs after the new route has painted. Saving the *outgoing* position in the
   * cleanup is what makes this work: the effect body sees the new path, and the
   * cleanup still closes over the old one.
   */
  useEffect(() => {
    const saved = scrollPositions.current.get(pathname);

    /*
     * Classify the commit that just happened, for `back()`'s depth counter.
     * The pop case has already been counted by the popstate listener — which
     * always runs first, since the browser fires it before the router
     * re-renders — so here it only clears the flag.
     */
    if (!seenFirstPath.current) {
      seenFirstPath.current = true;
    } else if (sawPop.current) {
      sawPop.current = false;
    } else if (navIntent.current === "replace") {
      // A replacement swaps the current entry: same depth, nothing to count.
    } else {
      entriesPushed.current += 1;
    }
    navIntent.current = null;

    finishTransition();

    // Content arrives asynchronously, so the container is often still short
    // when this first runs and the assignment silently clamps to 0. Retry
    // across a few frames until the scroll height can actually hold it. The
    // scroller is re-resolved each attempt because a page that owns its own
    // scroller may not have mounted yet on the first frame.
    let attempts = 0;
    let raf = 0;
    const settle = () => {
      const node = resolveScroller(scrollerRef.current);
      if (!node) return;

      node.scrollTop = saved ?? 0;
      if (saved && Math.abs(node.scrollTop - saved) > 1 && attempts < 8) {
        attempts += 1;
        raf = requestAnimationFrame(settle);
      }
    };
    raf = requestAnimationFrame(settle);

    const currentPath = pathname;
    return () => {
      cancelAnimationFrame(raf);
      const node = resolveScroller(scrollerRef.current);
      if (node) scrollPositions.current.set(currentPath, node.scrollTop);
    };
  }, [pathname, finishTransition]);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (popFallbackTimer.current) clearTimeout(popFallbackTimer.current);
    };
  }, []);

  const runWithTransition = useCallback(
    (kind: NavKind, run: () => void) => {
      if (!supportsViewTransitions()) {
        run();
        return;
      }

      // Released early if a previous navigation is somehow still pending, so
      // two fast taps can't deadlock on each other's promise.
      finishTransition();

      // The kind drives which CSS animation applies — see globals.css.
      document.documentElement.dataset.nav = kind;

      /*
       * The resolver is installed synchronously, before `run()` — and that
       * ordering is the whole point.
       *
       * It used to be assigned inside the `startViewTransition` callback, which
       * the browser invokes asynchronously, at its next rendering opportunity.
       * `run()` fires immediately after. So on any navigation that committed
       * before the browser got round to that callback — which is the *common*
       * case for a prefetched route, the fast path we most want to feel instant
       * — the `[pathname]` effect called `finishTransition()` while
       * `releaseTransition.current` was still null. It resolved nothing, and the
       * callback then installed a resolver with nobody left to call it. The hold
       * ran to its full timeout and animated the old snapshot to the old
       * snapshot: a flash, and a page that didn't change.
       *
       * Creating the promise up front means an early commit resolves the hold it
       * was meant to resolve, however the two orderings interleave.
       */
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      releaseTransition.current = release;
      holdTimer.current = setTimeout(() => {
        releaseTransition.current = null;
        holdTimer.current = null;
        release();
      }, MAX_HOLD_MS);

      const transition = document.startViewTransition(() => held);

      transition.finished
        .catch(() => {
          // A transition skipped by the browser (another one started, the tab
          // was hidden) rejects. Nothing to recover — the navigation itself is
          // unaffected.
        })
        .finally(() => {
          delete document.documentElement.dataset.nav;
        });

      run();
    },
    [finishTransition]
  );

  const navigate = useCallback(
    (href: string, kind: NavKind = "push") => {
      if (href === pathname) return;
      afterPendingPop(() => {
        // Tab switches replace rather than stack, so Back doesn't have to walk
        // through every tab the user visited to leave the app.
        if (kind === "tab") {
          navIntent.current = "replace";
          runWithTransition("tab", () => router.replace(href));
          return;
        }
        navIntent.current = "push";
        runWithTransition(kind, () => router.push(href));
      });
    },
    [pathname, router, runWithTransition, afterPendingPop]
  );

  const back = useCallback(
    (fallback?: string) => {
      afterPendingPop(() => {
        /*
         * Nothing pushed means popping would leave the app (or, in a standalone
         * PWA, do nothing at all), so a deep-linked page goes to its stated
         * parent instead of a dead end. When there *is* somewhere to go back to,
         * pop it — a replace would work visually while quietly shortening the
         * stack, which is what made the browser's own Back leave the app from
         * pages you'd reached by three taps.
         */
        if (entriesPushed.current === 0 && fallback) {
          navIntent.current = "replace";
          runWithTransition("back", () => router.replace(fallback));
          return;
        }
        // The counter is decremented by the popstate listener, not here: the
        // pop is what makes it true, and counting it twice would strand the
        // next Back on the fallback branch.
        runWithTransition("back", () => router.back());
      });
    },
    [router, runWithTransition, afterPendingPop]
  );

  const scrollToTop = useCallback(
    (smooth = true) => {
      const el = getScroller();
      if (!el) return;
      el.scrollTo({
        top: 0,
        behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
      });
    },
    [getScroller]
  );

  const registerScroller = useCallback((el: HTMLElement | null) => {
    scrollerRef.current = el;
  }, []);

  return (
    <AppNavContext.Provider
      value={{
        navigate,
        back,
        scrollToTop,
        registerScroller,
        scrollerRef,
        getScroller,
        pushOverlayEntry,
      }}
    >
      {children}
    </AppNavContext.Provider>
  );
}
