"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractWaveform, TrimPreview, type WaveformData } from "@/lib/shareAudio";
import { haptic } from "@/lib/haptics";
import { clamp01 } from "@/lib/motion";
import styles from "./ShareStudio.module.css";

/**
 * Pick the part of the song the clip covers.
 *
 * The waveform is decoded from the real audio, not drawn from a seed. That
 * matters: the entire reason to show a waveform is that you can see where the
 * chorus is, and a decorative fake actively lies about the structure you're
 * navigating by.
 *
 * The other half is audio preview. Moving a handle in silence tells you
 * nothing about what you selected, so every handle move plays a short burst
 * from that position — which is the feature, not a nicety.
 */

/** Selection bounds, in seconds. Social clips past ~30s get truncated anyway. */
const MIN_LENGTH = 5;
const MAX_LENGTH = 30;

const PRESETS = [10, 15, 20, 30];

export interface TrimEditorProps {
  audioUrl: string;
  /** Full track length, for when decoding fails and we still need bounds. */
  trackDuration: number;
  /** Where playback was when sharing started — the natural default. */
  atTime?: number;
  accentColor: string | null;
  value: { start: number; duration: number };
  onChange: (value: { start: number; duration: number }) => void;
  disabled?: boolean;
}

export function TrimEditor({
  audioUrl,
  trackDuration,
  atTime = 0,
  accentColor,
  value,
  onChange,
  disabled,
}: TrimEditorProps) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  const railRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<TrimPreview | null>(null);
  const dragRef = useRef<"start" | "end" | "region" | null>(null);
  const grabOffsetRef = useRef(0);

  const duration = waveform?.duration || trackDuration || 0;

  /* ── Decode ─────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    extractWaveform(audioUrl, controller.signal)
      .then((data) => {
        setWaveform(data);
        setStatus("ready");
      })
      .catch((err) => {
        // An aborted decode is a component unmount, not a failure worth
        // reporting — the alternative is a flash of error state on close.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("failed");
      });

    return () => controller.abort();
  }, [audioUrl]);

  /* ── Preview player ─────────────────────────────────────────────────────── */

  useEffect(() => {
    previewRef.current = new TrimPreview(audioUrl);
    return () => {
      previewRef.current?.dispose();
      previewRef.current = null;
    };
  }, [audioUrl]);

  /* ── Geometry ───────────────────────────────────────────────────────────── */

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail || duration <= 0) return 0;
      const rect = rail.getBoundingClientRect();
      return clamp01((clientX - rect.left) / rect.width) * duration;
    },
    [duration]
  );

  const commit = useCallback(
    (start: number, length: number, previewAt?: number) => {
      const clampedLength = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length));
      const clampedStart = Math.max(0, Math.min(start, Math.max(0, duration - clampedLength)));
      onChange({ start: clampedStart, duration: clampedLength });

      if (previewAt !== undefined) {
        previewRef.current?.play(Math.max(0, Math.min(previewAt, duration - 0.5)));
      }
    },
    [duration, onChange]
  );

  /* ── Dragging ───────────────────────────────────────────────────────────── */

  const onPointerDown = useCallback(
    (handle: "start" | "end" | "region") => (e: React.PointerEvent) => {
      if (disabled || duration <= 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

      dragRef.current = handle;
      if (handle === "region") {
        grabOffsetRef.current = timeFromClientX(e.clientX) - value.start;
      }

      haptic("selection");
      // Preview immediately on grab, so touching a handle is already audible
      // before any movement.
      previewRef.current?.play(handle === "end" ? value.start + value.duration - 2 : value.start);
    },
    [disabled, duration, timeFromClientX, value.start, value.duration]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const handle = dragRef.current;
      if (!handle) return;

      const t = timeFromClientX(e.clientX);

      if (handle === "start") {
        const end = value.start + value.duration;
        const start = Math.min(t, end - MIN_LENGTH);
        commit(start, end - start);
      } else if (handle === "end") {
        commit(value.start, t - value.start);
      } else {
        commit(t - grabOffsetRef.current, value.duration);
      }
    },
    [timeFromClientX, value.start, value.duration, commit]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const handle = dragRef.current;
      dragRef.current = null;

      // Play the region from wherever the handle landed, so releasing tells
      // you what you actually chose rather than leaving silence.
      previewRef.current?.play(
        handle === "end" ? Math.max(value.start, value.start + value.duration - 3) : value.start
      );
      haptic("impact");
      void e;
    },
    [value.start, value.duration]
  );

  // Pointer capture can be lost (another element steals it, the browser
  // cancels) — without this the editor stays stuck mid-drag.
  useEffect(() => {
    const release = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  /* ── Keyboard ───────────────────────────────────────────────────────────── */

  const nudge = useCallback(
    (handle: "start" | "end", delta: number) => {
      if (handle === "start") {
        const end = value.start + value.duration;
        const start = Math.max(0, Math.min(value.start + delta, end - MIN_LENGTH));
        commit(start, end - start, start);
      } else {
        commit(value.start, value.duration + delta, value.start + value.duration + delta - 2);
      }
    },
    [value.start, value.duration, commit]
  );

  const handleKey = useCallback(
    (handle: "start" | "end") => (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(handle, -step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge(handle, step);
      }
    },
    [nudge]
  );

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const startPct = duration > 0 ? (value.start / duration) * 100 : 0;
  const widthPct = duration > 0 ? (value.duration / duration) * 100 : 0;

  // Bars are memoised against the peaks array, not re-derived per render —
  // this component re-renders on every pointermove during a drag.
  const bars = useMemo(() => waveform?.peaks ?? [], [waveform]);

  return (
    <div className={styles.trim}>
      <div className={styles.trimHead}>
        <span className={styles.trimTime}>{formatClock(value.start)}</span>
        <span className={styles.trimLength}>{Math.round(value.duration)}s</span>
        <span className={styles.trimTime}>{formatClock(value.start + value.duration)}</span>
      </div>

      <div
        ref={railRef}
        className={styles.wave}
        style={{ "--accent": accentColor || "var(--accent)" } as React.CSSProperties}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-state={status}
      >
        {status === "loading" && (
          <p className={styles.waveNote}>Reading the audio…</p>
        )}

        {status === "failed" && (
          <p className={styles.waveNote}>
            Couldn&rsquo;t read the audio to draw a waveform — you can still pick a
            length below.
          </p>
        )}

        {status === "ready" && (
          <>
            <div className={styles.waveBars} aria-hidden="true">
              {bars.map((peak, i) => {
                const t = (i / bars.length) * duration;
                const inRange = t >= value.start && t <= value.start + value.duration;
                return (
                  <span
                    key={i}
                    className={styles.waveBar}
                    data-in={inRange ? "true" : undefined}
                    // A floor of 6% so silence still reads as a waveform
                    // rather than a gap in the rail.
                    style={{ height: `${Math.max(6, peak * 100)}%` }}
                  />
                );
              })}
            </div>

            <div
              className={styles.region}
              style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              onPointerDown={onPointerDown("region")}
            />

            <button
              type="button"
              className={`${styles.handle} ${styles.handleStart}`}
              style={{ left: `${startPct}%` }}
              onPointerDown={onPointerDown("start")}
              onKeyDown={handleKey("start")}
              role="slider"
              aria-label="Clip start"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, duration - MIN_LENGTH)}
              aria-valuenow={Math.round(value.start)}
              aria-valuetext={formatClock(value.start)}
              disabled={disabled}
            />

            <button
              type="button"
              className={`${styles.handle} ${styles.handleEnd}`}
              style={{ left: `${startPct + widthPct}%` }}
              onPointerDown={onPointerDown("end")}
              onKeyDown={handleKey("end")}
              role="slider"
              aria-label="Clip end"
              aria-valuemin={MIN_LENGTH}
              aria-valuemax={duration}
              aria-valuenow={Math.round(value.start + value.duration)}
              aria-valuetext={formatClock(value.start + value.duration)}
              disabled={disabled}
            />
          </>
        )}
      </div>

      <div className={styles.presets} role="group" aria-label="Clip length">
        {PRESETS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            className={`${styles.preset} ${
              Math.round(value.duration) === seconds ? styles.presetActive : ""
            } pressable`}
            onClick={() => {
              haptic("selection");
              commit(value.start, seconds, value.start);
            }}
            disabled={disabled || seconds > duration}
            aria-pressed={Math.round(value.duration) === seconds}
          >
            {seconds}s
          </button>
        ))}

        <button
          type="button"
          className={`${styles.preset} pressable`}
          onClick={() => {
            haptic("selection");
            // Centre the clip on where playback actually was, which is almost
            // always the moment that prompted the share.
            const start = Math.max(0, atTime - value.duration / 2);
            commit(start, value.duration, start);
          }}
          disabled={disabled || !atTime}
        >
          At playhead
        </button>
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
