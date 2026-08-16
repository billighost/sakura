"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { BackButton } from "@/components/BackButton";
import { Grid, Rail } from "@/components/Rail";
import { MediaCard } from "@/components/MediaCard";
import { EmptyState, TrackListSkeleton } from "@/components/CollectionHero";
import { useArtworkTint } from "@/components/ArtworkTint";
import { useDownloadAll } from "@/lib/useDownloadAll";
import { haptic } from "@/lib/haptics";
import {
  AlertIcon,
  DiscIcon,
  DownloadIcon,
  DownloadedIcon,
  HeartIcon,
  PlayIcon,
  ShareIcon,
  ShuffleIcon,
  SpinnerIcon,
  UserIcon,
} from "@/components/Icons";
import {
  getCachedLibraryData,
  setCachedLibraryData,
  getCachedUserId,
  isTrackDownloaded,
} from "@/lib/offline-db";
import styles from "./page.module.css";

/**
 * Artist detail.
 *
 * The old page was a list of every track the artist appears on, with a bio
 * above it — which is the least interesting thing this data supports. The API
 * returns top tracks, the full album list and (new) related artists, so the page
 * now leads with songs, then albums, then who else to try, and keeps the bio
 * last because it's reference material rather than something you came for.
 *
 * Removed: the Follow button. It wrote an id into a `followed-artists`
 * localStorage array that nothing else in the app read — no rail, no home
 * section, no taste signal. It was a toggle whose only effect was to remember
 * its own state, which the house rule says to delete rather than ship. Liking
 * the songs does reach the server and does feed the taste engine, so that's the
 * action the page keeps.
 */

interface Track {
  id: string;
  title: string;
  artist: { name: string; id: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  otherArtists?: { name: string; id: string; role: string }[];
}

interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  releaseYear?: number | null;
  trackCount?: number;
}

interface RelatedArtist {
  id: string;
  name: string;
  imageUrl?: string | null;
}

interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  bio?: string;
  genres?: string[];
  fans?: number;
  albums: Album[];
  tracks: Track[];
  related?: RelatedArtist[];
  trackCount: number;
  albumCount: number;
}

/** Songs shown before the list asks to be expanded. */
const SONGS_PREVIEW = 5;

