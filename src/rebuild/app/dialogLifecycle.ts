"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

type DialogController = { close: (afterClose?: () => void) => void };
const controllers = new WeakMap<HTMLDialogElement, DialogController>();
const lockedDialogs = new Set<HTMLDialogElement>();
let originalOverflow = "";
let originalFocus: Element | null = null;

function topDialog() {
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
    const focused = document.activeElement;
    lockPage(dialog);
    dialog.dataset.dialogPhase = "opening";
    if (!dialog.open) dialog.showModal();

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
      dialog.close();
      unlockPage(dialog, focused);
    };
  }, [dialogRef]);

  return useCallback(() => requestDialogClose(callbackRef.current, dialogRef.current), [dialogRef]);
}
