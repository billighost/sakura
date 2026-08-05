"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import styles from "./page.module.css";

type Tab = "tracks" | "artists" | "albums";
type SortKey = "name" | "dateAdded" | "recentlyPlayed";

interface Track {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  addedAt?: string;
  lastPlayedAt?: string;
}

interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  _count?: { tracks: number };
}

interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  artist: { name: string };
  _count?: { tracks: number };
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("tracks");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  const tabs: Tab[] = ["tracks", "artists", "albums"];

  useEffect(() => {
    const idx = tabs.indexOf(tab);
    const el = tabRefs.current[idx];
    if (el) {
      setIndicatorStyle({
        left: el.offsetLeft,
        width: el.offsetWidth,
      });
    }
  }, [tab]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    setLoading(true);
    const endpoint =
      tab === "tracks"
        ? "/api/tracks?limit=50"
        : tab === "artists"
          ? "/api/artists"
          : "/api/albums";
    fetch(endpoint)
      .then((r) => r.json())
      .then((data) => {
        if (tab === "tracks") setTracks(data.tracks || data || []);
        else if (tab === "artists") setArtists(data.artists || data || []);
        else setAlbums(data.albums || data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const sortedTracks = useMemo(() => {
    const arr = [...tracks];
    if (sortKey === "name") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === "dateAdded") {
      arr.sort(
        (a, b) =>
          new Date(b.addedAt || 0).getTime() -
          new Date(a.addedAt || 0).getTime()
      );
    } else if (sortKey === "recentlyPlayed") {
      arr.sort(
        (a, b) =>
          new Date(b.lastPlayedAt || 0).getTime() -
          new Date(a.lastPlayedAt || 0).getTime()
      );
    }
    return arr;
  }, [tracks, sortKey]);

  const alphaIndex = useMemo(() => {
    const map: Record<string, number> = {};
    sortedTracks.forEach((t, i) => {
      const letter = t.title[0]?.toUpperCase() || "#";
      if (!(letter in map)) map[letter] = i;
    });
    return map;
  }, [sortedTracks]);

  const sortLabel: Record<SortKey, string> = {
    name: "Name",
    dateAdded: "Date Added",
    recentlyPlayed: "Recently Played",
  };

  const tabCounts: Record<Tab, number> = {
    tracks: tracks.length,
    artists: artists.length,
    albums: albums.length,
  };

  return (
    <div className={styles.page}>
      <div className={styles.tabsContainer}>
        <div className={styles.tabs}>
          <div
            className={styles.tabIndicator}
            style={{
              ...indicatorStyle,
              transition: "left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
          {tabs.map((t, i) => (
            <button
              key={t}
              ref={(el) => { tabRefs.current[i] = el; }}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {tabCounts[t] > 0 && (
                <span className={styles.tabCount}>{tabCounts[t]}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "tracks" && (
          <div className={styles.sortWrapper} ref={sortRef}>
            <button
              className={styles.sortBtn}
              onClick={() => setSortOpen(!sortOpen)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M6 12h12M9 18h6" />
              </svg>
              {sortLabel[sortKey]}
            </button>
            {sortOpen && (
              <div className={styles.sortDropdown}>
                {(Object.keys(sortLabel) as SortKey[]).map((k) => (
                  <button
                    key={k}
                    className={`${styles.sortOption} ${sortKey === k ? styles.sortOptionActive : ""}`}
                    onClick={() => {
                      setSortKey(k);
                      setSortOpen(false);
                    }}
                  >
                    {sortLabel[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.grid}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className={styles.gridItem}>
              <div className="skeleton" style={{ width: "100%", aspectRatio: 1, borderRadius: "12px" }} />
              <div className="skeleton" style={{ width: "70%", height: "0.8125rem", borderRadius: "4px", marginTop: "6px" }} />
              <div className="skeleton" style={{ width: "50%", height: "0.6875rem", borderRadius: "4px", marginTop: "4px" }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {tab === "tracks" && tracks.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🎵</div>
              <div className={styles.emptyTitle}>No tracks yet</div>
              <div className={styles.emptyDesc}>
                Import music or add tracks to build your library
              </div>
            </div>
          )}

          {tab === "artists" && artists.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🎤</div>
              <div className={styles.emptyTitle}>No artists yet</div>
              <div className={styles.emptyDesc}>
                Artists will appear here once you add tracks
              </div>
            </div>
          )}

          {tab === "albums" && albums.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>💿</div>
              <div className={styles.emptyTitle}>No albums yet</div>
              <div className={styles.emptyDesc}>
                Albums will appear here once you add tracks
              </div>
            </div>
          )}

          {tab === "tracks" && sortedTracks.length > 0 && (
            <div className={styles.trackLayout}>
              <div className={styles.list}>
                {sortedTracks.map((track, i) => (
                  <TrackRow key={track.id} track={track} queue={sortedTracks} index={i} showNumber />
                ))}
              </div>
              <div className={styles.alphaSidebar}>
                {Object.entries(alphaIndex).map(([letter, idx]) => (
                  <button
                    key={letter}
                    className={styles.alphaLetter}
                    onClick={() => {
                      const list = document.querySelector(`.${styles.list}`);
                      if (list) {
                        const items = list.children;
                        if (items[idx]) {
                          (items[idx] as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                      }
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "artists" && artists.length > 0 && (
            <div className={styles.grid}>
              {artists.map((artist) => (
                <Link key={artist.id} href={`/artist/${artist.id}`} className={styles.gridItem}>
                  {artist.imageUrl ? (
                    <img className={styles.gridArt} src={artist.imageUrl} alt="" />
                  ) : (
                    <div className={styles.gridArtPlaceholder}>🎤</div>
                  )}
                  <div className={styles.gridTitle}>{artist.name}</div>
                  <div className={styles.gridSubtitle}>{artist._count?.tracks || 0} tracks</div>
                </Link>
              ))}
            </div>
          )}

          {tab === "albums" && albums.length > 0 && (
            <div className={styles.grid}>
              {albums.map((album) => (
                <Link key={album.id} href={`/album/${album.id}`} className={styles.gridItem}>
                  {album.coverUrl ? (
                    <img className={styles.gridArt} src={album.coverUrl} alt="" />
                  ) : (
                    <div className={styles.gridArtPlaceholder}>💿</div>
                  )}
                  <div className={styles.gridTitle}>{album.title}</div>
                  <div className={styles.gridSubtitle}>{album.artist.name}</div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
