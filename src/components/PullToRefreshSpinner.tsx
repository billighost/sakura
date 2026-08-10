"use client";

import styles from "./PullToRefreshSpinner.module.css";

interface PullToRefreshSpinnerProps {
  pullDistance: number;
  refreshing: boolean;
  /** Past the threshold — releasing now refreshes. */
  armed?: boolean;
  threshold?: number;
}

/**
 * The pull-to-refresh indicator.
 *
 * Rewritten from a block of inline styles that shipped a `<style jsx global>`
 * keyframe on every render. Two behavioural changes beyond the move to CSS
 * modules: the arc now traces the pull as an SVG dash offset, so progress is
 * legible before release rather than only as a rotation nobody reads; and the
 * armed state is shown explicitly, because the old version gave no signal that
 * letting go would actually do anything.
 */
export function PullToRefreshSpinner({
  pullDistance,
  refreshing,
  armed = false,
  threshold = 70,
}: PullToRefreshSpinnerProps) {
  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(1, pullDistance / threshold);
  const RADIUS = 8;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <>
      {/*
        The live region is a sibling, not a child: `aria-hidden` on the visual
        wrapper would hide anything inside it from assistive tech, silently
        including the announcement.
      */}
      <span role="status" aria-live="polite" className="srOnly">
        {refreshing ? "Refreshing" : armed ? "Release to refresh" : ""}
      </span>

      <div
        className={styles.root}
        style={{
          // Travels at a fraction of the pull so the badge trails the finger
          // instead of racing it off the top of the list.
          transform: `translate3d(0, ${Math.min(pullDistance * 0.55, 46)}px, 0)`,
          opacity: refreshing ? 1 : progress,
        }}
        aria-hidden="true"
      >
      <div className={`${styles.badge} ${armed ? styles.armed : ""}`}>
        {refreshing ? (
          <span className={styles.spinner} />
        ) : (
          <svg className={styles.arc} viewBox="0 0 20 20" width="20" height="20">
            <circle
              className={styles.arcTrack}
              cx="10"
              cy="10"
              r={RADIUS}
              fill="none"
              strokeWidth="2"
            />
            <circle
              className={styles.arcFill}
              cx="10"
              cy="10"
              r={RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            />
          </svg>
        )}
        </div>
      </div>
    </>
  );
}
