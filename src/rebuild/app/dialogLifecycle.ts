"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { sheetDismissIntent } from "./gestureIntent";

type DialogController = { close: (afterClose?: () => void) => void };
const controllers = new WeakMap<HTMLDialogElement, DialogController>();
const lockedDialogs = new Set<HTMLDialogElement>();
let originalOverflow = "";
let originalFocus: Element | null = null;

export function topDialog() {
  // Insertion order follows showModal(), including dialogs mounted in cached route trees.
  const active = Array.from(lockedDialogs).findLast(dialog => dialog.open && dialog.isConnected);
  if (active) return active;
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return dialogs.item(dialogs.length - 1);
}

/** Keep a native modal in the top layer until its closing artwork has settled. */
export function requestDialogClose(afterClose: () => void, dialog?: HTMLDialogElement | null) {
  const target = dialog ?? topDialog();
  const controller = target && controllers.get(target);
  if (controller) controller.close(afterClose);
  else afterClose();
}

function lockPage(dialog: HTMLDialogElement) {
  if (!lockedDialogs.size) {
    originalOverflow = document.body.style.overflow;
    originalFocus = document.activeElement;
    document.body.style.overflow = "hidden";
  }
  lockedDialogs.add(dialog);
}

function unlockPage(dialog: HTMLDialogElement, focused: Element | null) {
  lockedDialogs.delete(dialog);
  if (!lockedDialogs.size) document.body.style.overflow = originalOverflow;
  const remaining = topDialog();
  const candidate = focused instanceof HTMLElement && focused.isConnected ? focused : !remaining ? originalFocus : null;
  if (candidate instanceof HTMLElement && candidate.isConnected && (!remaining || remaining.contains(candidate))) {
    candidate.focus({ preventScroll: true });
  }
  if (!lockedDialogs.size) originalFocus = null;
}

