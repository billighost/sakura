"use client";

import { useAppNav } from "./AppNavContext";
import { ChevronLeftIcon } from "./Icons";
import styles from "./BackButton.module.css";

/**
 * Standalone back control, for pages whose header is a bespoke hero rather
 * than a <PageHeader> title bar (album, artist, track, browse). Those keep
 * their own layout; what they share is this button's behaviour.
 *
 * Consolidates three implementations: this file (which styled itself against
 * `--bg-secondary` / `--bg-tertiary`, two variables that don't exist in this
 * design system, so it rendered with no background at all), a near-identical
 * copy at `app/(app)/track/[id]/BackButton.tsx`, and the hand-rolled button in
 * Settings — now <PageHeader>'s.
 *
 * Going through `useAppNav().back` rather than `router.back()` is what earns
 * it the directional page transition and the deep-link fallback: opened from a
 * shared link there is nothing to pop, and a standalone PWA has no browser
 * chrome to escape with.
 */
export function BackButton({
  className,
  /** Where to go when there's no history to pop. */
  fallback,
  /** Over artwork, where a plain glyph wouldn't hold contrast. */
  onMedia = false,
}: {
  className?: string;
  fallback?: string;
  onMedia?: boolean;
}) {
  const { back } = useAppNav();

  return (
    <button
      type="button"
      onClick={() => back(fallback)}
      className={`${styles.btn} ${onMedia ? styles.onMedia : ""} pressable ${className ?? ""}`}
      aria-label="Go back"
    >
      <ChevronLeftIcon size={22} />
    </button>
  );
}
