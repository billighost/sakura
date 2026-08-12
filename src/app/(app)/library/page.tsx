"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiBatch } from "@/lib/apiBatch";
import { getCachedLibraryData, setCachedLibraryData, getCachedUserId } from "@/lib/offline-db";
import { PlaylistModal } from "@/components/PlaylistModal";
import { PageHeader } from "@/components/PageHeader";
import { MediaCard } from "@/components/MediaCard";
import { CollectionFilter, CollectionSearch, CollectionSort } from "@/components/CollectionControls";
import { EmptyState } from "@/components/CollectionHero";
import {
  AlbumIcon,
  DownloadedIcon,
  HeartIcon,
  LibraryIcon,
  MicrophoneIcon,
  PlaylistIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/Icons";
import { haptic } from "@/lib/haptics";
import { usePersistedChoice } from "@/lib/usePersistedChoice";
import styles from "./page.module.css";

/**
 * Your Library — the index of everything saved: playlists, albums, artists.
 *
 * ── On the data model ─────────────────────────────────────────────────────
 *
 * This file used to carry a note saying the routes and shapes below were
 * "reconstructed by guessing" and should be swapped for whatever the backend
 * really used. They were checked against the handlers and they are correct, so
 * the note is gone rather than left to make the next reader distrust working
 * code. For the record, as of this pass:
 *
 *   GET /api/playlists → a bare array of Playlist rows (+ trackCount)
 *   GET /api/albums    → { albums, total, page, limit, pages }
 *   GET /api/artists   → { artists, total, page, limit, pages }
 *
 * Two of the three wrap their list and one doesn't, which is exactly the trap
 * the house rules warn about — hence `asArray`/`asList` below rather than
 * assuming either shape.
 */

interface LibraryItem {
  id: string;
  type: "playlist" | "album" | "artist";
  title: string;
  subtitle?: string;
  coverUrl?: string;
  coverUrls?: string[];
  addedAt?: string;
  trackCount?: number;
}

type FilterKey = "all" | "playlist" | "album" | "artist";
type SortKey = "recent" | "alpha" | "creator";
type ViewMode = "grid" | "list";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently added",
  alpha: "A–Z",
  creator: "Creator",
};

const TYPE_LABEL: Record<LibraryItem["type"], string> = {
  playlist: "Playlist",
  album: "Album",
  artist: "Artist",
};

function routeFor(item: LibraryItem): string {
  if (item.type === "album") return `/album/${item.id}`;
  if (item.type === "artist") return `/artist/${item.id}`;
  return `/playlist/${item.id}`;
}

function iconFor(type: LibraryItem["type"], size = 22) {
  if (type === "artist") return <MicrophoneIcon size={size} />;
  if (type === "album") return <AlbumIcon size={size} />;
  return <PlaylistIcon size={size} />;
}

/** A bare-array response. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** A `{ key: [...] }` response, tolerating the bare-array form too. */
function asList<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

/* Stable identities: useSyncExternalStore compares snapshots, and a fresh
 * array literal per render would make the subscription churn. */
