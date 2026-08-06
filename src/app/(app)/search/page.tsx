"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { MicrophoneIcon, GuitarIcon, MusicNoteIcon, SliderIcon, SaxophoneIcon, HeadphonesIcon } from "@/components/Icons";
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
  contributors?: { name: string; role: string; imageUrl?: string }[];
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

// "Tracks" used to sit alongside "All" and do exactly the same thing, and
// "Artists"/"Albums" always returned an empty list since there's no such data
// on a SearchResult — they were dead ends. Library/Online actually filter on
// the real `source` field.
const FILTERS = ["All", "Library", "Online"] as const;
type Filter = (typeof FILTERS)[number];

const HISTORY_KEY = "sakura-search-history";
const MAX_HISTORY = 10;

const CATEGORIES = [
  { label: "Pop", icon: <MicrophoneIcon size={24} />, query: "pop hits", colors: ["#FF6B9D", "#C44DFF"] },
  { label: "Rock", icon: <GuitarIcon size={24} />, query: "rock classics", colors: ["#FF4D4D", "#FF8C42"] },
  { label: "Hip-Hop", icon: <MicrophoneIcon size={24} />, query: "hip hop", colors: ["#6C5CE7", "#A29BFE"] },
  { label: "Electronic", icon: <SliderIcon size={24} />, query: "electronic music", colors: ["#00B4D8", "#0077B6"] },
  { label: "R&B", icon: <MusicNoteIcon size={24} />, query: "R&B soul", colors: ["#E17055", "#FDCB6E"] },
  { label: "Jazz", icon: <SaxophoneIcon size={24} />, query: "jazz classics", colors: ["#00B894", "#55EFC4"] },
  { label: "Classical", icon: <MusicNoteIcon size={24} />, query: "classical music", colors: ["#636E72", "#B2BEC3"] },
  { label: "Podcast", icon: <HeadphonesIcon size={24} />, query: "podcast", colors: ["#2D3436", "#636E72"] },
];

// Hand-picked jumping-off points for the idle screen — not a live trends feed,
// just quick single-tap searches so the page isn't a blank box on first open.
const QUICK_PICKS = ["Chill vibes", "Workout mix", "Throwback hits", "Feel good", "Focus flow", "Late night", "Acoustic", "Party starters"];

function getHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
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

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>("All");
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { play } = usePlayer();

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

    // Check cache first
    const cacheKey = `search-${q.trim().toLowerCase()}`;
    const cached = await getCachedLibraryData<SearchResult[]>(cacheKey);
    if (cached) {
      setResults(cached);
      setLoading(false);
      // Still refresh from server in background
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

      const allResults = [...libTracks, ...dzrTracks];
      setResults(allResults);
      setCachedLibraryData(cacheKey, allResults);
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
    setActiveFilter("All");
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

  function handleQuickPick(q: string) {
    setQuery(q);
    search(q);
  }

  function handleCategoryClick(q: string) {
    setQuery(q);
    search(q);
  }

  function handlePlayDownloaded(track: SearchResult) {
    const queue = results
      .filter((t) => t.source === "library" || t.isDownloaded)
      .map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        coverUrl: t.coverUrl,
        audioUrl: t.audioUrl || "",
        duration: t.duration,
      }));

    const idx = queue.findIndex((t) => t.id === track.id);
    const q = idx >= 0 ? queue.slice(idx) : queue;

    if (q.length > 0) {
      play(
        {
          id: q[0].id,
          title: q[0].title,
          artist: q[0].artist,
          album: q[0].album,
          coverUrl: q[0].coverUrl,
          audioUrl: q[0].audioUrl,
          duration: q[0].duration,
        },
        q
      );
    }
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
                  isDownloaded: true,
                  coverUrl: data.coverUrl || t.coverUrl,
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

  const libraryCount = useMemo(() => results.filter((t) => t.source === "library").length, [results]);
  const onlineCount = useMemo(() => results.filter((t) => t.source === "deezer").length, [results]);

  const filteredResults = results.filter((t) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Library") return t.source === "library";
    if (activeFilter === "Online") return t.source === "deezer";
    return true;
  });

  // The single best match gets pulled into its own hero card, Spotify-style.
  // Only on the "All" tab, so it doesn't disappear/duplicate oddly when the
  // person is specifically filtering to one source.
  const topResult = activeFilter === "All" ? filteredResults[0] : null;
  const restResults = topResult ? filteredResults.slice(1) : filteredResults;

  const showDefault = !searched && !query;

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>
            {loading ? (
              <span className={styles.spinnerSmall} aria-hidden="true" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                width="18"
                height="18"
              >
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
            <button
              className={styles.clearBtn}
              onClick={handleClear}
              aria-label="Clear search"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                width="16"
                height="16"
              >
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
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="13"
                      height="13"
                      className={styles.historyIcon}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className={styles.historyChipText}>{q}</span>
                    <span
                      className={styles.historyChipRemove}
                      onClick={(e) => handleHistoryRemove(e, q)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${q} from recent searches`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width="11"
                        height="11"
                      >
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
                <button key={q} className={styles.quickPickChip} onClick={() => handleQuickPick(q)}>
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
                  onClick={() => handleCategoryClick(cat.query)}
                  style={
                    {
                      "--cat-color-1": cat.colors[0],
                      "--cat-color-2": cat.colors[1],
                    } as React.CSSProperties
                  }
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
        <>
          <div className={styles.filterRow}>
            {FILTERS.map((f) => {
              const count = f === "All" ? results.length : f === "Library" ? libraryCount : onlineCount;
              return (
                <button
                  key={f}
                  className={`${styles.filterChip} ${activeFilter === f ? styles.filterChipActive : ""}`}
                  onClick={() => setActiveFilter(f)}
                >
                  {f}
                  <span className={styles.filterCount}>{count}</span>
                </button>
              );
            })}
          </div>
          <p className={styles.resultsSummary}>
            {filteredResults.length} result{filteredResults.length === 1 ? "" : "s"} for &ldquo;{query}&rdquo;
          </p>
        </>
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

        {!loading && searched && filteredResults.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg
                viewBox="0 0 120 120"
                width="120"
                height="120"
                fill="none"
              >
                <circle
                  cx="60"
                  cy="60"
                  r="56"
                  stroke="var(--sakura-border)"
                  strokeWidth="2"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="32"
                  stroke="var(--sakura-accent)"
                  strokeWidth="2"
                  opacity="0.3"
                />
                <circle cx="60" cy="60" r="10" fill="var(--sakura-accent)" opacity="0.15" />
                <line
                  x1="45"
                  y1="45"
                  x2="75"
                  y2="75"
                  stroke="var(--sakura-accent)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.4"
                />
                <line
                  x1="75"
                  y1="45"
                  x2="45"
                  y2="75"
                  stroke="var(--sakura-accent)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.4"
                />
              </svg>
            </div>
            <p className={styles.emptyText}>
              No results for &ldquo;{query}&rdquo;
            </p>
            <p className={styles.emptySubtext}>
              Try checking your spelling or use different keywords.
            </p>
            <button className={styles.emptyStateCta} onClick={handleClear}>
              Back to browse
            </button>
          </div>
        )}

        {!loading && searched && filteredResults.length > 0 && (
          <>
            {topResult && (
              <div className={styles.topResultSection}>
                <div className={styles.sectionHeader}>Top Result</div>
                <div className={styles.topResultCard}>
                  {topResult.coverUrl && (
                    <img src={topResult.coverUrl} alt="" className={styles.topResultCover} />
                  )}
                  <div className={styles.topResultInfo}>
                    <div className={styles.topResultTitle}>{topResult.title}</div>
                    <div className={styles.topResultMeta}>
                      {topResult.artist}
                      {topResult.album ? ` · ${topResult.album}` : ""}
                      {" · "}
                      {formatDuration(topResult.duration)}
                    </div>
                    <span className={styles.topResultBadge}>
                      {topResult.source === "library" ? "In Your Library" : "Available Online"}
                    </span>
                  </div>
                  {topResult.source === "library" || topResult.isDownloaded ? (
                    <button
                      className={styles.topResultPlayBtn}
                      onClick={() => handlePlayDownloaded(topResult)}
                      aria-label={`Play ${topResult.title}`}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      className={styles.topResultDownloadBtn}
                      onClick={() => handleDownload(topResult)}
                      disabled={downloading === topResult.id}
                      aria-label={`Download ${topResult.title}`}
                    >
                      {downloading === topResult.id ? (
                        <div className={styles.spinner} />
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {restResults.some((t) => t.source === "library") && (
              <>
                <div className={styles.sectionHeader}>In Your Library</div>
                {restResults
                  .filter((t) => t.source === "library")
                  .map((track, i) => (
                    <div key={track.id} className={styles.resultRow} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
                      <TrackRow
                        track={{
                          id: track.id,
                          title: track.title,
                          artist: { name: track.artist },
                          album: { title: track.album, coverUrl: track.coverUrl },
                          coverUrl: track.coverUrl,
                          audioUrl: track.audioUrl || "",
                          duration: track.duration,
                        }}
                        queue={restResults
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
                    </div>
                  ))}
              </>
            )}

            {restResults.some((t) => t.source === "deezer") && (
              <>
                <div className={styles.sectionHeader}>Available Online</div>
                {restResults
                  .filter((t) => t.source === "deezer")
                  .map((track, i) => (
                    <div key={track.id} className={styles.resultRow} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
                      <div className={styles.deezerResult}>
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
                        {track.isDownloaded ? (
                          <button
                            className={styles.playBtn}
                            onClick={() => handlePlayDownloaded(track)}
                            title="Play"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            className={styles.downloadBtn}
                            onClick={() => handleDownload(track)}
                            disabled={downloading === track.id}
                            title="Download"
                          >
                            {downloading === track.id ? (
                              <div className={styles.spinner} />
                            ) : (
                              <svg
                                className={styles.downloadIcon}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
