"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "./haptics";
import { prefersReducedMotion } from "./motion";

/**
 * Drag-to-reorder for a vertical list. See the vocabulary doc in `motion.ts`.
 *
 * Two callers need this — the playlist page and the queue sheet — and neither
 * had it. The queue's "reorder" was a pair of move-up/move-down buttons, and the
 * playlist had no way to change the order at all despite `PlaylistTrack.position`
 * existing in the schema for exactly that.
 *
 * ── Why the drag starts from a handle ─────────────────────────────────────
 *
 * A row you can drag anywhere is a row you can't scroll past. Long-press-then-
 * drag is the other option, and it's what iOS uses in some places, but it costs
 * every reorder a 500ms wait and it makes an accidental reorder easy on a list
 * you were only trying to read. A grip is unambiguous: touching it means
 * "move this", touching anything else means "scroll" or "play".
 *
 * ── What it does with the pointer ─────────────────────────────────────────
 *
 * Rects are measured once at drag start rather than per frame: reading
 * `getBoundingClientRect` on every pointermove forces layout against a list
 * whose children are mid-transform, which is both slow and self-referential —
 * the measurements include the displacement the measurements caused.
 *
 * The target index is decided by which row's midpoint the dragged row's centre
 * has crossed, not by dividing travel by row height. Midpoint crossing is what
 * makes the gap open when the row is visibly over its new home rather than a
 * fixed distance later.
 */

export interface UseReorderOptions {
  /**
   * The element wrapping the rows. An input rather than something this hook
   * hands back: a returned object that contains a ref is ref-tainted as a whole,
   * so every property read on it during render — `itemProps(i)` inside a
   * `.map`, for instance — reads as accessing a ref mid-render.
   */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Number of items. Changing it mid-drag cancels the drag. */
  count: number;
  /** Committed move. Not called when the row lands where it started. */
  onReorder: (from: number, to: number) => void;
  enabled?: boolean;
  /**
   * The scrolling ancestor, for edge auto-scroll. Without it a drag can't reach
   * a destination that's off screen, which on a 40-track playlist means most
   * destinations.
   */
  scrollerRef?: React.RefObject<HTMLElement | null>;
}

export interface ReorderState {
  /** Index being dragged, or null. */
  dragging: number | null;
  /** Where it would land on release. */
  target: number | null;
}

/** Travel before a press on the grip becomes a drag, so a tap on it isn't one. */
const START_PX = 4;

/** Distance from a scroller edge at which auto-scroll kicks in. */
const EDGE_PX = 72;

/** Auto-scroll speed at the very edge, px per frame. */
const EDGE_SPEED = 12;

