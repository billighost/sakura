"use client";

import { useCallback, useRef, useState } from "react";
import { Scrubber } from "./Scrubber";
import {
  ChevronDownIcon,
  ShareIcon,
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ArrowDownIcon,
} from "./Icons";
import { TransliterateControl } from "./TransliterateControl";
import { useLyricsScroll } from "@/lib/useLyricsScroll";
import { useSmoothTime } from "@/lib/useSmoothTime";
import type { LyricData, LyricLine } from "@/lib/lyrics";
import { haptic } from "@/lib/haptics";
import styles from "./LyricsModal.module.css";

/**
 * The full synced-lyrics view.
 *
 * Two things here are worth knowing before editing.
 *
 * **The active line is marked by type, never by a background.** A filled row
 * behind the current line reads as a selected table row — it says "this row is
 * selected", not "this is being sung". Weight, colour, scale and the dimming of
 * neighbours carry it instead, so the lyrics read as a page rather than a list.
 *
 * **The highlight matches the data we actually have.** With word timings it
 * travels through the line as it's sung. Without them, every word in the active
 * line lights at once — deliberately, not as a fallback that looks broken. A
 * linear sweep interpolated across a line we have no word data for would drift
 * out of step with the singing within a couple of words, and a highlight that
 * disagrees with what you hear is worse than one that simply says "this line".
 */

interface LyricsModalProps {
  open: boolean;
  onClose: () => void;
  track: { id: string; title: string; artist: string; coverUrl?: string; duration?: number };
  lyrics: LyricData | null;
  loadingLyrics: boolean;
  activeLineIndex: number;
  accentColor: string | null;
  onLineClick: (time: number) => void;
  onShareLine: (line: LyricLine) => void;
  onShareTrack: () => void;
  onTransliterated: (data: LyricData) => void;
  progress: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubStart: () => void;
  onScrubMove: (time: number) => void;
  onSeek: (time: number) => void;
  formatTime: (seconds: number) => string;
  /** Changes on seek and track change; makes the scroll snap rather than drift. */
  snapToken: number;
}

