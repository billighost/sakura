"use client";

import { useState, useRef, useEffect } from "react";
import { usePlayer } from "./PlayerContext";
import styles from "./MiniPlayer.module.css";

const PETAL_COUNT = 6;

export function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    seek,
    beginSeek,
    endSeek,
    togglePlay,
    next,
    prev,
    isLiked,
    toggleLiked,
    accentColor,
    setMiniArtRect,
  } = usePlayer();
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const artWrapRef = useRef<HTMLDivElement>(null);

  // Reset the loaded flag whenever the track (and therefore the art) changes
  useEffect(() => {
    setArtLoaded(false);
  }, [currentTrack?.coverUrl]);

  // Keep the last-known art position fresh so the Full Player can grow out of it
  // the instant it's asked to (avoids a stale rect from before a resize/scroll).
  useEffect(() => {
    function updateRect() {
      if (artWrapRef.current) {
        setMiniArtRect(artWrapRef.current.getBoundingClientRect());
      }
    }
    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [currentTrack?.id, setMiniArtRect]);

  if (!currentTrack) return null;

  const displayProgress = seekDrag !== null ? seekDrag : progress;
  const progressPercent = duration > 0 ? (displayProgress / duration) * 100 : 0;

  function handleLike() {
    if (!isLiked) setBurstKey((k) => k + 1);
    toggleLiked();
  }

  function handleExpand() {
    if (artWrapRef.current) {
      setMiniArtRect(artWrapRef.current.getBoundingClientRect());
    }
    onExpand();
  }

  return (
    <div
      className={styles.root}
      style={{ "--track-accent": accentColor || undefined } as React.CSSProperties}
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(`.${styles.playBtn}`) ||
          (e.target as HTMLElement).closest(`.${styles.likeBtn}`) ||
          (e.target as HTMLElement).closest(`.${styles.skipBtn}`)
        )
          return;
        handleExpand();
      }}
    >
      <div className={styles.seekContainer}>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressBar}
            style={{ width: `${progressPercent}%` }}
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
          onClick={(e) => e.stopPropagation()}
          aria-label="Seek"
        />
      </div>

      <div className={styles.content}>
        <div ref={artWrapRef} className={`${styles.artWrap} ${isPlaying ? styles.playing : ""}`}>
          <div className={styles.artGlow} />
          {currentTrack.coverUrl ? (
            <>
              {!artLoaded && <div className={`${styles.art} skeleton`} style={{ position: "absolute", inset: 0 }} />}
              <img
                className={`${styles.art} ${artLoaded ? styles.loaded : ""}`}
                src={currentTrack.coverUrl}
                alt=""
                onLoad={() => setArtLoaded(true)}
              />
            </>
          ) : (
            <div className={`${styles.art} ${styles.artFallback} ${styles.loaded}`}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.title}>{currentTrack.title}</div>
          <div className={styles.artist}>{currentTrack.artist}</div>
        </div>

        <button
          className={`${styles.likeBtn} ${isLiked ? styles.likedBtn : ""}`}
          onClick={handleLike}
          aria-label={isLiked ? "Unlike" : "Like"}
        >
          <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
          {burstKey > 0 && Array.from({ length: PETAL_COUNT }).map((_, i) => (
            <span
              key={`${burstKey}-${i}`}
              className={styles.petal}
              style={{ "--rot": `${(360 / PETAL_COUNT) * i}deg` } as React.CSSProperties}
            />
          ))}
        </button>

        <button
          className={styles.skipBtn}
          onClick={prev}
          aria-label="Previous"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            {isPlaying ? (
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>

        <button
          className={styles.skipBtn}
          onClick={next}
          aria-label="Next"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
