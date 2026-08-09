"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePlayer } from "./PlayerContext";
import { useRouter } from "next/navigation";
import { Scrubber } from "./Scrubber";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import {
  PlayIcon,
  PauseIcon,
  HeartIcon,
  MusicNoteIcon,
  QueueIcon,
  UserIcon,
  AlbumIcon,
  ShareIcon,
  PrevIcon,
  NextIcon,
} from "./Icons";
import styles from "./MiniPlayer.module.css";

const PETAL_COUNT = 6;
const SWIPE_COMMIT_PX = 46; // horizontal drag distance that commits to a track skip
const SWIPE_COMMIT_VELOCITY = 0.5; // px/ms flick speed that commits regardless of distance
const EXPAND_COMMIT_PX = -28; // vertical drag up that commits to expanding the full player
const LONG_PRESS_MS = 450;
const AXIS_LOCK_PX = 6; // movement before we decide this is a horizontal or vertical drag

/**
 * Compact "now playing" bar. Deliberately minimal — art, title/artist, like,
 * play/pause — with gestures carrying the rest: swipe up (or tap) to expand,
 * swipe left/right to skip, long-press for the context menu.
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
  const router = useRouter();
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);
  const artWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setArtLoaded(false);
  }, [currentTrack?.coverUrl]);

  // Keep the last-known art position fresh so the Full Player can grow out of
  // it the instant it's asked to (avoids a stale rect from before a resize).
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

  // --- Gestures -------------------------------------------------------------
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
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressed: false,
  });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [gestureActive, setGestureActive] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  /**
   * Controls and the scrub strip own their own taps. Anything else on the bar
   * belongs to the gesture layer.
   */
  function isInteractive(el: HTMLElement) {
    return !!el.closest(
      `.${styles.playBtn}, .${styles.likeBtn}, .${styles.scrubRow}, .${styles.lyricTicker}`
    );
  }

  const handleExpand = useCallback(() => {
    if (artWrapRef.current) {
      setMiniArtRect(artWrapRef.current.getBoundingClientRect());
    }
    onExpand();
  }, [onExpand, setMiniArtRect]);

  const handleGesturePointerDown = useCallback((e: React.PointerEvent) => {
    if (isInteractive(e.target as HTMLElement)) return;
    // Ignore secondary buttons and multi-touch; both produce nonsense drags.
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const g = gesture.current;
    g.active = true;
    g.pointerId = e.pointerId;
    g.startX = g.lastX = e.clientX;
    g.startY = g.lastY = e.clientY;
    g.lastT = performance.now();
    g.vx = g.vy = 0;
    g.axis = null;
    g.longPressed = false;

    if (g.longPressTimer) clearTimeout(g.longPressTimer);
    g.longPressTimer = setTimeout(() => {
      if (
        g.active &&
        !g.axis &&
        Math.abs(g.lastX - g.startX) < 10 &&
        Math.abs(g.lastY - g.startY) < 10
      ) {
        g.longPressed = true;
        import("@/lib/haptics").then((h) => h.vibrate(15));
        setMenuPos({ x: g.lastX, y: g.lastY });
        setGestureActive(false);
        setDragOffset({ x: 0, y: 0 });
      }
    }, LONG_PRESS_MS);

    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handleGesturePointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.active || g.pointerId !== e.pointerId) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    // Cancel the long press once the finger travels.
    if ((Math.abs(dx) > 10 || Math.abs(dy) > 10) && g.longPressTimer) {
      clearTimeout(g.longPressTimer);
      g.longPressTimer = null;
    }

    /*
     * Velocity has to be measured against the *previous* sample. The old code
     * assigned `g.lastX = e.clientX` at the top of this handler and then
     * computed `(e.clientX - g.lastX) / dt` — always exactly zero. Flick-to-skip
     * therefore never fired on velocity; only a slow 46px drag worked, which is
     * why quick swipes felt like they did nothing.
     */
    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    g.vx = (e.clientX - g.lastX) / dt;
    g.vy = (e.clientY - g.lastY) / dt;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.lastT = now;

    if (g.longPressed) return;

    if (!g.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      setGestureActive(true);
    }

    if (g.axis === "x") {
      setDragOffset({ x: dx, y: 0 });
    } else {
      // Rubber-band: free upward, resistant downward.
      setDragOffset({ x: 0, y: dy < 0 ? dy : dy * 0.15 });
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
        const committed =
          Math.abs(dx) > SWIPE_COMMIT_PX || Math.abs(g.vx) > SWIPE_COMMIT_VELOCITY;
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
        // No axis was ever locked — a tap.
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
      ? `translate3d(${dragOffset.x}px,0,0)`
      : dragOffset.y !== 0
        ? `translate3d(0,${dragOffset.y}px,0)`
        : undefined;
  const opacity =
    dragOffset.x !== 0 ? Math.max(0.35, 1 - Math.abs(dragOffset.x) / 160) : undefined;

  // Show the user which way they're committing, once past the threshold.
  const armedNext = dragOffset.x < -SWIPE_COMMIT_PX;
  const armedPrev = dragOffset.x > SWIPE_COMMIT_PX;

  const lyricSeek = () => {
    if (lyrics?.lines && activeLyricIndex >= 0) {
      const line = lyrics.lines[activeLyricIndex];
      if (line) seekTo(line.time);
    }
  };

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

      <span
        className={`${styles.swipeHint} ${styles.swipeHintPrev} ${armedPrev ? styles.swipeHintArmed : ""}`}
        aria-hidden="true"
      >
        <PrevIcon size={12} /> Prev
      </span>
      <span
        className={`${styles.swipeHint} ${styles.swipeHintNext} ${armedNext ? styles.swipeHintArmed : ""}`}
        aria-hidden="true"
      >
        Next <NextIcon size={12} />
      </span>

      {activeLyricLine && (
        <div
          className={styles.lyricTicker}
          onClick={lyricSeek}
          tabIndex={0}
          role="button"
          aria-label={`Current lyric: ${activeLyricLine}. Activate to jump playback here.`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              lyricSeek();
            }
          }}
        >
          {activeLyricLine}
        </div>
      )}

      <div className={styles.content}>
        <div
          ref={artWrapRef}
          className={`${styles.artWrap} ${isPlaying ? styles.playing : ""}`}
        >
          {currentTrack.coverUrl ? (
            <>
              {!artLoaded && (
                <div
                  className={`${styles.art} skeleton`}
                  style={{ position: "absolute", inset: 0, opacity: 1 }}
                />
              )}
              <img
                className={`${styles.art} ${artLoaded ? styles.loaded : ""}`}
                src={currentTrack.coverUrl}
                alt=""
                onLoad={() => setArtLoaded(true)}
              />
            </>
          ) : (
            <div className={`${styles.art} ${styles.artFallback} ${styles.loaded}`}>
              <MusicNoteIcon size={16} />
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
          aria-label={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          aria-pressed={isLiked}
        >
          <HeartIcon size={17} filled={isLiked} />
          {burstKey > 0 &&
            Array.from({ length: PETAL_COUNT }).map((_, i) => (
              <span
                key={`${burstKey}-${i}`}
                className={styles.petal}
                style={{ "--rot": `${(360 / PETAL_COUNT) * i}deg` } as React.CSSProperties}
              />
            ))}
        </button>

        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
        </button>
      </div>

      {menuPos && (
        <ContextMenu x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              addToQueue(currentTrack);
            }}
            icon={<QueueIcon size={16} />}
          >
            Add to queue
          </ContextMenuItem>
          {currentTrack.artistId && (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                router.push(`/artist/${currentTrack.artistId}`);
              }}
              icon={<UserIcon size={16} />}
            >
              Go to artist
            </ContextMenuItem>
          )}
          {currentTrack.albumId && (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                router.push(`/album/${currentTrack.albumId}`);
              }}
              icon={<AlbumIcon size={16} />}
            >
              Go to album
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              window.dispatchEvent(
                new CustomEvent("sakura:share", { detail: { track: currentTrack } })
              );
            }}
            icon={<ShareIcon size={16} />}
          >
            Share
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
