"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TrackRow } from "@/components/TrackRow";
import { MicrophoneIcon, RockIcon, HipHopIcon, ElectronicIcon, RnBIcon, JazzIcon, ClassicalIcon, PodcastIcon } from "@/components/Icons";
import { getCachedLibraryData, setCachedLibraryData } from "@/lib/offline-db";
import styles from "./page.module.css";

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  artistImage?: string;
  album: string;
  albumId?: number;
  coverUrl: string;
  duration: number;
  preview: string;
  source: "deezer" | "library";
  audioUrl?: string;
  isDownloaded?: boolean;
  deezerTrackId?: number;
}

interface LibraryTrack {
  id: string;
  title: string;
  artist: { name: string; id: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

const HISTORY_KEY = "sakura-search-history";
const MAX_HISTORY = 10;

const CATEGORIES = [
  { label: "Pop", icon: <MicrophoneIcon size={24} />, query: "pop hits", colors: ["#FF6B9D", "#C44DFF"] },
  { label: "Rock", icon: <RockIcon size={24} />, query: "rock classics", colors: ["#FF4D4D", "#FF8C42"] },
  { label: "Hip-Hop", icon: <HipHopIcon size={24} />, query: "hip hop", colors: ["#6C5CE7", "#A29BFE"] },
  { label: "Electronic", icon: <ElectronicIcon size={24} />, query: "electronic music", colors: ["#00B4D8", "#0077B6"] },
  { label: "R&B", icon: <RnBIcon size={24} />, query: "R&B soul", colors: ["#E17055", "#FDCB6E"] },
  { label: "Jazz", icon: <JazzIcon size={24} />, query: "jazz classics", colors: ["#00B894", "#55EFC4"] },
  { label: "Classical", icon: <ClassicalIcon size={24} />, query: "classical music", colors: ["#636E72", "#B2BEC3"] },
  { label: "Podcast", icon: <PodcastIcon size={24} />, query: "podcast", colors: ["#2D3436", "#636E72"] },
];

const QUICK_PICKS = ["Chill vibes", "Workout mix", "Throwback hits", "Feel good", "Focus flow", "Late night", "Acoustic", "Party starters"];

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
  const history = getHistory().filter(
    (h) => h.toLowerCase() !== trimmed.toLowerCase()
  );
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
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHistory(getHistory());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement !== inputRef.current &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
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

    const cacheKey = `search-${q.trim().toLowerCase()}`;
    const cached = await getCachedLibraryData<SearchResult[]>(cacheKey);
    if (cached) {
      setResults(cached);
      setLoading(false);
      fetchSearchResults(q, cacheKey);
      return;
    }

    await fetchSearchResults(q, cacheKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSearchResults(q: string, cacheKey: string) {
    try {
      const [libRes, deezerRes] = await Promise.allSettled([
        fetch(`/api/tracks?q=${encodeURIComponent(q.trim())}&limit=10`),
        fetch(`/api/music/search?q=${encodeURIComponent(q.trim())}&limit=15`),
      ]);

      let libTracks: SearchResult[] = [];
      if (libRes.status === "fulfilled") {
        const data = await libRes.value.json();
        libTracks = (data.tracks || []).map((t: LibraryTrack) => ({
          id: t.id,
          title: t.title,
          artist: t.artist.name,
          album: t.album?.title || "",
          coverUrl: t.coverUrl || t.album?.coverUrl || "",
          duration: t.duration,
          preview: "",
          source: "library" as const,
          audioUrl: t.audioUrl,
          isDownloaded: true,
        }));
      }

      let dzrTracks: SearchResult[] = [];
      if (deezerRes.status === "fulfilled") {
        const data = await deezerRes.value.json();
        dzrTracks = data.tracks || [];
      }

      // Deduplicate tracks by deezerId or title+artist
      const allResults = [...libTracks];
      for (const dt of dzrTracks) {
        if (!allResults.some(rt => rt.id === dt.id || (rt.title === dt.title && rt.artist === dt.artist))) {
          allResults.push(dt);
        }
      }

      setResults(allResults);
      setCachedLibraryData(cacheKey, allResults);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function exploreCategory(q: string) {
    setLoading(true);
    setSearched(true);
    setQuery(q); 
    try {
      const res = await fetch(`/api/music/explore?q=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json();
      setResults(data.tracks || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(value);
    }, 400);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      search(query);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      if (query) {
        handleClear();
      } else {
        inputRef.current?.blur();
      }
    }
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

  const showDefault = !searched && !query;

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>
            {loading ? (
              <span className={styles.spinnerSmall} aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            )}
          </span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="What do you want to listen to?"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            aria-label="Search"
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

      {showDefault && (
        <>
          <p className={styles.shortcutHint}>
            Press <kbd>/</kbd> anytime to jump back into search
          </p>

          {history.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.historyHeader}>
                <span className={styles.sectionTitle}>Recent Searches</span>
                <button
                  className={styles.clearHistoryBtn}
                  onClick={() => {
                    localStorage.removeItem(HISTORY_KEY);
                    setHistory([]);
                  }}
                >
                  Clear all
                </button>
              </div>
              <div className={styles.historyChips}>
                {history.map((q) => (
                  <div key={q} className={styles.historyChip} onClick={() => handleHistoryClick(q)} role="button" tabIndex={0}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="13" height="13" className={styles.historyIcon}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className={styles.historyChipText}>{q}</span>
                    <span className={styles.historyChipRemove} onClick={(e) => handleHistoryRemove(e, q)} role="button" tabIndex={0} aria-label={`Remove ${q} from recent searches`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.quickPicksSection}>
            <span className={styles.sectionTitle}>Quick Picks</span>
            <div className={styles.quickPicksRow}>
              {QUICK_PICKS.map((q) => (
                <button key={q} className={styles.quickPickChip} onClick={() => exploreCategory(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.categoriesSection}>
            <span className={styles.sectionTitle}>Browse All</span>
            <div className={styles.categoriesGrid}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.label}
                  className={styles.categoryCard}
                  onClick={() => exploreCategory(cat.query)}
                  style={{ "--cat-color-1": cat.colors[0], "--cat-color-2": cat.colors[1] } as React.CSSProperties}
                >
                  <span className={styles.categoryIcon}>{cat.icon}</span>
                  <span className={styles.categoryLabel}>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {searched && !loading && results.length > 0 && (
        <p className={styles.resultsSummary}>
          {results.length} result{results.length === 1 ? "" : "s"} for &ldquo;{query}&rdquo;
        </p>
      )}

      <div className={styles.results}>
        {loading && (
          <div className={styles.skeletonContainer}>
            {[...Array(6)].map((_, i) => (
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
                <circle cx="60" cy="60" r="32" stroke="var(--sakura-accent)" strokeWidth="2" opacity="0.3" />
                <circle cx="60" cy="60" r="10" fill="var(--sakura-accent)" opacity="0.15" />
                <line x1="45" y1="45" x2="75" y2="75" stroke="var(--sakura-accent)" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
                <line x1="75" y1="45" x2="45" y2="75" stroke="var(--sakura-accent)" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
              </svg>
            </div>
            <p className={styles.emptyText}>No results for &ldquo;{query}&rdquo;</p>
            <p className={styles.emptySubtext}>Try checking your spelling or use different keywords.</p>
            <button className={styles.emptyStateCta} onClick={handleClear}>Back to browse</button>
          </div>
        )}

        {!loading && searched && results.length > 0 && (
          <div className={styles.resultsList}>
            {results.map((track, i) => (
              <div key={track.id} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
                <TrackRow
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: { name: track.artist },
                    album: { title: track.album, coverUrl: track.coverUrl },
                    coverUrl: track.coverUrl,
                    audioUrl: track.audioUrl || undefined,
                    duration: track.duration,
                    source: track.source
                  }}
                  queue={results.map((t) => ({
                    id: t.id,
                    title: t.title,
                    artist: { name: t.artist },
                    album: { title: t.album, coverUrl: t.coverUrl },
                    coverUrl: t.coverUrl,
                    audioUrl: t.audioUrl || undefined,
                    duration: t.duration,
                    source: t.source
                  }))}
                  index={i}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
