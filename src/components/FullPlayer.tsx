"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
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
import { NowPlayingMenu } from "./NowPlayingMenu";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { Tooltip } from "./Tooltip";
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
/** Matches the `petalBurst` keyframe duration, plus a frame of slack. */
const PETAL_MS = 700;

/** Cycled by the sleep-timer button. `null` is "off", and is a real option. */
const SLEEP_OPTIONS = [null, 15, 30, 45, 60] as const;

/**
 * The now-playing screen.
 *
 * ── The shape, and why it changed ───────────────────────────────────────────
 *
 * Two panes in one scroller:
 *
 *   1. THE STAGE — artwork, the song's name, the line it's singing, the
 *      scrubber, the transport, the utilities. Sized to exactly one viewport
 *      (`min-height: 100%`), so it is always whole. It used to be an art block
 *      with `flex-shrink: 0` followed by a controls card carrying its own
 *      margin: two independently-sized things inside a scroller, which on a
 *      short screen left the transport half-cut with nothing to say there was
 *      more.
 *
 *   2. THE READING — the lyrics preview and the credits, below the fold on
 *      purpose, on their own veiled surface. The controls card used to have
 *      `backdrop-filter` and a top radius — it *looked* like fixed chrome and
 *      then scrolled away like content. Now the thing that looks like a panel is
 *      one, and the fold is signposted rather than discovered.
 *
 * ── Type ────────────────────────────────────────────────────────────────────
 *
 * Upright Fraunces for the song's name, *italic* Fraunces for the lyric line.
 * The house rule is that names take the display face; extending it, the name is
 * set upright and the voice is set italic, so the two never read as the same
 * kind of text at a glance. Inter carries every label, time and number.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 *
 * Nothing here is a literal colour. The surface is the artwork under
 * `--media-art-filter` behind the `--media-scrim-*` ramp, and every foreground
 * is an `--on-media-*` token, so the player is genuinely themed rather than
 * hardcoded dark. `--track-accent` (sampled from the cover) marks the active
 * control and the play chip; `--on-track-accent` is computed from its luminance
 * so the glyph on that chip reads on a deep indigo and a pale sand alike.
 */
