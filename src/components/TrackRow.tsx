"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePlayer } from "./PlayerContext";
import { isTrackDownloaded, saveTrackOffline, saveAudioBlob, removeOfflineTrack, getCachedUserId, getDeviceId } from "@/lib/offline-db";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import styles from "./TrackRow.module.css";

interface TrackRowProps {
  track: {
    id: string;
    title: string;
    artist: { name: string; id?: string };
    album?: { title: string; coverUrl?: string; id?: string } | null;
    coverUrl?: string;
    audioUrl?: string; // It could be undefined if it's an online track that needs downloading
    duration: number;
    source?: "library" | "deezer";
  };
  queue?: TrackRowProps["track"][];
  index?: number;
  showNumber?: boolean;
  dragHandle?: React.ReactNode;
  onRemove?: (trackId: string) => void;
  hidePlayButton?: boolean;
}

function CircularProgress({ progress, speed }: { progress: number; speed?: string }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className={styles.circularLoader}>
      <circle cx="14" cy="14" r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth="2" fill="none" />
      <circle 
        cx="14" cy="14" r={radius} 
        stroke="currentColor" strokeWidth="2" fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
        style={{ transition: "stroke-dashoffset 0.3s ease" }}
      />
      {speed && (
        <text 
          x="14" 
          y="16.5" 
          fill="currentColor" 
          fontSize="6px" 
          fontWeight="bold" 
          textAnchor="middle"
          style={{ letterSpacing: "-0.5px" }}
        >
          {speed.replace("/s", "")}
        </text>
      )}
    </svg>
  );
}

