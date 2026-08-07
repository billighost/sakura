"use client";

import { useEffect } from "react";
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

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className={styles.wrap} role="alert">
      <div className={styles.card}>
        <div className={styles.glyph} aria-hidden="true">
          <svg viewBox="0 0 48 48" width="56" height="56" fill="none">
            <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="2" opacity="0.18" />
            <path
              d="M24 14v12"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="24" cy="33" r="2.2" fill="currentColor" />
          </svg>
        </div>

        <h1 className={styles.title}>
          {offline ? "You're offline" : "Something broke"}
        </h1>
        <p className={styles.body}>
          {offline
            ? "This page needs a connection. Your downloads still play — everything you've saved is available offline."
            : "This page hit an unexpected error. Your music and library are safe."}
        </p>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={reset}>
            Try again
          </button>
          <a className={styles.secondary} href="/library/downloaded">
            Go to downloads
          </a>
        </div>

        {error.digest && (
          <p className={styles.digest}>
            Reference <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
