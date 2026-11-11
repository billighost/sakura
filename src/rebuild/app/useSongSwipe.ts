"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type PointerEvent } from "react";
import { horizontalIntent, songSwipeDirection } from "./gestureIntent";

interface SongSwipeOptions {
  onNext: () => void;
  onPrevious: () => void;
  disabled?: boolean;
  reducedMotion?: boolean;
}
type Press = { id: number; x: number; y: number; width: number; axis: "pending" | "horizontal"; latestX: number; latestTime: number; velocity: number; target: HTMLElement };
function subscribeMotion(changed: () => void) {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", changed); return () => query.removeEventListener("change", changed);
}
function systemMotion() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

/** A record sleeve follows the hand; vertical scrolling and browser zoom keep ownership. */
export function useSongSwipe(options: SongSwipeOptions) {
  const systemStill = useSyncExternalStore(subscribeMotion, systemMotion, () => false);
  const reducedMotion = options.reducedMotion || systemStill;
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = { ...options, reducedMotion }; }, [options, reducedMotion]);
  const press = useRef<Press | null>(null);
  const suppressClickUntil = useRef(0);
  const settling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  function releaseCapture(active: Press) {
    if (active.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
  }
  function cancel() {
    const active = press.current;
    press.current = null;
    if (active) releaseCapture(active);
    setOffset(0); setSwiping(false);
  }
  function finish(event: PointerEvent<HTMLElement>) {
    const active = press.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    const velocity = event.timeStamp - active.latestTime > 100 ? 0 : active.velocity;
    const chosen = active.axis === "horizontal" && !latest.current.disabled ? songSwipeDirection(dx, dy, active.width, velocity) : null;
    if (active.axis === "horizontal") suppressClickUntil.current = Date.now() + 500;
    press.current = null; releaseCapture(active);
    setSwiping(false); setOffset(0);
    if (!chosen) return;
    setDirection(chosen); settling.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { settling.current = false; }, latest.current.reducedMotion ? 100 : 560);
    if (chosen === "next") latest.current.onNext(); else latest.current.onPrevious();
  }
  const bind: HTMLAttributes<HTMLElement> = {
    onPointerDown(event) {
      if (!event.isPrimary) { cancel(); return; }
      if (event.button !== 0 || latest.current.disabled || settling.current) return;
      const target = event.target as Element;
      if ((target instanceof HTMLElement && target.isContentEditable) || target.closest('input,textarea,select,option,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="option"],[role="slider"],[role="spinbutton"]')) return;
      cancel();
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth, axis: "pending", latestX: event.clientX, latestTime: event.timeStamp, velocity: 0, target: event.currentTarget };
    },
    onPointerMove(event) {
      const active = press.current;
      if (!active || active.id !== event.pointerId) return;
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      if (active.axis === "pending") {
        const intent = horizontalIntent(dx, dy);
        if (intent === "vertical") { cancel(); return; }
        if (intent !== "horizontal") return;
        active.axis = "horizontal"; active.target.setPointerCapture(active.id); setSwiping(true);
      }
      event.preventDefault();
      const elapsed = event.timeStamp - active.latestTime;
      if (elapsed > 0) active.velocity = (event.clientX - active.latestX) / elapsed;
      active.latestX = event.clientX; active.latestTime = event.timeStamp;
      const drag = Math.sign(dx) * Math.min(Math.abs(dx) * .58, 110);
      setOffset(drag);
    },
    onPointerUp: finish,
    onPointerCancel: cancel,
    // Touch starts with implicit capture on the image/child. Taking ownership
    // on the sleeve emits a bubbling loss from that child, not from our sleeve.
    onLostPointerCapture(event) { if (press.current && event.target === event.currentTarget) cancel(); },
    onDragStart(event) { event.preventDefault(); },
    onClickCapture(event) { if (event.detail > 0 && Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } },
  };
  const style: CSSProperties = {
    touchAction: "pan-y pinch-zoom",
    translate: `${offset}px 0`,
    rotate: reducedMotion ? undefined : `${offset * .015}deg`,
    transition: swiping || reducedMotion ? "none" : "translate 560ms cubic-bezier(.16,.76,.22,1), rotate 560ms cubic-bezier(.16,.76,.22,1)",
  };
  return { bind, style, direction, swiping };
}
