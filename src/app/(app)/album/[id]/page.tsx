"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { isTrackDownloaded, saveTrackOffline, saveAudioBlob } from "@/lib/offline-db";
import styles from "./page.module.css";

/**
 * NOTE ON ASSUMPTIONS
 * Only this page's CSS module + loading skeleton were in your upload, not
 * the component itself, so the data shape and endpoints below are
 * reconstructed to match the conventions in your other pages (TrackRow,
 * usePlayer, lib/offline-db, fetch-from-api pattern). Point `/api/albums/${id}`
 * and the like-toggle endpoint at whatever your backend actually exposes.
 */

interface AlbumTrack {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

interface RelatedAlbum {
  id: string;
  title: string;
  coverUrl?: string;
  year?: number;
}

interface AlbumDetail {
  id: string;
  title: string;
  artist: { id: string; name: string };
  coverUrl?: string;
  year?: number;
  genres?: string[];
  accentColor?: string;
  liked?: boolean;
  tracks: AlbumTrack[];
  relatedAlbums?: RelatedAlbum[];
  copyright?: string;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
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
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { play } = usePlayer();

  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadAlbum = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/albums/${params.id}`);
      const data: AlbumDetail = await res.json();
      setAlbum(data);
      setLiked(!!data.liked);
    } catch {
      setAlbum(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadAlbum();
  }, [loadAlbum]);

  const playerQueue = useMemo(() => {
    if (!album) return [];
    return album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      album: album.title,
      coverUrl: t.coverUrl || album.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
  }, [album]);

  const displayTracks = useMemo(() => {
    if (!album) return [];
    return album.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: { name: t.artist.name },
      album: { title: album.title, coverUrl: album.coverUrl },
      coverUrl: t.coverUrl || album.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    }));
  }, [album]);

  function handlePlay() {
    if (playerQueue.length === 0) return;
    play(playerQueue[0], playerQueue);
  }

  function handleShuffle() {
    if (playerQueue.length === 0) return;
    const shuffled = shuffleArray(playerQueue);
    play(shuffled[0], shuffled);
  }

  async function handleToggleLike() {
    if (!album) return;
    const next = !liked;
    setLiked(next);
    try {
      await fetch(`/api/albums/${album.id}/like`, {
        method: next ? "POST" : "DELETE",
      });
    } catch {
      setLiked(!next);
    }
  }

  async function handleDownloadAll() {
    if (!album || downloading) return;
    setDownloading(true);
    try {
      for (const track of album.tracks) {
        try {
          const existing = await isTrackDownloaded(track.id);
          if (existing) continue;
          const res = await fetch(track.audioUrl);
          const blob = await res.blob();
          await saveTrackOffline({
            id: track.id,
            title: track.title,
            artist: track.artist.name,
            album: album.title,
            audioUrl: track.audioUrl,
            coverUrl: track.coverUrl || album.coverUrl,
            duration: track.duration,
          });
          await saveAudioBlob(track.id, blob);
        } catch {
          continue;
        }
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleRemoveFromLibrary() {
    if (!album) return;
    try {
      await fetch(`/api/albums/${album.id}/library`, { method: "DELETE" });
    } catch {
      /* ignore */
    } finally {
      setConfirmRemoveOpen(false);
      router.back();
    }
  }

  if (loading) {
    return <AlbumLoadingState />;
  }

  if (!album) {
    return (
      <div style={{ padding: "clamp(2rem, 8vh, 4rem) 1.5rem", textAlign: "center", color: "var(--sakura-text-secondary)" }}>
        Couldn&apos;t load this album.
      </div>
    );
  }

  const heroStyle = { "--bg": album.accentColor || "var(--sakura-accent-2)" } as React.CSSProperties;

  return (
    <div className={styles.page}>
      <div className={styles.heroGradient} style={heroStyle}>
        <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className={styles.hero}>
          {album.coverUrl ? (
            <img src={album.coverUrl} alt="" className={styles.coverArt} />
          ) : (
            <div className={styles.coverArt} />
          )}
          <div className={styles.heroInfo}>
            <div className={styles.heroLabel}>Album</div>
            <h1 className={styles.heroTitle}>{album.title}</h1>
            <button className={styles.artistLink} onClick={() => router.push(`/artist/${album.artist.id}`)}>
              {album.artist.name}
            </button>
            <div className={styles.heroMeta}>
              {album.year && <span>{album.year}</span>}
              {album.year && <span>·</span>}
              <span>{album.tracks.length} song{album.tracks.length !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span>{formatDuration(album.tracks.reduce((s, t) => s + (t.duration || 0), 0))}</span>
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
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M8 5v14l11-7z" />
          </svg>
          Play
        </button>
        <button className={styles.shuffleBtn} onClick={handleShuffle} aria-label="Shuffle play">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
        </button>
        <button
          className={`${styles.iconBtn} ${liked ? styles.iconBtnActive : ""}`}
          onClick={handleToggleLike}
          aria-label={liked ? "Unlike album" : "Like album"}
          aria-pressed={liked}
        >
          <svg viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        </button>
        <button className={styles.iconBtn} onClick={handleDownloadAll} aria-label="Download album for offline" title={downloading ? "Downloading…" : "Download for offline"}>
          {downloading ? (
            <svg viewBox="0 0 24 24" width="18" height="18" style={{ animation: "spin 0.8s linear infinite" }}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="42" strokeDashoffset="14" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        </button>
        <div className={styles.spacer} />
        <div style={{ position: "relative" }}>
          <button className={styles.iconBtn} onClick={() => setMoreOpen((v) => !v)} aria-label="More options" aria-haspopup="menu" aria-expanded={moreOpen}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <circle cx="12" cy="5" r="1.75" />
              <circle cx="12" cy="12" r="1.75" />
              <circle cx="12" cy="19" r="1.75" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.trackList}>
        {displayTracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            queue={displayTracks}
            index={i}
            showNumber
          />
        ))}
      </div>

      {album.copyright && <p className={styles.copyright}>{album.copyright}</p>}

      {album.relatedAlbums && album.relatedAlbums.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>More by {album.artist.name}</h2>
          <div className={styles.albumGrid}>
            {album.relatedAlbums.map((rel) => (
              <button key={rel.id} className={styles.albumCard} onClick={() => router.push(`/album/${rel.id}`)}>
                {rel.coverUrl ? (
                  <img src={rel.coverUrl} alt="" className={styles.albumArt} />
                ) : (
                  <div className={styles.albumArt} />
                )}
                <div className={styles.albumTitle}>{rel.title}</div>
                {rel.year && <div className={styles.albumYear}>{rel.year}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmRemoveOpen && (
        <div className={styles.modalOverlay} onClick={() => setConfirmRemoveOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Remove from Your Library?</div>
            <p className={styles.modalText}>
              &ldquo;{album.title}&rdquo; will be removed from your saved albums. You can add it back anytime.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setConfirmRemoveOpen(false)}>Cancel</button>
              <button className={styles.modalConfirm} onClick={handleRemoveFromLibrary}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlbumLoadingState() {
  return (
    <div style={{ padding: "clamp(0.75rem, 3vw, 1.25rem)" }}>
      <div style={{ margin: "clamp(-0.75rem, -3vw, -1.25rem) clamp(-0.75rem, -3vw, -1.25rem) clamp(0.75rem, 3vw, 1.25rem)", background: "var(--sakura-skeleton)", padding: "clamp(1rem, 4vw, 1.5rem)", borderRadius: "0 0 16px 16px", opacity: 0.5 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(0.75rem, 3vw, 1rem)" }}>
          <div style={{ width: "clamp(6rem, 25vw, 10rem)", height: "clamp(6rem, 25vw, 10rem)", borderRadius: "14px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", paddingBottom: "0.5rem" }}>
            <div style={{ width: "3rem", height: "0.6875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "10rem", height: "1.5rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "6rem", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ width: "6rem", height: "2.25rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
        <div style={{ width: "2.75rem", height: "2.25rem", borderRadius: "9999px", background: "var(--sakura-skeleton)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
            <div style={{ width: "0.8125rem", height: "0.875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            <div style={{ width: "3rem", height: "3rem", borderRadius: "8px", background: "var(--sakura-skeleton)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ width: "60%", height: "0.875rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
              <div style={{ width: "40%", height: "0.75rem", borderRadius: "4px", background: "var(--sakura-skeleton)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
