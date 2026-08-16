"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TrackRow } from "./TrackRow";
import { usePlayer } from "./PlayerContext";
import {
  CollectionHero,
  CollectionTransport,
  EmptyState,
  TrackListSkeleton,
} from "./CollectionHero";
import { useArtworkTint } from "./ArtworkTint";
import { useReorder } from "@/lib/useReorder";
import { useDownloadAll } from "@/lib/useDownloadAll";
import { isTrackDownloaded } from "@/lib/offline-db";
import { haptic } from "@/lib/haptics";
import { AlertIcon, DragHandleIcon, MusicNotesIcon } from "./Icons";
import styles from "./CollectionDetail.module.css";

/**
 * One page for playlists, system playlists and mixes.
 *
 * Those three routes were three copies of the same 555-line stylesheet and three
 * copies of the same 320-line client, differing in a fetch URL and one word of
 * label. That's the copy-paste artifact the brief calls out. But unifying them
 * turned up the more interesting problem: the three pages were *identical* when
 * the three things are not remotely the same, and the design said nothing about
 * which one you were looking at.
 *
 *   playlist        yours. You built it, so you can change it — rename, reorder,
 *                   remove, publish. The only one of the three with any verbs.
 *   system playlist ours. Curated, fixed, the same for everyone.
 *   mix             generated from your listening. It changes on its own, which
 *                   is the single most useful thing to say about it and the one
 *                   thing the old page never mentioned.
 *
 * So the shared part is the *shape* — hero, transport, list — and the differences
 * are declared as capabilities by the caller. `provenance` is the line that says
 * where the collection came from, and it's required: a collection with nothing to
 * say about its own origin is one of the three lying about being another.
 */