/** One opening per mount, cancellable exit, and shared scroll/focus ownership for nested dialogs. */
export function useDialogLifecycle(dialogRef: RefObject<HTMLDialogElement | null>, onClose: () => void, reducedMotion = false) {
  const callbackRef = useRef(onClose);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => { callbackRef.current = onClose; reducedRef.current = reducedMotion; }, [onClose, reducedMotion]);

  useEffect(() => {
    const mountedDialog = dialogRef.current;
    if (!mountedDialog) return;
    const dialog = mountedDialog;
    let disposed = false;
    let closing = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let drag: { id: number; x: number; y: number; latestY: number; latestTime: number; velocity: number; offset: number; started: boolean; handle: HTMLElement } | null = null;
    let draggedUntil = 0;
    let dragSettle: Animation | null = null;
    const focused = document.activeElement;
    lockPage(dialog);
    dialog.dataset.dialogPhase = "opening";
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-autofocus]:not(:disabled),[autofocus]:not(:disabled)")?.focus({preventScroll:true});

    const still = () => reducedRef.current || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ownAnimations = () => dialog.getAnimations().filter(animation => {
      const effect = animation.effect;
      return effect instanceof KeyframeEffect && effect.target === dialog;
    });
    function markOpen() {
      if (!disposed && !closing) dialog.dataset.dialogPhase = "open";
    }
    function close(afterClose = callbackRef.current) {
      if (disposed || closing) return;
      closing = true;
      if (settleTimer) clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      // A pulled sheet leaves from the hand's last position, without jumping back to its origin.
      const draggedOffset = Number(dialog.dataset.dialogSwipeOffset) || 0;
      if (draggedOffset && !still()) {
        dragSettle?.cancel();
        dialog.style.animation = "none";
        dialog.animate([{ translate: `0 ${draggedOffset}px`, opacity: 1, rotate: "0deg" }, { translate: `0 ${innerHeight}px`, opacity: 0, rotate: "2deg" }], { duration: 460, easing: "cubic-bezier(.24,.64,.3,1)", fill: "forwards" });
      }
      dialog.dataset.dialogPhase = "closing";
      // Keep the native focus trap during the short exit, including repeated Escape presses.
      let finished = false;
      const finish = () => {
        if (finished || disposed) return;
        finished = true;
        if (exitTimer) clearTimeout(exitTimer);
        afterClose();
      };
      if (still()) { finish(); return; }
      // Reading animations flushes the phase style before inspecting its actual duration.
      const animations = ownAnimations();
      if (!animations.length) { finish(); return; }
      const duration = Math.max(...animations.map(animation => {
        const end = animation.effect?.getComputedTiming().endTime;
        return typeof end === "number" && Number.isFinite(end) ? end : 260;
      }));
      exitTimer = setTimeout(finish, Math.min(900, Math.max(80, duration + 80)));
      void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    }
    controllers.set(dialog, { close });
    function resetDrag(animate = true) {
      const active = drag; drag = null;
      if (active?.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
      delete dialog.dataset.dialogDragging;
      delete dialog.dataset.dialogSwipeOffset;
      if (active?.started && animate && !still()) {
        dragSettle?.cancel();
        dragSettle = dialog.animate([{ translate: `0 ${active.offset}px` }, { translate: "0 0" }], { duration: 480, easing: "cubic-bezier(.16,.76,.22,1)" });
      }
      dialog.style.translate = "";
    }
    function pointerDown(event: PointerEvent) {
      if (!event.isPrimary) { resetDrag(); return; }
      if (!event.isPrimary || event.button !== 0 || closing || dialog.dataset.dialogPhase !== "open" || topDialog() !== dialog || dialog.dataset.dialogCloseDisabled) return;
      if (!(event.target instanceof HTMLElement) || event.target.closest("button,a,input,textarea,select,[role=slider],[contenteditable=true]")) return;
      const handle = event.target.closest<HTMLElement>("[data-dialog-swipe-handle]");
      if (!handle || !dialog.contains(handle)) return;
      dragSettle?.cancel(); resetDrag(false);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, latestY: event.clientY, latestTime: event.timeStamp, velocity: 0, offset: 0, started: false, handle };
    }
    function pointerMove(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.started) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.1 || dy < -10) { resetDrag(false); return; }
        if (dy < 12 || dy < Math.abs(dx) * 1.35) return;
        drag.started = true; drag.handle.setPointerCapture(event.pointerId);
        dialog.dataset.dialogDragging = "true";
      }
      event.preventDefault();
      const elapsed = event.timeStamp - drag.latestTime;
      if (elapsed > 0) drag.velocity = (event.clientY - drag.latestY) / elapsed;
      drag.latestY = event.clientY; drag.latestTime = event.timeStamp;
      drag.offset = Math.max(0, dy * .86);
      dialog.style.translate = `0 ${drag.offset}px`;
      dialog.dataset.dialogSwipeOffset = String(drag.offset);
    }
    function pointerUp(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return;
      const active = drag;
      const velocity = event.timeStamp - active.latestTime > 100 ? 0 : active.velocity;
      const dismiss = active.started && !dialog.dataset.dialogCloseDisabled && sheetDismissIntent(event.clientX - active.x, event.clientY - active.y, dialog.clientHeight, velocity);
      if (active.started) draggedUntil = Date.now() + 500;
      if (dismiss) {
        drag = null;
        if (active.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
        delete dialog.dataset.dialogDragging;
        close();
      } else resetDrag();
    }
    function pointerCancel() { resetDrag(); }
    function lostCapture(event: PointerEvent) { if (drag?.id === event.pointerId && event.target === drag.handle) resetDrag(); }
    function suppressDraggedClick(event: MouseEvent) { if (event.detail > 0 && Date.now() < draggedUntil) { event.preventDefault(); event.stopPropagation(); } }
    dialog.addEventListener("pointerdown", pointerDown);
    dialog.addEventListener("pointermove", pointerMove);
    dialog.addEventListener("pointerup", pointerUp);
    dialog.addEventListener("pointercancel", pointerCancel);
    dialog.addEventListener("lostpointercapture", lostCapture);
    dialog.addEventListener("click", suppressDraggedClick, true);
    frame = requestAnimationFrame(() => {
      if (still()) { markOpen(); return; }
      const animations = ownAnimations();
      if (!animations.length) { markOpen(); return; }
      settleTimer = setTimeout(markOpen, 1200);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (settleTimer) clearTimeout(settleTimer);
        markOpen();
      });
    });
    return () => {
      disposed = true;
      controllers.delete(dialog);
      cancelAnimationFrame(frame);
      if (settleTimer) clearTimeout(settleTimer);
      if (exitTimer) clearTimeout(exitTimer);
      resetDrag(false); dragSettle?.cancel();
      dialog.removeEventListener("pointerdown", pointerDown);
      dialog.removeEventListener("pointermove", pointerMove);
      dialog.removeEventListener("pointerup", pointerUp);
      dialog.removeEventListener("pointercancel", pointerCancel);
      dialog.removeEventListener("lostpointercapture", lostCapture);
      dialog.removeEventListener("click", suppressDraggedClick, true);
      dialog.close();
      unlockPage(dialog, focused);
    };
  }, [dialogRef]);

  return useCallback(() => requestDialogClose(callbackRef.current, dialogRef.current), [dialogRef]);
}
