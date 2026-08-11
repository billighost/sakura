import styles from "./page.module.css";

/**
 * Home's loading state.
 *
 * Shaped like the real feed — shelves, then the lead block, then quick picks —
 * rather than the undifferentiated column of grey rows this used to be. The
 * point isn't decoration: matching the layout means content lands in space
 * already reserved for it, so nothing shifts under a thumb that's already
 * reaching for it.
 *
 * Its own module (not `page.tsx`, not `HomeFeed.tsx`) because both `loading.tsx`
 * and the page's Suspense boundary render it, and it needs no client JS —
 * putting it in the client component would drag that bundle into the loading
 * route for nothing.
 */
export function HomeSkeleton() {
  return (
    <div aria-hidden="true">
      <div className={styles.shelves}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${styles.shelf} ${styles.shelfSkeleton} skeleton`} />
        ))}
      </div>

      <div className={styles.lead}>
        <div className={`${styles.leadArt} skeleton`} />
        <div className={styles.leadBody}>
          <div className={`${styles.lineSm} skeleton`} />
          <div className={`${styles.lineLg} skeleton`} />
          <div className={`${styles.lineMd} skeleton`} />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={`${styles.lineTitle} skeleton`} />
        </div>
        <div className={styles.picks}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.pick}>
              <div className={`${styles.pickArt} skeleton`} />
              <div className={styles.pickMeta}>
                <div className={`${styles.lineSm} skeleton`} />
                <div className={`${styles.lineXs} skeleton`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
