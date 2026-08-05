"use client";

import { useState, useEffect, useCallback } from "react";
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

function formatTotalDuration(tracks: Track[]): string {
  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${tracks.length} songs · ${h}h ${m}m`;
  return `${tracks.length} songs · ${m} min`;
}

export default function LikedPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { play } = usePlayer();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json();
      setTracks(data.tracks || data || []);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleShufflePlay() {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    const t = shuffled[0];
    play(
      { id: t.id, title: t.title, artist: t.artist.name, album: t.album?.title, coverUrl: t.coverUrl || t.album?.coverUrl, audioUrl: t.audioUrl, duration: t.duration },
      shuffled.map((s) => ({ id: s.id, title: s.title, artist: s.artist.name, album: s.album?.title, coverUrl: s.coverUrl || s.album?.coverUrl, audioUrl: s.audioUrl, duration: s.duration }))
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerGradient}>
        <div className={styles.header}>
          <div className={styles.headerArt}>
            <svg viewBox="0 0 24 24" fill="white" width="clamp(1.5rem, 5vw, 2rem)" height="clamp(1.5rem, 5vw, 2rem)">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.headerLabel}>Playlist</div>
            <div className={styles.headerTitle}>Liked Songs</div>
            <div className={styles.headerCount}>
              {loading ? (
                <span className={styles.skeletonTextSmall} />
              ) : tracks.length > 0 ? (
                formatTotalDuration(tracks)
              ) : (
                "0 songs"
              )}
            </div>
          </div>
        </div>
      </div>

      {refreshing && (
        <div className={styles.refreshIndicator}>
          <div className={styles.refreshSpinner} />
        </div>
      )}

      {tracks.length > 0 && (
        <div className={styles.buttonRow}>
          <button className={styles.playAllBtn} onClick={() => {
            if (tracks.length === 0) return;
            const t = tracks[0];
            play(
              { id: t.id, title: t.title, artist: t.artist.name, album: t.album?.title, coverUrl: t.coverUrl || t.album?.coverUrl, audioUrl: t.audioUrl, duration: t.duration },
              tracks.map((s) => ({ id: s.id, title: s.title, artist: s.artist.name, album: s.album?.title, coverUrl: s.coverUrl || s.album?.coverUrl, audioUrl: s.audioUrl, duration: s.duration }))
            );
          }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play All
          </button>
          <button className={styles.shuffleBtn} onClick={handleShufflePlay}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            Shuffle
          </button>
        </div>
      )}

      <div className={styles.trackList}>
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonCol}>
                <div className={styles.skeletonLineW70} />
                <div className={styles.skeletonLineW40} />
              </div>
            </div>
          ))
        ) : (
          tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} queue={tracks} index={i} />
          ))
        )}
      </div>

      {!loading && tracks.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration}>
            <svg viewBox="0 0 120 120" width="120" height="120" fill="none">
              <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="2" />
              <circle cx="60" cy="60" r="32" stroke="var(--sakura-accent)" strokeWidth="2" opacity="0.4" />
              <path d="M60 40 C60 40 72 52 72 62 C72 68 66 74 60 74 C54 74 48 68 48 62 C48 52 60 40 60 40Z" fill="var(--sakura-accent)" opacity="0.15" />
              <circle cx="42" cy="44" r="3" fill="var(--sakura-accent-2)" opacity="0.5" />
              <circle cx="78" cy="50" r="2" fill="var(--sakura-accent)" opacity="0.4" />
              <circle cx="50" cy="80" r="2.5" fill="var(--sakura-accent-2)" opacity="0.3" />
            </svg>
          </div>
          <p className={styles.emptyText}>No liked songs yet</p>
          <p className={styles.emptySubtext}>Tap the heart icon on any track to like it</p>
        </div>
      )}
    </div>
  );
}
