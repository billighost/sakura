"use client";

import { useEffect, useRef } from "react";
import { Scrubber } from "./Scrubber";
import type { LyricData } from "@/lib/lyrics";
import styles from "./LyricsModal.module.css";

interface LyricsModalProps {
  open: boolean;
  onClose: () => void;
  track: { title: string; artist: string; coverUrl?: string };
  lyrics: LyricData | null;
  loadingLyrics: boolean;
  activeLineIndex: number;
  accentColor: string | null;
  onLineClick: (time: number) => void;
  onShareLine: (text: string) => void;
  progress: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubStart: () => void;
  onScrubMove: (time: number) => void;
  onSeek: (time: number) => void;
  formatTime: (seconds: number) => string;
}

/**
 * The full synced-lyrics view — its own overlay now, not a swap-in that
 * replaces the album art inside the main content column. Keeps a mini
 * transport pinned to the bottom so playback stays reachable while reading,
 * the way Apple Music/Spotify both do it.
 */
export function LyricsModal({
  open,
  onClose,
  track,
  lyrics,
  loadingLyrics,
  activeLineIndex,
  accentColor,
  onLineClick,
  onShareLine,
  progress,
  duration,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  onScrubStart,
  onScrubMove,
  onSeek,
  formatTime,
}: LyricsModalProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || activeLineIndex < 0 || !listRef.current) return;
    const activeEl = listRef.current.children[activeLineIndex] as HTMLElement;
    if (activeEl) {
      listRef.current.scrollTo({
        top: activeEl.offsetTop - listRef.current.clientHeight / 2 + activeEl.clientHeight / 2,
        behavior: "smooth",
      });
    }
  }, [activeLineIndex, open]);

  return (
    <div
      className={`${styles.overlay} ${open ? styles.open : ""}`}
      style={{ "--track-accent": accentColor || undefined } as React.CSSProperties}
      aria-hidden={!open}
      data-block-drag
    >
      <div className={styles.header}>
        <button className={styles.headerBtn} onClick={onClose} aria-label="Close lyrics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div className={styles.headerCenter}>
          <div className={styles.headerLabel}>Lyrics</div>
          <div className={styles.headerTitle}>{track.title}</div>
        </div>
        <button
          className={styles.headerBtn}
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.share) {
              navigator
                .share({ title: track.title, text: `${track.title} by ${track.artist}`, url: window.location.href })
                .catch(() => {});
            }
          }}
          aria-label="Share"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
      </div>

      <div className={styles.body}>
        {loadingLyrics ? (
          <div className={styles.status}>Loading lyrics&hellip;</div>
        ) : !lyrics || (!lyrics.lines?.length && !lyrics.lyrics?.trim()) ? (
          <div className={styles.status}>No lyrics found for this track.</div>
        ) : lyrics.lines?.length ? (
          <div ref={listRef} className={styles.list}>
            {lyrics.lines.map((line, idx) => (
              <div key={idx} className={`${styles.row} ${idx === activeLineIndex ? styles.rowActive : ""}`}>
                <div
                  className={`${styles.lineGroup} ${idx === activeLineIndex ? styles.lineGroupActive : ""}`}
                  onClick={() => onLineClick(line.time)}
                >
                  <p className={`${styles.line} ${idx === activeLineIndex ? styles.lineActive : ""}`}>{line.text}</p>
                  {line.transliterated && (
                    <p className={`${styles.lineTranslit} ${idx === activeLineIndex ? styles.lineTranslitActive : ""}`}>
                      {line.transliterated}
                    </p>
                  )}
                </div>
                <button
                  className={styles.shareLineBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShareLine(line.text);
                  }}
                  aria-label="Share this lyric line"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.plainText}>
            {lyrics.lyrics!.split("\n").map((line, i) => (
              <p key={i}>{line || "\u00A0"}</p>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <Scrubber
          progress={progress}
          duration={duration}
          accentColor={accentColor}
          variant="full"
          formatTime={formatTime}
          onScrubStart={onScrubStart}
          onScrubMove={onScrubMove}
          onSeek={onSeek}
        />
        <div className={styles.timeRow}>
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className={styles.transport}>
          <button className={styles.transportBtn} onClick={onPrev} aria-label="Previous">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>
          <button className={styles.playPauseBtn} onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
              {isPlaying ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <button className={styles.transportBtn} onClick={onNext} aria-label="Next">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
