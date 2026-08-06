"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LogoLoader.module.css";

/**
 * Full-screen "petals forming a blossom" loader.
 *
 * Sequence: 5 petals scatter in from off-center → assemble into the
 * sakura shape → center + stamens pop in → whole flower blooms with a
 * soft scale/brightness pulse → wordmark + skip fade in → overlay
 * dismisses (tap/click, Escape, or after `minDurationMs`).
 *
 * Pure SVG + CSS animation, no libraries — cheap enough to run while
 * audio/assets keep loading underneath it.
 */

interface LogoLoaderProps {
  /** Total time before auto-dismiss once mounted (ms). Default 2600ms. */
  minDurationMs?: number;
  /** Allow tap/click/Escape to skip early. Default true. */
  skippable?: boolean;
  /** Called after the exit fade finishes (overlay is unmounted right after). */
  onComplete?: () => void;
}

const PETALS = [
  { dx: -130, dy: -150, rot: -150, delay: 0 },
  { dx: 150, dy: -120, rot: 170, delay: 90 },
  { dx: 170, dy: 70, rot: -120, delay: 180 },
  { dx: -50, dy: 175, rot: 210, delay: 270 },
  { dx: -175, dy: 30, rot: -200, delay: 360 },
] as const;

const STAMEN_ANGLES = [0, 60, 120, 180, 240, 300];

export function LogoLoader({
  minDurationMs = 2600,
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
            <g className={styles.bloomGroup}>
              {PETALS.map((p, i) => (
                <g key={i} transform={`rotate(${i * 72})`}>
                  <g
                    className={styles.petal}
                    style={
                      {
                        "--dx": `${p.dx}px`,
                        "--dy": `${p.dy}px`,
                        "--rot": `${p.rot}deg`,
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
