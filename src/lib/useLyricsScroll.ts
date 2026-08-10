"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

/**
 * Auto-scroll for the lyrics view that yields to the reader.
 *
 * The old behaviour force-scrolled to the active line on every index change,
 * which meant you could not read ahead or look back: the moment you scrolled
 * away it yanked you back on the next line. Adding "pause for N seconds after a
 * touch" is the obvious fix and it's still wrong — five seconds is far too long
 * when you only nudged the list and glanced at the next line, and far too short
 * when you scrolled to the second verse to read it properly.
 *
 * So resume is conditional on *what the user did*, not just on elapsed time:
 *
 *   - Nudged, and the active line is still on screen. They didn't leave; they
 *     looked. Resume quickly (NEAR_IDLE_MS) — the song is still where they're
 *     reading, so re-centring is a small correction, not a hijack.
 *   - Scrolled away, but the playhead has since caught up to where they are.
 *     Waiting the full timeout here feels broken, because the thing they
 *     scrolled to is now the thing being sung. Resume as soon as the active
 *     line re-enters view and the list is idle.
 *   - Scrolled a long way off. They are deliberately reading elsewhere.
 *     Hold for FAR_IDLE_MS, and offer the jump-back control instead of
 *     deciding for them.
 *   - Seeked, or the track changed. That's an explicit "put me here", so it
 *     snaps and clears any detachment — drifting there over 400ms after a seek
 *     reads as lag.
 *
 * Momentum is the constraint that shapes the implementation. A flick keeps
 * emitting scroll events long after the finger is gone, and calling scrollTo
 * mid-flick on iOS either fights the momentum or kills it dead. So the idle
 * clock is reset by *scroll* events, not by touchend — momentum keeps the
 * timer alive on its own and we only ever re-centre once the list has actually
 * come to rest.
 */

export interface LyricsScrollOptions {
  /** Index of the line to keep centred. -1 before playback reaches line one. */
  activeIndex: number;
  /** Bumped by the caller on seek or track change to force a snap. */
  snapToken?: number | string;
  /** Pauses auto-scroll wholesale — e.g. while the view is closed. */
  enabled?: boolean;
}

export interface LyricsScrollResult {
  /** Attach to the scrolling element. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Register each line element, keyed by index. */
  registerLine: (index: number, el: HTMLElement | null) => void;
  /** True while the user has taken over and auto-scroll has yielded. */
  detached: boolean;
  /**
   * True when the active line is off screen *and* the user is detached — the
   * only moment a "jump to current" control is worth showing. Offering it
   * while the line is already visible is clutter pointing at nothing.
   */
  showJumpToCurrent: boolean;
  /** Re-centre and hand control back to auto-scroll. */
  jumpToCurrent: () => void;
}

/** Resume delays, measured from the last scroll event rather than the touch. */
const NEAR_IDLE_MS = 1200;
const FAR_IDLE_MS = 7000;

/** How far off-centre still counts as "they only nudged it", in viewports. */
const NEAR_FACTOR = 0.75;

/** Where the active line sits in the viewport, 0 = top, 1 = bottom. */
const FOCUS_RATIO = 0.42;

