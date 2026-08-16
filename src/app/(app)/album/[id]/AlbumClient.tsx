"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import {
  CollectionHero,
  CollectionTransport,
  EmptyState,
  TrackListSkeleton,
} from "@/components/CollectionHero";
import { Grid } from "@/components/Rail";
import { MediaCard } from "@/components/MediaCard";
import { useArtworkTint } from "@/components/ArtworkTint";
import { useDownloadAll } from "@/lib/useDownloadAll";
import { haptic } from "@/lib/haptics";
import { AlertIcon, DiscIcon, HeartIcon } from "@/components/Icons";
import {
  isTrackDownloaded,
  getCachedLibraryData,
  setCachedLibraryData,
  getCachedUserId,
} from "@/lib/offline-db";
import styles from "./page.module.css";

/**
 * An album is a collection, so it uses the same hero, transport row and empty
 * state as Liked, Downloaded, Playlist and Mix rather than a fourth private copy
 * of all three. What used to be album-specific — the year/track-count/runtime
 * line, the genre chips, the "more by this artist" grid — is what's left in this
 * file, which is the right split.
 */

interface AlbumTrack {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

interface RelatedAlbum {
  id: string;
  title: string;
  coverUrl?: string;
  year?: number;
}

interface AlbumDetail {
  id: string;
  title: string;
  artist: { id: string; name: string };
  coverUrl?: string;
  year?: number;
  genres?: string[];
  liked?: boolean;
  tracks: AlbumTrack[];
  relatedAlbums?: RelatedAlbum[];
  copyright?: string;
}

/** "1 hr 12 min" reads better than "72 min" past the hour. */
function formatRuntime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AlbumClient({ id }: { id: string }) {
  const { play, downloadStates } = usePlayer();
  const { downloadAll } = useDownloadAll();

  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [liked, setLiked] = useState(false);

  const tint = useArtworkTint(album?.coverUrl);

  const downloading = useMemo(
    () =>
      album
        ? album.tracks.some(
            (t) => downloadStates[t.id] === "queued" || downloadStates[t.id] === "downloading"
          )
        : false,
    [album, downloadStates]
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const cacheKey = `album-${id}`;
    const uId = getCachedUserId();

    async function load() {
      setLoading(true);
      setFailed(false);

      // Cached copy first so an album opened before renders instantly and
      // offline; the network result replaces it when it lands.
      const cached = await getCachedLibraryData<AlbumDetail>(cacheKey, uId);
      if (cancelled) return;
      if (cached) {
        setAlbum(cached);
        setLiked(!!cached.liked);
        setLoading(false);
      }

      try {
        const res = await fetch(`/api/albums/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AlbumDetail = await res.json();
        if (cancelled) return;
        setAlbum(data);
        setLiked(!!data.liked);
        setCachedLibraryData(cacheKey, data, uId);
      } catch {
        // A failed refresh with a cached copy on screen is not a failure the
        // user needs to see; a failure with nothing on screen is.
        if (!cancelled && !cached) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /*
   * How many tracks are already on the device. A count rather than the old
   * all-or-nothing boolean, because the transport row reports "Save 4" when
   * you're partway through — which is the state most albums are actually in.
   *
   * Stored against the album id and matched during render rather than reset by
   * the effect: resetting synchronously is a cascading render, and it would also
   * let one album's count show briefly under another album's title when you
   * navigate between two of them.
   */
  const [savedCount, setSavedCount] = useState<{ albumId: string; count: number } | null>(null);
  const downloadedCount = album && savedCount?.albumId === album.id ? savedCount.count : 0;

  useEffect(() => {
    if (!album || album.tracks.length === 0) return;

    let active = true;
    const albumId = album.id;
    (async () => {
      const flags = await Promise.all(album.tracks.map((t) => isTrackDownloaded(t.id)));
      if (active) setSavedCount({ albumId, count: flags.filter(Boolean).length });
    })();

    return () => {
      active = false;
    };
  }, [album, downloadStates]);

  const playerQueue = useMemo(() => {
    if (!album) return [];
    return album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: album.title,
      coverUrl: t.coverUrl || album.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
  }, [album]);

  const displayTracks = useMemo(() => {
    if (!album) return [];
    return album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: { name: t.artist.name },
      album: { title: album.title, coverUrl: album.coverUrl },
      coverUrl: t.coverUrl || album.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
  }, [album]);

  const handlePlay = useCallback(() => {
    if (playerQueue.length) play(playerQueue[0], playerQueue);
  }, [playerQueue, play]);

  const handleShuffle = useCallback(() => {
    if (!playerQueue.length) return;
    const shuffled = shuffleArray(playerQueue);
    play(shuffled[0], shuffled);
  }, [playerQueue, play]);

  const handleToggleLike = useCallback(async () => {
    if (!album) return;
    const next = !liked;
    setLiked(next);
    haptic(next ? "success" : "selection");
    try {
      const res = await fetch(`/api/favorites/batch`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackIds: album.tracks.map((t) => t.id) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Roll back rather than leaving the heart lying about server state.
      setLiked(!next);
      haptic("error");
    }
  }, [album, liked]);

  const handleDownloadAll = useCallback(async () => {
    if (!album) return;
    await downloadAll(
      album.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: album.title,
        coverUrl: track.coverUrl || album.coverUrl,
        audioUrl: track.audioUrl,
        duration: track.duration,
        albumId: album.id,
      })),
      album.title
    );
  }, [album, downloadAll]);

  if (loading && !album) {
    return (
      <div className={styles.page} data-page-scroll>
        <TrackListSkeleton rows={8} />
      </div>
    );
  }

  if (!album) {
    return (
      <div className={styles.page} data-page-scroll>
        <EmptyState
          icon={<AlertIcon size={26} />}
          title={failed ? "Couldn't open this album" : "Album not found"}
          body={
            failed
              ? "Check your connection and try again. Anything you've saved for offline is still in your library."
              : "This album isn't available any more. It may have been removed."
          }
          action={{ href: "/library", label: "Go to library" }}
          secondaryAction={{ href: "/search", label: "Search" }}
        />
      </div>
    );
  }

  const runtime = album.tracks.reduce((s, t) => s + (t.duration || 0), 0);

  return (
    <div className={styles.page} data-page-scroll>
      <CollectionHero
        eyebrow="Album"
        title={album.title}
        coverUrl={album.coverUrl}
        fallbackIcon={<DiscIcon size={34} />}
        tint={tint}
        backFallback="/library"
        meta={
          <>
            <Link href={`/artist/${album.artist.id}`} className={styles.artistLink}>
              {album.artist.name}
            </Link>
            {album.year ? <span aria-hidden="true">·</span> : null}
            {album.year ? <span>{album.year}</span> : null}
            <span aria-hidden="true">·</span>
            <span>
              {album.tracks.length} song{album.tracks.length === 1 ? "" : "s"}
            </span>
            {runtime > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatRuntime(runtime)}</span>
              </>
            )}
            {/* Genre belongs in the fact line, with the year and the runtime.
                It used to render as bordered pills below, which is the visual
                CollectionControls uses for a filter you can tap — these aren't
                tappable, because there's no genre destination to link to. */}
            {album.genres && album.genres.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{album.genres.slice(0, 2).join(", ")}</span>
              </>
            )}
          </>
        }
      />

      <CollectionTransport
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        disabled={album.tracks.length === 0}
        downloaded={downloadedCount}
        total={album.tracks.length}
        onDownloadAll={handleDownloadAll}
        downloading={downloading}
      >
        <button
          type="button"
          className={`${styles.likeBtn} ${liked ? styles.likeBtnOn : ""} pressable`}
          onClick={handleToggleLike}
          aria-pressed={liked}
          aria-label={liked ? "Remove these songs from Liked" : "Add every song to Liked"}
        >
          <HeartIcon size={16} filled={liked} />
        </button>
      </CollectionTransport>

      {album.tracks.length === 0 ? (
        <EmptyState
          icon={<DiscIcon size={26} />}
          title="No songs listed"
          body="We couldn't get this album's track list. Searching for the album name usually finds the songs individually."
          action={{ href: `/search?q=${encodeURIComponent(album.title)}`, label: "Search for it" }}
        />
      ) : (
        <div className={styles.tracks}>
          {displayTracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              queue={displayTracks}
              index={i}
              showNumber
            />
          ))}
        </div>
      )}

      {album.copyright && <p className={styles.copyright}>{album.copyright}</p>}

      {album.relatedAlbums && album.relatedAlbums.length > 0 && (
        <Grid title={`More by ${album.artist.name}`} href={`/artist/${album.artist.id}`}>
          {album.relatedAlbums.map((rel, i) => (
            <MediaCard
              key={rel.id}
              href={`/album/${rel.id}`}
              title={rel.title}
              subtitle={rel.year ? String(rel.year) : undefined}
              coverUrl={rel.coverUrl}
              fallbackIcon={<DiscIcon size={22} />}
              index={i}
            />
          ))}
        </Grid>
      )}
    </div>
  );
}
