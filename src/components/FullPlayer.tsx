"use client";

import { useState, useRef, useCallback } from "react";
import { usePlayer } from "./PlayerContext";
import styles from "./FullPlayer.module.css";

interface FullPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullPlayer({ open, onClose }: FullPlayerProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  const {
    queue,
    upNextQueue,
    currentIndex,
    currentTrack,
    isPlaying,
    isSeeking,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    isLiked,
    togglePlay,
    seek,
    beginSeek,
    endSeek,
    setVolume,
    next,
    prev,
    toggleShuffle,
    toggleRepeat,
    toggleLiked,
  } = usePlayer();

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 100) onClose();
    },
    [onClose]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startY.current = e.clientY;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (startY.current === 0) return;
      const delta = e.clientY - startY.current;
      if (delta > 100) onClose();
    },
    [onClose]
  );

  const handleMouseUp = useCallback(() => {
    startY.current = 0;
  }, []);

  if (!currentTrack) return null;

  const displayProgress = seekDrag !== null ? seekDrag : progress;
  const progressPercent = duration > 0 ? (displayProgress / duration) * 100 : 0;

  return (
    <div
      className={`${styles.root} ${open ? styles.open : ""}`}
      style={{
        backgroundImage: currentTrack.coverUrl
          ? `url(${currentTrack.coverUrl})`
          : undefined,
      }}
    >
      <div className={styles.overlay} />

      <div
        ref={dragRef}
        className={styles.dragArea}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <div className={styles.dragHandle} />
      </div>

      <div className={styles.header}>
        <button className={styles.headerBtn} onClick={onClose} aria-label="Close player">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div className={styles.headerCenter}>
          <div className={styles.headerLabel}>Playing from album</div>
          <div className={styles.headerTitle}>{currentTrack.album || "Unknown Album"}</div>
        </div>
        <button className={styles.headerBtn} aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </div>

      <div className={styles.mainContent}>
        {showQueue ? (
          <div className={styles.queueContainer}>
            <div className={styles.queueHeader}>Now Playing</div>
            <div className={styles.queueRowActive}>
              <img src={currentTrack.coverUrl || ""} alt="" className={styles.queueArt} />
              <div className={styles.queueInfo}>
                <div className={styles.queueTitleActive}>{currentTrack.title}</div>
                <div className={styles.queueArtist}>{currentTrack.artist}</div>
              </div>
            </div>

            {upNextQueue.length > 0 && (
              <>
                <div className={styles.queueHeader}>Up Next</div>
                {upNextQueue.map((t, i) => (
                  <div key={`upnext-${i}`} className={styles.queueRow}>
                    <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                    <div className={styles.queueInfo}>
                      <div className={styles.queueTitle}>{t.title}</div>
                      <div className={styles.queueArtist}>{t.artist}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {queue.length - currentIndex - 1 > 0 && (
              <>
                <div className={styles.queueHeader}>Next from: {currentTrack.album || "Playlist"}</div>
                {queue.slice(currentIndex + 1).map((t, i) => (
                  <div key={`queue-${i}`} className={styles.queueRow}>
                    <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                    <div className={styles.queueInfo}>
                      <div className={styles.queueTitle}>{t.title}</div>
                      <div className={styles.queueArtist}>{t.artist}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className={styles.artContainer}>
            {currentTrack.coverUrl ? (
              <img
                className={styles.art}
                src={currentTrack.coverUrl}
                alt={currentTrack.title}
              />
            ) : (
              <div className={`${styles.art} ${styles.artFallback}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        {!showQueue && (
          <div className={styles.trackInfo}>
            <div className={styles.trackTitle}>{currentTrack.title}</div>
            <div className={styles.trackArtist}>{currentTrack.artist}</div>
          </div>
        )}

        <div className={styles.seekContainer}>
          <div className={styles.seekTrack}>
            <div
              className={styles.seekProgress}
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className={styles.seekThumb}
              style={{ left: `${progressPercent}%` }}
            />
          </div>
          <input
            type="range"
            className={styles.seekInput}
            min={0}
            max={duration || 0}
            step={0.1}
            value={displayProgress}
            onInput={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              setSeekDrag(val);
            }}
            onMouseDown={(e) => {
              beginSeek();
              const val = Number((e.target as HTMLInputElement).value);
              setSeekDrag(val);
            }}
            onMouseUp={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              seek(val);
              endSeek(val);
              setSeekDrag(null);
            }}
            onTouchStart={(e) => {
              beginSeek();
              const val = Number((e.target as HTMLInputElement).value);
              setSeekDrag(val);
            }}
            onTouchEnd={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              seek(val);
              endSeek(val);
              setSeekDrag(null);
            }}
            aria-label="Seek"
          />
        </div>
        <div className={styles.timeRow}>
          <span>{formatTime(displayProgress)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className={styles.transport}>
          <button
            className={`${styles.transportBtn} ${shuffle ? styles.activeBtn : ""}`}
            onClick={toggleShuffle}
            aria-label="Shuffle"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>

          <button className={styles.transportBtn} onClick={prev} aria-label="Previous">
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button className={styles.playPauseBtn} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
              {isPlaying ? (
                <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
              ) : (
                <path d="M8 5v14l11-7z" />
              )}
            </svg>
          </button>

          <button className={styles.transportBtn} onClick={next} aria-label="Next">
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          <button
            className={`${styles.transportBtn} ${repeat !== "off" ? styles.activeBtn : ""}`}
            onClick={toggleRepeat}
            aria-label="Repeat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            {repeat === "one" && (
              <span className={styles.repeatOne}>1</span>
            )}
          </button>
        </div>

        <div className={styles.extras}>
          <button
            className={`${styles.likeBtn} ${isLiked ? styles.likedBtn : ""}`}
            onClick={toggleLiked}
            aria-label={isLiked ? "Unlike" : "Like"}
          >
            <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>

          <div className={styles.volumeGroup}>
            <button
              className={styles.iconBtn}
              onClick={() => setShowVolume(!showVolume)}
              aria-label="Volume"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {volume > 0.5 && (
                  <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                )}
                {volume > 0 && volume <= 0.5 && (
                  <path d="M15.54 8.46a5 5 0 010 7.07" />
                )}
              </svg>
            </button>
            <input
              type="range"
              className={styles.volumeSlider}
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>

          <button className={styles.iconBtn} onClick={() => {
            if (navigator.share) {
              navigator.share({ title: currentTrack?.title, text: `${currentTrack?.title} by ${currentTrack?.artist}`, url: window.location.href });
            } else {
              navigator.clipboard.writeText(window.location.href);
            }
          }} aria-label="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>

          <button className={styles.iconBtn} aria-label="Add to playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button 
            className={`${styles.iconBtn} ${showQueue ? styles.activeBtn : ""}`} 
            onClick={() => setShowQueue(!showQueue)} 
            aria-label="Queue"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
