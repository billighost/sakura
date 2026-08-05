"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { getAllDownloadedTracks } from "@/lib/offline-db";
import styles from "./page.module.css";

interface OfflineTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  savedAt: number;
}

function formatTotalDuration(tracks: OfflineTrack[]): string {
  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${tracks.length} songs · ${h} hr ${m} min`;
  return `${tracks.length} songs · ${m} min`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function DownloadedPage() {
  const router = useRouter();
  const { play } = usePlayer();
  const [tracks, setTracks] = useState<OfflineTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTracks = useCallback(async () => {
    try {
      const allTracks = await getAllDownloadedTracks();
      setTracks(allTracks.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  function toQueue(t: OfflineTrack) {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverUrl: t.coverUrl,
      audioUrl: t.audioUrl,
      duration: t.duration,
    };
  }

  function handlePlayAll() {
    if (tracks.length === 0) return;
    const q = tracks.map(toQueue);
    play(q[0], q);
  }

  function handleShufflePlay() {
    if (tracks.length === 0) return;
    const shuffled = shuffleArray(tracks);
    const q = shuffled.map(toQueue);
    play(q[0], q);
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerGradient}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className={styles.headerArt}>
            <svg viewBox="0 0 24 24" fill="white" width="clamp(1.5rem, 5vw, 2.25rem)" height="clamp(1.5rem, 5vw, 2.25rem)">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.headerLabel}>Playlist</div>
            <div className={styles.headerTitle}>Downloaded Songs</div>
            <div className={styles.headerMeta}>
              {loading ? (
                <span className={styles.skeletonTextSmall} />
              ) : tracks.length > 0 ? (
                <span>{formatTotalDuration(tracks)}</span>
              ) : (
                <span>0 songs</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {tracks.length > 0 && (
        <div className={styles.controlsRow}>
          <div className={styles.playButtons}>
            <button className={styles.playAllBtn} onClick={handlePlayAll}>
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
            <TrackRow
              key={track.id}
              track={{
                id: track.id,
                title: track.title,
                artist: { name: track.artist },
                album: track.album ? { title: track.album, coverUrl: track.coverUrl } : null,
                coverUrl: track.coverUrl,
                audioUrl: track.audioUrl,
                duration: track.duration,
              }}
              queue={tracks.map((t) => ({
                id: t.id,
                title: t.title,
                artist: { name: t.artist },
                album: t.album ? { title: t.album, coverUrl: t.coverUrl } : null,
                coverUrl: t.coverUrl,
                audioUrl: t.audioUrl,
                duration: t.duration,
              }))}
              index={i}
              showNumber
            />
          ))
        )}
      </div>

      {!loading && tracks.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration}>
            <svg viewBox="0 0 120 120" width="100" height="100" fill="none">
              <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="1.5" />
              <path d="M60 38 C60 38 76 52 76 64 C76 71 69 78 60 78 C51 78 44 71 44 64 C44 52 60 38 60 38Z" fill="var(--sakura-accent)" opacity="0.12" />
              <path d="M45 75 L60 60 L75 75" stroke="var(--sakura-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
              <line x1="60" y1="60" x2="60" y2="85" stroke="var(--sakura-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
            </svg>
          </div>
          <p className={styles.emptyTitle}>No downloaded songs</p>
          <p className={styles.emptySubtext}>Songs you download for offline listening will appear here.</p>
        </div>
      )}
    </div>
  );
}
