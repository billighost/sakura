"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import styles from "./Scrubber.module.css";

interface ScrubberProps {
  /** Current playback position in seconds (raw, not the drag-preview value). */
  progress: number;
  duration: number;
  /** Called once, with the final time, when the user releases/taps. */
  onSeek: (time: number) => void;
  /** Called continuously while dragging (and once immediately on press/tap). */
  onScrubMove?: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  accentColor?: string | null;
  /** "full" = FullPlayer's inline bar. "mini" = MiniPlayer's top-edge bar with a floating time tooltip. */
  variant?: "full" | "mini";
  formatTime?: (seconds: number) => string;
  className?: string;
}

function defaultFormatTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * A custom pointer-driven scrubber — deliberately NOT a native <input type="range">.
 *
 * Native range inputs need `-webkit-appearance: none` reset or iOS Safari keeps its own
 * (tiny, invisible-when-opacity-0) hit-testing geometry, which is what broke seeking on
 * iPhone while it kept working fine with a mouse on desktop. Building this ourselves also
 * lets us give the whole component a much larger, padded hit target than the thin visual
 * track — tapping or dragging anywhere in that padded zone works, not just the 2-4px line.
 */
export function Scrubber({
  progress,
  duration,
  onSeek,
  onScrubMove,
  onScrubStart,
  onScrubEnd,
  accentColor,
  variant = "full",
  formatTime = defaultFormatTime,
  className = "",
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [pressed, setPressed] = useState(false);

  const displayValue = dragValue !== null ? dragValue : progress;
  const percent = duration > 0 ? Math.min(100, Math.max(0, (displayValue / duration) * 100)) : 0;

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (duration <= 0) return;
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pointerIdRef.current = e.pointerId;
      const time = valueFromClientX(e.clientX);
      setPressed(true);
      setDragValue(time);
      onScrubStart?.();
      onScrubMove?.(time);
    },
    [duration, valueFromClientX, onScrubStart, onScrubMove]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const time = valueFromClientX(e.clientX);
      setDragValue(time);
      onScrubMove?.(time);
    },
    [valueFromClientX, onScrubMove]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const time = valueFromClientX(e.clientX);
      pointerIdRef.current = null;
      setPressed(false);
      setDragValue(null);
      onSeek(time);
      onScrubEnd?.();
    },
    [valueFromClientX, onSeek, onScrubEnd]
  );

  // Safety net: a lost pointerup/pointercancel (e.g. capture stolen elsewhere) should
  // never leave the scrubber stuck in a pressed/dragging state.
  useEffect(() => {
    function forceEnd() {
      if (pointerIdRef.current !== null) {
        pointerIdRef.current = null;
        setPressed(false);
        setDragValue(null);
        onScrubEnd?.();
      }
    }
    window.addEventListener("pointerup", forceEnd);
    window.addEventListener("pointercancel", forceEnd);
    return () => {
      window.removeEventListener("pointerup", forceEnd);
      window.removeEventListener("pointercancel", forceEnd);
    };
  }, [onScrubEnd]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (duration <= 0) return;
    if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      onSeek(duration);
      return;
    }
    let delta = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 5;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -5;
    else return;
    e.preventDefault();
    onSeek(Math.min(duration, Math.max(0, progress + delta)));
  }

  return (
    <div
      className={`${styles.hitArea} ${variant === "mini" ? styles.hitAreaMini : styles.hitAreaFull} ${pressed ? styles.pressed : ""} ${className}`}
      style={{ "--track-accent": accentColor || undefined } as React.CSSProperties}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={displayValue}
        aria-valuetext={`${formatTime(displayValue)} of ${formatTime(duration)}`}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.trackBg} />
        <div className={styles.fill} style={{ width: `${percent}%` }} />
        <div className={styles.thumb} style={{ left: `${percent}%` }} />
      </div>

      {variant === "mini" && (
        <div className={styles.tooltip} style={{ left: `${percent}%` }}>
          {formatTime(displayValue)}
        </div>
      )}
    </div>
  );
}
