"use client";

import type { LyricData, LyricLine } from "@/lib/lyrics";
import styles from "./LyricsPreviewCard.module.css";

interface LyricsPreviewCardProps {
  lyrics: LyricData | null;
  loadingLyrics: boolean;
  activeLineIndex: number;
  onOpen: () => void;
}

const WINDOW_SIZE = 5;
const HALF_WINDOW = Math.floor(WINDOW_SIZE / 2);

/**
 * The collapsed "Lyrics" card that sits in the scrollable content, above
 * Credits — same job as Spotify's lyrics preview: show a taste of what's
 * playing right now and invite a tap into the full synced view (LyricsModal).
 *
 * The recession-by-depth treatment (font-size and colour stepping down with
 * distance from the active line) deliberately mirrors LyricsModal's `--depth`
 * logic — see the window/depth math below — so the collapsed preview and the
 * expanded view read as the same grammar rather than two lyric components
 * that happen to sit near each other.
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
      <button
        className={`${styles.card} pressable`}
        onClick={onOpen}
        aria-label="Show full lyrics"
      >
        {hasSynced ? (
          <SyncedPreview lines={lyrics!.lines!} activeLineIndex={activeLineIndex} />
        ) : (
          <PlainPreview text={lyrics!.lyrics!} />
        )}

        <span className={styles.showBtn}>
          Show lyrics
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width="12"
            height="12"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      </button>
    </div>
  );
}

/**
 * The five-line-wide slice of lyrics to show, centred on whichever line is
 * active. Near the start or end of a song there aren't `HALF_WINDOW`
 * neighbours on both sides, so the window shifts rather than shrinks — the
 * card stays a constant five lines (when the song has that many) instead of
 * visibly resizing as playback nears either end.
 */
function lyricWindow(total: number, activeLineIndex: number) {
  const center = activeLineIndex >= 0 ? activeLineIndex : 0;

  let start = center - HALF_WINDOW;
  let end = center + HALF_WINDOW;

  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > total - 1) {
    start -= end - (total - 1);
    end = total - 1;
  }

  return { start: Math.max(0, start), end: Math.min(total - 1, end), center };
}

function SyncedPreview({
  lines,
  activeLineIndex,
}: {
  lines: LyricLine[];
  activeLineIndex: number;
}) {
  const { start, end, center } = lyricWindow(lines.length, activeLineIndex);
  const slice = lines.slice(start, end + 1);

  return (
    <div className={styles.lines}>
      {slice.map((line, i) => {
        const idx = start + i;
        const isActive = activeLineIndex >= 0 && idx === activeLineIndex;
        // Capped at 2 — the window is only ever two lines deep either side of
        // the centre, so anything past that would never be reached anyway.
        const depth = Math.min(2, Math.abs(idx - center));
        return (
          <p
            key={idx}
            className={`${styles.line} ${isActive ? styles.lineActive : ""}`}
            style={{ "--depth": depth } as React.CSSProperties}
          >
            {line.text || "\u00A0"}
          </p>
        );
      })}
    </div>
  );
}

function PlainPreview({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, WINDOW_SIZE);

  return (
    <div className={styles.lines}>
      {lines.map((line, i) => (
        <p
          key={i}
          className={`${styles.line} ${i === 0 ? styles.lineActive : ""}`}
          style={{ "--depth": Math.min(2, i) } as React.CSSProperties}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
