"use client";

import { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePlayer } from "./PlayerContext";
import { getLyrics, LyricData, LyricLine } from "@/lib/lyrics";
import { Scrubber } from "./Scrubber";
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
  const [showFullLyrics, setShowFullLyrics] = useState(false);
  const [showArtLyrics, setShowArtLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const [artFlipStyle, setArtFlipStyle] = useState<React.CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const artShellRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
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
    setLyrics(null);
    if (!currentTrack) return;

    setLoadingLyrics(true);
    getLyrics(currentTrack)
      .then((data) => {
        setLyrics(data);
      })
      .catch(() => {})
      .finally(() => setLoadingLyrics(false));
  }, [currentTrack?.id]);

  // Sync scroll for the lyrics container
  const activeLineIndex = useMemo(() => {
    if (!lyrics || !lyrics.lines) return -1;
    const currentProgress = seekDrag !== null ? seekDrag : progress;
    // Find largest time less than or equal to current progress
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time <= currentProgress) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [lyrics, progress, seekDrag]);

  useEffect(() => {
    if (activeLineIndex !== -1 && lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLineIndex] as HTMLElement;
      if (activeEl) {
        lyricsContainerRef.current.scrollTo({
          top: activeEl.offsetTop - lyricsContainerRef.current.clientHeight / 2 + activeEl.clientHeight / 2,
          behavior: "smooth"
        });
      }
    }
  }, [activeLineIndex]);

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
  const LONG_PRESS_MS = 260;
  const MOVE_CANCEL_THRESHOLD = 10;

  const [dragQueueItem, setDragQueueItem] = useState<{
    list: "upnext" | "tail";
    index: number;
    deltaY: number;
    rowHeight: number;
  } | null>(null);

  const pressState = useRef<{
    pointerId: number;
    list: "upnext" | "tail";
    index: number;
    startY: number;
    startX: number;
    rowEl: HTMLElement;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    active: boolean;
  } | null>(null);

  const finishQueueDrag = useCallback(
    (finalDeltaY: number | null) => {
      const ps = pressState.current;
      if (ps?.longPressTimer) clearTimeout(ps.longPressTimer);
      pressState.current = null;

      setDragQueueItem((current) => {
        if (!current) return null;
        if (finalDeltaY !== null) {
          const rowsMoved = Math.round(finalDeltaY / current.rowHeight);
          if (rowsMoved !== 0) {
            const listLength = current.list === "upnext" ? upNextQueue.length : queue.length - currentIndex - 1;
            const to = Math.min(Math.max(current.index + rowsMoved, 0), Math.max(0, listLength - 1));
            if (to !== current.index) {
              if (current.list === "upnext") reorderUpNext(current.index, to);
              else reorderQueueTail(current.index, to);
            }
          }
        }
        return null;
      });
    },
    [upNextQueue.length, queue.length, currentIndex, reorderUpNext, reorderQueueTail]
  );

  useEffect(() => {
    if (!dragQueueItem) return;
    function forceEnd() {
      finishQueueDrag(null);
    }
    window.addEventListener("pointerup", forceEnd);
    window.addEventListener("pointercancel", forceEnd);
    window.addEventListener("blur", forceEnd);
    return () => {
      window.removeEventListener("pointerup", forceEnd);
      window.removeEventListener("pointercancel", forceEnd);
      window.removeEventListener("blur", forceEnd);
    };
  }, [dragQueueItem, finishQueueDrag]);

  useEffect(() => {
    if (!dragQueueItem) return;
    const listLength = dragQueueItem.list === "upnext" ? upNextQueue.length : queue.length - currentIndex - 1;
    if (dragQueueItem.index >= listLength) finishQueueDrag(null);
  }, [upNextQueue.length, queue.length, currentIndex, dragQueueItem, finishQueueDrag]);

  function handleRowPointerDown(list: "upnext" | "tail", index: number, e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    if (e.button !== undefined && e.button !== 0) return;

    const rowEl = e.currentTarget as HTMLElement;
    const timer = setTimeout(() => {
      const ps = pressState.current;
      if (!ps) return;
      ps.active = true;
      rowEl.setPointerCapture?.(ps.pointerId);
      setDragQueueItem({ list, index, deltaY: 0, rowHeight: rowEl.getBoundingClientRect().height || ROW_HEIGHT });
    }, LONG_PRESS_MS);

    pressState.current = {
      pointerId: e.pointerId,
      list,
      index,
      startY: e.clientY,
      startX: e.clientX,
      rowEl,
      longPressTimer: timer,
      active: false,
    };
  }

  function handleRowPointerMove(e: React.PointerEvent) {
    const ps = pressState.current;
    if (!ps) return;

    if (!ps.active) {
      const dx = Math.abs(e.clientX - ps.startX);
      const dy = Math.abs(e.clientY - ps.startY);
      if (dx > MOVE_CANCEL_THRESHOLD || dy > MOVE_CANCEL_THRESHOLD) {
        if (ps.longPressTimer) clearTimeout(ps.longPressTimer);
        pressState.current = null;
      }
      return;
    }

    e.preventDefault();
    const deltaY = e.clientY - ps.startY;
    setDragQueueItem((prev) => (prev ? { ...prev, deltaY } : prev));
  }

  function handleRowPointerUp(e: React.PointerEvent) {
    const ps = pressState.current;
    if (!ps) return;
    if (!ps.active) {
      if (ps.longPressTimer) clearTimeout(ps.longPressTimer);
      pressState.current = null;
      return;
    }
    const finalDeltaY = e.clientY - ps.startY;
    finishQueueDrag(finalDeltaY);
  }

  function handleRowPointerCancel() {
    finishQueueDrag(null);
  }

  if (!currentTrack) return null;

  const displayProgress = seekDrag !== null ? seekDrag : progress;
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
                      style={isDragging ? { transform: `translateY(${dragQueueItem.deltaY}px)`, transition: "none" } : undefined}
                      onPointerDown={(e) => handleRowPointerDown("upnext", i, e)}
                      onPointerMove={handleRowPointerMove}
                      onPointerUp={handleRowPointerUp}
                      onPointerCancel={handleRowPointerCancel}
                    >
                      <span className={styles.dragGrip} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                        </svg>
                      </span>
                      <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                      <div className={styles.queueInfo}>
                        <div className={styles.queueTitle}>{t.title}</div>
                        <div className={styles.queueArtist}>{t.artist}</div>
                      </div>
                      <button
                        data-no-drag
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
                      style={isDragging ? { transform: `translateY(${dragQueueItem.deltaY}px)`, transition: "none" } : undefined}
                      onPointerDown={(e) => handleRowPointerDown("tail", i, e)}
                      onPointerMove={handleRowPointerMove}
                      onPointerUp={handleRowPointerUp}
                      onPointerCancel={handleRowPointerCancel}
                    >
                      <span className={styles.dragGrip} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                        </svg>
                      </span>
                      <img src={t.coverUrl || ""} alt="" className={styles.queueArt} />
                      <div className={styles.queueInfo}>
                        <div className={styles.queueTitle}>{t.title}</div>
                        <div className={styles.queueArtist}>{t.artist}</div>
                      </div>
                      <button
                        data-no-drag
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
        ) : showFullLyrics ? (
          // Dedicated Full Synced Lyrics Panel
          <div className={styles.fullLyricsContainer}>
            <div className={styles.fullLyricsHeader}>
              <span>Lyrics</span>
              <button className={styles.closeLyricsBtn} onClick={() => setShowFullLyrics(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {loadingLyrics ? (
              <div className={styles.lyricsStatus}>Loading lyrics...</div>
            ) : lyrics?.lines ? (
              <div ref={lyricsContainerRef} className={styles.lyricsList}>
                {lyrics.lines.map((line, idx) => (
                  <p
                    key={idx}
                    className={`${styles.lyricLine} ${idx === activeLineIndex ? styles.lyricLineActive : ""}`}
                    onClick={() => seek(line.time)}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            ) : lyrics?.lyrics ? (
              <div className={styles.plainLyricsText}>
                {lyrics.lyrics.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            ) : (
              <div className={styles.lyricsStatus}>Lyrics unavailable</div>
            )}
          </div>
        ) : (
          <div className={styles.artContainer}>
            <div
              ref={artShellRef}
              className={styles.artShell}
              style={artFlipStyle}
              onClick={() => {
                if (lyrics?.lines || lyrics?.lyrics) {
                  setShowArtLyrics(!showArtLyrics);
                }
              }}
            >
              {showArtLyrics && (lyrics?.lines || lyrics?.lyrics) ? (
                // Line-by-line album art overlay
                <div className={styles.artLyricsOverlay}>
                  {lyrics?.lines ? (
                    <div className={styles.rollingLyricWrap}>
                      <p className={styles.rollingLyricLineActive}>
                        {lyrics.lines[activeLineIndex]?.text || "♪"}
                      </p>
                      <p className={styles.rollingLyricLineNext}>
                        {lyrics.lines[activeLineIndex + 1]?.text || ""}
                      </p>
                    </div>
                  ) : (
                    <div className={styles.rollingLyricWrap}>
                      <p className={styles.rollingLyricLineActive}>Plain text lyrics loaded</p>
                      <p className={styles.rollingLyricLineNext}>Tap player icon to view full text</p>
                    </div>
                  )}
                </div>
              ) : currentTrack.coverUrl ? (
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
        {!showQueue && !showFullLyrics && (
          <div className={styles.trackInfo}>
            <div className={styles.trackTitle}>{currentTrack.title}</div>
            <div className={styles.trackArtist}>{currentTrack.artist}</div>
          </div>
        )}

        <Scrubber
          progress={progress}
          duration={duration}
          accentColor={accentColor}
          variant="full"
          formatTime={formatTime}
          onScrubStart={beginSeek}
          onScrubMove={(t) => setSeekDrag(t)}
          onSeek={(t) => {
            seek(t);
            endSeek(t);
            setSeekDrag(null);
          }}
        />
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

          {/* Toggle Full Synced Lyrics Panel */}
          <button
            className={`${styles.iconBtn} ${(lyrics?.lines || lyrics?.lyrics) ? styles.lyricsAvailableBtn : ""} ${showFullLyrics ? styles.activeBtn : ""}`}
            onClick={() => setShowFullLyrics(!showFullLyrics)}
            aria-label="Toggle Lyrics View"
            title="Lyrics"
            disabled={!lyrics?.lines && !lyrics?.lyrics}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M12 20h9M3 20h6M3 12h18M3 4h18" />
            </svg>
          </button>

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

        {/* Artist Card & Song Credits */}
        <ArtistCreditsPanel currentTrack={currentTrack} />
      </div>
    </div>
  );
}

interface ArtistDetail {
  id: string;
  name: string;
  imageUrl?: string | null;
  bio?: string | null;
}

interface CreditDetail {
  id: string;
  name: string;
  role: string;
}

function ArtistCreditsPanel({ currentTrack }: { currentTrack: any }) {
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [credits, setCredits] = useState<CreditDetail[]>([]);
  const [samples, setSamples] = useState<any[]>([]);
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;

    // Load track credits
    fetch(`/api/tracks/${currentTrack.id}/credits`)
      .then(res => res.json())
      .then(data => {
        if (data.credits) setCredits(data.credits);
        if (data.samples) setSamples(data.samples);
      })
      .catch(() => {});

    // Load artist info
    if (currentTrack.artistId) {
      fetch(`/api/artists/${currentTrack.artistId}`)
        .then(res => res.json())
        .then(data => {
          if (data) {
            setArtist({
              id: data.id,
              name: data.name,
              imageUrl: data.imageUrl,
              bio: data.bio
            });
          }
        })
        .catch(() => {});
    }
  }, [currentTrack]);

  if (!currentTrack) return null;

  return (
    <div className={styles.artistCreditsWrap}>
      {/* Artist Profile Section */}
      {artist && (
        <div className={styles.artistProfileCard}>
          <div className={styles.artistProfileHeader}>
            {artist.imageUrl ? (
              <img src={artist.imageUrl} alt="" className={styles.artistProfileAvatar} />
            ) : (
              <div className={styles.artistProfileAvatarFallback}>
                {artist.name[0]?.toUpperCase()}
              </div>
            )}
            <div className={styles.artistProfileInfo}>
              <div className={styles.artistProfileLabel}>About the Artist</div>
              <Link href={`/artist/${artist.id}`} className={styles.artistProfileName}>
                {artist.name}
              </Link>
            </div>
          </div>
          {artist.bio && (
            <div className={styles.artistProfileBioWrap}>
              <p className={`${styles.artistProfileBio} ${bioExpanded ? styles.bioExpanded : ""}`}>
                {artist.bio}
              </p>
              {artist.bio.length > 120 && (
                <button
                  className={styles.bioReadMoreBtn}
                  onClick={() => setBioExpanded(!bioExpanded)}
                >
                  {bioExpanded ? "Show Less" : "Read More"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Song Credits Section */}
      {credits.length > 0 && (
        <div className={styles.songCreditsCard}>
          <h3 className={styles.creditsSectionTitle}>Song Credits</h3>
          <div className={styles.creditsList}>
            {credits.map((credit) => (
              <div key={credit.id} className={styles.creditRow}>
                <span className={styles.creditName}>{credit.name}</span>
                <span className={styles.creditRole}>{credit.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Samples Section */}
      {samples.length > 0 && (
        <div className={styles.songCreditsCard}>
          <h3 className={styles.creditsSectionTitle}>Samples / Inclusions</h3>
          <div className={styles.creditsList}>
            {samples.map((sample, idx) => (
              <div key={idx} className={styles.creditRow}>
                <span className={styles.creditName}>
                  {sample.trackTitle}
                </span>
                <span className={styles.creditRole}>
                  {sample.sampleType === "samples" ? "Samples" : "Interpolated"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
