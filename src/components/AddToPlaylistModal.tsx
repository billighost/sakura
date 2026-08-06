"use client";

import { useState, useEffect } from "react";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { PlaylistModal } from "./PlaylistModal";

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
}

interface Playlist {
  id: string;
  name: string;
  trackCount: number;
}

export function AddToPlaylistModal({ isOpen, onClose, trackId }: AddToPlaylistModalProps) {
  const { showToast } = usePlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);

  useEffect(() => {
    if (isOpen && !showNewPlaylist) {
      fetchPlaylists();
    }
  }, [isOpen, showNewPlaylist]);

  async function fetchPlaylists() {
    try {
      setLoading(true);
      const res = await fetch("/api/playlists");
      if (!res.ok) throw new Error("Failed to fetch playlists");
      const data = await res.json();
      setPlaylists(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddToPlaylist(playlistId: string) {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      
      if (!res.ok) {
        if (res.status === 409) throw new Error("Track already in playlist");
        throw new Error("Failed to add track");
      }
      
      showToast("Added to playlist!", "success");
      onClose();
    } catch (err: any) {
      showToast(err.message || "Something went wrong", "error");
    }
  }

  if (!isOpen) return null;

  if (showNewPlaylist) {
    return (
      <PlaylistModal 
        isOpen={true} 
        onClose={() => setShowNewPlaylist(false)} 
        onSuccess={(playlistId) => {
          handleAddToPlaylist(playlistId);
          setShowNewPlaylist(false);
        }}
      />
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Add to Playlist</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.inputGroup} style={{ maxHeight: "300px", overflowY: "auto", margin: "8px 0" }}>
          {loading ? (
            <div className={styles.progressContainer}>
              <div className={styles.spinner} style={{ width: 20, height: 20 }} />
            </div>
          ) : playlists.length === 0 ? (
            <div className={styles.progressText} style={{ padding: "16px 0" }}>No playlists yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {playlists.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleAddToPlaylist(p.id)}
                  style={{
                    background: "var(--sakura-hover)",
                    border: "none",
                    padding: "12px 16px",
                    borderRadius: "12px",
                    color: "var(--sakura-text)",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = "var(--sakura-border)"}
                  onMouseOut={(e) => e.currentTarget.style.background = "var(--sakura-hover)"}
                >
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  <span style={{ fontSize: "12px", color: "var(--sakura-text-secondary)" }}>{p.trackCount} tracks</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button 
          className={`${styles.btn} ${styles.btnSubmit}`} 
          onClick={() => setShowNewPlaylist(true)}
          style={{ width: "100%", marginTop: "8px" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Playlist
        </button>
      </div>
    </div>
  );
}
