import styles from "./page.module.css";

export default function Loading() {
  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div className={styles.searchBox} style={{ opacity: 0.6 }}>
          <span className={styles.searchIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
        </div>
      </div>

      <div className={styles.skeletonContainer}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <div className={styles.skeletonThumb} />
            <div className={styles.skeletonCol}>
              <div className={styles.skeletonLineW70} />
              <div className={styles.skeletonLineW40} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
