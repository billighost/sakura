"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { DiscIcon } from "@/components/Icons";
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
  copyright?: string;
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

function extractColor(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#2a1a3a";
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);
  const max = Math.max(r, g, b);
  const factor = max > 150 ? 0.55 : 0.7;
  r = Math.min(255, Math.round(r * factor + 10));
  g = Math.min(255, Math.round(g * factor + 8));
  b = Math.min(255, Math.round(b * factor + 15));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function AlbumPage() {
  const params = useParams();
  const { play } = usePlayer();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [bgColor, setBgColor] = useState<string>("#2a1a3a");
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/albums/${params.id}`)
      .then((r) => r.json())
      .then((data) => setAlbum(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const color = extractColor(e.currentTarget);
    setBgColor(color);
  }, []);

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
        <div className={styles.heroGradient} style={{ "--bg": "#2a1a3a" } as React.CSSProperties}>
          <div className={styles.hero}>
            <div className="skeleton" style={{ width: "clamp(8rem, 32vw, 14rem)", height: "clamp(8rem, 32vw, 14rem)", borderRadius: "12px", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "8px", padding: "0.5rem 0" }}>
              <div className="skeleton" style={{ width: "30%", height: "0.6875rem" }} />
              <div className="skeleton" style={{ width: "90%", height: "clamp(1.25rem, 4vw, 1.75rem)" }} />
              <div className="skeleton" style={{ width: "40%", height: "0.8125rem" }} />
              <div className="skeleton" style={{ width: "55%", height: "0.75rem" }} />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                <div className="skeleton" style={{ width: "3rem", height: "1.375rem", borderRadius: "9999px" }} />
                <div className="skeleton" style={{ width: "3rem", height: "1.375rem", borderRadius: "9999px" }} />
                <div className="skeleton" style={{ width: "3rem", height: "1.375rem", borderRadius: "9999px" }} />
              </div>
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <div className="skeleton" style={{ width: "5.5rem", height: "2.5rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.5rem", height: "2.5rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.25rem", height: "2.25rem", borderRadius: "9999px" }} />
        </div>
        <div style={{ padding: "0 clamp(0.75rem, 3vw, 1.25rem)" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0" }}>
              <div className="skeleton" style={{ width: "1.25rem", height: "0.8125rem" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <div className="skeleton" style={{ width: `${60 + ((i * 17) % 30)}%`, height: "0.8125rem" }} />
                <div className="skeleton" style={{ width: `${30 + ((i * 13) % 20)}%`, height: "0.6875rem" }} />
              </div>
              <div className="skeleton" style={{ width: "2rem", height: "0.75rem" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!album) return null;

  return (
    <div className={styles.page}>
      <div className={styles.heroGradient} style={{ "--bg": bgColor } as React.CSSProperties}>
        <div className={styles.hero} ref={heroRef}>
          {album.coverUrl ? (
            <img className={styles.coverArt} src={album.coverUrl} alt="" onLoad={onImageLoad} crossOrigin="anonymous" />
          ) : (
            <div className={styles.coverArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}><DiscIcon size={48} /></div>
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
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
          Play
        </button>
        <button className={styles.shuffleBtn} onClick={handleShuffle} title="Shuffle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={() => setShowPlaylistPicker(true)} title="Add to playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={handleLikeAll} title="Like all">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
        </button>
        <button className={styles.iconBtn} onClick={handleShare} title="Share">
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

      {album.copyright && (
        <div className={styles.copyright}>{album.copyright}</div>
      )}

      {album.otherAlbums && album.otherAlbums.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Other Albums by {album.artist.name}</div>
          <div className={styles.albumGrid}>
            {album.otherAlbums.map((oa) => (
              <Link key={oa.id} href={`/album/${oa.id}`} className={styles.albumCard}>
                {oa.coverUrl ? (
                  <img className={styles.albumArt} src={oa.coverUrl} alt="" />
                ) : (
                  <div className={styles.albumArt} style={{ background: "var(--sakura-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}><DiscIcon size={24} /></div>
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
