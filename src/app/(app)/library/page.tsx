"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { MusicNoteIcon, AlbumIcon, MicrophoneIcon, PlaylistIcon } from "@/components/Icons";
import { getCachedLibraryData, setCachedLibraryData, getCachedUserId, setCachedUserId } from "@/lib/offline-db";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { PullToRefreshSpinner } from "@/components/PullToRefreshSpinner";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string; id: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  trackCount?: number;
}

interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  artist: { name: string; id: string };
  trackCount?: number;
}

interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string;
  trackCount: number;
  createdAt: string;
}

type LibraryItem =
  | { type: "downloaded"; trackCount: number; tracks: Track[] }
  | { type: "album"; data: Album }
  | { type: "artist"; data: Artist }
  | { type: "playlist"; data: Playlist };

interface LibraryCache {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  likedCount?: number;
}

export default function LibraryPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedCount, setLikedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "recent" | "tracks">("name");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortOpen, setSortOpen] = useState(false);
  const hasLoadedFromCache = useRef(false);

  const sortLabels = {
    name: "Name",
    recent: "Recently Added",
    tracks: "Tracks Count",
  };

  const SMART_FILTERS = [
    { id: "all", label: "All" },
    { id: "recent", label: "Recently Added" },
    { id: "artists", label: "Artists" },
    { id: "albums", label: "Albums" },
    { id: "playlists", label: "Playlists" },
  ];

  // Restore sorting and view preferences
  useEffect(() => {
    const savedSort = localStorage.getItem("sakura-library-sort") as any;
    const savedView = localStorage.getItem("sakura-library-view") as any;
    if (savedSort) setSortBy(savedSort);
    if (savedView) setViewMode(savedView);

    // Fetch user settings from server if authenticated
    fetch("/api/settings")
      .then(res => res.json())
      .then(settings => {
        if (settings) {
          if (settings.librarySort) {
            setSortBy(settings.librarySort);
            localStorage.setItem("sakura-library-sort", settings.librarySort);
          }
          if (settings.libraryView) {
            setViewMode(settings.libraryView);
            localStorage.setItem("sakura-library-view", settings.libraryView);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleSortChange = useCallback((newSort: typeof sortBy) => {
    setSortBy(newSort);
    localStorage.setItem("sakura-library-sort", newSort);
    // Push setting change to server in background
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ librarySort: newSort }),
    }).catch(() => {});
  }, []);

  const handleViewChange = useCallback((newView: typeof viewMode) => {
    setViewMode(newView);
    localStorage.setItem("sakura-library-view", newView);
    // Push setting change to server in background
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryView: newView }),
    }).catch(() => {});
  }, []);

  const loadFromCache = useCallback(async (userId = getCachedUserId()) => {
    try {
      const cached = await getCachedLibraryData<LibraryCache>("library-main", userId);
      if (cached) {
        setTracks(cached.tracks || []);
        setAlbums(cached.albums || []);
        setArtists(cached.artists || []);
        setPlaylists(cached.playlists || []);
        if (cached.likedCount !== undefined) {
          setLikedCount(cached.likedCount);
        }
        setLoading(false);
        hasLoadedFromCache.current = true;
        return true;
      }
    } catch {}
    return false;
  }, []);

  const fetchFromServer = useCallback(async (isRefresh = false, userId = getCachedUserId()) => {
    if (isRefresh) setRefreshing(true);

    try {
      // First fetch the profile to get up to date userId
      const profileRes = await fetch("/api/profile");
      const profile = await profileRes.json();
      let activeUserId = userId;
      if (profile && profile.id) {
        activeUserId = profile.id;
        setCachedUserId(activeUserId);
      }

      const [tracksRes, albumsRes, artistsRes, playlistsRes, favoritesRes] = await Promise.allSettled([
        fetch("/api/tracks?limit=200"),
        fetch("/api/albums?limit=100"),
        fetch("/api/artists?limit=100"),
        fetch("/api/playlists"),
        fetch("/api/favorites"),
      ]);

      let newTracks = tracks;
      let newAlbums = albums;
      let newArtists = artists;
      let newPlaylists = playlists;
      let newLikedCount = likedCount;

      if (tracksRes.status === "fulfilled") {
        const data = await tracksRes.value.json();
        const rawTracks = data.tracks || [];
        const seen = new Set<string>();
        newTracks = rawTracks.filter((t: Track) => {
          const key = `${t.title} - ${t.artist.name}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setTracks(newTracks);
      }

      if (albumsRes.status === "fulfilled") {
        const data = await albumsRes.value.json();
        newAlbums = data.albums || [];
        setAlbums(newAlbums);
      }

      if (artistsRes.status === "fulfilled") {
        const data = await artistsRes.value.json();
        newArtists = data.artists || [];
        setArtists(newArtists);
      }

      if (playlistsRes.status === "fulfilled") {
        const data = await playlistsRes.value.json();
        newPlaylists = Array.isArray(data) ? data : data.playlists || [];
        setPlaylists(newPlaylists);
      }

      if (favoritesRes.status === "fulfilled") {
        const data = await favoritesRes.value.json();
        const favTracks = Array.isArray(data) ? data : data.tracks || [];
        newLikedCount = favTracks.length;
        setLikedCount(newLikedCount);
      }

      // Update cache in background isolated by user ID
      setCachedLibraryData("library-main", {
        tracks: newTracks,
        albums: newAlbums,
        artists: newArtists,
        playlists: newPlaylists,
        likedCount: newLikedCount,
      }, activeUserId);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tracks, albums, artists, playlists, likedCount]);

  // Load from cache first, then fetch from server
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Instantly read user cache ID
      const activeUserId = getCachedUserId();
      
      // 2. Load IndexedDB cache instantly
      const hasCache = await loadFromCache(activeUserId);
      if (cancelled) return;

      // 3. Trigger server background check
      fetchFromServer(false, activeUserId);
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const libraryItems = useMemo((): LibraryItem[] => {
    const items: LibraryItem[] = [];

    // Note: Downloaded songs card is excluded from general items list because it is rendered explicitly at the top
    for (const album of albums) {
      items.push({ type: "album", data: album });
    }

    for (const artist of artists) {
      items.push({ type: "artist", data: artist });
    }

    for (const playlist of playlists) {
      items.push({ type: "playlist", data: playlist });
    }

    let filtered = items;

    if (activeFilter === "artists") {
      filtered = items.filter((item) => item.type === "artist");
    } else if (activeFilter === "albums") {
      filtered = items.filter((item) => item.type === "album");
    } else if (activeFilter === "playlists") {
      filtered = items.filter((item) => item.type === "playlist");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return filtered.filter((item) => {
        if (item.type === "album") return item.data.title.toLowerCase().includes(q) || item.data.artist.name.toLowerCase().includes(q);
        if (item.type === "artist") return item.data.name.toLowerCase().includes(q);
        if (item.type === "playlist") return item.data.name.toLowerCase().includes(q);
        return false;
      });
    }

    return filtered;
  }, [albums, artists, playlists, searchQuery, activeFilter]);

  const sortedItems = useMemo((): LibraryItem[] => {
    let items = [...libraryItems];

    if (sortBy === "name") {
      items.sort((a, b) => {
        const nameA = a.type === "album" ? a.data.title : a.type === "artist" ? a.data.name : a.type === "playlist" ? a.data.name : "";
        const nameB = b.type === "album" ? b.data.title : b.type === "artist" ? b.data.name : b.type === "playlist" ? b.data.name : "";
        return nameA.localeCompare(nameB);
      });
    } else if (sortBy === "tracks") {
      items.sort((a, b) => {
        const countA = a.type === "album" ? a.data.trackCount || 0 : a.type === "artist" ? a.data.trackCount || 0 : a.type === "playlist" ? a.data.trackCount || 0 : 0;
        const countB = b.type === "album" ? b.data.trackCount || 0 : b.type === "artist" ? b.data.trackCount || 0 : b.type === "playlist" ? b.data.trackCount || 0 : 0;
        return (countB || 0) - (countA || 0);
      });
    }

    return items;
  }, [libraryItems, sortBy]);

  // Wire pull to refresh gestures
  const ptr = usePullToRefresh({
    onRefresh: () => fetchFromServer(true),
    threshold: 70,
  });

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop === 0 && !refreshing) {
      // Refresh silently in background
      fetchFromServer(false);
    }
  }

  // Pointer Down hook setup
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ptr.refreshing) return;
    const container = e.currentTarget;
    if (container.scrollTop !== 0) return;
    if (e.button !== undefined && e.button !== 0) return;

    ptr.startYRef.current = e.clientY;
    ptr.currentYRef.current = e.clientY;
    ptr.setActive(true);
    container.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptr.active || ptr.refreshing) return;
    ptr.currentYRef.current = e.clientY;
    const dy = e.clientY - ptr.startYRef.current;
    if (dy > 0) {
      const distance = dy > 70 ? 70 + (dy - 70) * 0.25 : dy;
      ptr.setPullDistance(distance);
    } else {
      ptr.setPullDistance(0);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptr.active || ptr.refreshing) return;
    ptr.setActive(false);
    const dy = ptr.currentYRef.current - ptr.startYRef.current;
    if (dy >= 70) {
      ptr.setRefreshing(true);
      import("@/lib/haptics").then((h) => h.vibrate(12));
      fetchFromServer(true).finally(() => {
        ptr.setRefreshing(false);
        ptr.setPullDistance(0);
      });
    } else {
      ptr.setPullDistance(0);
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Your Library</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={() => setSearchOpen(!searchOpen)}
            title="Search library"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            placeholder="Search in your library..."
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

      <div className={styles.filterRow}>
        {SMART_FILTERS.map((filter) => (
          <button
            key={filter.id}
            className={`${styles.filterChip} ${activeFilter === filter.id ? styles.filterChipActive : ""}`}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className={styles.controlsRow}>
        <div className={styles.sortWrapper}>
          <button className={styles.sortBtn} onClick={() => setSortOpen(!sortOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="12" y2="18" />
            </svg>
            Sort by: {sortLabels[sortBy]}
          </button>
          {sortOpen && (
            <>
              <div className={styles.sortBackdrop} onClick={() => setSortOpen(false)} />
              <div className={styles.sortDropdown}>
                {(Object.keys(sortLabels) as Array<keyof typeof sortLabels>).map((key) => (
                  <button
                    key={key}
                    className={`${styles.sortOption} ${sortBy === key ? styles.sortOptionActive : ""}`}
                    onClick={() => { handleSortChange(key); setSortOpen(false); }}
                  >
                    {sortLabels[key]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          className={styles.layoutToggleBtn}
          onClick={() => handleViewChange(viewMode === "list" ? "grid" : "list")}
          title={viewMode === "list" ? "Switch to Grid View" : "Switch to List View"}
        >
          {viewMode === "list" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          )}
        </button>
      </div>

      <div
        className={styles.content}
        onScroll={handleScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ position: "relative" }}
      >
        <PullToRefreshSpinner
          pullDistance={ptr.pullDistance}
          refreshing={ptr.refreshing}
        />
        {loading ? (
          <div className={styles.list}>
            {[...Array(8)].map((_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonThumb} />
                <div className={styles.skeletonInfo}>
                  <div className={styles.skeletonLine} style={{ width: "60%" }} />
                  <div className={styles.skeletonLineSecondary} style={{ width: "40%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : libraryItems.length === 0 && !tracks.length ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><MusicNoteIcon size={48} /></div>
            <div className={styles.emptyTitle}>Your library is empty</div>
            <div className={styles.emptyDesc}>Download songs or create playlists to see them here</div>
            <Link href="/search" className={styles.emptyCta}>Browse Music</Link>
          </div>
        ) : (
          <div className={viewMode === "grid" ? styles.grid : styles.list}>
            {/* 1st Place: Liked Songs Card */}
            {(activeFilter === "all" || activeFilter === "playlists") && !searchQuery && (
              <Link href="/liked" className={viewMode === "grid" ? styles.gridItem : styles.likedSongsCard}>
                <div className={viewMode === "grid" ? styles.gridItemArt : styles.likedSongsArt}>
                  {viewMode === "grid" ? (
                    <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #450eff 0%, #c43ad6 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="white" width="32" height="32">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                    </div>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="white" width="20" height="20">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  )}
                </div>
                {viewMode === "grid" ? (
                  <>
                    <div className={styles.gridItemTitle}>Liked Songs</div>
                    <div className={styles.gridItemSubtitle}>{likedCount} songs</div>
                  </>
                ) : (
                  <>
                    <div className={styles.listItemInfo}>
                      <div className={styles.listItemTitle}>Liked Songs</div>
                      <div className={styles.listItemSubtitle}>Playlist · {likedCount} song{likedCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className={styles.pinIndicator} title="Pinned to top">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                      </svg>
                    </div>
                  </>
                )}
              </Link>
            )}

            {/* 2nd Place: Pinned Downloaded Songs Card */}
            {(activeFilter === "all" || activeFilter === "albums" || activeFilter === "playlists" || activeFilter === "artists") && !searchQuery && (
              viewMode === "grid" ? (
                <Link key="downloaded" href="/library/downloaded" className={styles.gridItem}>
                  <div className={styles.gridItemArt}>
                    <div className={styles.downloadedPlaceholder}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                  </div>
                  <div className={styles.gridItemTitle}>Downloaded</div>
                  <div className={styles.gridItemSubtitle}>{tracks.length} songs</div>
                </Link>
              ) : (
                <Link key="downloaded" href="/library/downloaded" className={styles.listItem}>
                  <div className={styles.listItemArt}>
                    <div className={styles.downloadedPlaceholder}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                  </div>
                  <div className={styles.listItemInfo}>
                    <div className={styles.listItemTitle}>Downloaded Songs</div>
                    <div className={styles.listItemSubtitle}>{tracks.length} songs</div>
                  </div>
                  <div className={styles.pinIndicator} title="Pinned to top">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                    </svg>
                  </div>
                </Link>
              )
            )}

            {/* Remaining items */}
            {sortedItems.map((item) => {
              if (item.type === "album") {
                const album = item.data;
                if (viewMode === "grid") {
                  return (
                    <Link key={album.id} href={`/album/${album.id}`} className={styles.gridItem}>
                      <div className={styles.gridItemArt}>
                        {album.coverUrl ? (
                           <img className={styles.gridItemArtImg} src={album.coverUrl} alt="" />
                        ) : (
                          <div className={styles.gridItemArtPlaceholder}><AlbumIcon size={20} /></div>
                        )}
                      </div>
                      <div className={styles.gridItemTitle}>{album.title}</div>
                      <div className={styles.gridItemSubtitle}>Album · {album.artist.name}</div>
                    </Link>
                  );
                }
                return (
                  <Link key={album.id} href={`/album/${album.id}`} className={styles.listItem}>
                    <div className={styles.listItemArt}>
                      {album.coverUrl ? (
                        <img className={styles.listItemArtImg} src={album.coverUrl} alt="" />
                      ) : (
                        <div className={styles.listItemArtPlaceholder}><AlbumIcon size={20} /></div>
                      )}
                    </div>
                    <div className={styles.listItemInfo}>
                      <div className={styles.listItemTitle}>{album.title}</div>
                      <div className={styles.listItemSubtitle}>Album · {album.artist.name}</div>
                    </div>
                    <div className={styles.listItemMeta}>
                      {album.trackCount || 0} songs
                    </div>
                  </Link>
                );
              }

              if (item.type === "artist") {
                const artist = item.data;
                if (viewMode === "grid") {
                  return (
                    <Link key={artist.id} href={`/artist/${artist.id}`} className={styles.gridItem}>
                      <div className={styles.gridItemArtCircle}>
                        {artist.imageUrl ? (
                          <img className={styles.gridItemArtImgCircle} src={artist.imageUrl} alt="" />
                        ) : (
                          <div className={styles.gridItemArtPlaceholderCircle}><MicrophoneIcon size={20} /></div>
                        )}
                      </div>
                      <div className={styles.gridItemTitle}>{artist.name}</div>
                      <div className={styles.gridItemSubtitle}>Artist</div>
                    </Link>
                  );
                }
                return (
                  <Link key={artist.id} href={`/artist/${artist.id}`} className={styles.listItem}>
                    <div className={styles.listItemArtCircle}>
                      {artist.imageUrl ? (
                        <img className={styles.listItemArtImgCircle} src={artist.imageUrl} alt="" />
                      ) : (
                        <div className={styles.listItemArtPlaceholderCircle}><MicrophoneIcon size={20} /></div>
                      )}
                    </div>
                    <div className={styles.listItemInfo}>
                      <div className={styles.listItemTitle}>{artist.name}</div>
                      <div className={styles.listItemSubtitle}>Artist</div>
                    </div>
                    <div className={styles.listItemMeta}>
                      {artist.trackCount || 0} songs
                    </div>
                  </Link>
                );
              }

              if (item.type === "playlist") {
                const playlist = item.data;
                if (viewMode === "grid") {
                  return (
                    <Link key={playlist.id} href={`/playlist/${playlist.id}`} className={styles.gridItem}>
                      <div className={styles.gridItemArt}>
                        {playlist.coverUrl ? (
                          <img className={styles.gridItemArtImg} src={playlist.coverUrl} alt="" />
                        ) : (
                          <div className={styles.gridItemArtPlaceholder}><PlaylistIcon size={20} /></div>
                        )}
                      </div>
                      <div className={styles.gridItemTitle}>{playlist.name}</div>
                      <div className={styles.gridItemSubtitle}>Playlist</div>
                    </Link>
                  );
                }
                return (
                  <Link key={playlist.id} href={`/playlist/${playlist.id}`} className={styles.listItem}>
                    <div className={styles.listItemArt}>
                      {playlist.coverUrl ? (
                        <img className={styles.listItemArtImg} src={playlist.coverUrl} alt="" />
                      ) : (
                        <div className={styles.listItemArtPlaceholder}><PlaylistIcon size={20} /></div>
                      )}
                    </div>
                    <div className={styles.listItemInfo}>
                      <div className={styles.listItemTitle}>{playlist.name}</div>
                      <div className={styles.listItemSubtitle}>Playlist · {playlist.trackCount} songs</div>
                    </div>
                  </Link>
                );
              }

              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
