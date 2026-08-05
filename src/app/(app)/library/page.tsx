"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { MusicNoteIcon, AlbumIcon, MicrophoneIcon, PlaylistIcon } from "@/components/Icons";
import { getCachedLibraryData, setCachedLibraryData } from "@/lib/offline-db";
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
}

export default function LibraryPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const hasLoadedFromCache = useRef(false);

  const SMART_FILTERS = [
    { id: "all", label: "All" },
    { id: "recent", label: "Recently Added" },
    { id: "artists", label: "Artists" },
    { id: "albums", label: "Albums" },
    { id: "playlists", label: "Playlists" },
  ];

  const loadFromCache = useCallback(async () => {
    try {
      const cached = await getCachedLibraryData<LibraryCache>("library-main");
      if (cached) {
        setTracks(cached.tracks || []);
        setAlbums(cached.albums || []);
        setArtists(cached.artists || []);
        setPlaylists(cached.playlists || []);
        setLoading(false);
        hasLoadedFromCache.current = true;
        return true;
      }
    } catch {}
    return false;
  }, []);

  const fetchFromServer = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const [tracksRes, albumsRes, artistsRes, playlistsRes] = await Promise.allSettled([
        fetch("/api/tracks?limit=200"),
        fetch("/api/albums?limit=100"),
        fetch("/api/artists?limit=100"),
        fetch("/api/playlists"),
      ]);

      let newTracks = tracks;
      let newAlbums = albums;
      let newArtists = artists;
      let newPlaylists = playlists;

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

      // Update cache in background
      setCachedLibraryData("library-main", {
        tracks: newTracks,
        albums: newAlbums,
        artists: newArtists,
        playlists: newPlaylists,
      });
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tracks, albums, artists, playlists]);

  // Load from cache first, then fetch from server
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const hasCache = await loadFromCache();
      if (cancelled) return;

      if (hasCache) {
        // Cache loaded, now refresh from server in background
        fetchFromServer(false);
      } else {
        // No cache, fetch from server (shows skeleton)
        fetchFromServer(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const libraryItems = useMemo((): LibraryItem[] => {
    const items: LibraryItem[] = [];

    if (tracks.length > 0) {
      items.push({ type: "downloaded", trackCount: tracks.length, tracks });
    }

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

    if (activeFilter === "recent") {
      filtered = items.filter((item) => {
        return true;
      });
    } else if (activeFilter === "artists") {
      filtered = items.filter((item) => item.type === "artist" || item.type === "downloaded");
    } else if (activeFilter === "albums") {
      filtered = items.filter((item) => item.type === "album" || item.type === "downloaded");
    } else if (activeFilter === "playlists") {
      filtered = items.filter((item) => item.type === "playlist" || item.type === "downloaded");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return filtered.filter((item) => {
        if (item.type === "downloaded") return "Downloaded Songs".toLowerCase().includes(q);
        if (item.type === "album") return item.data.title.toLowerCase().includes(q) || item.data.artist.name.toLowerCase().includes(q);
        if (item.type === "artist") return item.data.name.toLowerCase().includes(q);
        if (item.type === "playlist") return item.data.name.toLowerCase().includes(q);
        return false;
      });
    }

    return filtered;
  }, [tracks, albums, artists, playlists, searchQuery, activeFilter]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop === 0 && !refreshing) {
      fetchFromServer(true);
    }
  }

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

      <div
        className={styles.content}
        onScroll={handleScroll}
      >
        {refreshing && (
          <div className={styles.refreshIndicator}>
            <div className={styles.refreshSpinner} />
          </div>
        )}

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
        ) : libraryItems.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><MusicNoteIcon size={48} /></div>
            <div className={styles.emptyTitle}>Your library is empty</div>
            <div className={styles.emptyDesc}>Download songs or create playlists to see them here</div>
            <Link href="/search" className={styles.emptyCta}>Browse Music</Link>
          </div>
        ) : (
          <div className={styles.list}>
            {libraryItems.map((item) => {
              if (item.type === "downloaded") {
                return (
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
                      <div className={styles.listItemSubtitle}>{item.trackCount} songs</div>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--sakura-text-secondary)", flexShrink: 0 }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                );
              }

              if (item.type === "album") {
                const album = item.data;
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
