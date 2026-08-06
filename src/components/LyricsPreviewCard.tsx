"use client";

import type { LyricData } from "@/lib/lyrics";
import styles from "./LyricsPreviewCard.module.css";

interface LyricsPreviewCardProps {
  lyrics: LyricData | null;
  loadingLyrics: boolean;
  activeLineIndex: number;
  onOpen: () => void;
}

/**
 * The collapsed "Lyrics" card that sits in the scrollable content, above
 * Credits — same job as Spotify's lyrics preview: show a taste of what's
 * playing right now and invite a tap into the full synced view (LyricsModal).
 * Deliberately NOT the thing that used to happen on tap-album-art; that
 * overlay is gone in favor of this always-visible, always-in-place card.
 */
export function LyricsPreviewCard({ lyrics, loadingLyrics, activeLineIndex, onOpen }: LyricsPreviewCardProps) {
  if (loadingLyrics) {
    return (
      <div className={styles.container} data-block-drag>
        <div className={styles.header}>Lyrics</div>
        <div className={`${styles.card} ${styles.cardLoading}`}>
          <div className={styles.loadingText}>Loading lyrics&hellip;</div>
        </div>
      </div>
    );
  }

  const hasSynced = !!lyrics?.lines?.length;
  const hasPlain = !!lyrics?.lyrics?.trim();
  if (!lyrics || (!hasSynced && !hasPlain)) return null;

  return (
    <div className={styles.container} data-block-drag>
      <div className={styles.header}>Lyrics</div>
      <button className={styles.card} onClick={onOpen} aria-label="Show full lyrics">
        {hasSynced ? (
          <div className={styles.syncedPreview}>
            <p className={`${styles.line} ${styles.lineDim}`}>
              {lyrics!.lines![activeLineIndex - 1]?.text || "\u00A0"}
            </p>
            <p className={`${styles.line} ${styles.lineActive}`}>
              {lyrics!.lines![activeLineIndex]?.text || lyrics!.lines![0]?.text || "\u266A"}
            </p>
            <p className={`${styles.line} ${styles.lineDim}`}>
              {lyrics!.lines![activeLineIndex + 1]?.text || "\u00A0"}
            </p>
          </div>
        ) : (
          <div className={styles.plainPreview}>
            {lyrics!
              .lyrics!.split("\n")
              .filter((l) => l.trim())
              .slice(0, 3)
              .map((line, i) => (
                <p key={i} className={`${styles.line} ${i === 0 ? styles.lineActive : styles.lineDim}`}>
                  {line}
                </p>
              ))}
          </div>
        )}

        <div className={styles.fadeBottom} aria-hidden="true" />
        <span className={styles.showBtn}>
          Show lyrics
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      </button>
    </div>
  );
}
