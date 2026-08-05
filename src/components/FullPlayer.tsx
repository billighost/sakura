"use client";

import { usePlayer } from "./PlayerContext";
import styles from "./FullPlayer.module.css";

interface FullPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullPlayer({ open, onClose }: FullPlayerProps) {
  const { currentTrack, isPlaying, progress, duration, volume, shuffle, repeat, togglePlay, seek, setVolume, next, prev, toggleShuffle, toggleRepeat } = usePlayer();

  if (!currentTrack) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`${styles.root} ${open ? styles.open : ""}`}>
      <div className={styles.dragHandle} />
      <div className={styles.header}>
        <div />
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close player">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      <div className={styles.artContainer}>
        {currentTrack.coverUrl ? (
          <img className={styles.art} src={currentTrack.coverUrl} alt={currentTrack.title} />
        ) : (
          <div className={styles.art} style={{ background: "var(--sakura-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3rem" }}>
            🎵
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.trackInfo}>
          <div className={styles.trackTitle}>{currentTrack.title}</div>
          <div className={styles.trackArtist}>{currentTrack.artist}</div>
        </div>

        <input
          type="range"
          className={styles.seekBar}
          min={0}
          max={duration || 0}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
        <div className={styles.timeRow}>
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className={styles.transport}>
          <button className={styles.transportBtn} onClick={toggleShuffle} aria-label="Shuffle" style={{ color: shuffle ? "var(--sakura-accent)" : undefined }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
          <button className={styles.transportBtn} onClick={prev} aria-label="Previous">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>
          <button className={`${styles.transportBtn} ${styles.playPauseBtn}`} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              {isPlaying ? (
                <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
              ) : (
                <path d="M8 5v14l11-7z" />
              )}
            </svg>
          </button>
          <button className={styles.transportBtn} onClick={next} aria-label="Next">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
          <button className={styles.transportBtn} onClick={toggleRepeat} aria-label="Repeat" style={{ color: repeat !== "off" ? "var(--sakura-accent)" : undefined }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            {repeat === "one" && <span style={{ position: "absolute", fontSize: "0.5rem", fontWeight: 800 }}>1</span>}
          </button>
        </div>

        <div className={styles.extras}>
          <button className={styles.likeBtn} aria-label="Like">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ width: "clamp(4rem, 15vw, 6rem)", accentColor: "var(--sakura-accent)" }}
          />
        </div>
      </div>
    </div>
  );
}
