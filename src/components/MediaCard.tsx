"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePlayer } from "./PlayerContext";
import { NowPlayingBars, PlayIcon, PauseIcon, MusicNoteIcon } from "./Icons";
import { haptic } from "@/lib/haptics";
import styles from "./MediaCard.module.css";

/**
 * The app's one card.
 *
 * Every rail on home, library and the detail pages used to draw its own:
 * `.quickPickCard`, `.madeForYouCard`, `.playlistCard`, `.trackCard`,
 * `.artistCard` — five component shapes, five sets of hover states, five
 * subtly different corner radii, and three of them silently did nothing but
 * navigate. Consolidating them is most of why home's stylesheet drops from 736
 * lines: the *variety* people perceive between rails comes from `size` and
 * `shape`, which are two props, not five components.
 *
 * ── Why a card can play ───────────────────────────────────────────────────
 *
 * The old cards were plain links to a detail page, so playing a "Quick Pick"
 * took two taps and a page load. That's backwards for a rail whose whole
 * premise is "here, start with this". A card that has audio behind it gets a
 * play affordance that starts it in place; the surrounding link still goes to
 * the detail page, so both intents are one tap and neither is ambiguous.
 */

export interface MediaCardTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
}

export interface MediaCardProps {
  href: string;
  title: string;
  subtitle?: string | null;
  coverUrl?: string | null;
  /** Four-up mosaic — reads as "assembled", which a single cover can't. */
  coverUrls?: string[];
  /** `round` for people, `square` for everything else. */
  shape?: "square" | "round";
  size?: "sm" | "md" | "lg";
  /** Small text over the artwork's bottom edge — track counts, mix labels. */
  badge?: string;
  /**
   * Supply to make the card playable. `queue` is what plays after it; omit and
   * the track plays alone.
   */
  track?: MediaCardTrack | null;
  queue?: MediaCardTrack[];
  /** Overrides the fallback glyph when there's no artwork. */
  fallbackIcon?: React.ReactNode;
  /** Index into `.anim-stagger`'s cascade. */
  index?: number;
}

export function MediaCard({
  href,
  title,
  subtitle,
  coverUrl,
  coverUrls,
  shape = "square",
  size = "md",
  badge,
  track,
  queue,
  fallbackIcon,
  index,
}: MediaCardProps) {
  const { currentTrack, isPlaying, play, togglePlay } = usePlayer();

  const playable = Boolean(track?.audioUrl);
  const isCurrent = Boolean(
    track && currentTrack && (currentTrack.resolvedId ?? currentTrack.id) === track.id
  );
  const isPlayingThis = isCurrent && isPlaying;

  const onPlay = useCallback(
    (e: React.MouseEvent) => {
      // The card is a link; without this the tap navigates *and* plays.
      e.preventDefault();
      e.stopPropagation();

      if (!track?.audioUrl) return;

      if (isCurrent) {
        togglePlay();
        haptic("selection");
        return;
      }

      haptic("impact");
      const asTrack = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl ?? undefined,
        audioUrl: track.audioUrl,
        duration: track.duration ?? 0,
      };
      const rest = (queue ?? [])
        .filter((t) => t.audioUrl)
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          coverUrl: t.coverUrl ?? undefined,
          audioUrl: t.audioUrl as string,
          duration: t.duration ?? 0,
        }));
      play(asTrack, rest.length ? rest : [asTrack]);
    },
    [track, queue, isCurrent, play, togglePlay]
  );

  const mosaic = coverUrls && coverUrls.length >= 4 ? coverUrls.slice(0, 4) : null;

  return (
    <Link
      href={href}
      className={`${styles.card} ${styles[size]} pressable-lg`}
      style={index === undefined ? undefined : ({ "--i": Math.min(index, 12) } as React.CSSProperties)}
      // The visible title is inside; this names the whole target for screen
      // readers without the subtitle running into it as one string.
      aria-label={subtitle ? `${title} — ${subtitle}` : title}
    >
      <div
        className={`${styles.art} ${shape === "round" ? styles.round : ""} ${
          isPlayingThis ? styles.artActive : ""
        }`}
      >
        {mosaic ? (
          <div className={styles.mosaic} aria-hidden="true">
            {mosaic.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt="" className={styles.mosaicCell} loading="lazy" />
            ))}
          </div>
        ) : coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className={styles.image} loading="lazy" />
        ) : (
          <div className={styles.fallback} aria-hidden="true">
            {fallbackIcon ?? <MusicNoteIcon size={size === "lg" ? 30 : 22} />}
          </div>
        )}

        {badge && <span className={styles.badge}>{badge}</span>}

        {playable && (
          <button
            type="button"
            className={`${styles.play} ${isPlayingThis ? styles.playActive : ""} pressable`}
            onClick={onPlay}
            aria-label={isPlayingThis ? `Pause ${title}` : `Play ${title}`}
          >
            {isPlayingThis ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </button>
        )}
      </div>

      <div className={styles.meta}>
        <p className={`${styles.title} ${isCurrent ? styles.titleActive : ""}`}>
          {/* A live readout, not an icon: it dances while playing and freezes
              when paused, so "this is the one" survives without colour. */}
          {isCurrent && <NowPlayingBars playing={isPlaying} size={11} className={styles.bars} />}
          <span className={styles.titleText}>{title}</span>
        </p>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
    </Link>
  );
}
