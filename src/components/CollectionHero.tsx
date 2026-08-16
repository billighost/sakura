"use client";

import Link from "next/link";
import { BackButton } from "./BackButton";
import { DownloadIcon, DownloadedIcon, PlayIcon, ShuffleIcon, SpinnerIcon } from "./Icons";
import { haptic } from "@/lib/haptics";
import styles from "./CollectionHero.module.css";

/**
 * The header block every collection page shares: a large art tile, a kind
 * label, the title, and a line of metadata.
 *
 * Liked, Downloaded, Playlist, System Playlist and Mix each had their own copy —
 * five near-identical `.headerGradient` blocks, all of which the gradient purge
 * had already flattened to a single colour, and each of which computed its
 * "N songs · M minutes" line slightly differently. One of them said "0 songs"
 * while still loading.
 *
 * `tint` accepts an extracted artwork colour. It drives `--hero-tint`, which
 * the scrim ramps from — one colour to transparent, which is the only kind of
 * gradient the design language permits over artwork.
 */

export interface CollectionHeroProps {
  /** Small label above the title — "Playlist", "Mix", "Album". */
  eyebrow: string;
  title: string;
  /** Rendered under the title: counts, durations, owner. */
  meta?: React.ReactNode;
  description?: string | null;
  coverUrl?: string | null;
  /** Four-up mosaic, used when a collection has no single cover of its own. */
  coverUrls?: string[];
  /** Drawn when there's no artwork. */
  fallbackIcon?: React.ReactNode;
  /** Extracted accent from the artwork; tints the block behind the text. */
  tint?: string | null;
  /** Replaces meta with a shimmer while the count is genuinely unknown. */
  loading?: boolean;
  /** Trailing controls in the top-right — search toggles, overflow menus. */
  actions?: React.ReactNode;
  /**
   * Where Back goes when there's nothing to pop — a shared link, a PWA cold
   * start, a refresh. Defaults to the library, which is where every collection
   * in the app is reachable from.
   */
  backFallback?: string;
  /**
   * Set false only for a collection that is itself a tab root. Every page using
   * this hero today is a detail page reached by tapping something, so the
   * control is on by default: making it opt-in is how five of these pages ended
   * up with no way back but the system gesture, which a standalone PWA doesn't
   * always have.
   */
  showBack?: boolean;
  children?: React.ReactNode;
}

export function CollectionHero({
  eyebrow,
  title,
  meta,
  description,
  coverUrl,
  coverUrls,
  fallbackIcon,
  tint,
  loading = false,
  actions,
  backFallback = "/library",
  showBack = true,
  children,
}: CollectionHeroProps) {
  const mosaic = coverUrls && coverUrls.length >= 4 ? coverUrls.slice(0, 4) : null;

  return (
    <header
      className={styles.hero}
      style={tint ? ({ "--hero-tint": tint } as React.CSSProperties) : undefined}
    >
      {showBack && (
        <div className={styles.backRow}>
          <BackButton fallback={backFallback} />
        </div>
      )}

      <div className={styles.top}>
        <div className={styles.art}>
          {mosaic ? (
            <div className={styles.mosaic} aria-hidden="true">
              {mosaic.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={url} alt="" className={styles.mosaicCell} />
              ))}
            </div>
          ) : coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className={styles.image} />
          ) : (
            <div className={styles.fallback} aria-hidden="true">
              {fallbackIcon}
            </div>
          )}
        </div>

        {actions && <div className={styles.actions}>{actions}</div>}
      </div>

      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>

      {description && <p className={styles.description}>{description}</p>}

      <div className={styles.meta}>
        {loading ? <span className={`${styles.metaSkeleton} skeleton`} /> : meta}
      </div>

      {children}
    </header>
  );
}

/* ── Transport row ───────────────────────────────────────────────────────── */

/**
 * Play / Shuffle / Download-all, plus whatever the page adds.
 *
 * The download control is the interesting one: it reports three states rather
 * than two. "Nothing saved" offers the download, "some saved" says how many are
 * left, and "all saved" stops being a button and becomes a statement. The
 * previous pages simply hid the button once everything was downloaded, which
 * loses the most reassuring piece of information the page has — that this
 * collection works with no signal.
 */
