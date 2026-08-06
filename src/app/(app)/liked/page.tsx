"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { isTrackDownloaded, saveTrackOffline, saveAudioBlob, getCachedLibraryData, setCachedLibraryData, getCachedUserId } from "@/lib/offline-db";
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

type SortKey = "title" | "artist" | "album" | "date";

function formatTotalDuration(tracks: Track[]): string {
  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${tracks.length} songs · ${h} hr ${m} min`;
  return `${tracks.length} songs · ${m} min`;
}

function formatTotalDurationLong(tracks: Track[]): string {
  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} hour${h !== 1 ? "s" : ""} ${m} minute${m !== 1 ? "s" : ""}`;
  return `${m} minute${m !== 1 ? "s" : ""}`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function LikedPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortOpen, setSortOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { play } = usePlayer();
  const hasLoadedFromCache = useRef(false);

  // Restore sorting preference
  useEffect(() => {
    const savedSort = localStorage.getItem("sakura-liked-sort") as SortKey;
    if (savedSort) setSortBy(savedSort);
  }, []);

  const handleSortChange = useCallback((newSort: SortKey) => {
    setSortBy(newSort);
    localStorage.setItem("sakura-liked-sort", newSort);
  }, []);

  const fetchFromServer = useCallback(async (isRefresh = false, userId = getCachedUserId()) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json();
      const newTracks = data.tracks || data || [];
      setTracks(newTracks);

      // Update cache isolated by user ID
      setCachedLibraryData("liked-main", { tracks: newTracks }, userId);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Cache-first loading
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const activeUserId = getCachedUserId();
      const cached = await getCachedLibraryData<{ tracks: Track[] }>("liked-main", activeUserId);
      if (cancelled) return;

      if (cached?.tracks) {
        setTracks(cached.tracks);
        setLoading(false);
        hasLoadedFromCache.current = true;
        // Refresh from server silently in the background
        fetchFromServer(false, activeUserId);
      } else {
        await fetchFromServer(false, activeUserId);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTracks = useMemo(() => {
    let list = [...tracks];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.name.toLowerCase().includes(q) ||
          (t.album?.title && t.album.title.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.title.localeCompare(b.title);
        case "artist":
          return a.artist.name.localeCompare(b.artist.name);
        case "album":
          return (a.album?.title || "").localeCompare(b.album?.title || "");
        case "date":
        default:
          const dateA = a.likedAt ? new Date(a.likedAt).getTime() : 0;
          const dateB = b.likedAt ? new Date(b.likedAt).getTime() : 0;
          return dateB - dateA;
      }
    });
  }, [tracks, searchQuery, sortBy]);

  function toQueue(t: Track) {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title,
      coverUrl: t.coverUrl || t.album?.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    };
  }

  function handlePlayAll() {
    if (tracks.length === 0) return;
    const q = filteredTracks.map(toQueue);
    play(q[0], q);
  }

  function handleShufflePlay() {
    if (tracks.length === 0) return;
    const shuffled = shuffleArray(filteredTracks);
    const q = shuffled.map(toQueue);
    play(q[0], q);
  }

  async function handleDownloadAll() {
    for (const track of tracks) {
      try {
        const existing = await isTrackDownloaded(track.id);
        if (existing) continue;
        const res = await fetch(track.audioUrl);
        const blob = await res.blob();
        const cover = track.coverUrl || track.album?.coverUrl;
        await saveTrackOffline({
          id: track.id,
          title: track.title,
          artist: track.artist.name,
          album: track.album?.title,
          audioUrl: track.audioUrl,
          coverUrl: cover,
          duration: track.duration,
        });
        await saveAudioBlob(track.id, blob);
      } catch {
        continue;
      }
    }
  }

  const sortLabels: Record<SortKey, string> = {
    title: "Title",
    artist: "Artist",
    album: "Album",
    date: "Date Added",
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerGradient}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className={styles.header}>
            <div className={styles.headerArt}>
              <svg viewBox="0 0 24 24" fill="white" width="clamp(1.5rem, 5vw, 2.25rem)" height="clamp(1.5rem, 5vw, 2.25rem)">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
            </div>
            <div className={styles.headerInfo}>
              <div className={styles.headerLabel}>Playlist</div>
              <div className={styles.headerTitle}>Liked Songs</div>
              <div className={styles.headerMeta}>
                {loading ? (
                  <span className={styles.skeletonTextSmall} />
                ) : tracks.length > 0 ? (
                  <>
                    <span>{tracks.length} songs</span>
                    <span className={styles.dot}>·</span>
                    <span>{formatTotalDurationLong(tracks)}</span>
                  </>
                ) : (
                  <span>0 songs</span>
                )}
              </div>
            </div>
          </div>
          <button
            className={styles.headerSearchBtn}
            onClick={() => setSearchOpen(!searchOpen)}
            title="Search inside liked songs"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className={styles.searchBar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search in liked songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            autoFocus
          />
          {searchQuery && (
            <button className={styles.searchClear} onClick={() => setSearchQuery("")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {tracks.length > 0 && (
        <div className={styles.controlsRow}>
          <div className={styles.playButtons}>
            <button className={styles.playAllBtn} onClick={handlePlayAll}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play All
            </button>
            <button className={styles.shuffleBtn} onClick={handleShufflePlay}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              Shuffle
            </button>
          </div>
          <div className={styles.rightControls}>
            <button className={styles.downloadAllBtn} onClick={handleDownloadAll} title="Download all for offline">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <div className={styles.sortWrapper}>
              <button className={styles.sortBtn} onClick={() => setSortOpen(!sortOpen)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="16" y2="12" />
                  <line x1="4" y1="18" x2="12" y2="18" />
                </svg>
                {sortLabels[sortBy]}
              </button>
              {sortOpen && (
                <>
                  <div className={styles.sortBackdrop} onClick={() => setSortOpen(false)} />
                  <div className={styles.sortDropdown}>
                    {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                      <button
                        key={key}
                        className={`${styles.sortOption} ${sortBy === key ? styles.sortOptionActive : ""}`}
                        onClick={() => { handleSortChange(key); setSortOpen(false); }}
                      >
                        {sortLabels[key]}
                        {sortBy === key && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width="14" height="14">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.trackList}>
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonCol}>
                <div className={styles.skeletonLineW70} />
                <div className={styles.skeletonLineW40} />
              </div>
            </div>
          ))
        ) : (
          filteredTracks.map((track, i) => (
            <TrackRow key={track.id} track={track} queue={filteredTracks} index={i} showNumber />
          ))
        )}
      </div>

      {!loading && tracks.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration}>
            <svg viewBox="0 0 120 120" width="100" height="100" fill="none">
              <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="1.5" />
              <circle cx="60" cy="60" r="36" stroke="var(--sakura-accent)" strokeWidth="1.5" opacity="0.3" />
              <path d="M60 38 C60 38 76 52 76 64 C76 71 69 78 60 78 C51 78 44 71 44 64 C44 52 60 38 60 38Z" fill="var(--sakura-accent)" opacity="0.12" />
              <circle cx="40" cy="42" r="3" fill="var(--sakura-accent-2)" opacity="0.5" />
              <circle cx="80" cy="48" r="2" fill="var(--sakura-accent)" opacity="0.4" />
              <circle cx="48" cy="82" r="2.5" fill="var(--sakura-accent-2)" opacity="0.3" />
              <circle cx="82" cy="76" r="1.5" fill="var(--sakura-accent)" opacity="0.25" />
            </svg>
          </div>
          <p className={styles.emptyTitle}>No liked songs yet</p>
          <p className={styles.emptySubtext}>Songs you like will appear here. Tap the heart on any track to like it.</p>
        </div>
      )}
    </div>
  );
}