/** Bio length past which "Read more" earns its place. */
const BIO_CLAMP = 220;

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ArtistClient({ id }: { id: string }) {
  const { play, showToast, downloadStates } = usePlayer();
  const { downloadAll, checking: downloading } = useDownloadAll();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [songsExpanded, setSongsExpanded] = useState(false);
  const [likedAll, setLikedAll] = useState(false);

  const tint = useArtworkTint(artist?.imageUrl);

  /*
   * How much of this artist is already on the device. Saving music offline is
   * the thing this app does that the streaming services don't, and until now the
   * artist page expressed it as a single download glyph — indistinguishable from
   * Share sitting next to it. With a count, the control can say "Save 12" and
   * then "Saved offline", which is the most reassuring sentence the page has.
   *
   * Keyed by artist id and matched during render rather than cleared in the
   * effect: clearing synchronously is a cascading render, and it would let one
   * artist's count appear under another artist's name while the check re-runs.
   */
  const [savedCount, setSavedCount] = useState<{ artistId: string; count: number } | null>(null);
  const downloadedCount = artist && savedCount?.artistId === artist.id ? savedCount.count : 0;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const cacheKey = `artist-${id}`;

    async function load() {
      setFailed(false);
      const uId = getCachedUserId();

      const cached = await getCachedLibraryData<Artist>(cacheKey, uId);
      if (cancelled) return;
      if (cached) {
        setArtist(cached);
        setLoading(false);
      }

      try {
        const res = await fetch(`/api/artists/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Artist = await res.json();
        if (cancelled) return;
        setArtist(data);
        setCachedLibraryData(cacheKey, data, uId);
      } catch {
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

  useEffect(() => {
    if (!artist || artist.tracks.length === 0) return;

    let active = true;
    const artistId = artist.id;
    (async () => {
      const flags = await Promise.all(artist.tracks.map((t) => isTrackDownloaded(t.id)));
      if (active) setSavedCount({ artistId, count: flags.filter(Boolean).length });
    })();

    return () => {
      active = false;
    };
  }, [artist, downloadStates]);

  /*
   * Some tracks are credited to a featured artist as well as the main one, and
   * the row should say so. Built once per artist rather than per row: the old
   * page called this inside the render for every track *and* rebuilt the entire
   * queue array inside every row's props, so a 50-track artist page allocated
   * 50 copies of a 50-element queue on each render.
   */
  const queue = useMemo(() => {
    if (!artist) return [];
    return artist.tracks.map((t) => {
      const names = [t.artist.name];
      for (const other of t.otherArtists ?? []) {
        if (other.id !== t.artist.id) names.push(other.name);
      }
      return { ...t, artist: { name: names.join(", "), id: t.artist.id } };
    });
  }, [artist]);

  const playable = useMemo(
    () =>
      queue.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist.name,
        album: t.album?.title,
        coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
        audioUrl: t.audioUrl,
        duration: t.duration,
      })),
    [queue]
  );

  const handlePlayAll = useCallback(() => {
    if (playable.length) play(playable[0], playable);
  }, [playable, play]);

  const handleShuffle = useCallback(() => {
    if (!playable.length) return;
    const shuffled = shuffleArray(playable);
    play(shuffled[0], shuffled);
  }, [playable, play]);

  const handleLikeAll = useCallback(async () => {
    if (!artist) return;
    const next = !likedAll;
    setLikedAll(next);
    haptic(next ? "success" : "selection");
    try {
      const res = await fetch(`/api/favorites/batch`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackIds: artist.tracks.map((t) => t.id) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(next ? "Added these songs to Liked" : "Removed these songs from Liked");
    } catch {
      setLikedAll(!next);
      haptic("error");
      showToast("Couldn't save that. Check your connection.");
    }
  }, [artist, likedAll, showToast]);

  const handleDownloadAll = useCallback(async () => {
    if (!artist) return;
    await downloadAll(
      artist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title,
        coverUrl: track.coverUrl || track.album?.coverUrl,
        audioUrl: track.audioUrl,
        duration: track.duration,
        albumId: track.album?.id,
      })),
      artist.name
    );
  }, [artist, downloadAll]);

  const handleShare = useCallback(async () => {
    if (!artist) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: artist.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch (err) {
      // A share sheet the user swiped away rejects with AbortError. That's a
      // decision, not a failure, and it must not surface as one.
      if (err instanceof Error && err.name === "AbortError") return;
      showToast("Couldn't share that link");
    }
  }, [artist, showToast]);

  if (loading && !artist) {
    return (
      <div className={styles.page} data-page-scroll>
        <TrackListSkeleton rows={6} />
      </div>
    );
  }

  if (!artist) {
    return (
      <div className={styles.page} data-page-scroll>
        <EmptyState
          icon={<AlertIcon size={26} />}
          title={failed ? "Couldn't open this artist" : "Artist not found"}
          body={
            failed
              ? "Check your connection and try again. Music you've saved for offline still works."
              : "We couldn't find this artist. They may have been removed."
          }
          action={{ href: "/search", label: "Search" }}
          secondaryAction={{ href: "/home", label: "Go home" }}
        />
      </div>
    );
  }

  const visibleSongs = songsExpanded ? queue : queue.slice(0, SONGS_PREVIEW);
  const bioNeedsToggle = (artist.bio?.length ?? 0) > BIO_CLAMP;
  const allSaved = artist.tracks.length > 0 && downloadedCount === artist.tracks.length;

  return (
    <div className={styles.page} data-page-scroll>
      <header
        className={styles.hero}
        style={tint ? ({ "--hero-tint": tint } as React.CSSProperties) : undefined}
      >
        <div className={styles.backRow}>
          <BackButton fallback="/search" />
        </div>

        <div className={styles.avatarWrap}>
          {artist.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artist.imageUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={`${styles.avatar} ${styles.avatarFallback}`} aria-hidden="true">
              <UserIcon size={38} />
            </div>
          )}
        </div>

        <p className={styles.eyebrow}>Artist</p>
        <h1 className={styles.name}>{artist.name}</h1>

        {/*
          Genre used to render as bordered pills — which is the exact visual
          the filter chips in CollectionControls use for something you can tap.
          These aren't tappable (there's no genre destination to link to), so
          they sat in the fact line pretending to be controls. Genre is a fact
          about the record, like the year and the runtime, so it's written as
          one.
        */}
        <p className={styles.stats}>
          {artist.trackCount} song{artist.trackCount === 1 ? "" : "s"}
          {artist.albumCount > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              {artist.albumCount} album{artist.albumCount === 1 ? "" : "s"}
            </>
          )}
          {artist.genres && artist.genres.length > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              {artist.genres.slice(0, 2).join(", ")}
            </>
          )}
        </p>

        {/*
          Two rows, not one flat strip of five identical circles. Starting
          playback is why anyone opens an artist page, so it gets the row to
          itself; the rest are things you might do while you're here, and they
          carry words because "what does this circle do" is not a question a
          secondary control should raise.
        */}
        <div className={styles.primaryActions}>
          <button
            type="button"
            className={`${styles.play} pressable`}
            onClick={() => {
              haptic("impact");
              handlePlayAll();
            }}
            disabled={playable.length === 0}
          >
            <PlayIcon size={17} />
            Play
          </button>

          <button
            type="button"
            className={`${styles.shuffle} pressable`}
            onClick={() => {
              haptic("impact");
              handleShuffle();
            }}
            disabled={playable.length === 0}
            aria-label="Shuffle these songs"
          >
            <ShuffleIcon size={17} />
          </button>
        </div>

        <div className={styles.secondaryActions}>
          <button
            type="button"
            className={`${styles.ghost} ${likedAll ? styles.ghostOn : ""} pressable`}
            onClick={handleLikeAll}
            aria-pressed={likedAll}
          >
            <HeartIcon size={16} filled={likedAll} />
            {likedAll ? "Liked" : "Like all"}
          </button>

          {/*
            The same three states as the collection transport row: nothing saved
            offers the save, partway through says how many are left, and all
            saved stops being a button and becomes a statement.
          */}
          {allSaved ? (
            <span className={styles.savedBadge}>
              <DownloadedIcon size={16} />
              Saved offline
            </span>
          ) : (
            <button
              type="button"
              className={`${styles.ghost} pressable`}
              onClick={handleDownloadAll}
              disabled={downloading || artist.tracks.length === 0}
            >
              {downloading ? (
                <SpinnerIcon size={16} className={styles.spin} />
              ) : (
                <DownloadIcon size={16} />
              )}
              {downloading
                ? "Saving…"
                : downloadedCount > 0
                  ? `Save ${artist.tracks.length - downloadedCount}`
                  : "Save all"}
            </button>
          )}

          <button type="button" className={`${styles.ghost} pressable`} onClick={handleShare}>
            <ShareIcon size={16} />
            Share
          </button>
        </div>
      </header>

      {queue.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Songs</h2>
            {queue.length > SONGS_PREVIEW && (
              <button
                type="button"
                className={`${styles.showAll} pressable`}
                onClick={() => setSongsExpanded((v) => !v)}
                aria-expanded={songsExpanded}
              >
                {songsExpanded ? "Show less" : `Show all ${queue.length}`}
              </button>
            )}
          </div>

          {/*
            No track numbers here, unlike the album page. On an album the number
            is the track's position on the record — real information. This list
            is the library's copies first, then the provider's popular tracks, so
            a number beside each row would be a rank that means nothing.
          */}
          {visibleSongs.map((track, i) => (
            <TrackRow key={track.id} track={track} queue={queue} index={i} />
          ))}
        </section>
      )}

      {artist.albums.length > 0 && (
        <Grid title="Albums">
          {artist.albums.map((album, i) => (
            <MediaCard
              key={album.id}
              href={`/album/${album.id}`}
              title={album.title}
              subtitle={
                album.releaseYear
                  ? String(album.releaseYear)
                  : album.trackCount
                    ? `${album.trackCount} songs`
                    : undefined
              }
              coverUrl={album.coverUrl}
              fallbackIcon={<DiscIcon size={22} />}
              index={i}
            />
          ))}
        </Grid>
      )}

      {artist.related && artist.related.length > 0 && (
        <Rail title="Fans also like">
          {artist.related.map((rel, i) => (
            <MediaCard
              key={rel.id}
              href={`/artist/${rel.id}`}
              title={rel.name}
              coverUrl={rel.imageUrl}
              shape="round"
              size="sm"
              fallbackIcon={<UserIcon size={20} />}
              index={i}
            />
          ))}
        </Rail>
      )}

      {artist.bio && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <p className={`${styles.bio} ${bioExpanded ? styles.bioOpen : ""}`}>{artist.bio}</p>
          {bioNeedsToggle && (
            <button
              type="button"
              className={`${styles.showAll} pressable`}
              onClick={() => setBioExpanded((v) => !v)}
              aria-expanded={bioExpanded}
            >
              {bioExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </section>
      )}

      {queue.length === 0 && artist.albums.length === 0 && (
        <EmptyState
          icon={<DiscIcon size={26} />}
          title="Nothing here yet"
          body="We couldn't find any songs or albums for this artist. Searching by song name often works better."
          action={{ href: `/search?q=${encodeURIComponent(artist.name)}`, label: "Search" }}
        />
      )}
    </div>
  );
}
