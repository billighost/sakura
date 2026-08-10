"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@/lib/useDrag";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useScrollLock } from "@/lib/useScrollLock";
import { DURATION, clamp01, useReducedMotion } from "@/lib/motion";
import { CloseIcon } from "./Icons";
import styles from "./Sheet.module.css";

/**
 * The app's one overlay primitive. Every modal, sheet and dialog goes through
 * it — see the vocabulary doc in `src/lib/motion.ts`.
 *
 * It exists because there were five hand-rolled overlays with five different
 * behaviours: none trapped focus, none handled Escape, none restored focus on
 * close, two locked scrolling and three didn't, and every one of them unmounted
 * instantly on close so the exit animation never played. Rather than fix that
 * five times, callers now describe *what* the sheet contains and this owns how
 * it behaves.
 *
 * Presentation:
 *   "sheet"  — slides from the bottom edge, drag down to dismiss. The default
 *              on touch and the right choice for anything list-shaped.
 *   "dialog" — centred, scales in. For short confirmations and forms, where a
 *              full-height sheet would be mostly empty space.
 */

export type SheetVariant = "sheet" | "dialog";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Rendered in the header. Also the accessible name — always provide one. */
  title?: string;
  /** Accessible name when the visible title is absent or insufficient. */
  ariaLabel?: string;
  variant?: SheetVariant;
  /** Pinned below the scrolling body — action rows that must stay reachable. */
  footer?: React.ReactNode;
  /** Extra controls beside the close button. */
  headerAction?: React.ReactNode;
  /** Hide the header entirely; the sheet then owns its own chrome. */
  hideHeader?: boolean;
  /** Set false for a destructive-confirmation sheet that must be answered. */
  dismissible?: boolean;
  className?: string;
  /** Caps the sheet's height. Defaults to 88% of the viewport. */
  maxHeight?: string;
}

/** Drag distance that dismisses, and the flick speed that does it regardless. */
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 0.55;

export function Sheet({
  open,
  onClose,
  children,
  title,
  ariaLabel,
  variant = "sheet",
  footer,
  headerAction,
  hideHeader = false,
  dismissible = true,
  className,
  maxHeight,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  /*
   * `mounted` outlives `open` by one exit animation. Unmounting the moment
   * `open` flips false is why every previous overlay in this codebase
   * disappeared with a hard cut — there was nothing left in the tree to
   * animate out.
   *
   * Opening is derived during render rather than set from an effect: an effect
   * would mount one render late, and the entry animation would be a frame
   * behind the tap that triggered it. Only the *closing* half needs a timer,
   * because that genuinely waits on the exit animation.
   */
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(false);
  // Previous `open`, held as state rather than a ref: React's documented
  // "adjust state when a prop changes" pattern, and refs may not be read
  // during render.
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    // Setting state during render is the sanctioned way to respond to a prop
    // change; React re-renders immediately without committing the stale pass.
    setWasOpen(open);
    setExiting(!open);
    if (!open) setVisible(false);
  }

  const mounted = open || exiting;

  useEffect(() => {
    if (open) {
      // Two frames: one to get the element into the DOM at its start position,
      // one so the browser has a computed style to transition *from*. With a
      // single frame the class lands in the same style recalculation and the
      // transition is skipped entirely.
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }

    if (!exiting) return;
    // Reduced motion skips the exit animation, so there's nothing to wait for.
    const t = setTimeout(() => setExiting(false), reduced ? 0 : DURATION.base);
    return () => clearTimeout(t);
  }, [open, exiting, reduced]);

  useScrollLock(mounted);
  useFocusTrap(panelRef, open && mounted);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  // Drag-to-dismiss. Bottom sheets only: dragging a centred dialog downward
  // has no destination to imply.
  const canDrag = variant === "sheet" && dismissible;
  const drag = useDrag({
    axis: "y",
    threshold: DISMISS_PX,
    velocity: DISMISS_VELOCITY,
    commitDirections: ["down"],
    // Freely downward, barely upward — the sheet is already at rest at the top,
    // so upward travel should acknowledge the finger without implying anything.
    resistance: { down: 1, up: 0.1 },
    enabled: canDrag && open,
    // Anything that scrolls or handles its own pointers keeps its gesture. The
    // body scroller is the important one: without it, a flick to scroll the
    // list dismisses the sheet instead.
    blockSelector: `.${styles.body}, [data-block-drag], button, a, input, textarea, select, [role="slider"]`,
    onCommit: onClose,
  });

  if (!mounted || typeof document === "undefined") return null;

  const dragging = drag.active && drag.dy > 0;
  // The backdrop thins out as the sheet is pulled away, so the page behind
  // reappears progressively rather than snapping back at release.
  const backdropFade = dragging ? 1 - clamp01(drag.dy / (DISMISS_PX * 2.6)) * 0.7 : 1;

  return createPortal(
    <div
      className={`${styles.root} ${styles[variant]} ${visible ? styles.visible : ""}`}
      // Only the panel is a dialog; this wrapper is presentational.
      role="presentation"
    >
      <div
        className={styles.backdrop}
        style={dragging ? { opacity: backdropFade, transition: "none" } : undefined}
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className={`${styles.panel} ${className ?? ""}`}
        style={{
          ...(maxHeight ? { maxHeight } : null),
          ...(dragging
            ? { transform: `translate3d(0, ${drag.dy}px, 0)`, transition: "none" }
            : null),
        }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        tabIndex={-1}
        data-block-drag
        {...(canDrag ? drag.bind : {})}
      >
        {variant === "sheet" && dismissible && (
          <div className={styles.grabber} aria-hidden="true">
            <span className={styles.grabberBar} />
          </div>
        )}

        {!hideHeader && (title || headerAction || dismissible) && (
          <header className={styles.header}>
            {title && <h2 className={styles.title}>{title}</h2>}
            <div className={styles.headerActions}>
              {headerAction}
              {dismissible && (
                <button
                  type="button"
                  className={`${styles.closeBtn} pressable`}
                  onClick={onClose}
                  aria-label={title ? `Close ${title.toLowerCase()}` : "Close"}
                >
                  <CloseIcon size={18} />
                </button>
              )}
            </div>
          </header>
        )}

        <div className={styles.body} data-sheet-body data-lenis-prevent>
          {children}
        </div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
