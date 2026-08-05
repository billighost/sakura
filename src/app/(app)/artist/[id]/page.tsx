"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
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
  _count: { tracks: number; albums: number };
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
  const { play } = usePlayer();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/artists/${params.id}`)
      .then((r) => r.json())
      .then((data) => setArtist(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id]);

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

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className="skeleton" style={{ width: "clamp(5rem, 25vw, 7.5rem)", height: "clamp(5rem, 25vw, 7.5rem)", borderRadius: "50%", margin: "0 auto 1rem" }} />
          <div className="skeleton" style={{ width: "8rem", height: "1rem", margin: "0 auto 6px" }} />
          <div className="skeleton" style={{ width: "5rem", height: "0.75rem", margin: "0 auto" }} />
        </div>
      </div>
    );
  }

  if (!artist) return null;

  return (
    <div className={styles.page}>
      <div className={styles.heroGradient}>
        <div className={styles.hero}>
          {artist.imageUrl ? (
            <img className={styles.avatar} src={artist.imageUrl} alt="" />
          ) : (
            <div className={styles.avatar} style={{ background: "linear-gradient(135deg, var(--sakura-accent), var(--sakura-accent-2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(1.5rem, 5vw, 2rem)" }}>
              {artist.name[0]?.toUpperCase()}
            </div>
          )}
          <div className={styles.name}>{artist.name}</div>
          <div className={styles.stats}>
            {artist._count.tracks} tracks · {artist._count.albums} albums{artist.playCount ? ` · ${formatPlayCount(artist.playCount)} plays` : ""}
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
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z" /></svg>
              Play All
            </button>
            <button className={styles.shuffleBtn} onClick={handleShuffle}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
            </button>
            <button className={styles.iconBtn} onClick={handleShare}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
            </button>
          </div>
        </div>
      </div>

      {artist.bio && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>About</div>
          <div className={styles.bio}>{artist.bio}</div>
        </div>
      )}

      {artist.albums.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Albums</div>
          <div className={styles.albumGrid}>
            {artist.albums.map((album) => (
              <Link key={album.id} href={`/album/${album.id}`} className={styles.albumCard}>
                {album.coverUrl ? (
                  <img className={styles.albumArt} src={album.coverUrl} alt="" />
                ) : (
                  <div className={styles.albumArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>💿</div>
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

      {artist.tracks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Top Tracks</div>
          {artist.tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} queue={artist.tracks} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
