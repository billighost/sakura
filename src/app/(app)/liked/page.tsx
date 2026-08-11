"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import {
  CollectionHero,
  CollectionTransport,
  EmptyState,
  TrackListSkeleton,
} from "@/components/CollectionHero";
import { CollectionSearch, CollectionSort } from "@/components/CollectionControls";
import { HeartIcon, SearchIcon } from "@/components/Icons";
import { useDownloadAll } from "@/lib/useDownloadAll";
import { useDownloadedCount } from "@/lib/useDownloadedCount";
import { getCachedLibraryData, setCachedLibraryData, getCachedUserId } from "@/lib/offline-db";
import { formatCollectionMeta, shuffled } from "@/lib/collection";
import { usePersistedChoice } from "@/lib/usePersistedChoice";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  likedAt?: string;
}

type SortKey = "date" | "title" | "artist" | "album";

const SORT_LABELS: Record<SortKey, string> = {
  date: "Recently liked",
  title: "Title",
  artist: "Artist",
  album: "Album",
};

/* Stable identity — see usePersistedChoice. */
const SORT_KEYS = ["date", "title", "artist", "album"] as const;

export default function LikedPage() {
  const { play } = usePlayer();
  const { downloadAll, checking: downloading } = useDownloadAll();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hasCache = useRef(false);

  // Straight from storage, so the list never renders in the wrong order first.
  const [sortBy, setSortBy] = usePersistedChoice<SortKey>("sakura-liked-sort", SORT_KEYS, "date");

  const load = useCallback(async (userId = getCachedUserId()) => {
    try {
      const res = await fetch("/api/favorites");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      // The endpoint has returned both shapes over its life; accept either
      // rather than rendering an empty list against the one it isn't.
      const next: Track[] = Array.isArray(data) ? data : data.tracks ?? [];
      setTracks(next);
      setError(null);
      setCachedLibraryData("liked-main", { tracks: next }, userId);
    } catch {
      // Only surface the failure when there's nothing on screen. With cached
      // tracks showing, an error banner over a working list is just noise.
      if (!hasCache.current) {
        setError("Couldn't load your liked songs. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const userId = getCachedUserId();
      const cached = await getCachedLibraryData<{ tracks: Track[] }>("liked-main", userId);
      if (cancelled) return;

      if (cached?.tracks?.length) {
        setTracks(cached.tracks);
        setLoading(false);
        hasCache.current = true;
      }
      void load(userId);
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const visible = useMemo(() => {
    let list = tracks;

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.name.toLowerCase().includes(q) ||
          (t.album?.title ?? "").toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.title.localeCompare(b.title);
        case "artist":
          return a.artist.name.localeCompare(b.artist.name);
        case "album":
          return (a.album?.title ?? "").localeCompare(b.album?.title ?? "");
        default: {
          const dA = a.likedAt ? new Date(a.likedAt).getTime() : 0;
          const dB = b.likedAt ? new Date(b.likedAt).getTime() : 0;
          return dB - dA;
        }
      }
    });
  }, [tracks, query, sortBy]);

  const ids = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const { downloaded, total } = useDownloadedCount(ids);

  const toQueue = (t: Track) => ({
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    album: t.album?.title,
    coverUrl: t.coverUrl ?? t.album?.coverUrl,
    audioUrl: t.audioUrl,
    duration: t.duration,
  });

  /* Plays what's on screen, not what's stored: if a search has narrowed the
   * list, Play should mean "these", which is what the user is looking at. */
  const playAll = () => {
    const q = visible.map(toQueue);
    if (q.length) play(q[0], q);
  };

  const shufflePlay = () => {
    const q = shuffled(visible).map(toQueue);
    if (q.length) play(q[0], q);
  };

  const saveAll = () =>
    downloadAll(tracks.map(toQueue), "liked songs");

  /* The artwork of the four most recent likes, as a mosaic. A collection with
   * no cover of its own is better represented by what's actually in it. */
  const mosaic = useMemo(
    () =>
      tracks
        .map((t) => t.coverUrl ?? t.album?.coverUrl)
        .filter((u): u is string => Boolean(u))
        .slice(0, 4),
    [tracks]
  );

  return (
    <div className={styles.page}>
      <CollectionHero
        eyebrow="Playlist"
        title="Liked Songs"
        coverUrls={mosaic}
        fallbackIcon={<HeartIcon size={36} filled />}
        loading={loading && tracks.length === 0}
        meta={formatCollectionMeta(tracks.length, tracks.reduce((s, t) => s + (t.duration || 0), 0))}
        actions={
          <button
            type="button"
            className={`${styles.iconBtn} pressable`}
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery("");
            }}
            aria-label="Search your liked songs"
            aria-pressed={searchOpen}
          >
            <SearchIcon size={19} />
          </button>
        }
      >
        {searchOpen && (
          <div className={styles.searchSlot}>
            <CollectionSearch
              value={query}
              onChange={setQuery}
              onClose={() => setSearchOpen(false)}
              placeholder="Search in liked songs"
            />
          </div>
        )}
      </CollectionHero>

      {tracks.length > 0 && (
        <CollectionTransport
          onPlay={playAll}
          onShuffle={shufflePlay}
          disabled={visible.length === 0}
          downloaded={downloaded}
          total={total}
          onDownloadAll={saveAll}
          downloading={downloading}
        >
          <CollectionSort value={sortBy} labels={SORT_LABELS} onChange={setSortBy} />
        </CollectionTransport>
      )}

      <div className={styles.list}>
        {loading && tracks.length === 0 ? (
          <TrackListSkeleton rows={7} />
        ) : error ? (
          <EmptyState
            icon={<HeartIcon size={26} />}
            title="Couldn't load your liked songs"
            body={error}
            action={{ href: "/liked", label: "Try again" }}
          />
        ) : tracks.length === 0 ? (
          <EmptyState
            icon={<HeartIcon size={26} />}
            title="No liked songs yet"
            body="Tap the heart on any song and it lands here. Liked songs also teach the mixes on your home page what you're into."
            action={{ href: "/search", label: "Find something to like" }}
            secondaryAction={{ href: "/home", label: "Browse home" }}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchIcon size={26} />}
            title={`Nothing matches "${query}"`}
            body="Try a different word, or clear the search to see everything you've liked."
          />
        ) : (
          <div className="anim-stagger">
            {visible.map((track, i) => (
              <div key={track.id} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <TrackRow track={track} queue={visible} index={i} showNumber />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
