"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Keep Tab inside a dialog while it's open, and give focus back where it came
 * from when it closes.
 *
 * Both halves matter. Without the trap, Tab walks into the page behind an open
 * sheet — a screen reader user ends up reading content they can't see and can't
 * reach the sheet's own controls. Without the restore, closing a sheet drops
 * focus onto <body> and the next Tab starts from the top of the document,
 * which loses a keyboard user their place entirely.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Focus the first real control, falling back to the container itself so
    // focus is never left outside the dialog. The container carries tabIndex
    // -1 for exactly this, and `preventScroll` stops the focus call from
    // jumping a long sheet to its first button.
    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      // Re-queried per keypress: sheet contents change (a list loads, a step
      // advances) and a list captured on open would send Tab to a dead node.
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey && (activeEl === firstItem || activeEl === container)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && activeEl === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only restore if focus is still somewhere in the dialog — if something
      // else has deliberately moved it (a toast action, a navigation), yanking
      // it back would be the wrong call.
      const stillInside = container.contains(document.activeElement);
      const target = previouslyFocused.current;
      if (stillInside && target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [active, containerRef]);
}
