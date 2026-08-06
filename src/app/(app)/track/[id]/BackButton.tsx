"use client";

import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export function BackButton() {
  const router = useRouter();
  return (
    <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}