export function useReorder({
  containerRef,
  count,
  onReorder,
  enabled = true,
  scrollerRef,
}: UseReorderOptions) {
  const [state, setState] = useState<ReorderState>({ dragging: null, target: null });

  /*
   * Everything the gesture needs, in a ref rather than state: it changes on
   * every pointermove and none of it should trigger a render on its own. Only
   * `dragging`/`target` and the live offset do, and the offset is written
   * straight to the DOM.
   */
  const gesture = useRef<{
    pointerId: number;
    from: number;
    target: number;
    startY: number;
    /** Row tops relative to the container, and heights, measured at start. */
    tops: number[];
    heights: number[];
    rowHeight: number;
    /** Scroll offset at start, so auto-scroll is included in the delta. */
    startScroll: number;
    started: boolean;
    raf: number;
    lastY: number;
  } | null>(null);

  /** Latest committed callback, so a re-render mid-drag can't strand a stale one. */
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const rows = useCallback((): HTMLElement[] => {
    const el = containerRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>("[data-reorder-item]"));
  }, [containerRef]);

  /**
   * Which row a grip belongs to, read off the DOM at gesture time.
   *
   * The alternative — a `handleProps(index)` factory called once per row during
   * render — closes over refs inside functions the React Compiler sees being
   * created in the render pass, which it (correctly) refuses to optimise. One
   * delegated handler set plus a data attribute avoids that entirely, and it
   * also means the returned props object is stable rather than a fresh closure
   * per row per render.
   */
  const indexOf = useCallback((grip: HTMLElement): number | null => {
    const item = grip.closest<HTMLElement>("[data-reorder-item]");
    if (!item) return null;
    const i = rows().indexOf(item);
    return i === -1 ? null : i;
  }, [rows]);

  /** Paint the drag directly. Transform and opacity only — stays on the compositor. */
  const paint = useCallback(
    (offset: number) => {
      const g = gesture.current;
      if (!g) return;
      const items = rows();

      items.forEach((el, i) => {
        if (i === g.from) {
          el.style.transform = `translate3d(0, ${offset}px, 0)`;
          el.style.transition = "none";
          return;
        }

        // Rows between the origin and the target shift by one row to open the
        // gap; everything else sits still.
        let shift = 0;
        if (g.from < g.target && i > g.from && i <= g.target) shift = -g.rowHeight;
        else if (g.from > g.target && i >= g.target && i < g.from) shift = g.rowHeight;

        el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
        el.style.transition = "";
      });
    },
    [rows]
  );

  const clearPaint = useCallback(() => {
    for (const el of rows()) {
      el.style.transform = "";
      el.style.transition = "";
    }
  }, [rows]);

  const finish = useCallback(
    (commit: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;

      if (g.raf) cancelAnimationFrame(g.raf);
      clearPaint();
      setState({ dragging: null, target: null });

      if (commit && g.started && g.target !== g.from) {
        haptic("impact");
        onReorderRef.current(g.from, g.target);
      }
    },
    [clearPaint]
  );

  const updateFromPointer = useCallback(
    (clientY: number) => {
      const g = gesture.current;
      if (!g) return;

      const scroller = scrollerRef?.current;
      const scrolled = scroller ? scroller.scrollTop - g.startScroll : 0;
      const offset = clientY - g.startY + scrolled;

      // Centre of the dragged row in container coordinates.
      const centre = g.tops[g.from] + g.heights[g.from] / 2 + offset;

      let target = g.from;
      for (let i = 0; i < g.tops.length; i++) {
        if (i === g.from) continue;
        const mid = g.tops[i] + g.heights[i] / 2;
        if (i < g.from && centre < mid) {
          target = Math.min(target, i);
        } else if (i > g.from && centre > mid) {
          target = Math.max(target, i);
        }
      }

      if (target !== g.target) {
        g.target = target;
        // A detent passed. Light enough to fire repeatedly through a long drag.
        haptic("selection");
        setState({ dragging: g.from, target });
      }

      paint(offset);
    },
    [paint, scrollerRef]
  );

  /*
   * Edge auto-scroll. Runs on its own rAF loop rather than off pointermove,
   * because a finger held still near the edge produces no move events — and
   * holding still at the edge is exactly the gesture that means "keep going".
   */
  const startEdgeScroll = useCallback(() => {
    // A hoisted function declaration, so the loop can schedule itself by name.
    // A `const` arrow at hook scope cannot reference its own binding.
    function step() {
      const g = gesture.current;
      const scroller = scrollerRef?.current;
      if (!g || !scroller) return;

      const rect = scroller.getBoundingClientRect();
      const fromTop = g.lastY - rect.top;
      const fromBottom = rect.bottom - g.lastY;

      let dy = 0;
      if (fromTop < EDGE_PX) dy = -EDGE_SPEED * (1 - Math.max(0, fromTop) / EDGE_PX);
      else if (fromBottom < EDGE_PX) dy = EDGE_SPEED * (1 - Math.max(0, fromBottom) / EDGE_PX);

      if (dy !== 0) {
        const before = scroller.scrollTop;
        // `scrollBy` rather than `scrollTop += dy`: assigning a property on a
        // value read out of a hook argument's ref reads as mutating the
        // argument, which the compiler rejects. A method call says the same
        // thing and is clearer about intent.
        scroller.scrollBy(0, dy);
        // Re-derive the offset so the row keeps tracking the finger while the
        // list moves underneath it.
        if (scroller.scrollTop !== before) updateFromPointer(g.lastY);
      }

      g.raf = requestAnimationFrame(step);
    }

    const g = gesture.current;
    if (g) g.raf = requestAnimationFrame(step);
  }, [scrollerRef, updateFromPointer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || gesture.current) return;
      // Primary button / single touch only. A second finger landing mid-drag
      // would otherwise restart the gesture from the wrong origin.
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const index = indexOf(e.currentTarget as HTMLElement);
      if (index === null) return;

      const items = rows();
      if (items.length !== count) return;

      const container = containerRef.current;
      if (!container) return;
      const base = container.getBoundingClientRect().top;

      const tops = items.map((el) => el.getBoundingClientRect().top - base);
      const heights = items.map((el) => el.getBoundingClientRect().height);

      gesture.current = {
        pointerId: e.pointerId,
        from: index,
        target: index,
        startY: e.clientY,
        tops,
        heights,
        rowHeight: heights[index] || 0,
        startScroll: scrollerRef?.current?.scrollTop ?? 0,
        started: false,
        raf: 0,
        lastY: e.clientY,
      };

      // Capture on the grip so the drag survives the finger leaving it — which
      // it does immediately, since the row moves out from under the finger.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [enabled, rows, count, scrollerRef, indexOf, containerRef]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;

      g.lastY = e.clientY;

      if (!g.started) {
        if (Math.abs(e.clientY - g.startY) < START_PX) return;
        g.started = true;
        haptic("impact");
        setState({ dragging: g.from, target: g.from });
        if (scrollerRef?.current) startEdgeScroll();
      }

      // The grip has pointer capture, so the browser won't scroll the list from
      // this pointer — but preventDefault stops iOS treating a fast drag as a
      // page-level overscroll.
      e.preventDefault();
      updateFromPointer(e.clientY);
    },
    [updateFromPointer, startEdgeScroll, scrollerRef]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      finish(true);
    },
    [finish]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      finish(false);
    },
    [finish]
  );

  /*
   * Keyboard reorder. A pointer-only reorder is unreachable for anyone using a
   * keyboard or a switch, and the fix is small: the grip is a button, and
   * arrow keys on it move the row one place.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!delta) return;

      const index = indexOf(e.currentTarget as HTMLElement);
      if (index === null) return;

      const to = index + delta;
      if (to < 0 || to >= count) return;

      e.preventDefault();
      haptic("selection");
      onReorderRef.current(index, to);
    },
    [enabled, count, indexOf]
  );

  // A drag left running across an unmount would keep its rAF loop alive.
  useEffect(() => {
    return () => finish(false);
  }, [finish]);

  const reduced = prefersReducedMotion();

  /* One handler set for every grip, delegated by `data-reorder-item`. Stable
   * across renders, so spreading it per row allocates nothing. */
  const gripProps = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      // Claims the vertical gesture from the scroller for this element only.
      style: { touchAction: "none" } as React.CSSProperties,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]
  );

  return {
    /** Spread on each row. Marks it measurable and flags the dragged one. */
    itemProps: (index: number) => ({
      "data-reorder-item": "",
      "data-dragging": state.dragging === index ? "" : undefined,
      /*
       * Non-dragged rows animate into their displaced position; the dragged row
       * is written to directly by `paint` with transition: none. Under reduced
       * motion the gap appears without the slide — the row still follows the
       * finger, because direct manipulation isn't the kind of motion that
       * setting is about.
       */
      style: reduced
        ? undefined
        : ({ transition: "transform var(--d-fast) var(--ease)" } as React.CSSProperties),
    }),
    /** Spread on the grip inside each row. */
    gripProps,
    /** For the caller's own styling — a lifted shadow, a dimmed list. */
    dragging: state.dragging,
    target: state.target,
  };
}
