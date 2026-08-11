import { HomeSkeleton } from "./HomeSkeleton";
import styles from "./page.module.css";

/**
 * Shown on a cold navigation to /home, before the server component's first
 * byte. Renders the same skeleton the page's own Suspense boundary uses, so
 * moving from route-level loading to content-level loading is invisible
 * rather than one grey layout being swapped for a differently-shaped one.
 */
export default function Loading() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={`${styles.lineTitle} skeleton`} />
        <div className={`${styles.avatarLink} skeleton`} />
      </div>
      <HomeSkeleton />
    </div>
  );
}
