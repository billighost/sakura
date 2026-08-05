"use client";

import { useState, useEffect } from "react";
import { usePlayer } from "./PlayerContext";

interface TrackRowProps {
  track: {
    id: string;
    title: string;
    artist: { name: string };
    album?: { title: string; coverUrl?: string } | null;
    coverUrl?: string;
    audioUrl: string;
    duration: number;
  };
  queue?: TrackRowProps["track"][];
  index?: number;
  showNumber?: boolean;
}

export function TrackRow({ track, queue, index, showNumber }: TrackRowProps) {
  const { currentTrack, isPlaying, play, togglePlay } = usePlayer();
  const isActive = currentTrack?.id === track.id;
  const [offline, setOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const cover = track.coverUrl || track.album?.coverUrl;

  useEffect(() => {
    checkOffline();
  }, [track.id]);

  async function checkOffline() {
    try {
      const db = await openDB();
      const tx = db.transaction("tracks", "readonly");
      const stored = await tx.store.get(track.id);
      setOffline(!!stored);
    } catch {}
  }

  async function openDB() {
    const { openDB: idbOpen } = await import("idb");
    return idbOpen("sakura-offline", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("audio")) {
          db.createObjectStore("audio", { keyPath: "id" });
        }
      },
    });
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (offline) {
      try {
        const db = await openDB();
        await db.delete("tracks", track.id);
        await db.delete("audio", track.id);
        setOffline(false);
      } catch {}
      return;
    }

    setDownloading(true);
    try {
      const res = await fetch(track.audioUrl);
      const blob = await res.blob();

      const db = await openDB();
      await db.put("tracks", {
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title,
        coverUrl: cover,
        duration: track.duration,
        audioUrl: track.audioUrl,
        savedAt: Date.now(),
      });
      await db.put("audio", { id: track.id, blob });
      setOffline(true);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
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
        album: t.album?.title,
        coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
        audioUrl: t.audioUrl,
        duration: t.duration,
      }));
      play(
        {
          id: track.id,
          title: track.title,
          artist: track.artist.name,
          album: track.album?.title,
          coverUrl: cover,
          audioUrl: track.audioUrl,
          duration: track.duration,
        },
        q
      );
    }
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      onClick={handlePlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handlePlay(e as any); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "clamp(0.5rem, 2vw, 0.75rem)",
        width: "100%",
        padding: "clamp(0.5rem, 2vw, 0.625rem) clamp(0.5rem, 2vw, 0.75rem)",
        borderRadius: "12px",
        border: "none",
        background: isActive ? "var(--sakura-active)" : "transparent",
        color: "var(--sakura-text)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s",
      }}
    >
      {showNumber && index !== undefined ? (
        <span style={{ fontSize: "0.8125rem", color: "var(--sakura-text-secondary)", width: "clamp(1.25rem, 4vw, 1.5rem)", textAlign: "center", flexShrink: 0 }}>
          {isActive ? "♫" : index + 1}
        </span>
      ) : cover ? (
        <img
          src={cover}
          alt=""
          style={{
            width: "clamp(2.5rem, 8vw, 3rem)",
            height: "clamp(2.5rem, 8vw, 3rem)",
            borderRadius: "8px",
            objectFit: "cover",
            background: "var(--sakura-skeleton)",
            flexShrink: 0,
          }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "0.875rem",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: isActive ? "var(--sakura-accent)" : undefined,
        }}>
          {track.title}
        </div>
        <div style={{
          fontSize: "0.75rem",
          color: "var(--sakura-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginTop: "1px",
        }}>
          {track.artist.name}
          {track.album?.title ? ` · ${track.album.title}` : ""}
        </div>
      </div>
      <span style={{ fontSize: "0.75rem", color: "var(--sakura-text-secondary)", flexShrink: 0 }}>
        {formatDuration(track.duration)}
      </span>
      <button
        data-download-btn
        onClick={handleDownload}
        disabled={downloading}
        title={offline ? "Remove from offline" : "Download for offline"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "clamp(1.75rem, 5vw, 2rem)",
          height: "clamp(1.75rem, 5vw, 2rem)",
          borderRadius: "6px",
          border: "none",
          background: offline ? "var(--sakura-accent)" : "transparent",
          color: offline ? "white" : "var(--sakura-text-secondary)",
          cursor: downloading ? "wait" : "pointer",
          flexShrink: 0,
          transition: "all 0.15s",
        }}
      >
        {downloading ? (
          <span style={{ width: "0.75rem", height: "0.75rem", border: "2px solid var(--sakura-text-secondary)", borderTopColor: "var(--sakura-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        ) : offline ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        )}
      </button>
    </div>
  );
}
