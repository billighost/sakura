"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { isTrackDownloaded, saveTrackOffline, saveAudioBlob } from "@/lib/offline-db";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import { useDownloadAll } from "@/lib/useDownloadAll";
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

interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
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

export default function PlaylistPage() {
  const params = useParams();
  const router = useRouter();
  const { play, addToDownloadQueue, downloadStates } = usePlayer();
  const { downloadAll } = useDownloadAll();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [allDownloaded, setAllDownloaded] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const downloading = useMemo(() => {
    if (!playlist) return false;
    return playlist.tracks.some(t => downloadStates[t.id] === "queued" || downloadStates[t.id] === "downloading");
  }, [playlist, downloadStates]);

  useEffect(() => {
    fetch(`/api/playlists/${params.id}`)
      .then((r) => r.json())
      .then((data) => setPlaylist(data))
      .catch(() => {})
      .finally(() => setLoading(false));
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
  }, [playlist]);

  useEffect(() => {
    let active = true;
    if (!playlist || playlist.tracks.length === 0) {
      if (active) setAllDownloaded(true);
      return;
    }

    async function checkDownloads() {
      let allDl = true;
      for (const t of playlist!.tracks) {
        if (!(await isTrackDownloaded(t.id))) {
          allDl = false;
          break;
        }
      }
      if (active) setAllDownloaded(allDl);
    }
    checkDownloads();
    return () => { active = false; };
  }, [playlist, downloadStates]);

  function handlePlay() {
    if (!playlist || playlist.tracks.length === 0) return;
    const q = playlist.tracks.map((t) => ({
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

  function handleShufflePlay() {
    if (!playlist || playlist.tracks.length === 0) return;
    const shuffled = shuffleArray(playlist.tracks);
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
      navigator.share({ title: playlist?.name, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/playlists/${params.id}`, { method: "DELETE" });
      router.push("/library");
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append("cover", file);
      await fetch(`/api/playlists/${params.id}/cover`, { method: "PUT", body: formData });
      const res = await fetch(`/api/playlists/${params.id}`);
      const data = await res.json();
      setPlaylist(data);
    } catch {
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleDownloadAll() {
    if (!playlist) return;
    await downloadAll(
      playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title,
        coverUrl: track.coverUrl || track.album?.coverUrl,
        audioUrl: track.audioUrl,
        duration: track.duration,
      })),
      "songs from this playlist"
    );
  }

  const totalDuration = playlist
    ? playlist.tracks.reduce((sum, t) => sum + t.duration, 0)
    : 0;

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
            <div className="skeleton" style={{ width: "clamp(7rem, 28vw, 11.5rem)", height: "clamp(7rem, 28vw, 11.5rem)", borderRadius: "var(--sakura-radius-lg)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "8px", padding: "0.5rem 0" }}>
              <div className="skeleton" style={{ width: "30%", height: "0.6875rem", borderRadius: "4px" }} />
              <div className="skeleton" style={{ width: "80%", height: "clamp(1.375rem, 4vw, 2rem)", borderRadius: "6px" }} />
              <div className="skeleton" style={{ width: "45%", height: "0.75rem", borderRadius: "4px" }} />
              <div className="skeleton" style={{ width: "35%", height: "0.75rem", borderRadius: "4px" }} />
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <div className="skeleton" style={{ width: "6rem", height: "2.75rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.75rem", height: "2.75rem", borderRadius: "9999px" }} />
          <div className="skeleton" style={{ width: "2.625rem", height: "2.625rem", borderRadius: "9999px" }} />
        </div>
        <div style={{ padding: "0 clamp(1.25rem, 5vw, 2rem)" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
              <div className="skeleton" style={{ width: "1.25rem", height: "0.8125rem", borderRadius: "4px" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <div className="skeleton" style={{ width: `${55 + ((i * 17) % 35)}%`, height: "0.8125rem", borderRadius: "4px" }} />
                <div className="skeleton" style={{ width: `${25 + ((i * 13) % 20)}%`, height: "0.6875rem", borderRadius: "4px" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className={`${styles.stickyHeader} ${stickyVisible ? styles.visible : ""}`}>
        {playlist.coverUrl ? (
          <img className={styles.stickyCover} src={playlist.coverUrl} alt="" />
        ) : (
          <div className={styles.stickyCover} style={{ background: "var(--sakura-accent-gradient)" }} />
        )}
        <span className={styles.stickyName}>{playlist.name}</span>
        {playlist.tracks.length > 0 && (
          <button className={styles.stickyPlayBtn} onClick={handlePlay} aria-label="Play">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z" /></svg>
          </button>
        )}
      </div>

      <div className={styles.heroSection}>
        {playlist.coverUrl ? (
          <img className={styles.heroBleed} src={playlist.coverUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.heroBleedFallback} />
        )}
        <div className={styles.hero}>
          <div className={styles.coverArtWrapper}>
            {playlist.coverUrl ? (
              <img src={playlist.coverUrl} alt="" className={styles.coverArtImg} />
            ) : (
              <svg viewBox="0 0 24 24" fill="white" width="clamp(1.5rem, 5vw, 2rem)" height="clamp(1.5rem, 5vw, 2rem)">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
              </svg>
            )}
            <label className={styles.coverUpload} title="Change cover">
              <input type="file" accept="image/*" hidden onChange={handleCoverUpload} disabled={uploadingCover} />
              {uploadingCover ? (
                <span className={styles.uploadSpinner} />
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg>
              )}
            </label>
          </div>
          <div className={styles.heroInfo}>
            <div className={styles.heroLabel}>Playlist</div>
            <div className={styles.heroTitle}>{playlist.name}</div>
            {playlist.description && <div className={styles.heroDesc}>{playlist.description}</div>}
            <div className={styles.heroMeta}>
              {playlist.tracks.length} {playlist.tracks.length === 1 ? "song" : "songs"}{totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div ref={sentinelRef} />

      <div className={styles.actions}>
        {playlist.tracks.length > 0 && (
          <>
            <button className={styles.playBtn} onClick={handlePlay}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
              Play
            </button>
            <button className={styles.shuffleBtn} onClick={handleShufflePlay} title="Shuffle" aria-label="Shuffle play">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
            </button>
          </>
        )}
        <button className={styles.iconBtn} onClick={() => setShowAddTracks(true)} title="Add tracks" aria-label="Add tracks">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        {!allDownloaded && playlist.tracks.length > 0 && (
          <button className={styles.iconBtn} onClick={handleDownloadAll} aria-label="Download playlist for offline" title={downloading ? "Downloading…" : "Download for offline"}>
            {downloading ? (
              <svg viewBox="0 0 24 24" width="18" height="18" style={{ animation: "spin 0.8s linear infinite" }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="42" strokeDashoffset="14" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
        )}
        <Link href={`/playlist/${params.id}/edit`} className={styles.iconBtn} title="Edit playlist" aria-label="Edit playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        </Link>
        <button className={styles.iconBtn} onClick={handleShare} title="Share" aria-label="Share playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
        </button>
        <button className={`${styles.iconBtn} ${styles.dangerBtn} ${styles.iconBtnSpacer}`} onClick={() => setShowDeleteConfirm(true)} title="Delete playlist" aria-label="Delete playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      </div>

      {showDeleteConfirm && (
        <div className={styles.modalOverlay} onClick={() => setShowDeleteConfirm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-danger)" strokeWidth={2} width="28" height="28"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </div>
            <div className={styles.modalTitle}>Delete playlist</div>
            <div className={styles.modalText}>Are you sure you want to delete &quot;{playlist.name}&quot;? This action cannot be undone.</div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button className={styles.modalDelete} onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {showAddTracks && (
        <div className={styles.modalOverlay} onClick={() => setShowAddTracks(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Add tracks</div>
            <div className={styles.modalText}>Search for tracks to add to this playlist.</div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setShowAddTracks(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {playlist.tracks.length > 0 ? (
        <>
          <div className={styles.listHeader}>
            <div className={styles.sectionTitle}>Tracks</div>
          </div>
          <div className={`${styles.trackList} anim-fade-in`}>
            {playlist.tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} queue={playlist.tracks} index={i} showNumber />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyIconWrap}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width="32" height="32">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className={styles.emptyTitle}>No tracks yet</div>
          <div className={styles.emptyDesc}>Add some tracks to get this playlist started.</div>
          <button className={styles.emptyBtn} onClick={() => setShowAddTracks(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add tracks
          </button>
        </div>
      )}
    </div>
  );
}
