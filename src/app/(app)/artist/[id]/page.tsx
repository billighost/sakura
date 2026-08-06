"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { DiscIcon } from "@/components/Icons";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string; id: string };
  album?: { title: string; coverUrl?: string; id?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  otherArtists?: { name: string; id: string; role: string }[];
}

interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  releaseYear?: number | null;
  _count?: { tracks: number };
}

interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  bio?: string;
  genres?: string[];
  playCount?: number;
  albums: Album[];
  tracks: Track[];
  trackCount: number;
  albumCount: number;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ArtistPage() {
  const params = useParams();
  const router = useRouter();
  useSwipeBack();
  const { play } = usePlayer();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/artists/${params.id}`)
      .then((r) => r.json())
      .then((data) => setArtist(data))
      .catch(() => {})
      .finally(() => setLoading(false));

    const followedStr = localStorage.getItem("followed-artists");
    if (followedStr) {
      try {
        const followed = JSON.parse(followedStr);
        if (Array.isArray(followed) && followed.includes(params.id)) {
          setIsFollowing(true);
        }
      } catch {}
    }
  }, [params.id]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [artist]);

  const handleFollowToggle = useCallback(() => {
    const nextState = !isFollowing;
    setIsFollowing(nextState);

    const followedStr = localStorage.getItem("followed-artists");
    let followed: string[] = [];
    if (followedStr) {
      try {
        followed = JSON.parse(followedStr);
        if (!Array.isArray(followed)) followed = [];
      } catch {}
    }

    if (nextState) {
      if (!followed.includes(params.id as string)) {
        followed.push(params.id as string);
      }
    } else {
      followed = followed.filter((id) => id !== params.id);
    }
    localStorage.setItem("followed-artists", JSON.stringify(followed));
  }, [isFollowing, params.id]);

  function handlePlayAll() {
    if (!artist || artist.tracks.length === 0) return;
    const q = artist.tracks.map((t) => ({
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

  function handleShuffle() {
    if (!artist || artist.tracks.length === 0) return;
    const shuffled = shuffleArray(artist.tracks);
    const q = shuffled.map((t) => ({
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

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: artist?.name, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  }

  function formatPlayCount(n?: number): string {
    if (!n) return "0";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }

  function getArtistNames(track: Track): string {
    const names = [track.artist.name];
    if (track.otherArtists && track.otherArtists.length > 0) {
      for (const other of track.otherArtists) {
        if (other.id !== track.artist.id) {
          names.push(other.name);
        }
      }
    }
    return names.join(", ");
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className={styles.heroSection}>
          <div className={styles.heroBleedFallback} />
          <div className={styles.hero}>
            <div className="skeleton" style={{ width: "clamp(6.5rem, 26vw, 9.5rem)", height: "clamp(6.5rem, 26vw, 9.5rem)", borderRadius: "50%", margin: "0 auto 1.25rem" }} />
            <div className="skeleton" style={{ width: "12rem", height: "clamp(1.5rem, 5vw, 2.25rem)", margin: "0 auto 10px", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "7rem", height: "0.8125rem", margin: "0 auto 14px", borderRadius: "4px" }} />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "1.25rem" }}>
              <div className="skeleton" style={{ width: "3.5rem", height: "1.5rem", borderRadius: "9999px" }} />
              <div className="skeleton" style={{ width: "3.5rem", height: "1.5rem", borderRadius: "9999px" }} />
            </div>
            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "center" }}>
              <div className="skeleton" style={{ width: "7rem", height: "2.75rem", borderRadius: "9999px" }} />
              <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
              <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
            </div>
          </div>
        </div>
        <div className={styles.section}>
          <div className="skeleton" style={{ width: "4.5rem", height: "0.9375rem", marginBottom: "1rem", borderRadius: "4px" }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
              <div className="skeleton" style={{ width: "3rem", height: "3rem", borderRadius: "8px" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="skeleton" style={{ width: `${50 + ((i * 17) % 30)}%`, height: "0.8125rem", borderRadius: "4px" }} />
                <div className="skeleton" style={{ width: `${25 + ((i * 13) % 20)}%`, height: "0.6875rem", borderRadius: "4px" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!artist) return null;

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className={`${styles.stickyHeader} ${stickyVisible ? styles.visible : ""}`}>
        {artist.imageUrl ? (
          <img className={styles.stickyAvatar} src={artist.imageUrl} alt="" />
        ) : (
          <div className={styles.stickyAvatar} style={{ background: "var(--sakura-accent-gradient)" }} />
        )}
        <span className={styles.stickyName}>{artist.name}</span>
        <button className={styles.stickyPlayBtn} onClick={handlePlayAll} aria-label="Play">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>

      <div className={styles.heroSection}>
        {artist.imageUrl ? (
          <img className={styles.heroBleed} src={artist.imageUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.heroBleedFallback} />
        )}
        <div className={styles.hero}>
          {artist.imageUrl ? (
            <img className={styles.avatar} src={artist.imageUrl} alt="" />
          ) : (
            <div className={`${styles.avatar} ${styles.avatarFallback}`}>{artist.name[0]?.toUpperCase()}</div>
          )}
          <div className={styles.eyebrow}>Artist</div>
          <div className={styles.name}>{artist.name}</div>
          <div className={styles.stats}>
            {artist.trackCount} tracks · {artist.albumCount} albums{artist.playCount ? ` · ${formatPlayCount(artist.playCount)} plays` : ""}
          </div>
          {artist.genres && artist.genres.length > 0 && (
            <div className={styles.genreTags}>
              {artist.genres.map((g) => (
                <span key={g} className={styles.genreTag}>{g}</span>
              ))}
            </div>
          )}
          <div className={styles.heroActions}>
            <button className={styles.playBtn} onClick={handlePlayAll}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
              Play all
            </button>
            <button className={styles.shuffleBtn} onClick={handleShuffle} title="Shuffle" aria-label="Shuffle play">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
            </button>
            <button
              className={`${styles.followBtn} ${isFollowing ? styles.following : ""}`}
              onClick={handleFollowToggle}
              aria-pressed={isFollowing}
            >
              {isFollowing ? (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  Following
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  Follow
                </>
              )}
            </button>
            <button className={styles.iconBtn} onClick={handleShare} title="Share" aria-label="Share artist">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div ref={sentinelRef} />

      {artist.bio && (
        <div className={`${styles.section} anim-fade-in`}>
          <div className={styles.sectionTitle}>About</div>
          <div className={`${styles.bio} ${bioExpanded ? styles.bioExpanded : ""}`}>
            {artist.bio}
          </div>
          {artist.bio.length > 200 && (
            <button className={styles.bioToggle} onClick={() => setBioExpanded(!bioExpanded)}>
              {bioExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {artist.bio && (artist.albums.length > 0 || artist.tracks.length > 0) && <div className={styles.divider} />}

      {artist.albums.length > 0 && (
        <div className={`${styles.section} anim-fade-in`}>
          <div className={styles.sectionTitle}>Albums</div>
          <div className={styles.albumGrid}>
            {artist.albums.map((album) => (
              <Link key={album.id} href={`/album/${album.id}`} className={styles.albumCard}>
                {album.coverUrl ? (
                  <img className={styles.albumArt} src={album.coverUrl} alt="" />
                ) : (
                  <div className={styles.albumArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}><DiscIcon size={24} /></div>
                )}
                <div className={styles.albumTitle}>{album.title}</div>
                <div className={styles.albumMeta}>
                  {album.releaseYear && <span>{album.releaseYear}</span>}
                  {album._count?.tracks ? <span>{album._count.tracks} songs</span> : null}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {artist.albums.length > 0 && artist.tracks.length > 0 && <div className={styles.divider} />}

      {artist.tracks.length > 0 && (
        <div className={`${styles.section} anim-fade-in`} style={{ paddingBottom: "clamp(2rem, 6vw, 3rem)" }}>
          <div className={styles.sectionTitle}>All tracks</div>
          {artist.tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={{
                ...track,
                artist: { name: getArtistNames(track), id: track.artist.id },
              }}
              queue={artist.tracks.map((t) => ({
                ...t,
                artist: { name: getArtistNames(t), id: t.artist.id },
              }))}
              index={i}
              showNumber
            />
          ))}
        </div>
      )}
    </div>
  );
}
