"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TrackRow } from "@/components/TrackRow";
import styles from "./page.module.css";

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  preview: string;
  source: "deezer" | "library";
  audioUrl?: string;
}

interface LibraryTrack {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

const FILTERS = ["All", "Tracks", "Artists", "Albums"] as const;
type Filter = typeof FILTERS[number];

const HISTORY_KEY = "sakura-search-history";
const MAX_HISTORY = 10;

function getHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const history = getHistory().filter((h) => h.toLowerCase() !== trimmed.toLowerCase());
  history.unshift(trimmed);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function removeHistory(q: string) {
  const history = getHistory().filter((h) => h !== q);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>("All");
  const [history, setHistory] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHistory(getHistory());
    function handleOnline() { setOffline(false); }
    function handleOffline() { setOffline(true); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    saveHistory(q);
    setHistory(getHistory());

    try {
      const [libRes, deezerRes] = await Promise.allSettled([
        fetch(`/api/tracks?q=${encodeURIComponent(q.trim())}&limit=10`),
        fetch(`/api/music/search?q=${encodeURIComponent(q.trim())}&limit=15`),
      ]);

      const libTracks: SearchResult[] =
        libRes.status === "fulfilled"
          ? ((libRes.value.json() as any).then?.((d: any) =>
              (d.tracks || []).map((t: LibraryTrack) => ({
                id: t.id,
                title: t.title,
                artist: t.artist.name,
                album: t.album?.title || "",
                coverUrl: t.coverUrl || t.album?.coverUrl || "",
                duration: t.duration,
                preview: "",
                source: "library" as const,
                audioUrl: t.audioUrl,
              }))
            ) ?? [])
          : [];

      const dzrTracks: SearchResult[] =
        deezerRes.status === "fulfilled"
          ? ((await deezerRes.value.json()).tracks || [])
          : [];

      const lib = Array.isArray(libTracks) ? libTracks : await libTracks;
      const libTitles = new Set(
        lib.map((t) => `${t.artist} - ${t.title}`.toLowerCase())
      );
      const uniqueDeezer = dzrTracks.filter(
        (t: SearchResult) =>
          !libTitles.has(`${t.artist} - ${t.title}`.toLowerCase())
      );

      setResults([...lib, ...uniqueDeezer]);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 400);
  }

  function handleClear() {
    setQuery("");
    setResults([]);
    setSearched(false);
    inputRef.current?.focus();
  }

  function handleHistoryClick(q: string) {
    setQuery(q);
    search(q);
  }

  function handleHistoryRemove(e: React.MouseEvent, q: string) {
    e.stopPropagation();
    removeHistory(q);
    setHistory(getHistory());
  }

  async function handleDownload(track: SearchResult) {
    setDownloading(track.id);
    try {
      const res = await fetch("/api/music/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          duration: track.duration,
        }),
      });
      const data = await res.json();

      if (data.id) {
        setResults((prev) =>
          prev.map((t) =>
            t.id === track.id
              ? {
                  ...t,
                  id: data.id,
                  source: "library" as const,
                  audioUrl: data.audioUrl,
                }
              : t
          )
        );
      }
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div className={styles.searchBox}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Search tracks, artists, albums..."
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            autoFocus
          />
          {query && (
            <button className={styles.clearBtn} onClick={handleClear} aria-label="Clear search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!searched && !query && (
        <div className={styles.shortcutHint}>
          Press <kbd>/</kbd> to search
        </div>
      )}

