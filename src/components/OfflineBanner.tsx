"use client";

import { useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";
import styles from "./OfflineBanner.module.css";

/**
 * Connection status.
 *
 * ── Why `useOffline()` and not `navigator.onLine` ───────────────────────────
 *
 * This used to read `navigator.onLine` through `useSyncExternalStore`, plus a
 * hand-rolled HEAD probe against our own origin to confirm recovery. The probe
 * existed because `navigator.onLine` is only trustworthy when false: it reports
 * the state of the OS network interface, so a phone on WiFi with no upstream —
 * a captive portal, a dead router, a hotel network — reports "online" while
 * nothing in the app works. That's precisely when a user needs to be told, and
 * precisely when the old banner stayed hidden.
 *
 * `useOffline` (enabled by `experimental.useOffline` in next.config.ts) flips
 * true on the browser's offline event *or* when a navigation, prefetch or Server
 * Action fetch actually fails, and flips back only after a background
 * connectivity check succeeds. So it catches the connected-but-useless case on
 * the way down, and it already does the work the HEAD probe was doing on the way
 * back up — which is why that probe is gone rather than merely moved.
 *
 * It returns false during SSR and initial hydration, which matches what the old
 * server snapshot asserted, so the markup still hydrates quietly.
 *
 * The one behaviour kept deliberately: reconnection is *confirmed* for a couple
 * of seconds rather than the banner just vanishing. Silently disappearing leaves
 * people unsure whether the app recovered or the banner simply timed out.
 */
export function OfflineBanner() {
  const offline = useOffline();

  // Was the connection previously lost? Drives the transient "Back online"
  // confirmation, which is the one piece of genuinely derived state here.
  const [showRestored, setShowRestored] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (offline) {
      // No need to clear `showRestored` here: the offline branch takes
      // precedence in render, and coming back online re-arms it anyway.
      wasOfflineRef.current = true;
      return;
    }

    // Online, but we were never offline — nothing to confirm (this covers the
    // initial mount, so no banner flashes on a normal load).
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;

    setShowRestored(true);
    const timer = setTimeout(() => setShowRestored(false), 2600);
    return () => clearTimeout(timer);
  }, [offline]);

  if (!offline && !showRestored) return null;

  return (
    <div
      className={`${styles.banner} ${offline ? styles.offline : styles.restored}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>
        {offline ? "Offline — your downloads still play" : "Back online"}
      </span>
    </div>
  );
}
