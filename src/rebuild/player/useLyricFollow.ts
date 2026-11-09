"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { lyricIsInView, lyricReadingViewport, lyricScrollTarget } from "./lyricFollow";

export function useLyricFollow({ targetIndex, selecting, reducedMotion, viewRef, lineRefs, controlsRef, layoutVersion }: {
  targetIndex: number;
  selecting: boolean;
  reducedMotion: boolean;
  viewRef: RefObject<HTMLDivElement | null>;
  lineRefs: RefObject<Array<HTMLElement | null>>;
  controlsRef: RefObject<HTMLDivElement | null>;
  layoutVersion: unknown;
}) {
  const [follow, setFollow] = useState(true);
  const programmatic = useRef(false);
  const current = useRef({ targetIndex, selecting, follow, reducedMotion });
  useEffect(() => { current.current = { targetIndex, selecting, follow, reducedMotion }; }, [targetIndex, selecting, follow, reducedMotion]);

  const centre = useCallback(() => {
    if (!current.current.follow || current.current.selecting) return;
    const line = lineRefs.current[current.current.targetIndex];
    const scroll = viewRef.current?.closest<HTMLElement>("[data-player-scroll]");
    if (!line || !scroll || !scroll.clientHeight) return;
    const viewport = lyricReadingViewport(scroll.getBoundingClientRect(), controlsRef.current?.getBoundingClientRect());
    const top = lyricScrollTarget(scroll.scrollTop, line.getBoundingClientRect(), viewport);
    const bounded = Math.min(top, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    if (Math.abs(bounded - scroll.scrollTop) < 1) return;
    programmatic.current = true;
    scroll.scrollTo({ top: bounded, behavior: current.current.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [lineRefs, viewRef, controlsRef]);

  useEffect(() => {
    if (!follow || selecting || targetIndex < 0) return;
    const frame = requestAnimationFrame(centre);
    return () => cancelAnimationFrame(frame);
  }, [centre, follow, selecting, targetIndex, reducedMotion, layoutVersion]);

  useEffect(() => {
    const scroll = viewRef.current?.closest<HTMLElement>("[data-player-scroll]");
    if (!scroll) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let touching = false;
    let dragging = false;
    let userScrolled = false;
    let lastInteraction = 0;
    function inView() {
      const line = lineRefs.current[current.current.targetIndex];
      return Boolean(line && lyricIsInView(line.getBoundingClientRect(), lyricReadingViewport(scroll!.getBoundingClientRect(), controlsRef.current?.getBoundingClientRect())));
    }
    function settle() {
      clearTimeout(timer);
      const quietFor = performance.now() - lastInteraction;
      if (quietFor < 160) { timer = setTimeout(settle, 160 - quietFor); return; }
      programmatic.current = false;
      if (touching || dragging || current.current.selecting || !userScrolled) return;
      userScrolled = false;
      if (inView()) setFollow(true);
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(settle, 160); }
    function pause() {
      userScrolled = true;
      lastInteraction = performance.now();
      current.current.follow = false;
      if (programmatic.current) {
        // A gesture must interrupt an in-flight automatic scroll immediately.
        programmatic.current = false;
        scroll!.scrollTo({ top: scroll!.scrollTop, behavior: "instant" });
      }
      setFollow(false);
      schedule();
    }
    function wheel(event: WheelEvent) { if (event.deltaY) pause(); }
    function touchStart() { touching = true; }
    function touchMove() { pause(); }
    function touchEnd() { touching = false; schedule(); }
    function pointerDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.target !== scroll) return;
      const rect = scroll!.getBoundingClientRect();
      if (event.clientX >= rect.right - 20 || event.clientX <= rect.left + 20) { dragging = true; pause(); }
    }
    function pointerUp() { if (dragging) { dragging = false; schedule(); } }
    function keyDown(event: KeyboardEvent) {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select, [contenteditable=true]") || event.key === " " && target.closest("button, a"))) return;
      pause();
    }
    function onScroll() {
      lastInteraction = performance.now();
      // Replacing/loading a song can clamp the dialog's old scroll position.
      // Only an actual browsing gesture may turn off follow; layout shifts and
      // automatic focus/scroll anchoring must leave the new song following.
      if (!programmatic.current && (!current.current.follow || userScrolled || touching || dragging)) {
        userScrolled = true;
        if (current.current.follow && !inView()) { current.current.follow = false; setFollow(false); }
      }
      schedule();
    }
    scroll.addEventListener("wheel", wheel, { passive: true });
    scroll.addEventListener("touchstart", touchStart, { passive: true });
    scroll.addEventListener("touchmove", touchMove, { passive: true });
    scroll.addEventListener("touchend", touchEnd, { passive: true });
    scroll.addEventListener("touchcancel", touchEnd, { passive: true });
    scroll.addEventListener("pointerdown", pointerDown);
    scroll.addEventListener("keydown", keyDown);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    scroll.addEventListener("scrollend", settle);
    window.addEventListener("pointerup", pointerUp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (current.current.follow && !current.current.selecting) centre();
    });
    observer?.observe(scroll);
    if (viewRef.current) observer?.observe(viewRef.current);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      scroll.removeEventListener("wheel", wheel);
      scroll.removeEventListener("touchstart", touchStart);
      scroll.removeEventListener("touchmove", touchMove);
      scroll.removeEventListener("touchend", touchEnd);
      scroll.removeEventListener("touchcancel", touchEnd);
      scroll.removeEventListener("pointerdown", pointerDown);
      scroll.removeEventListener("keydown", keyDown);
      scroll.removeEventListener("scroll", onScroll);
      scroll.removeEventListener("scrollend", settle);
      window.removeEventListener("pointerup", pointerUp);
    };
  }, [viewRef, lineRefs, controlsRef, centre]);

  const resume = useCallback(() => { current.current.follow = true; setFollow(true); centre(); }, [centre]);
  const pause = useCallback(() => {
    current.current.follow = false;
    setFollow(false);
    if (programmatic.current) {
      programmatic.current = false;
      const scroll = viewRef.current?.closest<HTMLElement>("[data-player-scroll]");
      scroll?.scrollTo({ top: scroll.scrollTop, behavior: "instant" });
    }
  }, [viewRef]);
  return { follow, resume, pause };
}