      {!searched && history.length > 0 && !query && (
        <div className={styles.historySection}>
          <div className={styles.historyHeader}>
            <span className={styles.sectionHeader}>Recent Searches</span>
            <button
              className={styles.clearHistoryBtn}
              onClick={() => {
                localStorage.removeItem(HISTORY_KEY);
                setHistory([]);
              }}
            >
              Clear
            </button>
          </div>
          {history.map((q) => (
            <button key={q} className={styles.historyItem} onClick={() => handleHistoryClick(q)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="14" height="14" className={styles.historyIcon}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className={styles.historyText}>{q}</span>
              <button className={styles.historyRemove} onClick={(e) => handleHistoryRemove(e, q)} aria-label="Remove">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </button>
          ))}
        </div>
      )}

      {searched && !loading && (
        <div className={styles.filterRow}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterChip} ${activeFilter === f ? styles.filterChipActive : ""}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <div className={styles.results}>
        {offline && (
          <div className={styles.offlineState}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth={1.5} width="48" height="48" style={{ margin: "0 auto 1rem", opacity: 0.5 }}>
              <path d="M1 1l22 22" strokeLinecap="round" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" strokeLinecap="round" />
              <circle cx="12" cy="20" r="1" />
            </svg>
            <p style={{ fontSize: "0.9375rem", color: "var(--sakura-text-secondary)" }}>
              No internet connection
            </p>
            <p style={{ fontSize: "0.8125rem", color: "var(--sakura-text-secondary)", marginTop: "0.375rem" }}>
              Check your network and try again
            </p>
          </div>
        )}

        {loading && (
          <div style={{ padding: "1rem" }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonThumb} />
                <div className={styles.skeletonCol}>
                  <div className={styles.skeletonLineW70} />
                  <div className={styles.skeletonLineW40} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg viewBox="0 0 120 120" width="120" height="120" fill="none">
                <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="2" />
                <circle cx="60" cy="60" r="32" stroke="var(--sakura-accent)" strokeWidth="2" opacity="0.4" />
                <circle cx="60" cy="60" r="12" fill="var(--sakura-accent)" opacity="0.3" />
                <path d="M60 32 C60 32 72 48 72 60 C72 68 66 74 60 74 C54 74 48 68 48 60 C48 48 60 32 60 32Z" fill="var(--sakura-accent)" opacity="0.15" />
                <circle cx="42" cy="44" r="3" fill="var(--sakura-accent-2)" opacity="0.5" />
                <circle cx="78" cy="50" r="2" fill="var(--sakura-accent)" opacity="0.4" />
              </svg>
            </div>
            <p className={styles.emptyText}>No results for &ldquo;{query}&rdquo;</p>
            <p className={styles.emptySubtext}>Try a different search term</p>
          </div>
        )}

        {!loading && !searched && !query && !offline && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg viewBox="0 0 120 120" width="120" height="120" fill="none">
                <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="2" />
                <circle cx="60" cy="60" r="32" stroke="var(--sakura-accent)" strokeWidth="2" opacity="0.4" />
                <circle cx="60" cy="60" r="12" fill="var(--sakura-accent)" opacity="0.3" />
                <path d="M45 55 L55 65 L75 45" stroke="var(--sakura-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
              </svg>
            </div>
            <p className={styles.emptyText}>Search for your favorite music</p>
            <p className={styles.emptySubtext}>Find tracks, artists, and albums</p>
          </div>
        )}

        {results.length > 0 && (
          <>
            {results.some((t) => t.source === "library") && (
              <>
                <div className={styles.sectionHeader}>In Your Library</div>
                {results
                  .filter((t) => t.source === "library")
                  .map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={{
                        id: track.id,
                        title: track.title,
                        artist: { name: track.artist },
                        album: { title: track.album, coverUrl: track.coverUrl },
                        coverUrl: track.coverUrl,
                        audioUrl: track.audioUrl || "",
                        duration: track.duration,
                      }}
                      queue={results
                        .filter((t) => t.source === "library")
                        .map((t) => ({
                          id: t.id,
                          title: t.title,
                          artist: { name: t.artist },
                          album: { title: t.album, coverUrl: t.coverUrl },
                          coverUrl: t.coverUrl,
                          audioUrl: t.audioUrl || "",
                          duration: t.duration,
                        }))}
                      index={i}
                    />
                  ))}
              </>
            )}

            {results.some((t) => t.source === "deezer") && (
              <>
                <div className={styles.sectionHeader}>Available Online</div>
                {results
                  .filter((t) => t.source === "deezer")
                  .map((track) => (
                    <button
                      key={track.id}
                      className={styles.deezerResult}
                      onClick={() => handleDownload(track)}
                      disabled={downloading === track.id}
                    >
                      {track.coverUrl && (
                        <img
                          src={track.coverUrl}
                          alt=""
                          className={styles.deezerCover}
                        />
                      )}
                      <div className={styles.deezerInfo}>
                        <div className={styles.deezerTitle}>{track.title}</div>
                        <div className={styles.deezerArtist}>
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ""}
                        </div>
                      </div>
                      {downloading === track.id ? (
                        <div className={styles.spinner} />
                      ) : (
                        <svg className={styles.downloadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      )}
                    </button>
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