const VIEW_MODES = ["grid", "list"] as const;
const SORT_KEYS = ["recent", "alpha", "creator"] as const;

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const hasCache = useRef(false);

  // Read straight from storage rather than mirrored into state on mount, so
  // the list never renders once in the wrong order — see usePersistedChoice.
  const [view, setView] = usePersistedChoice<ViewMode>("sakura-library-view", VIEW_MODES, "grid");
  const [sortBy, setSortBy] = usePersistedChoice<SortKey>("sakura-library-sort", SORT_KEYS, "recent");

  const load = useCallback(async (userId = getCachedUserId()) => {
    try {
      const [playlistsRes, albumsRes, artistsRes] = await Promise.allSettled([
        apiBatch("playlists", "/api/playlists"),
        apiBatch("albums", "/api/albums"),
        apiBatch("artists", "/api/artists"),
      ]);

      // `allSettled`, so one failing collection doesn't blank the other two.
      const playlists = asArray<{
        id: string;
        name: string;
        coverUrl?: string;
        createdAt?: string;
        trackCount?: number;
      }>(playlistsRes.status === "fulfilled" ? playlistsRes.value : null).map(
        (p): LibraryItem => {
          let coverUrl = p.coverUrl;
          let coverUrls: string[] | undefined;
          if (coverUrl?.startsWith('[')) {
            try {
              coverUrls = JSON.parse(coverUrl);
              coverUrl = coverUrls?.[0]; // fallback to first image for list views
            } catch {}
          }
          return {
            id: p.id,
            type: "playlist",
            title: p.name,
            coverUrl,
            coverUrls,
            addedAt: p.createdAt,
            trackCount: p.trackCount,
          };
        }
      );

      const albums = asList<{
        id: string;
        title: string;
        coverUrl?: string;
        createdAt?: string;
        artist?: { name: string };
        trackCount?: number;
      }>(albumsRes.status === "fulfilled" ? albumsRes.value : null, "albums").map(
        (a): LibraryItem => ({
          id: a.id,
          type: "album",
          title: a.title,
          subtitle: a.artist?.name,
          coverUrl: a.coverUrl,
          addedAt: a.createdAt,
          trackCount: a.trackCount,
        })
      );

      const artists = asList<{
        id: string;
        name: string;
        imageUrl?: string;
        trackCount?: number;
      }>(artistsRes.status === "fulfilled" ? artistsRes.value : null, "artists").map(
        (a): LibraryItem => ({
          id: a.id,
          type: "artist",
          title: a.name,
          coverUrl: a.imageUrl,
          trackCount: a.trackCount,
        })
      );

      const next = [...playlists, ...albums, ...artists];

      // All three failing is a real error rather than an empty library, and
      // saying so is the difference between "nothing here" and "try again".
      const allFailed =
        playlistsRes.status === "rejected" &&
        albumsRes.status === "rejected" &&
        artistsRes.status === "rejected";

      if (allFailed && !hasCache.current) {
        setError("Couldn't load your library. Check your connection.");
        return;
      }

      setError(null);
      setItems(next);
      setCachedLibraryData("library-main", { items: next }, userId);
    } catch {
      if (!hasCache.current) setError("Couldn't load your library. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const userId = getCachedUserId();
      const cached = await getCachedLibraryData<{ items: LibraryItem[] }>("library-main", userId);
      if (cancelled) return;

      if (cached?.items?.length) {
        setItems(cached.items);
        setLoading(false);
        hasCache.current = true;
      }
      void load(userId);
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const counts = useMemo(
    () => ({
      all: items.length,
      playlist: items.filter((i) => i.type === "playlist").length,
      album: items.filter((i) => i.type === "album").length,
      artist: items.filter((i) => i.type === "artist").length,
    }),
    [items]
  );

  const visible = useMemo(() => {
    let list = filter === "all" ? items : items.filter((i) => i.type === filter);

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "alpha":
          return a.title.localeCompare(b.title);
        case "creator":
          return (a.subtitle ?? "").localeCompare(b.subtitle ?? "");
        default: {
          const dA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
          const dB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
          return dB - dA;
        }
      }
    });
  }, [items, filter, query, sortBy]);

  /* The pinned pair only makes sense on the unfiltered, unsearched view — they
   * aren't library items and shouldn't survive a filter that excludes them. */
  const showPinned = filter === "all" && !query.trim();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Your Library"
        showBack={false}
        actions={
          <>
            <button
              type="button"
              className={`${styles.iconBtn} pressable`}
              onClick={() => {
                haptic("selection");
                setModalOpen(true);
              }}
              aria-label="Create a playlist"
            >
              <PlusIcon size={20} />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} pressable`}
              onClick={() => {
                haptic("selection");
                setSearchOpen((v) => !v);
                if (searchOpen) setQuery("");
              }}
              aria-label="Search your library"
              aria-pressed={searchOpen}
            >
              <SearchIcon size={19} />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} pressable`}
              onClick={() => {
                haptic("selection");
                setView(view === "grid" ? "list" : "grid");
              }}
              aria-label={view === "grid" ? "Switch to list view" : "Switch to grid view"}
            >
              {view === "grid" ? <LibraryIcon size={19} /> : <AlbumIcon size={19} />}
            </button>
          </>
        }
      >
        {searchOpen && (
          <CollectionSearch
            value={query}
            onChange={setQuery}
            onClose={() => setSearchOpen(false)}
            placeholder="Search your library"
          />
        )}
      </PageHeader>

      <CollectionFilter
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "playlist", label: "Playlists", count: counts.playlist },
          { key: "album", label: "Albums", count: counts.album },
          { key: "artist", label: "Artists", count: counts.artist },
        ]}
      />

      {showPinned && (
        <nav className={styles.pinned} aria-label="Your collections">
          <Link href="/liked" className={`${styles.pin} pressable`}>
            <span className={`${styles.pinIcon} ${styles.pinLiked}`} aria-hidden="true">
              <HeartIcon size={18} filled />
            </span>
            <span className={styles.pinText}>
              <span className={styles.pinTitle}>Liked Songs</span>
              <span className={styles.pinSub}>Everything you&apos;ve hearted</span>
            </span>
          </Link>
          <Link href="/library/downloaded" className={`${styles.pin} pressable`}>
            <span className={`${styles.pinIcon} ${styles.pinDownloaded}`} aria-hidden="true">
              <DownloadedIcon size={18} />
            </span>
            <span className={styles.pinText}>
              <span className={styles.pinTitle}>Downloaded</span>
              <span className={styles.pinSub}>Plays with no connection</span>
            </span>
          </Link>
        </nav>
      )}

      <div className={styles.listHeader}>
        <span className={styles.listCount}>
          {loading && items.length === 0
            ? "Loading…"
            : `${visible.length} item${visible.length === 1 ? "" : "s"}`}
        </span>
        <CollectionSort
          value={sortBy}
          labels={SORT_LABELS}
          onChange={setSortBy}
        />
      </div>

      {loading && items.length === 0 ? (
        <LibrarySkeleton view={view} />
      ) : error ? (
        <EmptyState
          icon={<LibraryIcon size={26} />}
          title="Couldn't load your library"
          body={error}
          action={{ href: "/library", label: "Try again" }}
        />
      ) : visible.length === 0 && query.trim() ? (
        <EmptyState
          icon={<SearchIcon size={26} />}
          title={`Nothing matches "${query}"`}
          body="Try a shorter word, or switch the filter above to look in a different part of your library."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={26} />}
          title={filter === "all" ? "Your library is empty" : `No ${filter}s saved yet`}
          body={
            filter === "playlist"
              ? "Playlists you make show up here. Start one and add songs as you find them."
              : "Save an album, follow an artist, or make a playlist and it lands here."
          }
          action={{ href: "/search", label: "Find something to save" }}
        />
      ) : view === "grid" ? (
        <div className={`${styles.grid} anim-stagger`}>
          {visible.map((item, i) => (
            <MediaCard
              key={`${item.type}-${item.id}`}
              index={i}
              href={routeFor(item)}
              title={item.title}
              subtitle={item.subtitle ?? TYPE_LABEL[item.type]}
              coverUrl={item.coverUrl}
              coverUrls={item.coverUrls}
              shape={item.type === "artist" ? "round" : "square"}
              fallbackIcon={iconFor(item.type, 24)}
            />
          ))}
        </div>
      ) : (
        <div className={`${styles.list} anim-stagger`}>
          {visible.map((item, i) => (
            <Link
              key={`${item.type}-${item.id}`}
              href={routeFor(item)}
              className={`${styles.row} pressable`}
              style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
            >
              <span
                className={`${styles.rowArt} ${item.type === "artist" ? styles.rowArtRound : ""}`}
              >
                {item.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className={styles.rowFallback} aria-hidden="true">
                    {iconFor(item.type, 20)}
                  </span>
                )}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowSub}>
                  {TYPE_LABEL[item.type]}
                  {item.subtitle ? ` · ${item.subtitle}` : ""}
                  {item.trackCount ? ` · ${item.trackCount} songs` : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <PlaylistModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => void load()}
      />
    </div>
  );
}

/** Matches the active view's shape so the swap doesn't reflow. */
function LibrarySkeleton({ view }: { view: ViewMode }) {
  if (view === "grid") {
    return (
      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className={`${styles.skeletonArt} skeleton`} />
            <div className={`${styles.skeletonLine} skeleton`} />
            <div className={`${styles.skeletonLineShort} skeleton`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className={styles.row}>
          <div className={`${styles.rowArt} skeleton`} />
          <div className={styles.rowText}>
            <div className={`${styles.skeletonLine} skeleton`} />
            <div className={`${styles.skeletonLineShort} skeleton`} />
          </div>
        </div>
      ))}
    </div>
  );
}
