"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiBatch } from "@/lib/apiBatch";
import { getCachedLibraryData, setCachedLibraryData, getCachedUserId } from "@/lib/offline-db";
import { PlaylistModal } from "@/components/PlaylistModal";
import styles from "./page.module.css";

/**
 * NOTE ON ASSUMPTIONS
 * This page wasn't included in your upload (only its CSS module + loading
 * skeleton were), so the data model and route below are reconstructed to
 * match the conventions used in your Liked / Downloaded pages (cache-first
 * via lib/offline-db, fetch from an /api route). Swap `/api/library` and the
 * `/playlist|/album|/artist` routes for whatever your backend actually uses.
 */

interface LibraryItem {
  id: string;
  type: "playlist" | "album" | "artist";
  title: string;
  subtitle?: string;
  coverUrl?: string;
  addedAt?: string;
}

type FilterKey = "all" | "playlist" | "album" | "artist";
type SortKey = "recent" | "alpha" | "creator";
type ViewMode = "list" | "grid";

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "playlist", label: "Playlists" },
  { key: "album", label: "Albums" },
  { key: "artist", label: "Artists" },
];

const sortLabels: Record<SortKey, string> = {
  recent: "Recently added",
  alpha: "A–Z",
  creator: "Creator",
};

function routeFor(item: LibraryItem): string {
  if (item.type === "album") return `/album/${item.id}`;
  if (item.type === "artist") return `/artist/${item.id}`;
  return `/playlist/${item.id}`;
}

