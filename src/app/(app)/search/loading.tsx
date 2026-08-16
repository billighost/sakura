import { SearchIcon } from "@/components/Icons";
import styles from "./page.module.css";

export default function Loading() {
  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div className={styles.searchBox} style={{ opacity: 0.6 }}>
          <span className={styles.searchIcon}>
            <SearchIcon size={18} />
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
