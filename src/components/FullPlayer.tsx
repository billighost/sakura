"use client";

import { useState, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { usePlayer } from "./PlayerContext";
import { Scrubber } from "./Scrubber";
import {
  ChevronDownIcon,
  HeartIcon,
  MoreIcon,
  MusicNoteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShareIcon,
  ShuffleIcon,
  TimerIcon,
  VolumeIcon,
} from "./Icons";
import { CreditsSection } from "./CreditsSection";
import { LyricsPreviewCard } from "./LyricsPreviewCard";
import { QueueModal } from "./QueueModal";
import { LyricsModal } from "./LyricsModal";
import { useShare } from "./share/ShareContext";
import { useDrag } from "@/lib/useDrag";
import { readableOn } from "@/lib/color";
import type { LyricData } from "@/lib/lyrics";
import styles from "./FullPlayer.module.css";

interface FullPlayerProps {
  open: boolean;
  onClose: () => void;
}

const PETAL_COUNT = 6;

export function FullPlayer({ open, onClose }: FullPlayerProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [artLoaded, setArtLoaded] = useState(false);


  const rootRef = useRef<HTMLDivElement>(null);
  const artShellRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    queue,
    upNextQueue,
    currentIndex,
    currentTrack,
    isPlaying,
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
   * The glyph colour for anything filled with the artwork's accent — the
   * play/pause chip above all. Computed rather than fixed, because the accent
   * comes from a photograph: a fixed dark glyph disappears on a deep cover and a
   * fixed white one disappears on a pale one. Null when there's no artwork
   * colour yet, and the CSS falls back to the theme's `--on-accent`.
   */
  const onAccent = useMemo(() => readableOn(accentColor), [accentColor]);

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

  /*
   * Reset per-track view state when the track changes.
   *
   * Adjusted during render rather than from an effect. An effect runs *after*
   * the commit, so for one frame the new track was drawn with the previous
   * track's artwork already marked loaded — a visible flash of the wrong cover
   * at full opacity before the skeleton appeared. Setting state during render is
   * React's documented answer to "a prop changed, derive from it": it re-renders
   * immediately and never commits the stale pass.
   */
  const [renderedTrackId, setRenderedTrackId] = useState(currentTrack?.id);
  if (currentTrack?.id !== renderedTrackId) {
    setRenderedTrackId(currentTrack?.id);
    setArtLoaded(false);
    setLyricsExpanded(false);
  }

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

  /*
   * --- Shared-element "grow from the mini player" transition ---------------
   *
   * Written straight to the element rather than through state.
   *
   * A FLIP is imperative by nature: the start frame is measured from live layout
   * and has to be applied before the next paint, which is not something a render
   * pass can express. Routing it through `useState` meant a synchronous setState
   * inside a layout effect — a cascading render on every open — and the obvious
   * repair, deriving the start style during render, is worse: it reads a ref that
   * is still null on the first render, so the very first open had no origin to
   * grow from and silently fell back to a fade.
   *
   * Both frames now go to `style` directly. Two of them, as ever: the element
   * must exist at its start position *with a computed style* before the end state
   * has anything to transition from. One frame and the browser collapses both
   * into a single style recalculation, which skips the animation entirely.
   */
  useLayoutEffect(() => {
    const shell = artShellRef.current;
    if (!open || !shell) return;

    if (miniArtRect) {
      const artRect = shell.getBoundingClientRect();
      const scaleX = miniArtRect.width / artRect.width;
      const scaleY = miniArtRect.height / artRect.height;
      const translateX =
        miniArtRect.left + miniArtRect.width / 2 - (artRect.left + artRect.width / 2);
      const translateY =
        miniArtRect.top + miniArtRect.height / 2 - (artRect.top + artRect.height / 2);

      shell.style.transition = "none";
      shell.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
      shell.style.borderRadius = "9px";
    } else {
      // No known origin — deep-linked straight in, or a cold PWA start. Nothing
      // to grow from, so it fades.
      shell.style.transition = "none";
      shell.style.opacity = "0";
    }

    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!artShellRef.current) return;
        const el = artShellRef.current;
        if (miniArtRect) {
          el.style.transition =
            "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.45s cubic-bezier(0.32, 0.72, 0, 1)";
          el.style.transform = "translate(0px, 0px) scale(1, 1)";
          el.style.borderRadius = "16px";
        } else {
          el.style.transition = "opacity 0.35s ease";
          el.style.opacity = "1";
        }
      })
    );

    return () => cancelAnimationFrame(raf);
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

  /*
   * Queue reordering used to live here: a long-press timer, a pointer-capture
   * dance, a `dragQueueItem` state object and four handlers threaded into
   * QueueModal through six props — about 140 lines, all of it to move one row
   * while its neighbours stayed put, so there was no way to see where the row
   * would land. It's now `useReorder` inside QueueModal itself (shared with the
   * playlist page), and all this component has to hand over is the two reorder
   * callbacks the player context already exposed.
   */

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
          "--on-track-accent": onAccent || undefined,
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
<ChevronDownIcon size={24} />
        </button>
        <div className={styles.headerCenter}>
          <div className={styles.headerLabel}>Playing from album</div>
          <div className={styles.headerTitle}>{currentTrack.album || "Unknown Album"}</div>
        </div>
        <button className={styles.headerBtn} aria-label="More options">
<MoreIcon size={24} />
        </button>
      </div>

      <div ref={scrollContainerRef} className={styles.scrollContainer} data-lenis-prevent>
        <div className={styles.mainContent}>
          <div className={styles.artContainer}>
            <div
              ref={artShellRef}
              className={styles.artShell}
              style={
                artDragOpacity !== undefined
                  ? { opacity: artDragOpacity, transition: "none" }
                  : undefined
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
<MusicNoteIcon size={48} />
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
<ShuffleIcon size={22} />
            </button>

            <button className={styles.transportBtn} onClick={prev} aria-label="Previous">
<PrevIcon size={28} />
            </button>

            <button className={styles.playPauseBtn} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
{isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
            </button>

            <button className={styles.transportBtn} onClick={next} aria-label="Next">
<NextIcon size={28} />
            </button>

            <button
              className={`${styles.transportBtn} ${repeat !== "off" ? styles.activeBtn : ""}`}
              onClick={toggleRepeat}
              aria-label="Repeat"
            >
{repeat === "one" ? <RepeatOneIcon size={22} /> : <RepeatIcon size={22} />}
            </button>
          </div>

          <div className={styles.extras}>
            <button
              className={`${styles.likeBtn} ${isLiked ? styles.likedBtn : ""}`}
              onClick={handleLike}
              aria-label={isLiked ? "Unlike" : "Like"}
            >
<HeartIcon size={22} filled={isLiked} />
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
<VolumeIcon size={20} level={volume} />
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
<TimerIcon size={20} />
              {sleepTimerMinutes && (
                <span className={styles.sleepTimerBadge}>{sleepTimerMinutes}</span>
              )}
            </button>

            <button
              className={`${styles.iconBtn} ${showQueue ? styles.activeBtn : ""}`}
              onClick={() => setShowQueue(!showQueue)}
              aria-label="Queue"
            >
<QueueIcon size={20} />
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
        albumLabel={currentTrack.album || "this playlist"}
        currentIndex={currentIndex}
        upNextQueue={upNextQueue}
        tailQueue={tailQueue}
        onReorderUpNext={reorderUpNext}
        onReorderTail={reorderQueueTail}
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
