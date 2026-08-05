"use client";

import { usePlayer } from "./PlayerContext";
import styles from "./MiniPlayer.module.css";

export function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const { currentTrack, isPlaying, progress, duration, togglePlay } = usePlayer();

  if (!currentTrack) return null;

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className={styles.root} onClick={(e) => {
      if ((e.target as HTMLElement).closest(`.${styles.playBtn}`)) return;
      onExpand();
    }}>
      <div className={styles.progress} style={{ width: `${progressPercent}%` }} />
      {currentTrack.coverUrl && (
        <img className={styles.art} src={currentTrack.coverUrl} alt="" />
      )}
      <div className={styles.info}>
        <div className={styles.title}>{currentTrack.title}</div>
        <div className={styles.artist}>{currentTrack.artist}</div>
      </div>
      <button className={styles.playBtn} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          {isPlaying ? (
            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
          ) : (
            <path d="M8 5v14l11-7z" />
          )}
        </svg>
      </button>
    </div>
  );
}
