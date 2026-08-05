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
  trackNumber?: number | null;
}

interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  releaseYear?: number | null;
  releaseDate?: string;
  genres?: string[];
  artist: { name: string; id: string };
  tracks: Track[];
  otherAlbums?: { id: string; title: string; coverUrl?: string; releaseYear?: number | null }[];
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AlbumPage() {
  const params = useParams();
  const { play } = usePlayer();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);

  useEffect(() => {
    fetch(`/api/albums/${params.id}`)
      .then((r) => r.json())
      .then((data) => setAlbum(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id]);

  function handlePlay() {
    if (!album || album.tracks.length === 0) return;
    const q = album.tracks.map((t) => ({
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
    if (!album || album.tracks.length === 0) return;
    const shuffled = shuffleArray(album.tracks);
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

  function handleLikeAll() {
    if (!album) return;
    for (const track of album.tracks) {
      fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id }),
      }).catch(() => {});
    }
  }

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: album?.title, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  }

  function formatDate(d?: string): string {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return d;
    }
  }

  const totalDuration = album
    ? album.tracks.reduce((sum, t) => sum + t.duration, 0)
    : 0;

  if (loading) {
    return (
      <div className={styles.page}>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <div className="skeleton" style={{ width: "clamp(5rem, 20vw, 7.5rem)", height: "clamp(5rem, 20vw, 7.5rem)", borderRadius: "12px", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "6px" }}>
            <div className="skeleton" style={{ width: "40%", height: "0.75rem" }} />
            <div className="skeleton" style={{ width: "80%", height: "1rem" }} />
            <div className="skeleton" style={{ width: "30%", height: "0.75rem" }} />
          </div>
        </div>
      </div>
    );
  }

  if (!album) return null;

  return (
    <div className={styles.page}>
      <div className={styles.heroGradient}>
        <div className={styles.hero}>
          {album.coverUrl ? (
            <img className={styles.coverArt} src={album.coverUrl} alt="" />
          ) : (
            <div className={styles.coverArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(1.5rem, 5vw, 2rem)" }}>💿</div>
          )}
          <div className={styles.heroInfo}>
            <div className={styles.heroLabel}>Album</div>
            <div className={styles.heroTitle}>{album.title}</div>
            <Link href={`/artist/${album.artist.id}`} className={styles.artistLink}>{album.artist.name}</Link>
            <div className={styles.heroMeta}>
              {album.releaseDate ? formatDate(album.releaseDate) : album.releaseYear ? album.releaseYear : ""}{" "}
              · {album.tracks.length} songs{totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ""}
            </div>
            {album.genres && album.genres.length > 0 && (
              <div className={styles.genreTags}>
                {album.genres.map((g) => (
                  <span key={g} className={styles.genreTag}>{g}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.playBtn} onClick={handlePlay}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z" /></svg>
          Play
        </button>
        <button className={styles.shuffleBtn} onClick={handleShuffle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={() => setShowPlaylistPicker(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={handleLikeAll}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={handleShare}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
        </button>
      </div>

      {showPlaylistPicker && (
        <div className={styles.modalOverlay} onClick={() => setShowPlaylistPicker(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Add to Playlist</div>
            <div className={styles.modalText}>Select a playlist to add all tracks from this album.</div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setShowPlaylistPicker(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.trackList}>
        {album.tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} queue={album.tracks} index={i} showNumber />
        ))}
      </div>

      {album.otherAlbums && album.otherAlbums.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Other Albums by {album.artist.name}</div>
          <div className={styles.albumGrid}>
            {album.otherAlbums.map((oa) => (
              <Link key={oa.id} href={`/album/${oa.id}`} className={styles.albumCard}>
                {oa.coverUrl ? (
                  <img className={styles.albumArt} src={oa.coverUrl} alt="" />
                ) : (
                  <div className={styles.albumArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>💿</div>
                )}
                <div className={styles.albumTitle}>{oa.title}</div>
                {oa.releaseYear && <div className={styles.albumYear}>{oa.releaseYear}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