export function FullPlayer({ open, onClose }: FullPlayerProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [seekDrag, setSeekDrag] = useState<number | null>(null);
  const [artLoaded, setArtLoaded] = useState(false);
  /** True once the reading pane has been scrolled to — retires the fold hint. */
  const [scrolled, setScrolled] = useState(false);

  /*
   * The petal burst is two pieces of state, not one.
   *
   * `burstKey` is monotonic and only supplies React keys, so a second like
   * remounts the petals and replays the animation. `bursting` decides whether
   * they're in the tree at all, and a timer clears it. The condition used to be
   * `burstKey > 0`, which is true forever after the first like — six
   * absolutely-positioned nodes stayed mounted over the like button for the rest
   * of the session, held invisible by `animation-fill-mode: forwards`.
   */
  const [burstKey, setBurstKey] = useState(0);
  const [bursting, setBursting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const artShellRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const volumeGroupRef = useRef<HTMLDivElement>(null);

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
    if (!isLiked) {
      setBurstKey((k) => k + 1);
      setBursting(true);
    }
    toggleLiked();
  }

  // Unmounts the petals once they've finished, so they don't accumulate over the
  // like button for the rest of the session.
  useEffect(() => {
    if (!bursting) return;
    const t = setTimeout(() => setBursting(false), PETAL_MS);
    return () => clearTimeout(t);
  }, [bursting, burstKey]);

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

  /*
   * Everything transient closes when the player does, so re-opening it never
   * lands on a volume popover or an overflow sheet left over from last time.
   *
   * Adjusted during render, like the per-track reset above — an effect here
   * would be a synchronous setState in an effect body, which commits a frame
   * with the stale panels still open and then immediately re-renders.
   */
  const [renderedOpen, setRenderedOpen] = useState(open);
  if (open !== renderedOpen) {
    setRenderedOpen(open);
    if (!open) {
      setShowVolume(false);
      setShowQueue(false);
      setShowMenu(false);
      setLyricsExpanded(false);
    }
  }

  /*
   * Dismiss the volume popover on any pointer that isn't inside it.
   * `pointerdown` rather than `click`: on touch, click is synthesised late or
   * not at all, and the player's own drag recogniser sees the gesture first.
   */
  useEffect(() => {
    if (!showVolume) return;
    function onPointerDown(e: PointerEvent) {
      if (!volumeGroupRef.current?.contains(e.target as Node)) setShowVolume(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Stopped here so Escape closes the popover without also closing the
        // player underneath it (see lib/useKeyboardShortcuts.ts).
        e.stopPropagation();
        setShowVolume(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showVolume]);

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
   * The line the song is on, on the stage itself.
   *
   * This is the one thing on the stage that isn't a control, and it's here
   * because it's what the app is actually for: Sakura has a lyrics library,
   * synced timings, transliteration and lyric share cards. A now-playing screen
   * for a lyrics-first player should sing along, rather than name the track and
   * keep the words two taps away behind a card below the fold.
   *
   * Synced lyrics only. An unsynced blob has no "current line", and showing its
   * first line forever would be decoration dressed up as live data.
   *
   * `hasSyncedLyrics` and `nowSinging` are separate because the slot has to be
   * reserved from the moment we know the song has timings — before the first
   * line's timestamp is reached, `nowSinging` is null, and keying the *element*
   * off that would pull the transport up by 2rem at the start of every song and
   * drop it again a few seconds later.
   */
  const hasSyncedLyrics = !!lyrics?.lines?.length;
  const nowSinging = useMemo(
    () => lyrics?.lines?.[activeLineIndex]?.text?.trim() || null,
    [lyrics, activeLineIndex]
  );

  /*
   * What the header says, and why it's derived rather than fixed.
   *
   * It used to read "Playing from album" over `currentTrack.album` in every
   * case, so a radio track, a playlist and a liked-songs shuffle all claimed to
   * be an album — and a track with no album read "Playing from album / Unknown
   * Album", which is two untruths in one line.
   *
   * `setPlayContext` exists on PlayerContext but no screen calls it yet, so the
   * queue's true origin isn't knowable here for anything except radio. Rather
   * than guess, this says only what the track itself supports, and shows one
   * line instead of two when that's all there is.
   */
  const source = useMemo(() => {
    if (!currentTrack) return { eyebrow: "Now playing", detail: null as string | null };
    if (currentTrack.autoplay) {
      return { eyebrow: "Radio", detail: currentTrack.reason || "Based on what you've played" };
    }
    if (currentTrack.album) {
      return { eyebrow: "Playing from album", detail: currentTrack.album };
    }
    return { eyebrow: "Now playing", detail: null };
  }, [currentTrack]);

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
    // Also off while the overflow sheet or the playlist picker is up: those sit
    // above the player, and a drag that started on one of them must not dismiss
    // what's underneath.
    enabled: open && !showQueue && !lyricsExpanded && !showMenu && !showAddToPlaylist,
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

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const past = e.currentTarget.scrollTop > 8;
    // Guarded so a scroll gesture doesn't queue a render per pixel.
    setScrolled((prev) => (prev === past ? prev : past));
  }, []);

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

  const shareCurrent = () =>
    openShare({ track: currentTrack, lyrics, accentColor, atTime: displayProgress });

  const repeatLabel =
    repeat === "off" ? "Repeat" : repeat === "all" ? "Repeat queue" : "Repeat this song";

  const nextSleepOption = () => {
    const i = SLEEP_OPTIONS.indexOf(sleepTimerMinutes as (typeof SLEEP_OPTIONS)[number]);
    return SLEEP_OPTIONS[(i + 1) % SLEEP_OPTIONS.length];
  };

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
        <Tooltip label="Close" shortcut="Esc" placement="bottom" offsetX={18}>
          <button className={styles.headerBtn} onClick={onClose} aria-label="Close player">
            <ChevronDownIcon size={24} strokeWidth={2} />
          </button>
        </Tooltip>

        <div className={styles.headerCenter}>
          <div className={styles.headerLabel}>{source.eyebrow}</div>
          {source.detail && <div className={styles.headerTitle}>{source.detail}</div>}
        </div>

        {/* This button previously had no handler at all — an `aria-label`
            promising "More options" and nothing behind it. */}
        <Tooltip label="Song options" placement="bottom" offsetX={-18}>
          <button
            className={styles.headerBtn}
            onClick={() => setShowMenu(true)}
            aria-label="Song options"
            aria-haspopup="dialog"
          >
            <MoreIcon size={22} />
          </button>
        </Tooltip>
      </div>

      <div
        ref={scrollContainerRef}
        className={styles.scrollContainer}
        onScroll={handleScroll}
        data-lenis-prevent
      >
        {/* ── The stage: exactly one viewport, never half-shown ─────────── */}
        <div className={styles.stage}>
          <div className={styles.artArea}>
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

          <div className={styles.deck}>
            {/*
              Name on the left, like on the right.
              The like button was down in a row of five identical utilities,
              which put "do you love this song?" at the same weight as "set a
              sleep timer". It belongs with the song's name, which is what it's
              about. Left-aligning the name is what makes room for it — and long
              titles now truncate against a fixed edge instead of drifting
              off-centre.
            */}
            <div className={styles.identity}>
              <div className={styles.identityText}>
                <h2 className={styles.trackTitle}>{currentTrack.title}</h2>
                <p className={styles.trackArtist}>{currentTrack.artist}</p>
              </div>

              <Tooltip
                label={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                shortcut="F"
                offsetX={-24}
              >
                <button
                  className={`${styles.likeBtn} ${isLiked ? styles.likedBtn : ""}`}
                  onClick={handleLike}
                  aria-label={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                  aria-pressed={isLiked}
                >
                  <HeartIcon size={23} filled={isLiked} />
                  {bursting &&
                    Array.from({ length: PETAL_COUNT }).map((_, i) => (
                      <span
                        key={`${burstKey}-${i}`}
                        className={styles.petal}
                        style={{ "--rot": `${(360 / PETAL_COUNT) * i}deg` } as React.CSSProperties}
                      />
                    ))}
                </button>
              </Tooltip>
            </div>

            {/*
              The signature: the line the song is on, in italic display type,
              tappable straight into the full synced view. The span is keyed on
              the line index so each new line cross-fades in rather than
              snapping; the button itself persists so the slot never collapses.
            */}
            {hasSyncedLyrics && (
              <button
                className={styles.nowSinging}
                onClick={() => setLyricsExpanded(true)}
                aria-label={
                  nowSinging ? `Open lyrics. Now singing: ${nowSinging}` : "Open lyrics"
                }
              >
                {nowSinging && (
                  <span key={activeLineIndex} className={styles.nowSingingLine}>
                    {nowSinging}
                  </span>
                )}
              </button>
            )}

            <div className={styles.seekBlock}>
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
                {/* Remaining, not total: how much is left is the question you're
                    actually asking a clock that sits beside a progress bar. */}
                <span>-{formatTime(Math.max(0, duration - displayProgress))}</span>
              </div>
            </div>

            <div className={styles.transport}>
              <Tooltip label={shuffle ? "Shuffle on" : "Shuffle"} shortcut="S">
                <button
                  className={`${styles.transportBtn} ${shuffle ? styles.activeBtn : ""}`}
                  onClick={toggleShuffle}
                  aria-label="Shuffle"
                  aria-pressed={shuffle}
                >
                  <ShuffleIcon size={21} strokeWidth={2} />
                </button>
              </Tooltip>

              <Tooltip label="Previous" shortcut="P">
                <button className={styles.transportBtn} onClick={prev} aria-label="Previous">
                  <PrevIcon size={27} />
                </button>
              </Tooltip>

              <Tooltip label={isPlaying ? "Pause" : "Play"} shortcut="Space">
                <button
                  className={styles.playPauseBtn}
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
                </button>
              </Tooltip>

              <Tooltip label="Next" shortcut="N">
                <button className={styles.transportBtn} onClick={next} aria-label="Next">
                  <NextIcon size={27} />
                </button>
              </Tooltip>

              <Tooltip label={repeatLabel} shortcut="R">
                <button
                  className={`${styles.transportBtn} ${repeat !== "off" ? styles.activeBtn : ""}`}
                  onClick={toggleRepeat}
                  aria-label={repeatLabel}
                  aria-pressed={repeat !== "off"}
                >
                  {repeat === "one" ? (
                    <RepeatOneIcon size={21} strokeWidth={2} />
                  ) : (
                    <RepeatIcon size={21} strokeWidth={2} />
                  )}
                </button>
              </Tooltip>
            </div>

            <div className={styles.utilities}>
              <div className={styles.volumeGroup} ref={volumeGroupRef}>
                <Tooltip label="Volume" shortcut="↑↓" offsetX={18}>
                  <button
                    className={`${styles.iconBtn} ${showVolume ? styles.activeBtn : ""}`}
                    onClick={() => setShowVolume((v) => !v)}
                    aria-label="Volume"
                    aria-expanded={showVolume}
                  >
                    <VolumeIcon size={20} level={volume} strokeWidth={2} />
                  </button>
                </Tooltip>

                {/*
                  A popover, not an inline expansion. The slider used to animate
                  its width from 0 *inside* the row, which shoved the four
                  buttons beside it sideways every time you reached for it — you
                  aimed at Share and pressed Sleep timer. Out of flow, nothing
                  moves.
                */}
                {showVolume && (
                  <div className={styles.volumePop} data-block-drag>
                    <input
                      type="range"
                      className={styles.volumeSlider}
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      aria-label="Volume"
                      autoFocus
                    />
                    <span className={styles.volumeValue}>{Math.round(volume * 100)}</span>
                  </div>
                )}
              </div>

              {/*
                Opens the card generator rather than calling navigator.share with
                the raw URL. Sharing "sakura.app/home" told the recipient nothing
                about what was playing — the generated card carries the artwork,
                the title and the artist.
              */}
              <Tooltip label="Share this song">
                <button
                  className={styles.iconBtn}
                  onClick={shareCurrent}
                  aria-label="Share this song"
                >
                  <ShareIcon size={20} strokeWidth={2} />
                </button>
              </Tooltip>

              <Tooltip
                label={sleepTimerMinutes ? `Sleep timer: ${sleepTimerMinutes} min` : "Sleep timer"}
              >
                <button
                  className={`${styles.iconBtn} ${sleepTimerMinutes ? styles.activeBtn : ""}`}
                  onClick={() => setSleepTimer(nextSleepOption())}
                  aria-label={
                    sleepTimerMinutes
                      ? `Sleep timer set to ${sleepTimerMinutes} minutes. Change it.`
                      : "Set a sleep timer"
                  }
                >
                  <TimerIcon size={20} strokeWidth={2} />
                  {sleepTimerMinutes && <span className={styles.badge}>{sleepTimerMinutes}</span>}
                </button>
              </Tooltip>

              <Tooltip label="Queue" offsetX={-24}>
                <button
                  className={`${styles.iconBtn} ${showQueue ? styles.activeBtn : ""}`}
                  onClick={() => setShowQueue((q) => !q)}
                  aria-label="Queue"
                  aria-expanded={showQueue}
                >
                  <QueueIcon size={20} strokeWidth={2} />
                  {tailQueue.length > 0 && (
                    <span className={styles.badge}>{tailQueue.length}</span>
                  )}
                </button>
              </Tooltip>
            </div>

            {/*
              The fold is real now, so it's signposted — and it retires itself
              once used, rather than pointing down at content you're already
              reading.
            */}
            <div className={styles.fold} data-hidden={scrolled || undefined} aria-hidden="true">
              <ChevronDownIcon size={14} strokeWidth={2} />
              <span>Lyrics &amp; credits</span>
            </div>
          </div>
        </div>

        {/* ── The reading: below the fold, on its own surface ───────────── */}
        <div className={styles.reading}>
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

      <NowPlayingMenu
        open={showMenu}
        onClose={() => setShowMenu(false)}
        track={currentTrack}
        onLeavePlayer={onClose}
        onAddToPlaylist={() => setShowAddToPlaylist(true)}
        onShare={shareCurrent}
      />

      <AddToPlaylistModal
        isOpen={showAddToPlaylist}
        onClose={() => setShowAddToPlaylist(false)}
        trackId={currentTrack.id}
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
        onShareTrack={shareCurrent}
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
