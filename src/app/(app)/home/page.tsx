"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/PlayerContext";
import { FireIcon, PlaylistIcon, SparklesIcon, HeartIcon, MusicNoteIcon, MusicNotesIcon } from "@/components/Icons";
import { getCachedLibraryData, setCachedLibraryData } from "@/lib/offline-db";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  duration: number;
  audioUrl: string;
}

interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  _count?: { tracks: number };
}

interface Profile {
  username?: string;
  avatarUrl?: string;
}

interface Playlist {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount?: number;
}

interface MadeForYouItem {
  label: string;
  icon: React.ReactNode;
  gradient: string;
  tracks: Track[];
}

interface HomeCache {
  historyTracks: Track[];
  tracks: Track[];
  artists: Artist[];
  profile: Profile | null;
  playlists: Playlist[];
  globalTop?: Track[];
  countryTop?: Track[];
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildMadeForYou(
  history: Track[],
  tracks: Track[],
  playlists: Playlist[]
): MadeForYouItem[] {
  const items: MadeForYouItem[] = [];

  if (history.length > 0) {
    const counts = new Map<string, { track: Track; count: number }>();
    for (const t of history) {
      const key = t.id;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { track: t, count: 1 });
      }
    }
    const mostPlayed = [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((e) => e.track);
    items.push({
      label: "Most Played",
      icon: <FireIcon size={24} />,
      gradient: "linear-gradient(135deg, #FF6B35, #F7931E)",
      tracks: mostPlayed,
    });
  }

  if (playlists.length > 0) {
    const playlistTracks: Track[] = playlists.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.name,
      artist: { name: `${p.trackCount ?? 0} tracks` },
      coverUrl: p.coverUrl,
      duration: 0,
      audioUrl: "",
    }));
    items.push({
      label: "Your Playlists",
      icon: <PlaylistIcon size={24} />,
      gradient: "linear-gradient(135deg, #6C5CE7, #A29BFE)",
      tracks: playlistTracks,
    });
  }

  if (tracks.length > 0) {
    const sorted = [...tracks]
      .sort((a, b) => {
        const aTime = (a as unknown as { createdAt?: string }).createdAt
          ? new Date(
              (a as unknown as { createdAt: string }).createdAt
            ).getTime()
          : 0;
        const bTime = (b as unknown as { createdAt?: string }).createdAt
          ? new Date(
              (b as unknown as { createdAt: string }).createdAt
            ).getTime()
          : 0;
        return bTime - aTime;
      })
      .slice(0, 6);
    items.push({
      label: "Recently Added",
      icon: <SparklesIcon size={24} />,
      gradient: "linear-gradient(135deg, #00B894, #55EFC4)",
      tracks: sorted,
    });
  }

  if (history.length > 0) {
    items.push({
      label: "Favorites",
      icon: <HeartIcon size={24} filled />,
      gradient: "linear-gradient(135deg, #E17055, #FDCB6E)",
      tracks: history.slice(0, 6),
    });
  }

  return items;
}

