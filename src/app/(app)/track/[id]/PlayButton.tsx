"use client";

import { usePlayer } from "@/components/PlayerContext";
import styles from "./page.module.css";

interface PlayButtonProps {
  trackId: string;
  audioUrl: string;
  title: string;
  artistName: string;
  coverUrl?: string;
  duration?: number;
}

export function PlayButton({ trackId, audioUrl, title, artistName, coverUrl, duration }: PlayButtonProps) {
  const { play, currentTrack, isPlaying, togglePlay } = usePlayer();

  const isCurrentTrack = currentTrack?.id === trackId;

  const handleClick = () => {
    if (isCurrentTrack) {
      togglePlay();
    } else {
      play(
        { id: trackId, title, artist: artistName, audioUrl, coverUrl, duration: duration || 0 },
        [{ id: trackId, title, artist: artistName, audioUrl, coverUrl, duration: duration || 0 }]
      );
    }
  };

  return (
    <button className={styles.playBtn} onClick={handleClick}>
      {isCurrentTrack && isPlaying ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      )}
      {isCurrentTrack && isPlaying ? "Pause" : "Play"}
    </button>
  );
}
