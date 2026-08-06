"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LogoLoader.module.css";

/**
 * Full-screen "petals forming a blossom" loader.
 *
 * Sequence: 5 petals arc in from off-center along a curved, spring-
 * overshoot path (with a soft focus-pull blur) → assemble into the
 * sakura shape → center + stamens pop in → flower blooms with a
 * scale/brightness pulse + expanding ripple ring + sparkle twinkles →
 * wordmark settles in with a letter-spacing reveal → overlay dismisses
 * (tap/click, Escape, or after `minDurationMs`).
 *
 * Pure SVG + CSS animation, no libraries — cheap enough to run while
 * audio/assets keep loading underneath it.
 */

interface LogoLoaderProps {
  /** Total time before auto-dismiss once mounted (ms). Default 2800ms, tuned to this animation's timing. */
  minDurationMs?: number;
  /** Allow tap/click/Escape to skip early. Default true. */
  skippable?: boolean;
  /** Called after the exit fade finishes (overlay is unmounted right after). */
  onComplete?: () => void;
}

// dx/dy: scattered starting offset. mx/my: lateral drift added mid-flight,
// so the petal arcs in on a curve rather than a straight line. os: the
// small spring-back rotation (opposite sign to rot) used for overshoot.
const PETALS = [
  { dx: -130, dy: -150, rot: -150, os: 10, mx: 35, my: -25, delay: 0 },
  { dx: 150, dy: -120, rot: 170, os: -10, mx: -30, my: 35, delay: 70 },
  { dx: 170, dy: 70, rot: -120, os: 8, mx: -35, my: -20, delay: 130 },
  { dx: -50, dy: 175, rot: 210, os: -12, mx: 30, my: -30, delay: 220 },
  { dx: -175, dy: 30, rot: -200, os: 10, mx: 25, my: 30, delay: 300 },
] as const;

const STAMEN_ANGLES = [0, 60, 120, 180, 240, 300];

// [angle deg, radius, delay ms] — brief twinkles fired around the bloom peak.
const SPARKLES = [
  [35, 55, 0],
  [95, 50, 60],
  [150, 55, 110],
  [210, 55, 30],
  [280, 52, 150],
  [320, 50, 90],
] as const;

export function LogoLoader({
  minDurationMs = 2800,
  skippable = true,
  onComplete,
}: LogoLoaderProps) {
  const [exiting, setExiting] = useState(false);
  const [mounted, setMounted] = useState(true);
  const finishedRef = useRef(false);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setExiting(true);
      window.setTimeout(() => {
        setMounted(false);
        onComplete?.();
      }, 500); // must match --overlay-fade in CSS
    };
    finishRef.current = finish;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const timer = window.setTimeout(
      finish,
      reduceMotion ? 900 : minDurationMs
    );

    const onKey = (e: KeyboardEvent) => {
      if (skippable && e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDurationMs, skippable]);

  if (!mounted) return null;

  return (
    <div
      className={`${styles.overlay} ${exiting ? styles.exiting : ""}`}
      role="status"
      aria-label="Loading Sakura"
      onClick={skippable ? () => finishRef.current() : undefined}
    >
      <div className={styles.glowA} aria-hidden="true" />
      <div className={styles.glowB} aria-hidden="true" />

      <div className={styles.logoWrap}>
        <svg viewBox="0 0 200 200" className={styles.svg} aria-hidden="true">
          <defs>
            <radialGradient id="petalSheen" cx="35%" cy="20%" r="80%">
              <stop offset="0%" stopColor="var(--sakura-gradient-end)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--sakura-accent)" stopOpacity="1" />
            </radialGradient>
          </defs>

          <g transform="translate(100 100)">
            <circle
              className={styles.ripple}
              r="14"
              fill="none"
              stroke="var(--sakura-accent)"
              strokeWidth="1.5"
            />

            <g className={styles.bloomGroup}>
              {PETALS.map((p, i) => (
                <g key={i} transform={`rotate(${i * 72})`}>
                  <g
                    className={styles.petal}
                    style={
                      {
                        "--dx": `${p.dx}px`,
                        "--dy": `${p.dy}px`,
                        "--mx": `${p.mx}px`,
                        "--my": `${p.my}px`,
                        "--rot": `${p.rot}deg`,
                        "--os": `${p.os}deg`,
                        "--delay": `${p.delay}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <path
                      d="M0,-2 C-18,-6 -22,-24 -14,-40 C-10,-48 -4,-50 0,-46
                         C4,-50 10,-48 14,-40 C22,-24 18,-6 0,-2 Z"
                      fill="url(#petalSheen)"
                    />
                  </g>
                </g>
              ))}

              <circle className={styles.centerDot} r="10" fill="var(--sakura-accent-2)" />
              {STAMEN_ANGLES.map((angle) => (
                <circle
                  key={angle}
                  className={styles.stamenDot}
                  r="1.6"
                  fill="var(--sakura-surface)"
                  transform={`rotate(${angle}) translate(0 -5)`}
                />
              ))}
            </g>

            {SPARKLES.map(([angle, radius, delay], i) => {
              const rad = (angle * Math.PI) / 180;
              return (
                <circle
                  key={i}
                  className={styles.sparkle}
                  r="1.6"
                  fill="var(--sakura-accent)"
                  cx={(Math.cos(rad) * radius).toFixed(1)}
                  cy={(Math.sin(rad) * radius).toFixed(1)}
                  style={{ "--sdelay": `${delay}ms` } as React.CSSProperties}
                />
              );
            })}
          </g>
        </svg>

        <p className={styles.wordmark}>Sakura</p>
      </div>

      {skippable && (
        <button
          type="button"
          className={styles.skipButton}
          onClick={(e) => {
            e.stopPropagation();
            finishRef.current();
          }}
        >
          Skip
        </button>
      )}
    </div>
  );
}
