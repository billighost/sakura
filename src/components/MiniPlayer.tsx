"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePlayer } from "./PlayerContext";
import { useRouter } from "next/navigation";
import { Scrubber } from "./Scrubber";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import { useDrag } from "@/lib/useDrag";
import { haptic } from "@/lib/haptics";
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
// Expanding used to commit at its own 28px, but one threshold per gesture is
// the point of the shared recogniser and upward travel is already the cheapest
// way in — a flick clears it on velocity, and a plain tap still expands.
const LONG_PRESS_MS = 450;
const AXIS_LOCK_PX = 6; // movement before we decide this is a horizontal or vertical drag

/**
 * Compact "now playing" bar. Deliberately minimal — art, title/artist, like,
 * play/pause — with gestures carrying the rest: swipe up (or tap) to expand,
 * swipe left/right to skip, long-press for the context menu.
 *
 * The gesture physics that used to live here are now `useDrag` (see the
 * vocabulary doc in src/lib/motion.ts); this file keeps only the thresholds
 * and what the commits mean.
 */
export function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    seekTo,
    beginSeek,
    endSeek,
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

  /*
   * Reset the art fade when the cover changes — adjusted during render rather
   * than in an effect, which is React's documented "adjust state when a prop
   * changes" pattern and the one FullPlayer already uses for the same job. An
   * effect runs a frame after the commit, so for that frame the *new* image was
   * painted with the previous one's `loaded` opacity.
   */
  const [lastCover, setLastCover] = useState(currentTrack?.coverUrl);
  if (currentTrack?.coverUrl !== lastCover) {
    setLastCover(currentTrack?.coverUrl);
    setArtLoaded(false);
  }

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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleExpand = useCallback(() => {
    if (artWrapRef.current) {
      setMiniArtRect(artWrapRef.current.getBoundingClientRect());
    }
    onExpand();
  }, [onExpand, setMiniArtRect]);

  const drag = useDrag({
    axis: "both",
    threshold: SWIPE_COMMIT_PX,
    velocity: SWIPE_COMMIT_VELOCITY,
    lockAfter: AXIS_LOCK_PX,
    // Free upward toward the full player, resistant downward — there's nothing
    // below the bar to reveal, so downward travel only acknowledges the finger.
    resistance: { up: 1, down: 0.15 },
    // Downward never commits, so the bar can't be flicked into nothing.
    commitDirections: ["left", "right", "up"],
    blockSelector: `.${styles.playBtn}, .${styles.likeBtn}, .${styles.scrubRow}, .${styles.lyricLine}`,
    longPressDelay: LONG_PRESS_MS,
    onLongPress: (point) => setMenuPos(point),
    onTap: () => handleExpand(),
    onCommit: (direction) => {
      if (direction === "left") next();
      else if (direction === "right") prev();
      else if (direction === "up") handleExpand();
    },
  });

  if (!currentTrack) return null;

  function handleLike() {
    if (!isLiked) {
      setBurstKey((k) => k + 1);
      haptic("success");
    }
    toggleLiked();
  }

  const gestureActive = drag.active && drag.axis !== null;
  const transform =
    drag.dx !== 0
      ? `translate3d(${drag.dx}px,0,0)`
      : drag.dy !== 0
        ? `translate3d(0,${drag.dy}px,0)`
        : undefined;
  const opacity = drag.dx !== 0 ? Math.max(0.35, 1 - Math.abs(drag.dx) / 160) : undefined;

  // Show the user which way they're committing, once past the threshold.
  // `armed` already folds in velocity, so a fast flick lights the affordance up
  // too — the old distance-only check left quick swipes with no feedback at all.
  const armedNext = drag.axis === "x" && drag.direction === "left" && drag.armed;
  const armedPrev = drag.axis === "x" && drag.direction === "right" && drag.armed;
  const armed = armedNext || armedPrev;

  const lyricSeek = () => {
    if (lyrics?.lines && activeLyricIndex >= 0) {
      const line = lyrics.lines[activeLyricIndex];
      if (line) seekTo(line.time);
    }
  };

  return (
    <div
      className={styles.root}
      // The bar is one line taller while a lyric is showing — see the height
      // note in MiniPlayer.module.css. Attribute rather than a class because it
      // states a fact about the content, not a variant.
      data-has-lyric={activeLyricLine ? "" : undefined}
      style={
        {
          "--track-accent": accentColor || undefined,
          transform,
          opacity,
          // The transform *is* the finger while dragging; easing it would add
          // lag between the touch and the bar.
          transition: gestureActive ? "none" : undefined,
          touchAction: drag.touchAction,
        } as React.CSSProperties
      }
      {...drag.bind}
    >
      <div className={styles.scrubRow}>
        <Scrubber
          progress={progress}
          duration={duration}
          accentColor={accentColor}
          variant="mini"
          onScrubStart={beginSeek}
          onSeek={(t) => seekTo(t)}
          // Pairs with onScrubStart. Without it, a press that ends without a
          // completed drag — a tap on the bar, or a pointer whose capture is
          // stolen by the expand gesture — left the seek flag latched, which
          // froze `progress` and made playback resume slightly behind where it
          // actually was.
          onScrubEnd={endSeek}
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

      <div className={`${styles.content} ${armed ? styles.contentArmed : ""}`}>
        <div ref={artWrapRef} className={styles.artWrap}>
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
                referrerPolicy="no-referrer"
                onLoad={() => setArtLoaded(true)}
              />
            </>
          ) : (
            <div className={`${styles.art} ${styles.artFallback} ${styles.loaded}`}>
              <MusicNoteIcon size={16} />
            </div>
          )}
          {isPlaying && (
            <div className={styles.eqBadge} aria-hidden="true">
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
            </div>
          )}
        </div>

        <div className={styles.info}>
          {activeLyricLine && (
            <div
              className={styles.lyricLine}
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
