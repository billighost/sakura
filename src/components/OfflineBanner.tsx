"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./OfflineBanner.module.css";

/**
 * Connection status.
 *
 * Two behaviours worth noting beyond the styling:
 *
 *  - It confirms *re*connection for a couple of seconds instead of just
 *    vanishing. Silently disappearing leaves people unsure whether the app
 *    recovered or the banner simply timed out.
 *  - `navigator.onLine` is only trustworthy when false — it reports true for a
 *    connected-but-useless network (captive portal, no upstream). A cheap HEAD
 *    against our own origin is what actually confirms reachability.
 *
 * The raw online flag is read through `useSyncExternalStore` rather than being
 * mirrored into state from an effect. That's the API built for exactly this
 * shape — an external, subscribable browser value — and it avoids both the
 * hydration mismatch of reading `navigator` during render and the cascading
 * re-render of a setState in an effect body.
 */

function subscribeToOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

const getOnlineSnapshot = () => navigator.onLine;
// The server has no connection state; assume online so the markup matches the
// overwhelmingly common client case and hydration stays quiet.
const getOnlineServerSnapshot = () => true;

export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribeToOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot
  );

  // Was the connection previously lost? Drives the transient "Back online"
  // confirmation, which is the one piece of genuinely derived state here.
  const [showRestored, setShowRestored] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!online) {
      // No need to clear `showRestored` here: the offline branch takes
      // precedence in render, and coming back online re-arms it anyway.
      wasOfflineRef.current = true;
      return;
    }

    // Online, but we were never offline — nothing to confirm (this covers the
    // initial mount, so no banner flashes on a normal load).
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Only claim recovery once a real request succeeds — `navigator.onLine`
    // going true proves a link exists, not that there's a working route to us.
    void (async () => {
      try {
        await fetch("/manifest.json", { method: "HEAD", cache: "no-store" });
      } catch {
        return; // still unusable; leave the offline banner to re-arm
      }
      if (cancelled) return;
      setShowRestored(true);
      timer = setTimeout(() => setShowRestored(false), 2600);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [online]);

  if (online && !showRestored) return null;

  const offline = !online;

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