export function LyricsModal({
  open,
  onClose,
  track,
  lyrics,
  loadingLyrics,
  activeLineIndex,
  accentColor,
  onLineClick,
  onShareLine,
  onShareTrack,
  onTransliterated,
  progress,
  duration,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  onScrubStart,
  onScrubMove,
  onSeek,
  formatTime,
  snapToken,
}: LyricsModalProps) {
  const { scrollRef, registerLine, showJumpToCurrent, jumpToCurrent } = useLyricsScroll({
    activeIndex: activeLineIndex,
    snapToken,
    enabled: open,
  });

  // Only the word-level sweep needs sub-`timeupdate` resolution, so the
  // interpolated clock is only subscribed to when the data can use it.
  const wordSynced = Boolean(lyrics?.isWordSynced);
  const smoothTime = useSmoothTime(progress, isPlaying && open && wordSynced);
  const time = wordSynced ? smoothTime : progress;

  const lines = lyrics?.lines;

  /*
   * Romanisation visibility is local to this view rather than a persisted
   * setting: it's a reading aid you reach for on a particular song, and a
   * global "always show" would put a second line under every lyric in a
   * language the reader can already read.
   *
   * Defaults to on when the lyrics arrived with a provider's own romanisation,
   * since that was already the previous behaviour and those are human-checked.
   */
  const [translitVisible, setTranslitVisible] = useState(true);

  // Which line the share control is attached to. Showing a share button on
  // every line at all times was noise on a screen whose whole job is reading;
  // it now belongs to the line you're actually pointing at.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const handleLineActivate = useCallback(
    (line: LyricLine) => {
      haptic("selection");
      onLineClick(line.time);
    },
    [onLineClick]
  );

  return (
    <div
      className={`${styles.overlay} ${open ? styles.open : ""}`}
      style={{ "--track-accent": accentColor || undefined } as React.CSSProperties}
      {...(!open ? { inert: true } : {})}
      data-block-drag
    >
      <header className={styles.header}>
        <button
          className={`${styles.headerBtn} pressable`}
          onClick={onClose}
          aria-label="Close lyrics"
        >
          <ChevronDownIcon size={22} />
        </button>

        <div className={styles.headerCenter}>
          <div className={styles.headerLabel}>Lyrics</div>
          <div className={styles.headerTitle}>{track.title}</div>
        </div>

        <button className={`${styles.headerBtn} pressable`} onClick={onShareTrack} aria-label="Share">
          <ShareIcon size={20} />
        </button>
      </header>

      {lyrics && (
        <TransliterateControl
          track={track}
          lyrics={lyrics}
          onTransliterated={onTransliterated}
          visible={translitVisible}
          onVisibilityChange={setTranslitVisible}
        />
      )}

      <div className={styles.body}>
        {loadingLyrics ? (
          <LyricsSkeleton />
        ) : !lyrics || (!lines?.length && !lyrics.lyrics?.trim()) ? (
          <div className={styles.status}>
            <p className={styles.statusTitle}>No lyrics for this one yet</p>
            <p className={styles.statusHint}>
              Lyrics come from community databases, so newer and rarer tracks are
              sometimes missing.
            </p>
          </div>
        ) : lines?.length ? (
          <>
            <div
              ref={scrollRef}
              className={`${styles.list} no-scrollbar`}
              // Not a listbox: these are lines of text that happen to be
              // seekable, and announcing "option 4 of 60" while reading is
              // noise. A labelled group of buttons describes it honestly.
              role="group"
              aria-label="Lyrics. Select a line to jump to that moment."
            >
              {lines.map((line, idx) => (
                <LyricRow
                  key={`${idx}-${line.time}`}
                  line={line}
                  index={idx}
                  state={
                    idx === activeLineIndex ? "active" : idx < activeLineIndex ? "past" : "upcoming"
                  }
                  distance={activeLineIndex < 0 ? 0 : idx - activeLineIndex}
                  time={time}
                  showTranslit={translitVisible}
                  focused={focusedIndex === idx}
                  registerLine={registerLine}
                  onActivate={handleLineActivate}
                  onFocusChange={setFocusedIndex}
                  onShare={onShareLine}
                />
              ))}
            </div>

            {/* Appears only while detached *and* the current line is off screen —
                a jump-back control pointing at something already visible is
                clutter. */}
            <button
              type="button"
              className={`${styles.jumpBtn} ${showJumpToCurrent ? styles.jumpVisible : ""} pressable`}
              onClick={jumpToCurrent}
              tabIndex={showJumpToCurrent ? 0 : -1}
              aria-hidden={!showJumpToCurrent}
            >
              <ArrowDownIcon size={15} />
              Jump to current
            </button>
          </>
        ) : (
          <div className={`${styles.plainText} no-scrollbar`}>
            {lyrics.lyrics!.split("\n").map((line, i) => (
              <p key={i}>{line || " "}</p>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <Scrubber
          progress={progress}
          duration={duration}
          accentColor={accentColor}
          variant="full"
          formatTime={formatTime}
          onScrubStart={onScrubStart}
          onScrubMove={onScrubMove}
          onSeek={onSeek}
        />
        <div className={styles.timeRow}>
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className={styles.transport}>
          <button className={`${styles.transportBtn} pressable`} onClick={onPrev} aria-label="Previous">
            <PrevIcon size={24} />
          </button>
          <button
            className={`${styles.playPauseBtn} pressable`}
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button className={`${styles.transportBtn} pressable`} onClick={onNext} aria-label="Next">
            <NextIcon size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── One line ─────────────────────────────────────────────────────────────── */

interface LyricRowProps {
  line: LyricLine;
  index: number;
  state: "past" | "active" | "upcoming";
  /** Signed distance from the active line, for graded dimming. */
  distance: number;
  time: number;
  /** Romanisation is a reading aid the user can switch off. */
  showTranslit: boolean;
  focused: boolean;
  registerLine: (index: number, el: HTMLElement | null) => void;
  onActivate: (line: LyricLine) => void;
  onFocusChange: (index: number | null) => void;
  onShare: (line: LyricLine) => void;
}

function LyricRow({
  line,
  index,
  state,
  distance,
  time,
  showTranslit,
  focused,
  registerLine,
  onActivate,
  onFocusChange,
  onShare,
}: LyricRowProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      registerLine(index, el);
    },
    [index, registerLine]
  );

  const isActive = state === "active";

  /*
   * Lines further from the current one recede. Capped at three steps: past that
   * everything is equally "not now", and letting it keep fading would leave the
   * ends of a long song invisible while you're trying to read ahead.
   */
  const depth = Math.min(3, Math.abs(distance));

  return (
    <div
      ref={setRef}
      className={styles.row}
      data-state={state}
      style={{ "--depth": depth } as React.CSSProperties}
      onPointerEnter={(e) => {
        // Touch fires pointerenter on tap and leaves it stuck; the share
        // affordance is driven by the active line on touch instead.
        if (e.pointerType !== "touch") onFocusChange(index);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") onFocusChange(null);
      }}
    >
      <button
        type="button"
        className={styles.lineBtn}
        onClick={() => onActivate(line)}
        // The visible text is the label, and it's the accessible name too; the
        // seek behaviour is described once on the group above rather than
        // repeated into all sixty lines.
        aria-current={isActive ? "true" : undefined}
      >
        <p className={styles.line}>
          {line.words?.length ? (
            <WordSweep words={line.words} time={time} isActive={isActive} />
          ) : (
            line.text
          )}
        </p>

        {line.transliterated && <p className={styles.translit}>{line.transliterated}</p>}
      </button>

      <button
        type="button"
        className={`${styles.shareLineBtn} ${
          focused || isActive ? styles.shareLineVisible : ""
        } pressable`}
        onClick={() => onShare(line)}
        tabIndex={focused || isActive ? 0 : -1}
        aria-label={`Share this lyric: ${line.text}`}
      >
        <ShareIcon size={15} />
      </button>
    </div>
  );
}

/**
 * Word-by-word highlight for lines that carry word timings.
 *
 * Each chunk is its own span with a lit/unlit state, rather than one text node
 * under a moving gradient mask. Reason: chunks in Japanese and Chinese are
 * often a single glyph with no spaces around them, and a mask positioned by
 * percentage cuts through the middle of a character. Per-chunk spans always cut
 * on a real boundary.
 */
function WordSweep({
  words,
  time,
  isActive,
}: {
  words: NonNullable<LyricLine["words"]>;
  time: number;
  isActive: boolean;
}) {
  return (
    <>
      {words.map((word, i) => {
        // Before the line is current, nothing is lit; after it has passed,
        // everything is. Only the current line has a moving edge.
        const lit = !isActive ? false : time >= word.time;
        return (
          <span
            key={`${i}-${word.time}`}
            className={styles.word}
            data-lit={lit ? "true" : undefined}
          >
            {word.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * Loading state shaped like lyrics rather than a spinner — varied widths so it
 * reads as text arriving, which is what's about to happen.
 */
function LyricsSkeleton() {
  const widths = [72, 58, 81, 46, 68, 77, 52, 63];
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {widths.map((w, i) => (
        <div key={i} className={`${styles.skeletonLine} skeleton`} style={{ width: `${w}%` }} />
      ))}
      <span className="srOnly">Loading lyrics</span>
    </div>
  );
}
