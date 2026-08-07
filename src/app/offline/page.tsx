import Link from "next/link";
import styles from "./page.module.css";

/**
 * Served by the service worker when a cold navigation happens with no network
 * and no cached copy of the target route.
 *
 * Statically rendered on purpose — it must be cacheable at install time, which
 * rules out anything that touches the session or the database.
 */
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.glyph} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18" />
            <path d="M6.8 11.4a9 9 0 0 1 3-1.9" />
            <path d="M3.4 8.2A14 14 0 0 1 8 5.3" />
            <path d="M14.4 9.8a9 9 0 0 1 2.8 1.6" />
            <path d="M13 5.2a14 14 0 0 1 7.6 3" />
            <path d="M9.8 14.6a4.4 4.4 0 0 1 4.6.6" />
            <path d="M12 19.4h.01" />
          </svg>
        </div>

        <h1 className={styles.title}>No connection</h1>
        <p className={styles.body}>
          This page hasn&apos;t been saved to your device yet. Everything
          you&apos;ve downloaded still plays — no connection needed.
        </p>

        <div className={styles.actions}>
          <Link className={styles.primary} href="/library/downloaded">
            Play downloads
          </Link>
          <Link className={styles.secondary} href="/home">
            Try home
          </Link>
        </div>
      </div>
    </div>
  );
}