export default function LibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const hasLoadedFromCache = useRef(false);

  useEffect(() => {
    const savedView = localStorage.getItem("sakura-library-view") as ViewMode | null;
    const savedSort = localStorage.getItem("sakura-library-sort") as SortKey | null;
    if (savedView) setView(savedView);
    if (savedSort) setSortBy(savedSort);
  }, []);

  const handleViewChange = useCallback((v: ViewMode) => {
    setView(v);
    localStorage.setItem("sakura-library-view", v);
  }, []);

  const handleSortChange = useCallback((s: SortKey) => {
    setSortBy(s);
    localStorage.setItem("sakura-library-sort", s);
  }, []);

  const fetchFromServer = useCallback(async (isRefresh = false, userId = getCachedUserId()) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [playlistsRes, albumsRes, artistsRes] = await Promise.allSettled([
        apiBatch("playlists", "/api/playlists"),
        apiBatch("albums", "/api/albums"),
        apiBatch("artists", "/api/artists"),
      ]);

      const playlists: LibraryItem[] =
        playlistsRes.status === "fulfilled"
          ? (Array.isArray(playlistsRes.value) ? playlistsRes.value : []).map((p: { id: string; name: string; coverUrl?: string; createdAt?: string }) => ({
              id: p.id,
              type: "playlist" as const,
              title: p.name,
              coverUrl: p.coverUrl,
              addedAt: p.createdAt,
            }))
          : [];

      const albums: LibraryItem[] =
        albumsRes.status === "fulfilled"
          ? (albumsRes.value.albums || []).map((a: { id: string; title: string; coverUrl?: string; createdAt?: string; artist?: { name: string } }) => ({
              id: a.id,
              type: "album" as const,
              title: a.title,
              subtitle: a.artist?.name,
              coverUrl: a.coverUrl,
              addedAt: a.createdAt,
            }))
          : [];

      const artists: LibraryItem[] =
        artistsRes.status === "fulfilled"
          ? (artistsRes.value.artists || []).map((a: { id: string; name: string; imageUrl?: string }) => ({
              id: a.id,
              type: "artist" as const,
              title: a.name,
              coverUrl: a.imageUrl,
            }))
          : [];

      const newItems: LibraryItem[] = [...playlists, ...albums, ...artists];
      setItems(newItems);
      setCachedLibraryData("library-main", { items: newItems }, userId);
    } catch {
      /* silent — cached data (if any) stays on screen */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const activeUserId = getCachedUserId();
      const cached = await getCachedLibraryData<{ items: LibraryItem[] }>("library-main", activeUserId);
      if (cancelled) return;

      if (cached?.items) {
        setItems(cached.items);
        setLoading(false);
        hasLoadedFromCache.current = true;
      }

      fetchFromServer(hasLoadedFromCache.current, activeUserId);
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredItems = useMemo(() => {
    let list = items;
    if (filter !== "all") list = list.filter((i) => i.type === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.subtitle || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "alpha":
          return a.title.localeCompare(b.title);
        case "creator":
          return (a.subtitle || "").localeCompare(b.subtitle || "");
        case "recent":
        default: {
          const dA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
          const dB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
          return dB - dA;
        }
      }
    });
  }, [items, filter, sortBy, searchQuery]);

  const showPinned = filter === "all" && !searchQuery.trim();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Your Library</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={() => setPlaylistModalOpen(true)}
            aria-label="New Playlist"
            title="New Playlist"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search your library"
            aria-pressed={searchOpen}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button
            className={`${styles.iconBtn} ${view === "grid" ? styles.iconBtnActive : ""}`}
            onClick={() => handleViewChange(view === "list" ? "grid" : "list")}
            aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"}
          >
            {view === "list" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            )}
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
            placeholder="Search in your library"
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

      <div className={styles.filterRow}>
        {filters.map((f) => (
          <button
            key={f.key}
            className={`${styles.filterChip} ${filter === f.key ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        <div className={styles.contentInner}>
          {refreshing && (
            <div className={styles.refreshIndicator}>
              <div className={styles.refreshSpinner} />
            </div>
          )}

          {showPinned && (
            <div className={styles.pinnedGrid}>
              <Link href="/liked" className={styles.pinnedCard}>
                <div className={`${styles.pinnedArt} ${styles.pinnedArtLiked}`}>
                  <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
                    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                  </svg>
                </div>
                <div>
                  <div className={styles.pinnedTitle}>Liked Songs</div>
                  <div className={styles.pinnedSubtitle}>Playlist</div>
                </div>
              </Link>
              <Link href="/library/downloaded" className={styles.pinnedCard}>
                <div className={`${styles.pinnedArt} ${styles.pinnedArtDownloaded}`}>
                  <svg viewBox="0 0 24 24" fill="white" width="22" height="22">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
                <div>
                  <div className={styles.pinnedTitle}>Downloaded</div>
                  <div className={styles.pinnedSubtitle}>Offline songs</div>
                </div>
              </Link>
            </div>
          )}

          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              {filter === "all" ? "All items" : filters.find((f) => f.key === filter)?.label}
            </span>
            <div className={styles.sortWrapper}>
              <button className={styles.sortBtn} onClick={() => setSortOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={sortOpen}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
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
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width="13" height="13">
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

          {loading ? (
            view === "list" ? (
              [...Array(6)].map((_, i) => (
                <div key={i} className={styles.skeletonRow}>
                  <div className={styles.skeletonThumb} />
                  <div className={styles.skeletonInfo}>
                    <div className={styles.skeletonLine} style={{ width: "55%" }} />
                    <div className={styles.skeletonLineSecondary} style={{ width: "35%" }} />
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.grid}>
                {[...Array(8)].map((_, i) => (
                  <div key={i}>
                    <div className={styles.skeletonThumb} style={{ width: "100%", aspectRatio: "1", height: "auto", borderRadius: "10px", marginBottom: "0.625rem" }} />
                    <div className={styles.skeletonLine} style={{ width: "80%", marginBottom: "6px" }} />
                    <div className={styles.skeletonLineSecondary} style={{ width: "50%" }} />
                  </div>
                ))}
              </div>
            )
          ) : filteredItems.length === 0 && searchQuery ? (
            <div className={styles.noResults}>No results for &ldquo;{searchQuery}&rdquo;</div>
          ) : filteredItems.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIllustration}>
                <svg viewBox="0 0 120 120" width="88" height="88" fill="none">
                  <rect x="24" y="30" width="72" height="60" rx="8" stroke="var(--sakura-border)" strokeWidth="1.5" />
                  <path d="M40 30V22a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v8" stroke="var(--sakura-border)" strokeWidth="1.5" />
                  <path d="M44 58 L58 70 L78 48" stroke="var(--sakura-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                </svg>
              </div>
              <p className={styles.emptyTitle}>
                {filter === "all" ? "Your library is empty" : `No ${filters.find((f) => f.key === filter)?.label.toLowerCase()} yet`}
              </p>
              <p className={styles.emptyDesc}>
                Save playlists, albums, and artists you love and they&apos;ll show up here.
              </p>
              <Link href="/search" className={styles.emptyCta}>
                Find something to save
              </Link>
            </div>
          ) : view === "list" ? (
            <div className={styles.list}>
              {filteredItems.map((item) => (
                <Link href={routeFor(item)} key={item.id} className={styles.listItem}>
                  <div className={`${styles.listItemArt} ${item.type === "artist" ? styles.listItemArtCircle : ""}`}>
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" className={styles.listItemArtImg} />
                    ) : (
                      <div className={styles.listItemArtPlaceholder}>
                        {item.type === "artist" ? "🎤" : item.type === "album" ? "💿" : "🎵"}
                      </div>
                    )}
                  </div>
                  <div className={styles.listItemInfo}>
                    <div className={styles.listItemTitle}>{item.title}</div>
                    <div className={styles.listItemSubtitle}>
                      <span>{item.type === "playlist" ? "Playlist" : item.type === "album" ? "Album" : "Artist"}</span>
                      {item.subtitle && <><span>·</span><span>{item.subtitle}</span></>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredItems.map((item) => (
                <Link href={routeFor(item)} key={item.id} className={styles.gridItem}>
                  <div className={`${styles.gridItemArt} ${item.type === "artist" ? styles.gridItemArtCircle : ""}`}>
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" className={styles.gridItemArtImg} />
                    ) : (
                      <div className={styles.gridItemArtPlaceholder}>
                        {item.type === "artist" ? "🎤" : item.type === "album" ? "💿" : "🎵"}
                      </div>
                    )}
                  </div>
                  <div className={styles.gridItemTitle}>{item.title}</div>
                  {item.subtitle && <div className={styles.gridItemSubtitle}>{item.subtitle}</div>}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <PlaylistModal 
        isOpen={playlistModalOpen} 
        onClose={() => setPlaylistModalOpen(false)} 
        onSuccess={() => fetchFromServer(true)}
      />
    </div>
  );
}
