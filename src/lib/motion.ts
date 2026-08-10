"use client";

/* ═══════════════════════════════════════════════════════════════════════════
 *  SAKURA — INTERACTION VOCABULARY
 *
 *  Read this before adding an eighth way to do a gesture.
 *
 *  Before this layer existed, every component invented its own transition and
 *  its own pointer handling: MiniPlayer had the only correct velocity
 *  calculation in the codebase, FullPlayer had a near-copy with different
 *  thresholds, and three modals each hand-rolled a backdrop with no focus trap
 *  and no exit animation. The point of these primitives is that a gesture
 *  feels the same everywhere without each caller re-deriving the physics.
 *
 *  ── Pick a primitive ──────────────────────────────────────────────────────
 *
 *  `.pressable` / `.pressable-lg`  (globals.css)
 *      Any tappable non-link surface. Instant scale-down, sprung release.
 *      CSS-only, no JS. Start here — most things need nothing more.
 *
 *  usePress()                      (usePress.ts)
 *      When you need to *know* you're pressed — to swap an icon, hold a row
 *      highlighted, drive a custom press visual. Cancels correctly when the
 *      finger slides off or the list starts scrolling under it, which is where
 *      naive onPointerDown/Up pairs leave a control stuck looking pressed.
 *
 *  useDrag()                       (useDrag.ts)
 *      Swipes and drags. Axis locking, velocity, per-direction rubber-banding,
 *      and — the part that matters for feel — a live `progress` (0→1) and
 *      `armed` flag so the UI can show the commit threshold *approaching*
 *      instead of the user only finding out after they let go. Also carries
 *      optional long-press, because a component that needs both wants one
 *      pointer stream rather than two fighting over the same events.
 *
 *  useLongPress()                  (useLongPress.ts)
 *      Long-press on its own, with `progress` for a hold indicator. A thin
 *      preset over useDrag, so the two never disagree about what counts as
 *      "the finger moved".
 *
 *  usePullToRefresh()              (usePullToRefresh.ts)
 *      Top-of-scroller pull. Owns its own touch listeners because it must
 *      preventDefault to claim the gesture from the browser's overscroll,
 *      which pointer events can't express.
 *
 *  <Sheet>                         (components/Sheet.tsx)
 *      Every modal, sheet and dialog. Enter/exit animation, backdrop that
 *      tracks the drag, drag-to-dismiss with rubber-banding, scroll lock,
 *      focus trap, Escape, focus restore. Do not hand-roll another overlay.
 *
 *  haptic()                        (haptics.ts)
 *      Named feedback: selection / impact / success / warning / error.
 *      Never a raw millisecond number.
 *
 *  ── Rules ─────────────────────────────────────────────────────────────────
 *
 *  1. Transform and opacity only. Anything that animates width, height, top,
 *     left or filter leaves the compositor and drops frames on a mid-range
 *     phone — which is most of this app's traffic.
 *  2. Honour prefers-reduced-motion, but understand what it means here.
 *     Automatic movement and loops go off; opacity fades stay. Direct
 *     manipulation — an element tracking the finger that is dragging it — is
 *     *not* animation and stays on, because removing it doesn't reduce motion,
 *     it just breaks the gesture. What we drop under reduced motion is the
 *     follow-through: the sprung release, the sheet's slide, spinner rotation.
 *  3. Never leave a stuck :hover on touch. Hover styling goes inside
 *     `@media (hover: hover) and (pointer: fine)`, always.
 *  4. A gesture that can commit must say so before release — `armed` +
 *     `haptic("selection")`. Silent thresholds are why the old swipe-to-skip
 *     felt broken even after the velocity bug was fixed.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from "react";

/**
 * Motion durations in ms, mirroring the `--d-*` tokens in globals.css.
 *
 * Duplicating them here is deliberate: anything JS has to time (an exit
 * animation before unmount, a long-press ramp) must match what CSS is doing,
 * and reading a custom property off the computed style on every call is both
 * slower and silently returns "" if the token is ever renamed.
 */
export const DURATION = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 360,
  slower: 520,
} as const;

/** Synchronous read, for code paths that run before a component renders. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reactive version. The OS setting can change while the app is open — on iOS
 * it flips with Low Power Mode — so this subscribes rather than reading once.
 *
 * `useSyncExternalStore` rather than useState+useEffect: a media query is
 * exactly the external store it exists for. The effect version read the value
 * *after* mounting, which renders once with the wrong answer and then again
 * with the right one — a cascading render, and for a sheet that means the
 * entry animation it was supposed to suppress has already started.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    // Server snapshot: assume motion is fine, matching the CSS default. The
    // real value arrives on the client's first render, not a frame later.
    () => false
  );
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Progressive resistance for dragging past a boundary.
 *
 * `resistance` is how freely the element follows the finger: 1 travels 1:1,
 * 0 barely moves. Rather than scaling linearly — which still runs away over a
 * long drag, just more slowly — travel decays hyperbolically toward an
 * asymptote of `soft`. That's what makes a sheet feel attached to something:
 * it always gives a little, and never reaches a hard stop the finger can feel
 * as a break in contact.
 */
export function rubberBand(delta: number, resistance: number, soft = 140): number {
  if (resistance >= 1) return delta;
  if (resistance <= 0) return 0;

  const sign = delta < 0 ? -1 : 1;
  const d = Math.abs(delta);
  // Asymptotes at `soft` however far the finger travels.
  const damped = (1 - 1 / (d / soft + 1)) * soft;
  // Blend free travel with the damped curve so resistance stays continuous.
  return sign * (d * resistance + damped * (1 - resistance));
}

/** Clamp to 0→1. Used enough across the primitives to be worth a name. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
