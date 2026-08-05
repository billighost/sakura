"use client";

import { usePlayer } from "@/components/PlayerContext";

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
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-6 py-2.5 bg-[var(--accent)] hover:brightness-110 text-white rounded-full font-semibold text-sm transition-all active:scale-95"
    >
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
