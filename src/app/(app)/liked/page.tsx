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
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortOpen, setSortOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [allDownloaded, setAllDownloaded] = useState(false);
  const { play, addToDownloadQueue, downloadStates } = usePlayer();
  const hasLoadedFromCache = useRef(false);

  useEffect(() => {
    const savedSort = localStorage.getItem("sakura-liked-sort") as SortKey;
    if (savedSort) setSortBy(savedSort);
  }, []);

  const handleSortChange = useCallback((newSort: SortKey) => {
    setSortBy(newSort);
    localStorage.setItem("sakura-liked-sort", newSort);
  }, []);

  const fetchFromServer = useCallback(async (userId = getCachedUserId()) => {
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json();
      const newTracks = data.tracks || data || [];
      setTracks(newTracks);
      setCachedLibraryData("liked-main", { tracks: newTracks }, userId);
    } catch {
      /* silent — cache already shown if present */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (tracks.length === 0) {
      if (active) setAllDownloaded(true);
      return;
    }

    async function checkDownloads() {
      let allDl = true;
      for (const t of tracks) {
        if (!(await isTrackDownloaded(t.id))) {
          allDl = false;
          break;
        }
      }
      if (active) setAllDownloaded(allDl);
    }
    checkDownloads();
    return () => { active = false; };
  }, [tracks, downloadStates]);

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
      }

      fetchFromServer(activeUserId);
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
        default: {
          const dateA = a.likedAt ? new Date(a.likedAt).getTime() : 0;
          const dateB = b.likedAt ? new Date(b.likedAt).getTime() : 0;
          return dateB - dateA;
        }
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
    if (filteredTracks.length === 0) return;
    const q = filteredTracks.map(toQueue);
    play(q[0], q);
  }

  function handleShufflePlay() {
    if (filteredTracks.length === 0) return;
    const shuffled = shuffleArray(filteredTracks);
    const q = shuffled.map(toQueue);
    play(q[0], q);
  }

  async function handleDownloadAll() {
    const tracksToDownload = tracks.map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist.name,
      album: track.album?.title,
      coverUrl: track.coverUrl || track.album?.coverUrl,
      audioUrl: track.audioUrl,
      duration: track.duration,
    }));

    addToDownloadQueue(tracksToDownload);
  }

  const sortLabels: Record<SortKey, string> = {
    date: "Date Added",
    title: "Title",
    artist: "Artist",
    album: "Album",
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerGradient}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem" }}>
          <div className={styles.header}>
            <div className={styles.headerArt}>
              <svg viewBox="0 0 24 24" fill="white" width="clamp(1.75rem, 6vw, 2.75rem)" height="clamp(1.75rem, 6vw, 2.75rem)">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
            </div>
            <div className={styles.headerInfo}>
              <span className={styles.headerLabel}>Playlist</span>
              <h1 className={styles.headerTitle}>Liked Songs</h1>
              <div className={styles.headerMeta}>
                {loading ? (
                  <span className={styles.skeletonTextSmall} />
                ) : tracks.length > 0 ? (
                  <>
                    <span>{tracks.length} song{tracks.length !== 1 ? "s" : ""}</span>
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
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search inside liked songs"
            aria-pressed={searchOpen}
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
            placeholder="Search in liked songs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            autoFocus
          />
          {searchQuery && (
            <button className={styles.searchClear} onClick={() => setSearchQuery("")} aria-label="Clear search">
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
              Play
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
            {!allDownloaded && (
              <button className={styles.downloadAllBtn} onClick={handleDownloadAll} aria-label="Download all for offline" title="Download all for offline">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
            <div className={styles.sortWrapper}>
              <button className={styles.sortBtn} onClick={() => setSortOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={sortOpen}>
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
                  <div className={styles.sortDropdown} role="listbox">
                    {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                      <button
                        key={key}
                        className={`${styles.sortOption} ${sortBy === key ? styles.sortOptionActive : ""}`}
                        onClick={() => { handleSortChange(key); setSortOpen(false); }}
                        role="option"
                        aria-selected={sortBy === key}
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
          [...Array(6)].map((_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonCol}>
                <div className={styles.skeletonLineW70} />
                <div className={styles.skeletonLineW40} />
              </div>
            </div>
          ))
        ) : filteredTracks.length === 0 && searchQuery ? (
          <div className={styles.noResults}>No songs match &ldquo;{searchQuery}&rdquo;</div>
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
