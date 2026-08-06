"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePlayer } from "./PlayerContext";
import { Scrubber } from "./Scrubber";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import styles from "./MiniPlayer.module.css";

const PETAL_COUNT = 6;
const SWIPE_COMMIT_PX = 46; // horizontal drag distance that commits to a track skip
const SWIPE_COMMIT_VELOCITY = 0.5; // px/ms flick speed that commits regardless of distance
const EXPAND_COMMIT_PX = -28; // vertical drag up that commits to expanding the full player

/**
 * Compact "now playing" bar. Deliberately minimal — art, title/artist, like, play/pause —
 * with swipe gestures carrying the rest: swipe up (or tap) to expand, swipe left/right to
 * skip tracks. Keeping it to two buttons is what keeps it feeling like a real app bar
 * instead of a second toolbar competing with the FullPlayer underneath it.
 */
export function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    seekTo,
    beginSeek,
    togglePlay,
    next,
    prev,
    isLiked,
    toggleLiked,
    accentColor,
    setMiniArtRect,
    activeLyricLine,
    addToQueue,
    lyrics,
    activeLyricIndex,
  } = usePlayer();
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const artWrapRef = useRef<HTMLDivElement>(null);

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

  // --- Gestures: swipe up (or tap) to expand, swipe left/right to skip ------
  const gesture = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
    axis: null as "x" | "y" | null,
    longPressTimer: null as any,
    longPressed: false,
  });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [gestureActive, setGestureActive] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  function isInteractive(el: HTMLElement) {
    return !!el.closest(`.${styles.playBtn}, .${styles.likeBtn}, .${styles.scrubRow}`);
  }

  const handleExpand = useCallback(() => {
    if (artWrapRef.current) {
      setMiniArtRect(artWrapRef.current.getBoundingClientRect());
    }
    onExpand();
  }, [onExpand, setMiniArtRect]);

  const handleGesturePointerDown = useCallback((e: React.PointerEvent) => {
    if (isInteractive(e.target as HTMLElement)) return;
    const g = gesture.current;
    g.active = true;
    g.pointerId = e.pointerId;
    g.startX = g.lastX = e.clientX;
    g.startY = g.lastY = e.clientY;
    g.lastT = performance.now();
    g.vx = g.vy = 0;
    g.axis = null;
    g.longPressed = false;

    // Clear any previous timer
    if (g.longPressTimer) clearTimeout(g.longPressTimer);
    
    // Set 450ms long press threshold to distinct from tap-to-expand/swipes
    g.longPressTimer = setTimeout(() => {
      if (g.active && !g.axis && Math.abs(g.lastX - g.startX) < 10 && Math.abs(g.lastY - g.startY) < 10) {
        g.longPressed = true;
        import("@/lib/haptics").then((h) => h.vibrate(15));
        setMenuPos({ x: g.lastX, y: g.lastY });
        // Suppress gesture from firing swipe or expand
        setGestureActive(false);
        setDragOffset({ x: 0, y: 0 });
      }
    }, 450);

    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handleGesturePointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.active || g.pointerId !== e.pointerId) return;
    
    g.lastX = e.clientX;
    g.lastY = e.clientY;

    if (g.longPressed) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    // Cancel long press if user drags away
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (g.longPressTimer) {
        clearTimeout(g.longPressTimer);
        g.longPressTimer = null;
      }
    }

    if (!g.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      setGestureActive(true);
    }

    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    g.vx = (e.clientX - g.lastX) / dt;
    g.vy = (e.clientY - g.lastY) / dt;
    g.lastT = now;

    if (g.axis === "x") {
      setDragOffset({ x: dx, y: 0 });
    } else if (g.axis === "y") {
      // Rubber-band: let it move up freely but resist dragging the bar downward.
      const clamped = dy < 0 ? dy : dy * 0.15;
      setDragOffset({ x: 0, y: clamped });
    }
  }, []);

  const endGesture = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (g.longPressTimer) {
        clearTimeout(g.longPressTimer);
        g.longPressTimer = null;
      }

      if (!g.active || g.pointerId !== e.pointerId) return;
      g.active = false;
      setGestureActive(false);

      if (g.longPressed) {
        g.longPressed = false;
        setDragOffset({ x: 0, y: 0 });
        return;
      }

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const axis = g.axis;
      g.axis = null;

      if (axis === "x") {
        const committed = Math.abs(dx) > SWIPE_COMMIT_PX || Math.abs(g.vx) > SWIPE_COMMIT_VELOCITY;
        if (committed) {
          import("@/lib/haptics").then((h) => h.vibrate(10));
          if (dx < 0) next();
          else prev();
        }
      } else if (axis === "y") {
        if (dy < EXPAND_COMMIT_PX || g.vy < -0.5) {
          import("@/lib/haptics").then((h) => h.vibrate(8));
          handleExpand();
        }
      } else {
        // No meaningful movement — treat as a tap-to-expand.
        handleExpand();
      }

      setDragOffset({ x: 0, y: 0 });
    },
    [next, prev, handleExpand]
  );

  if (!currentTrack) return null;

  function handleLike() {
    if (!isLiked) {
      setBurstKey((k) => k + 1);
      import("@/lib/haptics").then((h) => h.vibrate(12));
    }
    toggleLiked();
  }

  const transform =
    dragOffset.x !== 0
      ? `translateX(${dragOffset.x}px)`
      : dragOffset.y !== 0
      ? `translateY(${dragOffset.y}px)`
      : undefined;
  const opacity = dragOffset.x !== 0 ? Math.max(0.35, 1 - Math.abs(dragOffset.x) / 160) : undefined;

  return (
    <div
      className={`${styles.root} ${activeLyricLine ? styles.hasLyrics : ""}`}
      style={
        {
          "--track-accent": accentColor || undefined,
          transform,
          opacity,
          transition: gestureActive ? "none" : undefined,
        } as React.CSSProperties
      }
      onPointerDown={handleGesturePointerDown}
      onPointerMove={handleGesturePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <div className={styles.scrubRow}>
        <Scrubber
          progress={progress}
          duration={duration}
          accentColor={accentColor}
          variant="mini"
          onScrubStart={beginSeek}
          onSeek={(t) => seekTo(t)}
        />
      </div>

      {activeLyricLine && (
        <div
          className={styles.lyricTicker}
          onClick={(e) => {
            e.stopPropagation();
            if (lyrics?.lines && activeLyricIndex >= 0) {
              const line = lyrics.lines[activeLyricIndex];
              if (line) seekTo(line.time);
            }
          }}
          style={{ cursor: "pointer" }}
          tabIndex={0}
          role="button"
          aria-label={`Current lyric line: ${activeLyricLine}. Press to jump playback here.`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              if (lyrics?.lines && activeLyricIndex >= 0) {
                const line = lyrics.lines[activeLyricIndex];
                if (line) seekTo(line.time);
              }
            }
          }}
        >
          {activeLyricLine}
        </div>
      )}

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
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
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
          <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
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

      {menuPos && (
        <ContextMenu x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              addToQueue(currentTrack);
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
          >
            Add to Queue
          </ContextMenuItem>
          {currentTrack.artistId && (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                window.location.href = `/artist/${currentTrack.artistId}`;
              }}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
            >
              Go to Artist
            </ContextMenuItem>
          )}
          {currentTrack.albumId && (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                window.location.href = `/album/${currentTrack.albumId}`;
              }}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>}
            >
              Go to Album
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              if (navigator.share) {
                navigator.share({ title: currentTrack.title, url: `${window.location.origin}/track/${currentTrack.id}` }).catch(() => {});
              } else {
                navigator.clipboard.writeText(`${window.location.origin}/track/${currentTrack.id}`);
              }
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>}
          >
            Share
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