export function TrackRow({ track, queue, index, showNumber, dragHandle, onRemove, hidePlayButton }: TrackRowProps) {
  const { 
    currentTrack, 
    isPlaying, 
    play, 
    togglePlay, 
    addToQueue, 
    favoriteTrackIds, 
    toggleLikeTrack, 
    showToast,
    downloadStates,
    downloadProgress,
    downloadSpeed,
    addToDownloadQueue,
    removeFromDownloadQueue,
  } = usePlayer();
  const liked = favoriteTrackIds?.has(track.id) || false;
  const isActive =
    currentTrack?.id === track.id ||
    (currentTrack?.resolvedId && currentTrack.resolvedId === track.id) ||
    (currentTrack &&
      currentTrack.title.toLowerCase() === track.title.toLowerCase() &&
      currentTrack.artist.toLowerCase() === track.artist.name.toLowerCase());

  const [offline, setOffline] = useState(false);
  const [localDownloadState, setLocalDownloadState] = useState<"idle" | "telegram" | "device">("idle");
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [addPlaylistModalOpen, setAddPlaylistModalOpen] = useState(false);

  const cover = track.coverUrl || track.album?.coverUrl;

  const stateInQueue = downloadStates[track.id];
  const effectiveDownloadState = stateInQueue === "queued" ? "telegram" : stateInQueue === "downloading" ? "device" : localDownloadState;

  useEffect(() => {
    async function checkOffline() {
      try {
        const uId = getCachedUserId();
        const dId = getDeviceId();
        const cached = await isTrackDownloaded(track.id, uId, dId);
        setOffline(cached);
      } catch {}
    }
    checkOffline();
  }, [track.id, stateInQueue]);

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    
    if (isActive) {
      togglePlay();
      return;
    }

    if (effectiveDownloadState !== "idle") return; // Prevent double clicks during download

    const au = track.audioUrl || "";
    const isAudioUsable = au.startsWith("/api/stream/telegram/") && !au.endsWith("/0");

    // If it's already downloaded or has a valid audioUrl from library, just play
    if (offline || track.source === "library" || isAudioUsable) {
      playTrack(track.id, track.audioUrl!);
      return;
    }

    // Otherwise, we need to download/stream it
    setLocalDownloadState("telegram");
    try {
      // 1. Resolve Stream/Track URL
      const res = await fetch("/api/music/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist.name,
          duration: track.duration,
          albumId: track.album?.id
        }),
      });
      const data = await res.json();
      
      if (!data.id) throw new Error("No track ID returned");

      const newId = data.id;
      const newAudioUrl = data.audioUrl;
      const finalCoverUrl = data.coverUrl || cover;

      setLocalDownloadState("idle");

      // 2. Play the stream URL immediately
      playTrack(newId, newAudioUrl, finalCoverUrl);

      // 3. Queue download for offline storage in background
      addToDownloadQueue([{
        id: newId,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title,
        coverUrl: finalCoverUrl,
        audioUrl: newAudioUrl,
        duration: track.duration,
        albumId: track.album?.id,
      }], true); // Boost priority because they are playing it
    } catch (err) {
      console.error("Auto-download failed:", err);
      showToast("Download failed. Please try again.", "error");
      // BUG-4 FIX: Clear the queued state from the download queue so the
      // spinner resets and the user can retry by tapping again. Without this,
      // stateInQueue stays "queued" and effectiveDownloadState stays "telegram",
      // making the row show an infinite spinner with no way to retry.
      removeFromDownloadQueue(track.id);
      setLocalDownloadState("idle");
    }
  }

  function playTrack(actualId: string, actualAudioUrl: string, actualCover?: string) {
    const q = queue?.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      artistId: t.artist.id,
      album: t.album?.title,
      albumId: t.album?.id,
      coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
      audioUrl: t.audioUrl || "",
      duration: t.duration,
    }));
    play(
      {
        id: track.id,
        resolvedId: actualId !== track.id ? actualId : undefined,
        title: track.title,
        artist: track.artist.name,
        artistId: track.artist.id,
        album: track.album?.title,
        albumId: track.album?.id,
        coverUrl: actualCover || cover,
        audioUrl: actualAudioUrl,
        duration: track.duration,
      },
      q,
      index
    );
  }

  async function handleRemoveOffline() {
    try {
      const uId = getCachedUserId();
      const dId = getDeviceId();
      await removeOfflineTrack(track.id, uId, dId);
      setOffline(false);
      showToast("Removed from device", "success");
    } catch {}
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

  const isDownloading = stateInQueue === "queued" || stateInQueue === "downloading";

  return (
    <div
      className={`${styles.root} ${isActive ? styles.active : ""} ${isDownloading ? styles.downloading : ""}`}
      onClick={handlePlay}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handlePlay(e as any); }}
    >
      {dragHandle}
      {showNumber && index !== undefined ? (
        <span className={`${styles.numberCell} ${isActive ? styles.numberActive : ""}`}>
          {isActive && isPlaying ? (
            <span className={styles.eq} aria-hidden="true"><span /><span /><span /></span>
          ) : isActive ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            index + 1
          )}
        </span>
      ) : null}
      {cover ? (
        <div className={styles.artWrap}>
          <img src={cover} alt="" className={styles.art} referrerPolicy="no-referrer" />
          {isActive && !showNumber && (
            <div className={styles.artOverlay}>
              {isPlaying ? (
                <span className={styles.eq} aria-hidden="true"><span /><span /><span /></span>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className={styles.info}>
        <div className={styles.titleRow}>
          <Link
            href={`/track/${track.id}`}
            onClick={(e) => e.stopPropagation()}
            className={`${styles.title} ${isActive ? styles.titleActive : ""}`}
          >
            {track.title}
          </Link>
          {liked && (
            <svg className={styles.likedIcon} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          )}
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

      <div className={styles.actions}>
        {track.duration > 0 && (
          <span className={styles.duration}>{formatDuration(track.duration)}</span>
        )}

        {!hidePlayButton && (
          <button
            className={styles.playBtn}
            onClick={handlePlay}
            title="Play"
            aria-label="Play"
          >
            {effectiveDownloadState === "telegram" ? (
              <CircularProgress progress={downloadProgress[track.id] ?? 30} speed={downloadSpeed[track.id]} />
            ) : effectiveDownloadState === "device" ? (
              <CircularProgress progress={downloadProgress[track.id] ?? 70} speed={downloadSpeed[track.id]} />
            ) : isActive && isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}

        {hidePlayButton && (effectiveDownloadState === "telegram" || effectiveDownloadState === "device") && (
          <CircularProgress 
            progress={downloadProgress[track.id] ?? (effectiveDownloadState === "telegram" ? 30 : 70)} 
            speed={downloadSpeed[track.id]} 
          />
        )}

        {onRemove && (
          <button
            data-no-drag
            className={styles.removeBtn}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onRemove(track.id);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
            }}
            title="Remove from queue"
            aria-label={`Remove ${track.title}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        <button className={styles.iconBtn} onClick={openMenuFromButton} title="More options" aria-label="More options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
      </div>

      {menuPos && (
        <ContextMenu x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              toggleLikeTrack(track.id);
            }}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            }
          >
            {liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              setAddPlaylistModalOpen(true);
            }}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            }
          >
            Add to Playlist
          </ContextMenuItem>
          {offline && (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                handleRemoveOffline();
              }}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>}
            >
              Remove from Device
            </ContextMenuItem>
          )}
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
                audioUrl: track.audioUrl || "",
                duration: track.duration,
              });
              showToast("Added to queue", "success");
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
          >
            Add to Queue
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              // Into the share studio, like every other track share. Sending a
              // bare /track/<id> URL gave the recipient no idea what the song
              // was until they opened it.
              //
              // Flattened on the way out: a row's `artist`/`album` are objects,
              // while the studio (and the card renderer) want plain strings.
              window.dispatchEvent(
                new CustomEvent("sakura:share", {
                  detail: {
                    track: {
                      id: track.id,
                      title: track.title,
                      artist: track.artist.name,
                      album: track.album?.title,
                      coverUrl: track.coverUrl ?? track.album?.coverUrl,
                      audioUrl: track.audioUrl,
                      duration: track.duration,
                    },
                  },
                })
              );
            }}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>}
          >
            Share
          </ContextMenuItem>
        </ContextMenu>
      )}

      <AddToPlaylistModal
        isOpen={addPlaylistModalOpen}
        onClose={() => setAddPlaylistModalOpen(false)}
        trackId={track.id}
      />
    </div>
  );
}
