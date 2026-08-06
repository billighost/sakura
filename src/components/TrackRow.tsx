"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePlayer } from "./PlayerContext";
import { isTrackDownloaded, saveTrackOffline, saveAudioBlob, removeOfflineTrack, getCachedUserId, getDeviceId } from "@/lib/offline-db";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import styles from "./TrackRow.module.css";

const PETAL_COUNT = 5;

interface TrackRowProps {
  track: {
    id: string;
    title: string;
    artist: { name: string; id?: string };
    album?: { title: string; coverUrl?: string; id?: string } | null;
    coverUrl?: string;
    audioUrl: string;
    duration: number;
  };
  queue?: TrackRowProps["track"][];
  index?: number;
  showNumber?: boolean;
}

export function TrackRow({ track, queue, index, showNumber }: TrackRowProps) {
  const { currentTrack, isPlaying, play, togglePlay, addToQueue, favoriteTrackIds, toggleLikeTrack } = usePlayer();
  const liked = favoriteTrackIds?.has(track.id) || false;
  const isActive = currentTrack?.id === track.id;
  const [offline, setOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [burstKey, setBurstKey] = useState(0);

  const cover = track.coverUrl || track.album?.coverUrl;

  useEffect(() => {
    checkOffline();
  }, [track.id]);

  async function checkOffline() {
    try {
      const uId = getCachedUserId();
      const dId = getDeviceId();
      const cached = await isTrackDownloaded(track.id, uId, dId);
      setOffline(cached);
    } catch {}
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const uId = getCachedUserId();
    const dId = getDeviceId();
    if (offline) {
      try {
        await removeOfflineTrack(track.id, uId, dId);
        setOffline(false);
      } catch {}
      return;
    }

    setDownloading(true);
    try {
      const res = await fetch(track.audioUrl);
      const blob = await res.blob();

      await saveTrackOffline({
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title,
        audioUrl: track.audioUrl,
        coverUrl: cover,
        duration: track.duration,
      }, uId, dId);
      await saveAudioBlob(track.id, blob, uId, dId);
      setOffline(true);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }

  function handleLike(e: React.MouseEvent) {
    e.stopPropagation();
    if (!liked) setBurstKey((k) => k + 1);
    toggleLikeTrack(track.id);
  }

  function handlePlay(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-download-btn]")) return;
    if (isActive) {
      togglePlay();
    } else {
      const q = queue?.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist.name,
        artistId: t.artist.id,
        album: t.album?.title,
        albumId: t.album?.id,
        coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
        audioUrl: t.audioUrl,
        duration: t.duration,
      }));
      play(
        {
          id: track.id,
          title: track.title,
          artist: track.artist.name,
          artistId: track.artist.id,
          album: track.album?.title,
          albumId: track.album?.id,
          coverUrl: cover,
          audioUrl: track.audioUrl,
          duration: track.duration,
        },
        q
      );
    }
  }

  function openMenuFromButton(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: rect.right - 180, y: rect.bottom + 4 });
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`${styles.root} ${isActive ? styles.active : ""}`}
      onClick={handlePlay}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handlePlay(e as any); }}
    >
      {showNumber && index !== undefined ? (
        <span className={`${styles.numberCell} ${isActive ? styles.numberActive : ""}`}>
          {isActive && isPlaying ? (
            <span className={styles.eq} aria-hidden="true"><span /><span /><span /></span>
          ) : isActive ? (
            "♫"
          ) : (
            index + 1
          )}
        </span>
      ) : cover ? (
        <div className={`${styles.artWrap} ${isActive && isPlaying ? styles.playing : ""}`}>
          <div className={styles.artGlow} />
          <img src={cover} alt="" className={styles.art} />
          <div className={styles.artOverlay}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      ) : null}

      <div className={styles.info}>
        <div className={`${styles.title} ${isActive ? styles.titleActive : ""}`}>
          <Link
            href={`/track/${track.id}`}
            onClick={(e) => e.stopPropagation()}
            className={styles.title}
            style={{ color: "inherit" }}
          >
            {track.title}
          </Link>
        </div>
        <div className={styles.meta}>
          {track.artist.id ? (
            <Link href={`/artist/${track.artist.id}`} onClick={(e) => e.stopPropagation()} className={styles.metaLink}>
              {track.artist.name}
            </Link>
          ) : (
            track.artist.name
          )}
          {track.album?.title ? (
            <>
              {" · "}
              {track.album.id ? (
                <Link href={`/album/${track.album.id}`} onClick={(e) => e.stopPropagation()} className={styles.metaLink}>
                  {track.album.title}
                </Link>
              ) : (
                track.album.title
              )}
            </>
          ) : ""}
        </div>
      </div>

      <span className={styles.duration}>{formatDuration(track.duration)}</span>

      <div className={styles.actions}>
        <button
          className={`${styles.iconBtn} ${liked ? styles.liked : ""}`}
          onClick={handleLike}
          title={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {burstKey > 0 && Array.from({ length: PETAL_COUNT }).map((_, i) => (
            <span
              key={`${burstKey}-${i}`}
              className={styles.petal}
              style={{ "--rot": `${(360 / PETAL_COUNT) * i}deg` } as React.CSSProperties}
            />
          ))}
        </button>

        <button
          data-download-btn
          className={`${styles.iconBtn} ${offline ? styles.downloaded : ""}`}
          onClick={handleDownload}
          disabled={downloading}
          title={offline ? "Remove from offline" : "Download for offline"}
        >
          {downloading ? (
            <span className={styles.spinner} />
          ) : offline ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          )}
        </button>

        <button className={styles.iconBtn} onClick={openMenuFromButton} title="More options" aria-label="More options">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </button>
      </div>

      {menuPos && (
        <ContextMenu x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              handlePlay({ target: document.body } as any);
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
          >
            Play
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              addToQueue({
                id: track.id,
                title: track.title,
                artist: track.artist.name,
                artistId: track.artist.id,
                album: track.album?.title,
                albumId: track.album?.id,
                coverUrl: cover,
                audioUrl: track.audioUrl,
                duration: track.duration,
              });
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
          >
            Add to Queue
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              if (navigator.share) {
                navigator.share({ title: track.title, url: `${window.location.origin}/track/${track.id}` }).catch(() => {});
              } else {
                navigator.clipboard.writeText(`${window.location.origin}/track/${track.id}`);
              }
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>}
          >
            Share
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
