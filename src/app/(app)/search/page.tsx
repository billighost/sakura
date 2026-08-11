"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { GENRES } from "@/lib/genres";
import {
  SearchIcon,
  CloseIcon,
  ClockIcon,
  ChevronRightIcon,
  UserIcon,
  PlaylistIcon,
  MusicNoteIcon,
} from "@/components/Icons";
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

interface ArtistResult {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  source: "library" | "deezer";
  deezerId?: number;
}

interface PlaylistResult {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  source: "library" | "deezer";
  externalUrl?: string;
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

const LOCAL_IDLE_MS = 180;
const PROVIDER_IDLE_MS = 650;
const MIN_PROVIDER_CHARS = 3;

function getHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
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

type Tab = "all" | "songs" | "artists" | "playlists";

/**
 * Where a result opens.
 *
 * Search now merges our own catalogue with Deezer's, and the two need
 * different destinations. A `library` row has a real row in our database and
 * goes to the normal page. A `deezer` row doesn't exist locally, so it goes to
 * /browse, which fetches the tracklist on demand.
 *
 * The ids arrive prefixed (`deezer-12345`) precisely so a mix-up can't route a
 * foreign id into a local page and 404.
 */
function entityHref(
  kind: "artist" | "playlist",
  id: string,
  source: "library" | "deezer",
  deezerId?: number
): string {
  if (source === "library" && !id.startsWith("deezer-")) {
    return `/${kind}/${id}`;
  }
  const externalId = deezerId ?? id.replace(/^deezer-/, "");
  return `/browse/${kind}/${externalId}`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [artists, setArtists] = useState<ArtistResult[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  /** Set while browsing a genre, so the header can say what you're looking at. */
  const [browsing, setBrowsing] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Guards against out-of-order responses. Each search takes the next id; a
   * response whose id is no longer current is discarded. Without this, a slow
   * lookup for "tay" can land after a fast one for "taylor swift" and replace
   * correct results with stale ones.
   */
  const generationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(getHistory());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
      if (providerTimerRef.current) clearTimeout(providerTimerRef.current);
      inFlightRef.current?.abort();
    };
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

  function resetResults() {
    setResults([]);
    setArtists([]);
    setPlaylists([]);
  }

  const search = useCallback(
    async (q: string, opts: { provider?: boolean; commit?: boolean } = {}) => {
      const includeProvider = opts.provider ?? true;

      if (!q.trim()) {
        generationRef.current += 1;
        inFlightRef.current?.abort();
        resetResults();
        setSearched(false);
        setLoading(false);
        return;
      }

      setBrowsing(null);
      setLoading(true);
      setSearched(true);

      if (opts.commit) {
        saveHistory(q);
        setHistory(getHistory());
      }

      await fetchSearchResults(q, `search-${q.trim().toLowerCase()}`, includeProvider);
    },
    []
  );

  async function fetchSearchResults(
    q: string,
    cacheKey: string,
    includeProvider: boolean
  ) {
    const generation = ++generationRef.current;
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    /*
     * The offline cache is consulted *inside* the guarded path, not before it.
     * Previously an `await getCachedLibraryData(...)` ran before the generation
     * was taken, so a cache hit for an old prefix could resolve after a newer
     * live search had already painted and overwrite it — the exact staleness
     * the generation counter exists to prevent.
     */
    try {
      const cached = await getCachedLibraryData<{
        tracks: SearchResult[];
        artists: ArtistResult[];
        playlists: PlaylistResult[];
      }>(cacheKey);

      if (cached && generation === generationRef.current) {
        setResults(cached.tracks ?? []);
        setArtists(cached.artists ?? []);
        setPlaylists(cached.playlists ?? []);
        setLoading(false);
        if (!includeProvider) return;
      }

      const [libRes, deezerRes, entityRes] = await Promise.allSettled([
        fetch(`/api/tracks?q=${encodeURIComponent(q.trim())}&limit=10`, {
          signal: controller.signal,
        }),
        includeProvider
          ? fetch(`/api/music/search?q=${encodeURIComponent(q.trim())}&limit=15`, {
              signal: controller.signal,
            })
          : Promise.reject(new Error("provider skipped")),
        fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=6`, {
          signal: controller.signal,
        }),
      ]);

      if (generation !== generationRef.current) return;

      let libTracks: SearchResult[] = [];
      if (libRes.status === "fulfilled" && libRes.value.ok) {
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
      if (deezerRes.status === "fulfilled" && deezerRes.value.ok) {
        const data = await deezerRes.value.json();
        dzrTracks = data.tracks || [];
      }

      let nextArtists: ArtistResult[] = [];
      let nextPlaylists: PlaylistResult[] = [];
      if (entityRes.status === "fulfilled" && entityRes.value.ok) {
        const data = await entityRes.value.json();
        nextArtists = data.artists || [];
        nextPlaylists = data.playlists || [];
      }

      if (generation !== generationRef.current) return;

      // Library first — those play instantly — then provider results that
      // aren't already represented.
      const allResults = [...libTracks];
      for (const dt of dzrTracks) {
        const dup = allResults.some(
          (rt) =>
            rt.id === dt.id ||
            (rt.title.toLowerCase() === dt.title.toLowerCase() &&
              rt.artist.toLowerCase() === dt.artist.toLowerCase())
        );
        if (!dup) allResults.push(dt);
      }

      setResults(allResults);
      setArtists(nextArtists);
      setPlaylists(nextPlaylists);

      if (includeProvider) {
        setCachedLibraryData(cacheKey, {
          tracks: allResults,
          artists: nextArtists,
          playlists: nextPlaylists,
        });
      }
    } catch (err) {
      // An abort is the expected outcome of typing another character.
      if ((err as Error)?.name === "AbortError") return;
      if (generation === generationRef.current) resetResults();
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }

  /**
   * Browse a genre properly.
   *
   * This used to call /api/music/explore with the genre's label as free text,
   * which searched song *titles* — asking for Jazz returned tracks with "jazz"
   * in the name and none of the actual jazz. It now hits the genre endpoint,
   * which filters on the genre field and Deezer's genre-scoped charts.
   */
  async function browseGenre(genreId: string, label: string) {
    cancelPending();
    generationRef.current += 1;
    const generation = generationRef.current;
    inFlightRef.current?.abort();

    setLoading(true);
    setSearched(true);
    setBrowsing(label);
    setQuery("");
    setArtists([]);
    setPlaylists([]);
    setTab("all");

    try {
      const res = await fetch(
        `/api/music/genre?genre=${encodeURIComponent(genreId)}&limit=30`
      );
      const data = await res.json();
      if (generation !== generationRef.current) return;
      setResults(data.tracks || []);
    } catch {
      if (generation === generationRef.current) setResults([]);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);

    if (localTimerRef.current) clearTimeout(localTimerRef.current);
    if (providerTimerRef.current) clearTimeout(providerTimerRef.current);

    if (!value.trim()) {
      search("");
      return;
    }

    localTimerRef.current = setTimeout(() => {
      search(value, { provider: false });
    }, LOCAL_IDLE_MS);

    if (value.trim().length >= MIN_PROVIDER_CHARS) {
      providerTimerRef.current = setTimeout(() => {
        search(value, { provider: true });
      }, PROVIDER_IDLE_MS);
    }
  }

  function cancelPending() {
    if (localTimerRef.current) clearTimeout(localTimerRef.current);
    if (providerTimerRef.current) clearTimeout(providerTimerRef.current);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      cancelPending();
      search(query, { provider: true, commit: true });
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      if (query) handleClear();
      else inputRef.current?.blur();
    }
  }

  function handleClear() {
    cancelPending();
    generationRef.current += 1;
    inFlightRef.current?.abort();
    setQuery("");
    resetResults();
    setSearched(false);
    setBrowsing(null);
    setLoading(false);
    inputRef.current?.focus();
  }

  const showDefault = !searched && !query;
  const hasAnything = results.length > 0 || artists.length > 0 || playlists.length > 0;

  const showSongs = tab === "all" || tab === "songs";
  const showArtists = tab === "all" || tab === "artists";
  const showPlaylists = tab === "all" || tab === "playlists";

  return (
    <div className={styles.page} data-page-scroll>
      <div className={styles.topRow}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>
            {loading ? (
              <span className={styles.spinnerSmall} aria-hidden="true" />
            ) : (
              <SearchIcon size={18} />
            )}
          </span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Songs, artists or playlists"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            aria-label="Search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {(query || browsing) && (
            <button
              className={styles.clearBtn}
              onClick={handleClear}
              aria-label="Clear search"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {showDefault && (
        <>
          {history.length > 0 && (
            <section className={styles.historySection}>
              <div className={styles.historyHeader}>
                <h2 className={styles.sectionTitle}>Recent</h2>
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
              <div className={styles.historyChips}>
                {history.map((q) => (
                  <div
                    key={q}
                    className={`${styles.historyChip} pressable`}
                    onClick={() => {
                      cancelPending();
                      setQuery(q);
                      search(q, { provider: true, commit: true });
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setQuery(q);
                        search(q, { provider: true, commit: true });
                      }
                    }}
                  >
                    <ClockIcon size={13} className={styles.historyIcon} />
                    <span className={styles.historyChipText}>{q}</span>
                    <span
                      className={styles.historyChipRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeHistory(q);
                        setHistory(getHistory());
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${q}`}
                    >
                      <CloseIcon size={11} />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.categoriesSection}>
            <h2 className={styles.sectionTitle}>Browse by genre</h2>
            <div className={styles.categoriesGrid}>
              {GENRES.map((g) => (
                <button
                  key={g.id}
                  className={`${styles.categoryCard} pressable-lg`}
                  onClick={() => browseGenre(g.id, g.label)}
                  style={{ "--tone": g.tone } as React.CSSProperties}
                  data-anim
                >
                  <span className={styles.categoryIcon}>
                    <g.Icon size={34} tone={g.tone} />
                  </span>
                  <span className={styles.categoryLabel}>{g.label}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {searched && !showDefault && (
        <>
          {browsing ? (
            <p className={styles.resultsSummary}>
              <span className={styles.browsingLabel}>{browsing}</span>
              <span>{results.length} songs</span>
            </p>
          ) : (
            hasAnything &&
            !loading && (
              <div className={styles.tabs} role="tablist">
                {(
                  [
                    ["all", "All"],
                    ["songs", `Songs${results.length ? ` · ${results.length}` : ""}`],
                    ["artists", `Artists${artists.length ? ` · ${artists.length}` : ""}`],
                    [
                      "playlists",
                      `Playlists${playlists.length ? ` · ${playlists.length}` : ""}`,
                    ],
                  ] as [Tab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )
          )}
        </>
      )}

      <div className={styles.results}>
        {loading && (
          <div className={styles.skeletonContainer}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <div className={`${styles.skeletonThumb} skeleton`} />
                <div className={styles.skeletonCol}>
                  <div className={`${styles.skeletonLineW70} skeleton`} />
                  <div className={`${styles.skeletonLineW40} skeleton`} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && searched && !hasAnything && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} data-anim>
              <MusicNoteIcon size={44} />
            </div>
            <p className={styles.emptyText}>
              {browsing
                ? `Nothing in ${browsing} yet`
                : `No results for "${query}"`}
            </p>
            <p className={styles.emptySubtext}>
              {browsing
                ? "Try another genre — this one has nothing we can play right now."
                : "Check the spelling, or try the artist's name instead."}
            </p>
            <button className={styles.emptyStateCta} onClick={handleClear}>
              Back to browse
            </button>
          </div>
        )}

        {!loading && showArtists && artists.length > 0 && (
          <section className={styles.entitySection}>
            {tab === "all" && <h2 className={styles.sectionTitle}>Artists</h2>}
            <div className={styles.artistRow}>
              {artists.map((a) => (
                <Link
                  key={a.id}
                  href={entityHref("artist", a.id, a.source, a.deezerId)}
                  className={`${styles.artistCard} pressable-lg`}
                >
                  <div className={styles.artistAvatarWrap}>
                    {a.imageUrl ? (
                      <img src={a.imageUrl} alt="" className={styles.artistAvatar} />
                    ) : (
                      <div className={styles.artistAvatarFallback}>
                        <UserIcon size={22} />
                      </div>
                    )}
                  </div>
                  <span className={styles.artistName}>{a.name}</span>
                  <span className={styles.artistMeta}>
                    {a.trackCount > 0 ? `${a.trackCount} songs` : "Artist"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!loading && showPlaylists && playlists.length > 0 && (
          <section className={styles.entitySection}>
            {tab === "all" && <h2 className={styles.sectionTitle}>Playlists</h2>}
            <div className={styles.playlistList}>
              {playlists.map((p) => (
                <Link
                  key={p.id}
                  href={entityHref("playlist", p.id, p.source)}
                  className={`${styles.playlistRow} pressable`}
                >
                  <div className={styles.playlistCover}>
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" />
                    ) : (
                      <PlaylistIcon size={20} />
                    )}
                  </div>
                  <div className={styles.playlistInfo}>
                    <span className={styles.playlistName}>{p.name}</span>
                    <span className={styles.playlistMeta}>
                      {p.trackCount} songs
                      {p.ownerName ? ` · ${p.ownerName}` : ""}
                    </span>
                  </div>
                  <ChevronRightIcon size={16} className={styles.playlistChevron} />
                </Link>
              ))}
            </div>
          </section>
        )}

        {!loading && showSongs && results.length > 0 && (
          <section className={styles.entitySection}>
            {tab === "all" && !browsing && artists.length + playlists.length > 0 && (
              <h2 className={styles.sectionTitle}>Songs</h2>
            )}
            <div className={`${styles.resultsList} anim-stagger`}>
              {results.map((track, i) => (
                <div key={track.id} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                  <TrackRow
                    track={{
                      id: track.id,
                      title: track.title,
                      artist: { name: track.artist },
                      album: { title: track.album, coverUrl: track.coverUrl },
                      coverUrl: track.coverUrl,
                      audioUrl: track.audioUrl || undefined,
                      duration: track.duration,
                      source: track.source,
                    }}
                    index={i}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
