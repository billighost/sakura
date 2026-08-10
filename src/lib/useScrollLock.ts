"use client";

import { useEffect } from "react";
import { resolveScroller } from "./appScroll";

/*
 * Nesting counter. A sheet can open another sheet (AddToPlaylist → New
 * playlist), and if each restored the page's scrolling on unmount the inner
 * one closing would unlock the page while the outer is still open. Only the
 * last lock released actually unlocks.
 */
let lockCount = 0;
let restore: (() => void) | null = null;

/**
 * Stop the page behind a dialog from scrolling.
 *
 * The app shell scrolls an inner element rather than the document (body is
 * already `overflow: hidden`), so this locks the scroll container the sheet is
 * layered over rather than the body — locking the body alone would do nothing
 * here, which is the trap this exists to avoid.
 *
 * Scroll position is preserved: an overflow change on a scrolled element keeps
 * `scrollTop`, but a container that reflows while locked can clamp it, so it's
 * captured and reapplied on release.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    lockCount += 1;
    if (lockCount === 1) {
      // Resolved, not assumed: several pages nest their own scroller inside
      // the shell's, and locking the outer one there does nothing at all.
      const scroller = resolveScroller();
      const body = document.body;
      const savedTop = scroller?.scrollTop ?? 0;
      const prevScrollerOverflow = scroller?.style.overflow ?? "";
      const prevBodyOverflow = body.style.overflow;

      if (scroller) scroller.style.overflow = "hidden";
      body.style.overflow = "hidden";

      restore = () => {
        if (scroller) {
          scroller.style.overflow = prevScrollerOverflow;
          scroller.scrollTop = savedTop;
        }
        body.style.overflow = prevBodyOverflow;
      };
    }

    return () => {
      lockCount -= 1;
      if (lockCount === 0 && restore) {
        restore();
        restore = null;
      }
    };
  }, [active]);
}
