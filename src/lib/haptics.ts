/**
 * Light wrapper around navigator.vibrate with feature checking to fail silently
 * in unsupported environments (like Safari or iOS browsers).
 */
export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore vibration errors
    }
  }
}