export function CollectionTransport({
  onPlay,
  onShuffle,
  disabled = false,
  downloaded,
  total,
  onDownloadAll,
  downloading = false,
  children,
}: {
  onPlay: () => void;
  onShuffle: () => void;
  disabled?: boolean;
  /** How many of `total` are already on this device. */
  downloaded?: number;
  total?: number;
  onDownloadAll?: () => void;
  downloading?: boolean;
  children?: React.ReactNode;
}) {
  const allSaved = total !== undefined && total > 0 && downloaded === total;
  const remaining = total !== undefined && downloaded !== undefined ? total - downloaded : 0;

  return (
    <div className={styles.transport}>
      <button
        type="button"
        className={`${styles.play} pressable`}
        onClick={() => {
          haptic("impact");
          onPlay();
        }}
        disabled={disabled}
      >
        <PlayIcon size={17} />
        Play
      </button>

      <button
        type="button"
        className={`${styles.shuffle} pressable`}
        onClick={() => {
          haptic("impact");
          onShuffle();
        }}
        disabled={disabled}
        aria-label="Shuffle"
      >
        <ShuffleIcon size={17} />
      </button>

      <div className={styles.spacer} />

      {/*
        Three states, not two. "All saved" is a statement rather than a button
        and renders whether or not the page offers a download action — it's the
        most reassuring thing this row can say, and hiding it (which is what
        the pages did before) throws that away.
      */}
      {allSaved ? (
        <span className={styles.savedBadge}>
          <DownloadedIcon size={15} />
          Saved offline
        </span>
      ) : onDownloadAll && total !== undefined && total > 0 ? (
        <button
          type="button"
          className={`${styles.download} pressable`}
          onClick={() => {
            haptic("impact");
            onDownloadAll();
          }}
          disabled={downloading}
          aria-label={`Download ${remaining} song${remaining === 1 ? "" : "s"} for offline listening`}
        >
          {downloading ? (
            <SpinnerIcon size={15} className={styles.spin} />
          ) : (
            <DownloadIcon size={15} />
          )}
          <span className={styles.downloadLabel}>
            {downloading ? "Saving…" : remaining < (total ?? 0) ? `Save ${remaining}` : "Save all"}
          </span>
        </button>
      ) : null}

      {children}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

/**
 * Every empty state in the app, one shape.
 *
 * The house rule is that an empty state must offer a way forward — the versions
 * this replaces mostly described the emptiness and stopped. `action` is
 * therefore not optional in spirit even though it is in the type: a page with
 * genuinely nowhere to send someone is rare enough to be worth noticing.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyGlyph} aria-hidden="true">
        {icon}
      </div>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
      {(action || secondaryAction) && (
        <div className={styles.emptyActions}>
          {action && (
            <Link href={action.href} className={`${styles.emptyPrimary} pressable`}>
              {action.label}
            </Link>
          )}
          {secondaryAction && (
            <Link href={secondaryAction.href} className={`${styles.emptySecondary} pressable`}>
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────── */

/**
 * Hero placeholder, shaped like the real hero above.
 *
 * Every route's `loading.tsx` used to hand-roll this out of inline styles — six
 * copies, each with its own hardcoded rem values and its own `--sakura-skeleton`
 * fill, and none of them matching the header they were standing in for. Sharing
 * the component means the placeholder and the thing it replaces can't drift, and
 * a route-level loading file becomes three lines.
 *
 * `round` covers the artist shape, where the tile is an avatar.
 */
export function CollectionHeroSkeleton({
  round = false,
  transport = true,
}: {
  round?: boolean;
  /** Set false for a hero with no play row beneath it. */
  transport?: boolean;
}) {
  return (
    <div aria-hidden="true">
      <div className={styles.hero}>
        <div className={styles.backRow}>
          <div className={`${styles.skeletonBack} skeleton`} />
        </div>
        <div className={styles.top}>
          <div className={`${styles.art} ${round ? styles.skeletonArtRound : ""} skeleton`} />
        </div>
        <div className={`${styles.skeletonEyebrow} skeleton`} />
        <div className={`${styles.skeletonTitle} skeleton`} />
        <div className={styles.meta}>
          <span className={`${styles.metaSkeleton} skeleton`} />
        </div>
      </div>

      {transport && (
        <div className={styles.transport}>
          <div className={`${styles.skeletonPlay} skeleton`} />
          <div className={`${styles.skeletonPill} skeleton`} />
          <div className={styles.spacer} />
          <div className={`${styles.skeletonChip} skeleton`} />
        </div>
      )}
    </div>
  );
}

/** Track-list placeholder, shaped like TrackRow so the swap doesn't reflow. */
export function TrackListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={`${styles.skeletonArt} skeleton`} />
          <div className={styles.skeletonText}>
            <div className={`${styles.skeletonLine} skeleton`} />
            <div className={`${styles.skeletonLineShort} skeleton`} />
          </div>
        </div>
      ))}
    </div>
  );
}
