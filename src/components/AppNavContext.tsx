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

/** Longest the old frame may be held waiting for the new route to commit. */
const MAX_HOLD_MS = 450;

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

  /** How many entries this session has pushed — see `back()`. */
  const entriesPushed = useRef(0);

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

  /*
   * Runs after the new route has painted. Saving the *outgoing* position in the
   * cleanup is what makes this work: the effect body sees the new path, and the
   * cleanup still closes over the old one.
   */
  useEffect(() => {
    const saved = scrollPositions.current.get(pathname);

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

      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            releaseTransition.current = resolve;
            holdTimer.current = setTimeout(() => {
              releaseTransition.current = null;
              holdTimer.current = null;
              resolve();
            }, MAX_HOLD_MS);
          })
      );

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
      // Tab switches replace rather than stack, so Back doesn't have to walk
      // through every tab the user visited to leave the app.
      if (kind === "tab") {
        runWithTransition("tab", () => router.replace(href));
        return;
      }
      entriesPushed.current += 1;
      runWithTransition(kind, () => router.push(href));
    },
    [pathname, router, runWithTransition]
  );

  const back = useCallback(
    (fallback?: string) => {
      /*
       * `history.length` is no help — it counts the whole tab's history, not
       * this app's, so it's non-zero even on a cold deep link. Instead we count
       * what this session actually pushed. Nothing pushed means popping would
       * leave the app (or, in a standalone PWA, do nothing at all), so a
       * deep-linked page goes to its stated parent instead of a dead end.
       */
      if (entriesPushed.current === 0 && fallback) {
        runWithTransition("back", () => router.replace(fallback));
        return;
      }
      entriesPushed.current = Math.max(0, entriesPushed.current - 1);
      runWithTransition("back", () => router.back());
    },
    [router, runWithTransition]
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
      value={{ navigate, back, scrollToTop, registerScroller, scrollerRef, getScroller }}
    >
      {children}
    </AppNavContext.Provider>
  );
}