function SkeletonLoader() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeletonSection}`}>
        <div className={styles.skeletonHeader} />
        <div className={styles.skeletonGrid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={styles.skeletonGridCell} />
          ))}
        </div>
      </div>
      {[...Array(3)].map((_, s) => (
        <div key={s} className={styles.skeletonSection}>
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonScroll}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className={styles.skeletonScrollItem}>
                <div className={styles.skeletonArt} />
                <div className={styles.skeletonText} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { play } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [madeForYou, setMadeForYou] = useState<MadeForYouItem[]>([]);
  const [globalTop, setGlobalTop] = useState<Track[]>([]);
  const [countryTop, setCountryTop] = useState<Track[]>([]);
  const [countryName, setCountryName] = useState<string>("Global");
  const [greeting] = useState(getGreeting);
  const hasLoadedFromCache = useRef(false);

  useEffect(() => {
    try {
      const locale = navigator.language || "en-US";
      const countryCode = locale.split("-")[1] || "US";
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      const detected = regionNames.of(countryCode);
      if (detected) setCountryName(detected);
    } catch {}
  }, []);

  const fetchFromServer = useCallback(async () => {
    try {
      const [historyRes, tracksRes, artistsRes, profileRes, playlistsRes, chartsRes] =
        await Promise.allSettled([
          fetch("/api/history?limit=10").then((r) => r.json()),
          fetch("/api/tracks?limit=20").then((r) => r.json()),
          fetch("/api/artists").then((r) => r.json()),
          fetch("/api/profile").then((r) => r.json()),
          fetch("/api/playlists").then((r) => r.json()),
          fetch("/api/charts").then((r) => r.json()),
        ]);

      const hTracks: Track[] =
        historyRes.status === "fulfilled"
          ? historyRes.value.tracks || []
          : [];
      const tTracks: Track[] =
        tracksRes.status === "fulfilled"
          ? tracksRes.value.tracks || []
          : [];
      const art: Artist[] =
        artistsRes.status === "fulfilled"
          ? artistsRes.value.artists || []
          : [];
      const prof: Profile | null =
        profileRes.status === "fulfilled" ? profileRes.value : null;
      const pls: Playlist[] =
        playlistsRes.status === "fulfilled"
          ? Array.isArray(playlistsRes.value)
            ? playlistsRes.value
            : playlistsRes.value.playlists || []
          : [];
      const charts: Track[] =
        chartsRes.status === "fulfilled"
          ? chartsRes.value.globalTop || []
          : [];

      setHistoryTracks(hTracks);
      setTracks(tTracks);
      setArtists(art);
      setProfile(prof);
      setPlaylists(pls);
      setMadeForYou(buildMadeForYou(hTracks, tTracks, pls));
      setGlobalTop(charts);
      setCountryTop([...charts].reverse());

      // Update cache
      setCachedLibraryData("home-main", {
        historyTracks: hTracks,
        tracks: tTracks,
        artists: art,
        profile: prof,
        playlists: pls,
        globalTop: charts,
        countryTop: [...charts].reverse(),
      });
    } catch {}
  }, []);

  // Cache-first loading
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Load from cache
      const cached = await getCachedLibraryData<HomeCache>("home-main");
      if (cancelled) return;

      if (cached) {
        setHistoryTracks(cached.historyTracks || []);
        setTracks(cached.tracks || []);
        setArtists(cached.artists || []);
        setProfile(cached.profile || null);
        setPlaylists(cached.playlists || []);
        setMadeForYou(buildMadeForYou(
          cached.historyTracks || [],
          cached.tracks || [],
          cached.playlists || []
        ));
        setGlobalTop(cached.globalTop || []);
        setCountryTop(cached.countryTop || []);
        setLoading(false);
        hasLoadedFromCache.current = true;

        // 2. Refresh from server in background
        fetchFromServer();
      } else {
        // No cache, fetch from server
        await fetchFromServer();
        setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <SkeletonLoader />;
  }

  const isEmpty =
    historyTracks.length === 0 &&
    tracks.length === 0 &&
    artists.length === 0;

  const quickPicks = historyTracks.slice(0, 6);

  const newTracks = [...tracks]
    .sort((a, b) => {
      const aTime = (a as unknown as { createdAt?: string }).createdAt
        ? new Date(
            (a as unknown as { createdAt: string }).createdAt
          ).getTime()
        : 0;
      const bTime = (b as unknown as { createdAt?: string }).createdAt
        ? new Date(
            (b as unknown as { createdAt: string }).createdAt
          ).getTime()
        : 0;
      return bTime - aTime;
    })
    .slice(0, 10);

  function getCoverUrl(track: Track): string {
    return track.coverUrl || track.album?.coverUrl || "";
  }

  function handlePlayMix(e: React.MouseEvent, mix: MadeForYouItem) {
    e.preventDefault();
    e.stopPropagation();
    if (mix.tracks.length === 0) return;
    const q = mix.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title,
      coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
    play(q[0], q);
  }

  function handleQuickPickPlay(e: React.MouseEvent, track: Track) {
    e.preventDefault();
    e.stopPropagation();
    const q = quickPicks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title,
      coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
    play(
      { id: track.id, title: track.title, artist: track.artist.name, album: track.album?.title, coverUrl: track.coverUrl || track.album?.coverUrl || undefined, audioUrl: track.audioUrl, duration: track.duration },
      q
    );
  }

  function handleTrackPlay(e: React.MouseEvent, track: Track, trackList: Track[]) {
    e.preventDefault();
    e.stopPropagation();
    const q = trackList.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title,
      coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
    play(
      { id: track.id, title: track.title, artist: track.artist.name, album: track.album?.title, coverUrl: track.coverUrl || track.album?.coverUrl || undefined, audioUrl: track.audioUrl, duration: track.duration },
      q
    );
  }

  if (isEmpty) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.greeting}>{greeting}</div>
          <div className={styles.avatarCol}>
            {profile?.avatarUrl ? (
              <Link href="/profile">
                <img
                  className={styles.avatar}
                  src={profile.avatarUrl}
                  alt=""
                />
              </Link>
            ) : (
              <Link href="/profile">
                <div className={styles.avatarPlaceholder}>
                  {profile?.username?.charAt(0)?.toUpperCase() || "S"}
                </div>
              </Link>
            )}
          </div>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration}>
            <svg viewBox="0 0 120 120" width="120" height="120" fill="none">
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
                opacity="0.4"
              />
              <circle
                cx="60"
                cy="60"
                r="12"
                fill="var(--sakura-accent)"
                opacity="0.3"
              />
              <path
                d="M60 32 C60 32 72 48 72 60 C72 68 66 74 60 74 C54 74 48 68 48 60 C48 48 60 32 60 32Z"
                fill="var(--sakura-accent)"
                opacity="0.15"
              />
              <circle
                cx="42"
                cy="44"
                r="3"
                fill="var(--sakura-accent-2)"
                opacity="0.5"
              />
              <circle
                cx="78"
                cy="50"
                r="2"
                fill="var(--sakura-accent)"
                opacity="0.4"
              />
              <circle
                cx="50"
                cy="80"
                r="2.5"
                fill="var(--sakura-accent-2)"
                opacity="0.3"
              />
            </svg>
          </div>
          <p className={styles.emptyText}>Your library is empty</p>
          <p className={styles.emptySubtext}>
            Start exploring and add some music
          </p>
          <Link href="/search" className={styles.emptyCta}>
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
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            Search Music
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.greeting}>{greeting}</div>
        <div className={styles.avatarCol}>
          {profile?.avatarUrl ? (
            <Link href="/profile">
              <img className={styles.avatar} src={profile.avatarUrl} alt="" />
            </Link>
          ) : (
            <Link href="/profile">
              <div className={styles.avatarPlaceholder}>
                {profile?.username?.charAt(0)?.toUpperCase() || "S"}
              </div>
            </Link>
          )}
        </div>
      </div>

      {quickPicks.length > 0 && (
        <div className={styles.quickPicksGrid}>
          {quickPicks.map((track) => (
            <button
              key={track.id}
              className={styles.quickPickCard}
              onClick={(e) => handleQuickPickPlay(e, track)}
            >
              {getCoverUrl(track) ? (
                <img
                  className={styles.quickPickArt}
                  src={getCoverUrl(track)}
                  alt=""
                />
              ) : (
                <div className={styles.quickPickFallback}><MusicNoteIcon size={24} /></div>
              )}
              <div className={styles.quickPickTitle}>{track.title}</div>
              <div className={styles.quickPickOverlay}>
                <div className={styles.quickPickPlayBtn}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="#fff"
                    width="20"
                    height="20"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {historyTracks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Recently Played</span>
          </div>
          <div className={styles.horizontalScroll}>
            {historyTracks.map((track) => (
              <button
                key={track.id}
                className={styles.trackCard}
                onClick={(e) => handleTrackPlay(e, track, historyTracks)}
              >
                {getCoverUrl(track) ? (
                  <img
                    className={styles.trackCardArt}
                    src={getCoverUrl(track)}
                    alt=""
                  />
                ) : (
                  <div className={styles.trackCardFallback}><MusicNoteIcon size={24} /></div>
                )}
                <div className={styles.trackCardTitle}>{track.title}</div>
                <div className={styles.trackCardArtist}>
                  {track.artist.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {artists.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Your Top Artists</span>
          </div>
          <div className={styles.horizontalScroll}>
            {artists.map((artist) => (
              <Link
                key={artist.id}
                href={`/artist/${artist.id}`}
                className={styles.artistCard}
              >
                <div className={styles.artistAvatarWrap}>
                  {artist.imageUrl ? (
                    <img
                      className={styles.artistAvatar}
                      src={artist.imageUrl}
                      alt=""
                    />
                  ) : (
                    <div className={styles.artistAvatarFallback}>
                      {artist.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className={styles.artistName}>{artist.name}</div>
                {artist._count && (
                  <div className={styles.artistTrackCount}>
                    {artist._count.tracks} tracks
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {madeForYou.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Made for You</span>
          </div>
          <div className={styles.madeForYouGrid}>
            {madeForYou.map((item) => (
              <button
                key={item.label}
                className={styles.madeForYouCard}
                onClick={(e) => handlePlayMix(e, item)}
                style={{ all: "unset", position: "relative", aspectRatio: 1, borderRadius: "8px", overflow: "hidden", cursor: "pointer", background: "var(--sakura-skeleton)", display: "block", width: "100%" }}
              >
                {item.tracks[0] && getCoverUrl(item.tracks[0]) ? (
                  <img
                    className={styles.madeForYouArt}
                    src={getCoverUrl(item.tracks[0])}
                    alt=""
                  />
                ) : (
                  <div
                    className={styles.madeForYouFallback}
                    style={{ background: item.gradient }}
                  >
                    {item.icon}
                  </div>
                )}
                <div className={styles.madeForYouLabel}>{item.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {globalTop.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Top 50 Global</span>
          </div>
          <div className={styles.horizontalScroll}>
            {globalTop.map((track) => (
              <button
                key={track.id}
                className={styles.trackCard}
                onClick={(e) => handleTrackPlay(e, track, globalTop)}
              >
                {getCoverUrl(track) ? (
                  <img
                    className={styles.trackCardArt}
                    src={getCoverUrl(track)}
                    alt=""
                  />
                ) : (
                  <div className={styles.trackCardFallback}><MusicNoteIcon size={24} /></div>
                )}
                <div className={styles.trackCardTitle}>{track.title}</div>
                <div className={styles.trackCardArtist}>
                  {track.artist.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {countryTop.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Top 50 in {countryName}</span>
          </div>
          <div className={styles.horizontalScroll}>
            {countryTop.map((track) => (
              <button
                key={track.id}
                className={styles.trackCard}
                onClick={(e) => handleTrackPlay(e, track, countryTop)}
              >
                {getCoverUrl(track) ? (
                  <img
                    className={styles.trackCardArt}
                    src={getCoverUrl(track)}
                    alt=""
                  />
                ) : (
                  <div className={styles.trackCardFallbackAlt}><MusicNotesIcon size={24} /></div>
                )}
                <div className={styles.trackCardTitle}>{track.title}</div>
                <div className={styles.trackCardArtist}>
                  {track.artist.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {newTracks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>New Arrivals</span>
          </div>
          <div className={styles.horizontalScroll}>
            {newTracks.map((track) => (
              <button
                key={track.id}
                className={styles.trackCard}
                onClick={(e) => handleTrackPlay(e, track, newTracks)}
              >
                {getCoverUrl(track) ? (
                  <img
                    className={styles.trackCardArt}
                    src={getCoverUrl(track)}
                    alt=""
                  />
                ) : (
                  <div className={styles.trackCardFallbackAlt}><MusicNotesIcon size={24} /></div>
                )}
                <div className={styles.trackCardTitle}>{track.title}</div>
                <div className={styles.trackCardArtist}>
                  {track.artist.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
