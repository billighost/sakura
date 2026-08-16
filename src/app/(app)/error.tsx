"use client";

import { useEffect } from "react";
import { useOffline } from "next/offline";
import { AlertIcon, OfflineIcon } from "@/components/Icons";
import styles from "./error.module.css";

/**
 * Route-level error boundary.
 *
 * Without one of these a single thrown render error unmounts the entire app
 * and leaves a blank white page with no way out — no navigation, no player, no
 * indication anything went wrong. This keeps the failure scoped to the route
 * segment and always offers a way forward.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  /*
   * `useOffline` rather than reading `navigator.onLine` once during render.
   * `navigator.onLine` is only trustworthy when false, and reading it in render
   * means the answer is fixed at mount — so a connection that comes back while
   * this screen is up left it still claiming to be offline.
   */
  const offline = useOffline();

  return (
    <div className={styles.wrap} role="alert">
      <div className={styles.card}>
        <div className={styles.glyph} aria-hidden="true">
          {offline ? <OfflineIcon size={30} /> : <AlertIcon size={30} />}
        </div>

        <h1 className={styles.title}>
          {offline ? "No connection" : "This page didn't load"}
        </h1>
        <p className={styles.body}>
          {offline
            ? "This page needs the internet. Everything you've saved for offline still plays."
            : "Something went wrong on our side. Nothing has happened to your music or your playlists."}
        </p>

        <div className={styles.actions}>
          <button type="button" className={`${styles.primary} pressable`} onClick={reset}>
            Try again
          </button>
          {/* A real navigation, not a Link: the router may be part of what
              failed, and this is the one route the service worker guarantees. */}
          <a className={`${styles.secondary} pressable`} href="/library/downloaded">
            Play my downloads
          </a>
        </div>

        {error.digest && (
          <p className={styles.digest}>
            If you report this, quote <code>{error.digest}</code>.
          </p>
        )}
      </div>
    </div>
  );
}
