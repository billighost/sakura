/**
 * Haptics as a vocabulary, not a pile of millisecond numbers.
 *
 * Call sites used to pass raw durations — vibrate(8), vibrate(10), vibrate(12),
 * vibrate(15) — scattered across the player, the tab bar and pull-to-refresh.
 * Two problems with that: you couldn't tell whether two call sites were *meant*
 * to feel the same, and re-tuning "the commit buzz" meant grepping for numbers
 * and guessing. Naming the intent fixes both — the table below is the only
 * place a duration appears, so every matching moment in the app moves together.
 *
 * Names follow the platform convention (iOS UIFeedbackGenerator, Android
 * HapticFeedbackConstants) so the mapping stays predictable:
 *
 *   selection — passing a detent: a swipe threshold arming, a value ticking
 *               over, a reorder slot changing. The lightest tap in the set. It
 *               fires often during a drag, so it has to stay under the
 *               threshold where repetition reads as nagging.
 *   impact    — something committed: track skipped, sheet dismissed, row moved.
 *   success   — an outcome landed: saved, downloaded, added to a playlist.
 *   warning   — reversible trouble: hit a limit, nothing to undo.
 *   error     — the action failed and the user has to do something about it.
 *
 * Only `selection` and `impact` belong in a gesture loop. The three-pulse
 * patterns are long enough that firing one per frame would overlap itself.
 */

export type Haptic = "selection" | "impact" | "success" | "warning" | "error";

/**
 * Durations in ms; arrays alternate vibrate/pause. Kept deliberately short —
 * the Vibration API has no amplitude control, so "light" can only be expressed
 * as "brief", and anything past ~20ms on a single pulse reads as a buzz rather
 * than a tick.
 */
const PATTERNS: Record<Haptic, number | number[]> = {
  selection: 6,
  impact: 11,
  success: [10, 40, 18],
  warning: [14, 55, 14],
  error: [16, 45, 16, 45, 22],
};

/**
 * Repeat guard. A drag that oscillates around its commit threshold would
 * otherwise fire `selection` on every frame it crosses, which feels like a
 * fault rather than feedback.
 */
const MIN_GAP_MS = 40;
let lastFiredAt = 0;

/**
 * Fire a named haptic. Silently does nothing where the Vibration API is absent
 * (all of iOS, Safari everywhere) — that's the majority of this app's traffic,
 * so haptics are strictly an enhancement and nothing may depend on them.
 */
export function haptic(name: Haptic) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;

  try {
    navigator.vibrate(PATTERNS[name]);
  } catch {
    // Some browsers throw when the document isn't user-activated yet. Feedback
    // is not worth an exception.
  }
}

/** Cancel anything in flight — used when a gesture is cancelled mid-pattern. */
export function cancelHaptics() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(0);
  } catch {
    // As above.
  }
}
