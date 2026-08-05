"use client";

import { useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";
import { usePlayer } from "./PlayerContext";
import styles from "./FullPlayer.module.css";

interface FullPlayerProps {
  open: boolean;
  onClose: () => void;
}

const PETAL_COUNT = 6;
const ROW_HEIGHT = 62; // approx height of a queue row, used to compute reorder targets while dragging

export function FullPlayer({ open, onClose }: FullPlayerProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const [artFlipStyle, setArtFlipStyle] = useState<React.CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const artShellRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startY: 0, lastY: 0, lastTime: 0, velocity: 0 });

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
    accentColor,
    miniArtRect,
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
    removeFromUpNext,
    reorderUpNext,
    removeTrack,
    reorderQueueTail,
  } = usePlayer();

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  function handleLike() {
    if (!isLiked) setBurstKey((k) => k + 1);
    toggleLiked();
  }

  useEffect(() => {
    setArtLoaded(false);
  }, [currentTrack?.coverUrl]);

  // --- Shared-element "grow from the mini player" transition ---------------
  useLayoutEffect(() => {
    if (!open || !artShellRef.current) {
      return;
    }
    if (!miniArtRect) {
      // No known origin (e.g. deep-linked straight into the full player) — just fade in.
      setArtFlipStyle({ opacity: 0, transition: "none" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setArtFlipStyle({ opacity: 1, transition: "opacity 0.35s ease" });
        });
      });
      return;
    }

    const artRect = artShellRef.current.getBoundingClientRect();
    const scaleX = miniArtRect.width / artRect.width;
    const scaleY = miniArtRect.height / artRect.height;
    const translateX = miniArtRect.left + miniArtRect.width / 2 - (artRect.left + artRect.width / 2);
    const translateY = miniArtRect.top + miniArtRect.height / 2 - (artRect.top + artRect.height / 2);

    // Snap instantly to the mini player's position/size (no transition)...
    setArtFlipStyle({
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
      borderRadius: "9px",
      transition: "none",
    });

    // ...then, next paint, animate to the full-size resting position.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setArtFlipStyle({
          transform: "translate(0px, 0px) scale(1, 1)",
          borderRadius: "16px",
          transition: "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
        });
      });
    });
  }, [open, miniArtRect]);

  // --- Real drag-to-dismiss physics -----------------------------------------
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = {
      dragging: true,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: performance.now(),
      velocity: 0,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (rootRef.current) rootRef.current.style.transition = "none";
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds.dragging) return;
    let delta = e.clientY - ds.startY;
    if (delta < 0) delta *= 0.25; // rubber-band if dragged upward past the resting position

    const now = performance.now();
    const dt = Math.max(1, now - ds.lastTime);
    ds.velocity = (e.clientY - ds.lastY) / dt; // px/ms
    ds.lastY = e.clientY;
    ds.lastTime = now;

    if (rootRef.current) {
      rootRef.current.style.transform = `translateY(${Math.max(0, delta)}px)`;
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      ds.dragging = false;

      const delta = Math.max(0, e.clientY - ds.startY);
      const isFastFlick = ds.velocity > 0.55;
      const isFarEnough = delta > window.innerHeight * 0.4;
      const shouldClose = isFastFlick || isFarEnough;

      if (rootRef.current) {
        rootRef.current.style.transition = "";
        rootRef.current.style.transform = "";
      }

      if (shouldClose) onClose();
    },
    [onClose]
  );

  // --- Queue drag-to-reorder -------------------------------------------------
  const [dragQueueItem, setDragQueueItem] = useState<{
    list: "upnext" | "tail";
    index: number;
    deltaY: number;
  } | null>(null);
  const queueDragRef = useRef({ startY: 0 });

  function handleQueueDragStart(list: "upnext" | "tail", index: number, e: React.PointerEvent) {
    e.stopPropagation();
    queueDragRef.current.startY = e.clientY;
    setDragQueueItem({ list, index, deltaY: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handleQueueDragMove(e: React.PointerEvent) {
    if (!dragQueueItem) return;
    e.stopPropagation();
    const deltaY = e.clientY - queueDragRef.current.startY;
    setDragQueueItem((prev) => (prev ? { ...prev, deltaY } : prev));
  }

  function handleQueueDragEnd(e: React.PointerEvent) {
    if (!dragQueueItem) return;
    e.stopPropagation();
    const rowsMoved = Math.round(dragQueueItem.deltaY / ROW_HEIGHT);
    if (rowsMoved !== 0) {
      const listLength = dragQueueItem.list === "upnext" ? upNextQueue.length : queue.length - currentIndex - 1;
      const to = Math.min(Math.max(dragQueueItem.index + rowsMoved, 0), listLength - 1);
      if (to !== dragQueueItem.index) {
        if (dragQueueItem.list === "upnext") reorderUpNext(dragQueueItem.index, to);
        else reorderQueueTail(dragQueueItem.index, to);
      }
    }
    setDragQueueItem(null);
  }

  if (!currentTrack) return null;

  const displayProgress = seekDrag !== null ? seekDrag : progress;
  const progressPercent = duration > 0 ? (displayProgress / duration) * 100 : 0;
  const tailQueue = queue.slice(currentIndex + 1);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${open ? styles.open : ""}`}
      style={
        {
          backgroundImage: currentTrack.coverUrl ? `url(${currentTrack.coverUrl})` : undefined,
          "--track-accent": accentColor || undefined,
        } as React.CSSProperties
      }
    >
      <div className={styles.overlay} />

      <div
        className={styles.dragArea}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
              {isPlaying && (
                <div className={styles.nowPlayingBadge} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            {upNextQueue.length > 0 && (
              <>
                <div className={styles.queueHeader}>Up Next</div>
                {upNextQueue.map((t, i) => {
                  const isDragging = dragQueueItem?.list === "upnext" && dragQueueItem.index === i;
                  return (
                    <div
                      key={t.id}
                      className={`${styles.queueRow} ${isDragging ? styles.queueRowDragging : ""}`}
                      style={isDragging ? { transform: `translateY(${dragQueueItem.deltaY}px)` } : undefined}
                    >
                      <button
                        className={styles.dragHandleBtn}
                        onPointerDown={(e) => handleQueueDragStart("upnext", i, e)}
                        onPointerMove={handleQueueDragMove}
                        onPointerUp={handleQueueDragEnd}
                        onPointerCancel={handleQueueDragEnd}
                        aria-label={`Reorder ${t.title}`}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                        </svg>
                      </button>
                      <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                      <div className={styles.queueInfo}>
                        <div className={styles.queueTitle}>{t.title}</div>
                        <div className={styles.queueArtist}>{t.artist}</div>
                      </div>
                      <button
                        className={styles.removeBtn}
                        onClick={() => removeFromUpNext(t.id)}
                        aria-label={`Remove ${t.title} from queue`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width="14" height="14">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {tailQueue.length > 0 && (
              <>
                <div className={styles.queueHeader}>Next from: {currentTrack.album || "Playlist"}</div>
                {tailQueue.map((t, i) => {
                  const isDragging = dragQueueItem?.list === "tail" && dragQueueItem.index === i;
                  return (
                    <div
                      key={t.id}
                      className={`${styles.queueRow} ${isDragging ? styles.queueRowDragging : ""}`}
                      style={isDragging ? { transform: `translateY(${dragQueueItem.deltaY}px)` } : undefined}
                    >
                      <button
                        className={styles.dragHandleBtn}
                        onPointerDown={(e) => handleQueueDragStart("tail", i, e)}
                        onPointerMove={handleQueueDragMove}
                        onPointerUp={handleQueueDragEnd}
                        onPointerCancel={handleQueueDragEnd}
                        aria-label={`Reorder ${t.title}`}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                        </svg>
                      </button>
                      <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                      <div className={styles.queueInfo}>
                        <div className={styles.queueTitle}>{t.title}</div>
                        <div className={styles.queueArtist}>{t.artist}</div>
                      </div>
                      <button
                        className={styles.removeBtn}
                        onClick={() => removeTrack(t.id)}
                        aria-label={`Remove ${t.title} from queue`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width="14" height="14">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : (
          <div className={styles.artContainer}>
            <div ref={artShellRef} className={styles.artShell} style={artFlipStyle}>
              {currentTrack.coverUrl ? (
                <>
                  {!artLoaded && <div className={`${styles.art} skeleton`} style={{ position: "absolute", inset: 0 }} />}
                  <img
                    className={`${styles.art} ${artLoaded ? styles.loaded : ""}`}
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    onLoad={() => setArtLoaded(true)}
                  />
                </>
              ) : (
                <div className={`${styles.art} ${styles.artFallback} ${styles.loaded}`}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              )}
            </div>
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
            onClick={handleLike}
            aria-label={isLiked ? "Unlike" : "Like"}
          >
            <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
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

          <div className={styles.volumeGroup}>
            <button
              className={styles.iconBtn}
              onClick={() => setShowVolume((v) => !v)}
              aria-label="Volume"
              aria-expanded={showVolume}
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
            <div className={`${styles.volumeSliderWrap} ${showVolume ? styles.volumeOpen : ""}`}>
              <input
                type="range"
                className={styles.volumeSlider}
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                tabIndex={showVolume ? 0 : -1}
              />
            </div>
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