export interface DetailTrack {
  id: string;
  title: string;
  artist: { name: string; id?: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

export interface CollectionDetailProps {
  /** "Playlist", "Mix", "Curated by Sakura". Sits above the title. */
  eyebrow: string;
  title: string;
  description?: string | null;
  /** One cover, or four for the mosaic. */
  coverUrls: string[];
  tracks: DetailTrack[];
  /**
   * Where this collection came from, in the user's words — "Made for you,
   * updated daily", "Curated by Sakura", "42 songs you added". Required; see the
   * note above.
   */
  provenance: string;
  /** Where Back goes on a cold start or a shared link. */
  backFallback: string;

  loading?: boolean;
  /** Set when the fetch failed with nothing cached. Renders a retry. */
  error?: string | null;
  onRetry?: () => void;

  /** Extra controls in the transport row's trailing slot. */
  actions?: React.ReactNode;
  /** Rendered under the hero — a visibility toggle, an owner byline. */
  heroExtra?: React.ReactNode;
  /** Shown instead of the track list when there are none. */
  empty?: { title: string; body: string; action?: { href: string; label: string } };

  /** Supply to allow reordering. Receives the full reordered id list. */
  onReorder?: (orderedIds: string[]) => void;
  /** Supply to allow removing a track from this collection. */
  onRemoveTrack?: (trackId: string) => void;
  /** Numbered rows. True for a playlist (position is real), false for a mix. */
  numbered?: boolean;
}

export function CollectionDetail({
  eyebrow,
  title,
  description,
  coverUrls,
  tracks,
  provenance,
  backFallback,
  loading = false,
  error = null,
  onRetry,
  actions,
  heroExtra,
  empty,
  onReorder,
  onRemoveTrack,
  numbered = true,
}: CollectionDetailProps) {
  const { play, downloadStates } = usePlayer();
  const { downloadAll } = useDownloadAll();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const tint = useArtworkTint(coverUrls[0]);

  /*
   * Local copy of the order, so a drag lands instantly instead of waiting on a
   * round trip. The server call follows; if it fails the caller restores the
   * order it knows about by re-rendering with its own `tracks`, which is why
   * this resets whenever the prop identity changes.
   */
  const [order, setOrder] = useState<DetailTrack[] | null>(null);
  const [orderSource, setOrderSource] = useState(tracks);
  if (orderSource !== tracks) {
    setOrderSource(tracks);
    setOrder(null);
  }
  const list = order ?? tracks;

  const downloading = useMemo(
    () =>
      list.some(
        (t) => downloadStates[t.id] === "queued" || downloadStates[t.id] === "downloading"
      ),
    [list, downloadStates]
  );

  /* How much of this collection is on the device. See AlbumClient for why the
   * count is keyed and matched during render rather than reset in the effect. */
  const idsKey = useMemo(() => list.map((t) => t.id).join(","), [list]);
  const [saved, setSaved] = useState<{ key: string; count: number } | null>(null);
  const downloadedCount = saved?.key === idsKey ? saved.count : 0;

  useEffect(() => {
    if (list.length === 0) return;
    let active = true;
    const key = idsKey;
    (async () => {
      const flags = await Promise.all(list.map((t) => isTrackDownloaded(t.id)));
      if (active) setSaved({ key, count: flags.filter(Boolean).length });
    })();
    return () => {
      active = false;
    };
    // `idsKey` is the identity of `list` for this purpose — a reorder doesn't
    // change what's downloaded, so it must not re-run the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, downloadStates]);

  const queue = useMemo(
    () =>
      list.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist.name,
        album: t.album?.title,
        coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
        audioUrl: t.audioUrl,
        duration: t.duration,
      })),
    [list]
  );

  const handlePlay = useCallback(() => {
    if (queue.length) play(queue[0], queue);
  }, [queue, play]);

  const handleShuffle = useCallback(() => {
    if (!queue.length) return;
    const a = [...queue];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    play(a[0], a);
  }, [queue, play]);

  const handleDownloadAll = useCallback(async () => {
    await downloadAll(
      list.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist.name,
        album: t.album?.title,
        coverUrl: t.coverUrl || t.album?.coverUrl,
        audioUrl: t.audioUrl,
        duration: t.duration,
      })),
      title
    );
  }, [list, downloadAll, title]);

  const handleMove = useCallback(
    (from: number, to: number) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setOrder(next);
      onReorder?.(next.map((t) => t.id));
    },
    [list, onReorder]
  );

  const reorder = useReorder({
    count: list.length,
    onReorder: handleMove,
    enabled: Boolean(onReorder),
    scrollerRef,
  });

  if (loading && tracks.length === 0) {
    return (
      <div className={styles.page} ref={scrollerRef} data-page-scroll>
        <TrackListSkeleton rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page} ref={scrollerRef} data-page-scroll>
        <EmptyState
          icon={<AlertIcon size={26} />}
          title="Couldn't open this"
          body={error}
          action={{ href: backFallback, label: "Go back" }}
        />
        {onRetry && (
          <div className={styles.retryRow}>
            <button type="button" className={`${styles.retry} pressable`} onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  const runtime = list.reduce((s, t) => s + (t.duration || 0), 0);

  return (
    <div className={styles.page} ref={scrollerRef} data-page-scroll>
      <CollectionHero
        eyebrow={eyebrow}
        title={title}
        description={description}
        coverUrl={coverUrls.length === 1 ? coverUrls[0] : undefined}
        coverUrls={coverUrls.length >= 4 ? coverUrls : undefined}
        fallbackIcon={<MusicNotesIcon size={32} />}
        tint={tint}
        backFallback={backFallback}
        loading={loading && list.length === 0}
        meta={
          <>
            <span>
              {list.length} song{list.length === 1 ? "" : "s"}
            </span>
            {runtime > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatRuntime(runtime)}</span>
              </>
            )}
          </>
        }
      >
        {/* Provenance, not decoration: it's the only thing distinguishing a mix
            from a curated playlist from one you built yourself. */}
        <p className={styles.provenance}>{provenance}</p>
        {heroExtra}
      </CollectionHero>

      <CollectionTransport
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        disabled={list.length === 0}
        downloaded={downloadedCount}
        total={list.length}
        onDownloadAll={handleDownloadAll}
        downloading={downloading}
      >
        {actions}
      </CollectionTransport>

      {list.length === 0 ? (
        <EmptyState
          icon={<MusicNotesIcon size={26} />}
          title={empty?.title ?? "Nothing in here yet"}
          body={empty?.body ?? "Songs you add will show up here."}
          action={empty?.action}
        />
      ) : (
        <div
          className={styles.tracks}
          ref={reorder.containerRef as React.RefObject<HTMLDivElement>}
        >
          {list.map((track, i) => (
            <div
              key={track.id}
              className={`${styles.row} ${reorder.dragging === i ? styles.rowDragging : ""}`}
              {...reorder.itemProps(i)}
            >
              <TrackRow
                track={track}
                queue={list}
                index={i}
                showNumber={numbered}
                onRemove={onRemoveTrack}
                dragHandle={
                  onReorder ? (
                    <button
                      type="button"
                      className={styles.grip}
                      aria-label={`Move ${track.title}. Use the up and down arrow keys.`}
                      {...reorder.handleProps(i)}
                    >
                      <DragHandleIcon size={17} />
                    </button>
                  ) : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "1 hr 12 min" past the hour, "48 min" below it. */
function formatRuntime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

/* ── Visibility ───────────────────────────────────────────────────────────── */

/**
 * Publish / unpublish, for a playlist you own.
 *
 * `Playlist.isPublic` and the profile page's toggle already existed, but the
 * playlist page itself — the place you're standing when you decide to share it —
 * had no way to change it. The control states what will be true after the press,
 * and the line under it says what that means, because "public" alone doesn't
 * tell anyone what becomes visible.
 */
export function VisibilityToggle({
  isPublic,
  onChange,
}: {
  isPublic: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={styles.visibility}>
      <button
        type="button"
        className={`${styles.visibilityBtn} ${isPublic ? styles.visibilityOn : ""} pressable`}
        onClick={() => {
          haptic("selection");
          onChange(!isPublic);
        }}
        aria-pressed={isPublic}
      >
        {isPublic ? "Anyone with the link" : "Only you"}
      </button>
      <p className={styles.visibilityHint}>
        {isPublic
          ? "This playlist shows up in search and anyone with the link can play it."
          : "Nobody else can see this playlist. Tap to let people with the link play it."}
      </p>
    </div>
  );
}

/** Owner byline, for a public playlist you're viewing but don't own. */
export function OwnerByline({ name, href }: { name: string; href?: string }) {
  return (
    <p className={styles.owner}>
      <span className={styles.ownerLabel}>Playlist by</span>{" "}
      {href ? (
        <Link href={href} className={styles.ownerName}>
          {name}
        </Link>
      ) : (
        <span className={styles.ownerName}>{name}</span>
      )}
    </p>
  );
}
