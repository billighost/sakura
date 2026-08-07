"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Edge-swipe to go back.
 *
 * Registration is deliberately global and guarded. Previously this hook existed
 * *and* `AppShell` had a byte-for-byte copy of the same listener, so on the four
 * pages that called the hook a single swipe fired `router.back()` twice and the
 * user landed two entries back in history. A module-level token means that even
 * if it's mounted more than once only the first instance is live, and the rest
 * are inert until it unmounts.
 */
let activeToken: symbol | null = null;

/** Routes that are roots of a tab — there is nothing to go back to. */
const TAB_ROOTS = ["/home", "/search", "/library", "/profile"];

export function useSwipeBack(enabled = true) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;

    const token = Symbol("swipe-back");
    if (activeToken !== null) return; // another instance already owns the gesture
    activeToken = token;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (e: TouchEvent) => {
      // Only a genuine edge swipe. Starting further in belongs to whatever the
      // finger is actually on (a carousel, the scrubber, a queue row).
      const t = e.touches[0];
      tracking = t.clientX < 24;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;

      if (TAB_ROOTS.includes(pathname)) return;

      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Horizontal intent: travelled far enough, and mostly sideways.
      if (dx > 70 && Math.abs(dy) < Math.abs(dx) * 0.6) {
        import("@/lib/haptics").then((h) => h.vibrate(8));
        router.back();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      if (activeToken === token) activeToken = null;
    };
  }, [router, pathname, enabled]);
}
