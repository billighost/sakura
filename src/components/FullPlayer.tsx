"use client";

import { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import { usePlayer } from "./PlayerContext";
import { Scrubber } from "./Scrubber";
import { ShareIcon } from "./Icons";
import { CreditsSection } from "./CreditsSection";
import { LyricsPreviewCard } from "./LyricsPreviewCard";
import { QueueModal } from "./QueueModal";
import { LyricsModal } from "./LyricsModal";
import { useShare } from "./share/ShareContext";
import { useDrag } from "@/lib/useDrag";
import { haptic } from "@/lib/haptics";
import type { LyricData } from "@/lib/lyrics";
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
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const [artFlipStyle, setArtFlipStyle] = useState<React.CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const artShellRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    seekTo,
    beginSeek,
    lyrics: contextLyrics,
    loadingLyrics,
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
    goToQueueItem,
    sleepTimerMinutes,
    setSleepTimer,
    autoplayRadio,
  } = usePlayer();

  const { openShare } = useShare();

  /*
   * A transliteration generated in the lyrics view replaces the context's copy
   * for as long as this player is mounted. It isn't pushed back into
   * PlayerContext because it's already written to the IndexedDB lyrics cache,
   * so the next load of this track picks it up through the normal path — and
   * writing it upward would mean a context-wide update per romanisation.
   */
  const [lyricsOverride, setLyricsOverride] = useState<LyricData | null>(null);
  const lyrics = lyricsOverride ?? contextLyrics;

  /*
   * Bumped whenever the lyrics view should snap rather than drift: a seek, or
   * a track change. Without it, tapping a line 40 lines away animates a long
   * smooth scroll to somewhere the song is already playing.
   */
  const [snapToken, setSnapToken] = useState(0);

  /*
   * Reset on track change, adjusted during render rather than in an effect.
   * An effect would run a frame late, so the first paint of a new song would
   * briefly show the previous song's transliteration and let the lyrics view
   * animate a scroll it should have snapped. This is React's documented
   * "adjust state when a prop changes" pattern — the same one Sheet.tsx uses.
   */
  const [lastTrackId, setLastTrackId] = useState(currentTrack?.id);
  if (currentTrack?.id !== lastTrackId) {
    setLastTrackId(currentTrack?.id);
    setLyricsOverride(null);
    setSnapToken((n) => n + 1);
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  /*
   * Every seek goes through here so the lyrics view snaps to the new position
   * instead of gliding to it. A seek is an explicit "put me here"; animating
   * the scroll afterwards reads as lag, and on a long jump it means watching
   * forty lines fly past.
   */
  const seekAndSnap = useCallback(
    (time: number) => {
      seekTo(time);
      setSnapToken((n) => n + 1);
    },
    [seekTo]
  );

  function handleLike() {
    if (!isLiked) setBurstKey((k) => k + 1);
    toggleLiked();
  }

  useEffect(() => {
    setArtLoaded(false);
    setLyricsExpanded(false);
  }, [currentTrack?.id]);

  // The active synced-lyric line, shared by the preview card and the full
  // lyrics modal — uses the live drag-preview value while scrubbing so both
  // stay in sync with what the user is about to seek to.
  const activeLineIndex = useMemo(() => {
    if (!lyrics || !lyrics.lines) return -1;
    const currentProgress = seekDrag !== null ? seekDrag : progress;
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

  // --- Real drag-to-dismiss / swipe-to-skip physics --------------------------
  // A single gesture recogniser covers the whole player: drag down anywhere to
  // dismiss, or swipe the album art left/right to skip. Interactive chrome
  // (buttons, links, the scrubber, queue rows, scrollable lyrics/credits, and
  // the Queue/Lyrics modals) opts out via `blockSelector` so this never steals
  // a tap, a seek or a reorder.
  //
  // The axis is decided at pointer-down rather than by the recogniser: the art
  // is the only region where a horizontal swipe means anything, and letting the
  // rest of the player lock to "x" would swallow drags that should dismiss.
  const [artAxisAllowed, setArtAxisAllowed] = useState(false);

  const playerDrag = useDrag({
    axis: artAxisAllowed ? "both" : "y",
    threshold: 70,
    velocity: 0.55,
    // Down dismisses; up has nothing above it, so it barely gives. Sideways is
    // damped so the art never fully leaves the frame before release.
    resistance: { down: 1, up: 0.25, left: 0.6, right: 0.6 },
    commitDirections: artAxisAllowed ? ["down", "left", "right"] : ["down"],
    enabled: open && !showQueue && !lyricsExpanded,
    blockSelector: 'button, a, input, [role="slider"], [data-block-drag]',
    onCommit: (direction) => {
      if (direction === "down") onClose();
      else if (direction === "left") next();
      else if (direction === "right") prev();
    },
  });

  /**
   * Dismiss is only available from the top of the scroller — otherwise a flick
   * to scroll the credits back up would close the player instead.
   */
  const handlePlayerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scrollContainerRef.current && scrollContainerRef.current.scrollTop > 0) return;
      setArtAxisAllowed(
        !!artShellRef.current && artShellRef.current.contains(e.target as Node)
      );
      playerDrag.bind.onPointerDown(e);
    },
    [playerDrag.bind]
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
              haptic("impact");
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

    e.stopPropagation();

    const gripEl = e.currentTarget as HTMLElement;
    const rowEl = (gripEl.closest("[data-queue-row]") as HTMLElement) || gripEl;

    try {
      gripEl.setPointerCapture?.(e.pointerId);
    } catch {}

    setDragQueueItem({
      list,
      index,
      deltaY: 0,
      rowHeight: rowEl.getBoundingClientRect().height || ROW_HEIGHT,
    });

    pressState.current = {
      pointerId: e.pointerId,
      list,
      index,
      startY: e.clientY,
      startX: e.clientX,
      rowEl,
      longPressTimer: null,
      active: true,
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
    setDragQueueItem((prev) => {
      if (!prev) return prev;
      // Tick once per slot crossed. Without this the row slides silently and the
      // only confirmation arrives on release, well after the decision is made.
      const slot = Math.round(deltaY / prev.rowHeight);
      if (slot !== Math.round(prev.deltaY / prev.rowHeight)) haptic("selection");
      return { ...prev, deltaY };
    });
  }

  function handleRowPointerUp(e: React.PointerEvent) {
    const ps = pressState.current;
    if (!ps) return;
    if (!ps.active) {
      if (ps.longPressTimer) clearTimeout(ps.longPressTimer);
      pressState.current = null;
      // Short tap = jump to that track
      return; // click handler will fire naturally
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

  const dragTransform =
    playerDrag.axis === "y"
      ? `translate3d(0, ${Math.max(0, playerDrag.dy)}px, 0)`
      : playerDrag.axis === "x"
        ? `translate3d(${playerDrag.dx}px, 0, 0)`
        : undefined;

  // The art fades as it's swiped away, so the skip reads as the current track
  // leaving rather than the whole screen sliding for no reason.
  const artDragOpacity =
    playerDrag.axis === "x" ? Math.max(0.4, 1 - Math.abs(playerDrag.dx) / 260) : undefined;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${open ? styles.open : ""}`}
      style={
        {
          backgroundImage: currentTrack.coverUrl ? `url(${currentTrack.coverUrl})` : undefined,
          "--track-accent": accentColor || undefined,
          transform: dragTransform,
          // While the finger is down the transform must track it exactly; the
          // class transition takes back over the moment it lifts and snaps home.
          transition: playerDrag.active && playerDrag.axis ? "none" : undefined,
          touchAction: playerDrag.touchAction,
        } as React.CSSProperties
      }
      {...playerDrag.bind}
      onPointerDown={handlePlayerPointerDown}
    >
      <div className={styles.overlay} />

      <div className={styles.dragArea}>
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

      <div ref={scrollContainerRef} className={styles.scrollContainer}>
        <div className={styles.mainContent}>
          <div className={styles.artContainer}>
            <div
              ref={artShellRef}
              className={styles.artShell}
              style={
                artDragOpacity !== undefined
                  ? { ...artFlipStyle, opacity: artDragOpacity, transition: "none" }
                  : artFlipStyle
              }
            >
              {currentTrack.coverUrl ? (
                <>
                  {!artLoaded && <div className={`${styles.art} skeleton`} style={{ position: "absolute", inset: 0 }} />}
                  <img
                    className={`${styles.art} ${artLoaded ? styles.loaded : ""}`}
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
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
        </div>

        <div className={styles.controls}>
          <div className={styles.trackInfo}>
            <div className={styles.trackTitle}>{currentTrack.title}</div>
            <div className={styles.trackArtist}>{currentTrack.artist}</div>
          </div>

          <Scrubber
            progress={progress}
            duration={duration}
            accentColor={accentColor}
            variant="full"
            formatTime={formatTime}
            onScrubStart={beginSeek}
            onScrubMove={(t) => setSeekDrag(t)}
            onSeek={(t) => {
              seekAndSnap(t);
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

            {/*
              Opens the card generator rather than calling navigator.share with
              the raw URL. Sharing "sakura.app/home" told the recipient nothing
              about what was playing — the generated card carries the artwork,
              the title and the artist.
            */}
            <button
              className={styles.iconBtn}
              onClick={() =>
                openShare({
                  track: currentTrack,
                  lyrics,
                  accentColor,
                  atTime: displayProgress,
                })
              }
              aria-label="Share this track"
            >
              <ShareIcon size={20} />
            </button>

            <button 
              className={`${styles.iconBtn} ${sleepTimerMinutes ? styles.activeBtn : ""}`} 
              onClick={() => {
                const options = [null, 15, 30, 45, 60];
                const currentIndex = options.indexOf(sleepTimerMinutes);
                const nextOption = options[(currentIndex + 1) % options.length];
                setSleepTimer(nextOption);
              }}
              aria-label={sleepTimerMinutes ? `Sleep timer: ${sleepTimerMinutes}m` : "Set sleep timer"}
              title={sleepTimerMinutes ? `Sleep timer: ${sleepTimerMinutes}m` : "Set sleep timer"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {sleepTimerMinutes && (
                <span className={styles.sleepTimerBadge}>{sleepTimerMinutes}</span>
              )}
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

          <LyricsPreviewCard
            lyrics={lyrics}
            loadingLyrics={loadingLyrics}
            activeLineIndex={activeLineIndex}
            onOpen={() => setLyricsExpanded(true)}
          />

          <CreditsSection
            trackId={currentTrack.id}
            artistName={currentTrack.artist}
            artistId={currentTrack.artistId}
          />
        </div>
      </div>

      <QueueModal
        open={showQueue}
        onClose={() => setShowQueue(false)}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        albumLabel={currentTrack.album || "Playlist"}
        currentIndex={currentIndex}
        upNextQueue={upNextQueue}
        tailQueue={tailQueue}
        dragQueueItem={dragQueueItem}
        onRowPointerDown={handleRowPointerDown}
        onRowPointerMove={handleRowPointerMove}
        onRowPointerUp={handleRowPointerUp}
        onRowPointerCancel={handleRowPointerCancel}
        onGoToQueueItem={goToQueueItem}
        onRemoveFromUpNext={removeFromUpNext}
        onRemoveTrack={removeTrack}
        radioActive={autoplayRadio}
      />

      <LyricsModal
        open={lyricsExpanded}
        onClose={() => setLyricsExpanded(false)}
        track={currentTrack}
        lyrics={lyrics}
        loadingLyrics={loadingLyrics}
        activeLineIndex={activeLineIndex}
        accentColor={accentColor}
        onLineClick={seekAndSnap}
        onShareLine={(line) =>
          openShare({
            track: currentTrack,
            lines: [line],
            lyrics,
            accentColor,
            atTime: line.time,
          })
        }
        onShareTrack={() =>
          openShare({ track: currentTrack, lyrics, accentColor, atTime: displayProgress })
        }
        onTransliterated={setLyricsOverride}
        progress={displayProgress}
        duration={duration}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onNext={next}
        onPrev={prev}
        onScrubStart={beginSeek}
        onScrubMove={(t) => setSeekDrag(t)}
        onSeek={(t) => {
          seekAndSnap(t);
          setSeekDrag(null);
        }}
        formatTime={formatTime}
        snapToken={snapToken}
      />
    </div>
  );
}