export function useLyricsScroll({
  activeIndex,
  snapToken,
  enabled = true,
}: LyricsScrollOptions): LyricsScrollResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLElement>());

  const [detached, setDetached] = useState(false);
  const [activeVisible, setActiveVisible] = useState(true);

  /*
   * Everything the scroll handler needs lives in one ref object. These values
   * change on every scroll event — several dozen a second during a flick — and
   * routing them through state would re-render the whole lyric list each time.
   */
  const s = useRef({
    /** Timestamp of the last user-driven scroll or pointer contact. */
    lastInteraction: 0,
    /** Set while we are the ones scrolling, so we don't detach ourselves. */
    programmatic: false,
    programmaticUntil: 0,
    detached: false,
    /** Distance from centre when the user stopped, in px. Chooses the delay. */
    driftAtRelease: 0,
    /** Guards the very first layout pass, which must not animate. */
    hasPositioned: false,
    lastActiveIndex: -1,
  });

  const registerLine = useCallback((index: number, el: HTMLElement | null) => {
    if (el) lineRefs.current.set(index, el);
    else lineRefs.current.delete(index);
  }, []);

  /** Offset that puts a line at the focus point of the scroller. */
  const targetOffsetFor = useCallback((index: number): number | null => {
    const container = scrollRef.current;
    const el = lineRefs.current.get(index);
    if (!container || !el) return null;

    const focus = container.clientHeight * FOCUS_RATIO;
    const target = el.offsetTop - focus + el.offsetHeight / 2;
    const max = container.scrollHeight - container.clientHeight;
    return Math.max(0, Math.min(max, target));
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const container = scrollRef.current;
      const top = targetOffsetFor(index);
      if (!container || top === null) return;

      // Already within a couple of pixels — scrolling anyway produces a visible
      // twitch on every line change for no benefit.
      if (Math.abs(container.scrollTop - top) < 2) return;

      /*
       * Mark the window during which incoming scroll events are ours. A smooth
       * scroll emits events for its whole duration, and without this the very
       * first one would look like the user grabbing the list and detach us
       * immediately — auto-scroll would disable itself the moment it worked.
       */
      s.current.programmatic = true;
      s.current.programmaticUntil = performance.now() + (behavior === "smooth" ? 900 : 120);

      container.scrollTo({ top, behavior });
    },
    [targetOffsetFor]
  );

  /** Is the active line currently within the visible band of the scroller? */
  const isActiveVisible = useCallback((index: number): boolean => {
    const container = scrollRef.current;
    const el = lineRefs.current.get(index);
    if (!container || !el) return false;

    const top = el.offsetTop - container.scrollTop;
    // Inset the band slightly: a line one pixel from the bottom edge is
    // technically visible and practically not.
    const margin = container.clientHeight * 0.12;
    return top + el.offsetHeight > margin && top < container.clientHeight - margin;
  }, []);

  const attach = useCallback(() => {
    s.current.detached = false;
    s.current.driftAtRelease = 0;
    setDetached(false);
  }, []);

  const jumpToCurrent = useCallback(() => {
    attach();
    if (activeIndex >= 0) {
      scrollToIndex(activeIndex, prefersReducedMotion() ? "auto" : "smooth");
    }
  }, [attach, activeIndex, scrollToIndex]);

  /* ── User input detaches ────────────────────────────────────────────────
   *
   * Detachment is driven by *input* events, not scroll events. A scroll event
   * cannot tell you who caused it, whereas a wheel or a finger on the glass is
   * unambiguously the user. This is what makes it safe to auto-scroll without
   * an elaborate "was that me?" heuristic.
   */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !enabled) return;

    const onUserInput = () => {
      s.current.lastInteraction = performance.now();
      // A gesture cancels any in-flight programmatic scroll: the user is
      // taking over mid-animation and must win immediately.
      s.current.programmatic = false;
      if (!s.current.detached) {
        s.current.detached = true;
        setDetached(true);
      }
    };

    const onScroll = () => {
      const now = performance.now();

      if (s.current.programmatic) {
        if (now < s.current.programmaticUntil) return;
        s.current.programmatic = false;
      }

      /*
       * A scroll we didn't cause and that no pointer explained — a trackpad
       * fling that outlived its wheel events, or a scrollbar drag. Treat it as
       * the user, and keep the idle clock running while momentum decays so we
       * never re-centre into a moving list.
       */
      s.current.lastInteraction = now;
      if (!s.current.detached) {
        s.current.detached = true;
        setDetached(true);
      }

      const top = targetOffsetFor(activeIndexRef.current);
      if (top !== null) s.current.driftAtRelease = Math.abs(container.scrollTop - top);

      setActiveVisible(isActiveVisible(activeIndexRef.current));
    };

    // Passive: none of these are ever prevented, and saying so up front lets
    // the browser scroll without waiting to find out.
    const opts = { passive: true } as const;
    container.addEventListener("pointerdown", onUserInput, opts);
    container.addEventListener("touchstart", onUserInput, opts);
    container.addEventListener("wheel", onUserInput, opts);
    container.addEventListener("scroll", onScroll, opts);

    return () => {
      container.removeEventListener("pointerdown", onUserInput);
      container.removeEventListener("touchstart", onUserInput);
      container.removeEventListener("wheel", onUserInput);
      container.removeEventListener("scroll", onScroll);
    };
  }, [enabled, isActiveVisible, targetOffsetFor]);

  // The scroll handler is bound once but needs the live index; a ref keeps it
  // current without rebinding listeners on every line change.
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  /* ── Following the song ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || activeIndex < 0) return;

    const changed = s.current.lastActiveIndex !== activeIndex;
    s.current.lastActiveIndex = activeIndex;

    if (!s.current.detached) {
      // First positioning after opening must not animate — a smooth scroll
      // from the top of a long song is a second of the list flying past.
      const behavior: ScrollBehavior =
        !s.current.hasPositioned || prefersReducedMotion() ? "auto" : "smooth";
      s.current.hasPositioned = true;
      scrollToIndex(activeIndex, behavior);
      return;
    }

    if (changed) setActiveVisible(isActiveVisible(activeIndex));
  }, [activeIndex, enabled, scrollToIndex, isActiveVisible]);

  /* ── Deciding when to take back over ────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || !detached) return;

    /*
     * Polled rather than scheduled with a single timeout, because the delay
     * isn't fixed at the moment of detachment: it depends on how far the user
     * scrolled and on whether the playhead has since caught up to them, both
     * of which change while they read. A quarter-second tick is far below the
     * threshold where the delay would feel wrong and costs nothing.
     */
    const tick = () => {
      const container = scrollRef.current;
      if (!container) return;

      const idle = performance.now() - s.current.lastInteraction;
      const visible = isActiveVisible(activeIndexRef.current);
      setActiveVisible(visible);

      const near = s.current.driftAtRelease < container.clientHeight * NEAR_FACTOR;
      // Visible means the song has arrived where they're reading, so the same
      // short delay applies however far they originally scrolled.
      const required = visible || near ? NEAR_IDLE_MS : FAR_IDLE_MS;

      if (idle < required) return;

      // Never resume onto a line that isn't on screen after a long excursion:
      // that's the yank this whole hook exists to avoid. The jump-to-current
      // control stays available so it remains their call.
      if (!visible && !near) return;

      attach();
      scrollToIndex(activeIndexRef.current, prefersReducedMotion() ? "auto" : "smooth");
    };

    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [enabled, detached, isActiveVisible, attach, scrollToIndex]);

  /* ── Seek and track change snap ─────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || snapToken === undefined) return;

    // An explicit "put me here" outranks whatever the user was reading, so it
    // reattaches as well as scrolling. Instant, not smooth: after a seek the
    // lyrics should already be there, not on their way.
    attach();
    s.current.lastInteraction = 0;

    if (activeIndexRef.current >= 0) {
      // A frame's delay lets the new track's lines mount and measure; without
      // it there is nothing to scroll to and the view stays at the top.
      const raf = requestAnimationFrame(() => scrollToIndex(activeIndexRef.current, "auto"));
      return () => cancelAnimationFrame(raf);
    }
  }, [snapToken, enabled, attach, scrollToIndex]);

  /* Reset when the view closes, so reopening starts centred rather than
   * wherever the reader left it during the previous song. */
  useEffect(() => {
    if (enabled) return;
    s.current.hasPositioned = false;
    s.current.detached = false;
    s.current.driftAtRelease = 0;
    setDetached(false);
    setActiveVisible(true);
  }, [enabled]);

  return {
    scrollRef,
    registerLine,
    detached,
    showJumpToCurrent: detached && !activeVisible && activeIndex >= 0,
    jumpToCurrent,
  };
}
