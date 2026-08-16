import Link from "next/link";
import { DownloadedIcon, OfflineIcon } from "@/components/Icons";
import styles from "./page.module.css";

/**
 * Served by the service worker when a cold navigation happens with no network
 * and no cached copy of the target route.
 *
 * Statically rendered on purpose — it must be cacheable at install time, which
 * rules out anything that touches the session or the database.
 *
 * `dynamic = "force-static"` used to say that here. Under Cache Components the
 * export is gone (it errors) and the guarantee comes from the page itself: with
 * no runtime data access at all, the prerender extracts a fully static shell,
 * which is exactly what the worker needs to pre-cache. Keep it that way — a
 * `cookies()` or a database call anywhere in here would quietly turn the app's
 * offline fallback into something that needs the network.
 */
export default function OfflinePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.glyph} aria-hidden="true">
          <OfflineIcon size={34} />
        </div>

        <h1 className={styles.title}>No connection</h1>
        <p className={styles.body}>
          This page isn&apos;t saved to your device, so it needs the internet.
        </p>

        {/*
          What still works, said plainly. This page can't count the downloads —
          it's prerendered at install time and touches no data by design — but it
          can name what the app is still good for, which is the whole reason
          somebody bothered downloading anything.
        */}
        <ul className={styles.works}>
          <li>
            <DownloadedIcon size={15} />
            Songs you saved for offline play as normal
          </li>
          <li>
            <DownloadedIcon size={15} />
            Your playlists and liked songs are on the device
          </li>
        </ul>

        <div className={styles.actions}>
          <Link className={`${styles.primary} pressable`} href="/library/downloaded">
            Play my downloads
          </Link>
          <Link className={`${styles.secondary} pressable`} href="/home">
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
