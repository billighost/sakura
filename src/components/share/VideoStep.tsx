"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TrimEditor } from "./TrimEditor";
import {
  COVER_STYLES,
  isVideoShareSupported,
  renderShareVideo,
  type CoverStyle,
  type VideoTrack,
} from "@/lib/shareVideo";
import { detectFastEncode } from "@/lib/fastEncode";
import { toSameOriginUrl } from "@/lib/shareAudio";
import type { LyricLine } from "@/lib/lyrics";
import { haptic } from "@/lib/haptics";
import styles from "./ShareStudio.module.css";

/**
 * Video step: choose a look, trim the clip, export.
 *
 * Export is real work — 15 seconds of video takes at least 15 seconds, because
 * MediaRecorder captures in real time. That shapes the whole screen: progress
 * has to be genuine rather than an indeterminate spinner, cancelling has to
 * actually stop the encode, and the copy has to set the expectation up front
 * so a 20-second wait doesn't read as a hang.
 */

export interface VideoStepProps {
  track: VideoTrack & { duration?: number };
  audioUrl?: string;
  lyricLines: LyricLine[];
  /** False when the track has no synced lyrics — gates lyric mode. */
  canUseLyrics: boolean;
  accentColor: string | null;
  atTime?: number;
  onExport: (blob: Blob, extension: string) => void;
}

export function VideoStep({
  track,
  audioUrl,
  lyricLines,
  canUseLyrics,
  accentColor,
  atTime = 0,
  onExport,
}: VideoStepProps) {
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("bloom");
  const [showLyrics, setShowLyrics] = useState(canUseLyrics);
  const [trim, setTrim] = useState(() => {
    // A default window around where playback was when the share started. The
    // 15s default only makes sense while there's a track long enough to hold
    // it; a 10-second loop gets the whole thing.
    const duration = track.duration ?? 0;
    const length = Math.min(15, Math.max(1, duration || 15));
    return {
      start: Math.max(0, Math.min(atTime - 7, Math.max(0, duration - length))),
      duration: length,
    };
  });

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localAudio, setLocalAudio] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const supported = isVideoShareSupported();

  /*
   * The audio is fetched to a same-origin blob once, up front, rather than per
   * export. It's needed twice — by the waveform decoder and by the recorder —
   * and both fail on a cross-origin source, so paying for it once here is both
   * faster and the only thing that works.
   */
  useEffect(() => {
    if (!audioUrl) return;
    let cancelled = false;
    const controller = new AbortController();

    toSameOriginUrl(audioUrl, controller.signal)
      .then((url) => {
        if (cancelled) {
          if (url !== audioUrl) URL.revokeObjectURL(url);
          return;
        }
        if (url !== audioUrl) objectUrlRef.current = url;
        setLocalAudio(url);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) setError("Couldn't load this track's audio.");
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [audioUrl]);

  const exporting = progress !== null;

  /*
   * Which encoder will run, so the progress copy can be honest about the wait.
   * WebCodecs encodes offline in a few seconds; MediaRecorder captures in real
   * time, so a 60-second clip genuinely takes a minute and the user needs to be
   * told that up front rather than concluding it has hung.
   */
  const [isFast, setIsFast] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    detectFastEncode().then((support) => {
      if (!cancelled) setIsFast(support !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = useCallback(async () => {
    if (!localAudio) return;

    setError(null);
    setProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await renderShareVideo({
        track,
        audioUrl: localAudio,
        startTime: trim.start,
        durationSeconds: trim.duration,
        coverStyle,
        accentColor,
        lyricLines: showLyrics ? lyricLines : [],
        showLyrics,
        onProgress: setProgress,
        signal: controller.signal,
      });

      haptic("success");
      onExport(result.blob, result.extension);
    } catch (err) {
      // A cancel is the user's decision, not a failure to report back at them.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Couldn't make the video.");
      haptic("error");
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }, [localAudio, track, trim, coverStyle, accentColor, showLyrics, lyricLines, onExport]);

  // An export left running after the sheet closes would keep recording audio
  // in the background with nowhere to deliver it.
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!supported) {
    return (
      <div className={styles.step}>
        <div className={styles.notice}>
          <p className={styles.noticeTitle}>Video isn&rsquo;t available in this browser</p>
          <p className={styles.noticeBody}>
            Making a video needs recording support this browser doesn&rsquo;t have.
            Chrome, Edge and Safari can do it — or you can share an image instead,
            which works everywhere.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <div className={styles.pickerGroup}>
        <p className={styles.pickerLabel} id="look-label">
          Look
        </p>
        <div className={`${styles.chipRow} no-scrollbar`} role="radiogroup" aria-labelledby="look-label">
          {COVER_STYLES.map((style) => (
            <button
              key={style.key}
              type="button"
              role="radio"
              aria-checked={coverStyle === style.key}
              className={`${styles.chip} ${coverStyle === style.key ? styles.chipActive : ""} pressable`}
              onClick={() => {
                haptic("selection");
                setCoverStyle(style.key);
              }}
              disabled={exporting}
            >
              <span className={styles.chipLabel}>{style.label}</span>
              <span className={styles.chipHint}>{style.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        Lyric mode is offered only when the track has synced lyrics, and when it
        doesn't we say why rather than hiding the option — a control that
        vanishes silently reads as a missing feature rather than as missing data.
      */}
      <div className={styles.pickerGroup}>
        <label className={`${styles.switchRow} ${!canUseLyrics ? styles.switchDisabled : ""}`}>
          <span>
            <span className={styles.switchLabel}>Show lyrics in the video</span>
            <span className={styles.switchHint}>
              {canUseLyrics
                ? "Words appear in time with the music"
                : "This track doesn't have time-synced lyrics, so they can't follow the music."}
            </span>
          </span>
          <input
            type="checkbox"
            className={styles.switch}
            checked={showLyrics && canUseLyrics}
            onChange={(e) => {
              haptic("selection");
              setShowLyrics(e.target.checked);
            }}
            disabled={!canUseLyrics || exporting}
          />
        </label>
      </div>

      {localAudio ? (
        <TrimEditor
          audioUrl={localAudio}
          trackDuration={track.duration ?? 0}
          atTime={atTime}
          accentColor={accentColor}
          value={trim}
          onChange={setTrim}
          disabled={exporting}
        />
      ) : (
        <p className={styles.waveNote}>Loading the audio…</p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {exporting ? (
        <div className={styles.exportPanel}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress ?? 0) * 100)}
            aria-label="Making your video"
          >
            <div
              className={styles.progressFill}
              style={{ transform: `scaleX(${progress ?? 0})` }}
            />
          </div>
          <p className={styles.progressNote}>
            {isFast === false
              ? `Recording in real time — about ${Math.max(
                  1,
                  Math.ceil(trim.duration * (1 - (progress ?? 0)))
                )}s left. Keep this screen open.`
              : "Putting your video together. Keep this screen open."}
          </p>
          <button
            type="button"
            className={`${styles.secondary} pressable`}
            onClick={() => {
              abortRef.current?.abort();
              setProgress(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.primary} pressable`}
          onClick={handleExport}
          disabled={!localAudio}
        >
          Make the video
        </button>
      )}
    </div>
  );
}
