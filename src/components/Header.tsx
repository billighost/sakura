"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./Header.module.css";

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
}

export function Header({ title, showBack = false, rightAction }: HeaderProps) {
  const router = useRouter();

  return (
    <header className={styles.header}>
      {showBack ? (
        <button
          className={styles.backBtn}
          onClick={() => router.back()}
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : (
        <div style={{ width: "clamp(2rem, 6vw, 2.5rem)" }} />
      )}
      {title && <h1 className={styles.title}>{title}</h1>}
      {rightAction || <div style={{ width: "clamp(2rem, 6vw, 2.5rem)" }} />}
    </header>
  );
}
