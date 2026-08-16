"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { PlaylistModal } from "./PlaylistModal";
import { Sheet } from "./Sheet";
import { PlusIcon } from "./Icons";

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
  const [error, setError] = useState<string | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  /** Bumped by the retry button to re-run the fetch effect. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isOpen || showNewPlaylist) return;

    /*
     * Aborted on cleanup so a slow response from a sheet the user already
     * closed — or from a previous open — can't land on top of a newer one.
     * The fetch is inlined rather than called from a `fetchPlaylists()` helper
     * because that helper's first statement was `setLoading(true)`, a
     * synchronous setState in an effect body and a cascading render.
     */
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/playlists", { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        // The endpoint returns a bare array, not { items: [...] }.
        setPlaylists(Array.isArray(data) ? data : []);
        setError(null);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError("We couldn't load your playlists.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, showNewPlaylist, reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  async function handleAddToPlaylist(playlistId: string) {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });

      if (!res.ok) {
        if (res.status === 409) throw new Error("That song is already in this playlist.");
        throw new Error("We couldn't add that song. Try again.");
      }

      showToast("Added to playlist!", "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Something went wrong", "error");
    }
  }

  if (showNewPlaylist) {
    return (
      <PlaylistModal
        isOpen={true}
        onClose={() => setShowNewPlaylist(false)}
        onSuccess={(playlistId) => {
          handleAddToPlaylist(playlistId);
          setShowNewPlaylist(false);
        }}
        /* Straight to the naming form. Someone who tapped "New Playlist" while
           adding a song wants to name a playlist, not browse Spotify — landing
           them on the import sources would be a detour with a back button. */
        startAt="manual"
      />
    );
  }

  return (
    <Sheet open={isOpen} onClose={onClose} title="Add to Playlist" maxHeight="70dvh">
      <div className={styles.pickList}>
        {loading ? (
          <div className={styles.progressContainer}>
            <div className={styles.spinner} />
          </div>
        ) : error ? (
          /* A failed fetch used to log to the console and render an empty list,
             which reads as "you have no playlists" — the one message guaranteed
             to be wrong. */
          <div className={styles.pickEmpty}>
            <p>{error}</p>
            <button type="button" className={styles.retryBtn} onClick={retry}>
              Try again
            </button>
          </div>
        ) : playlists.length === 0 ? (
          <div className={styles.pickEmpty}>
            <p>No playlists yet. Create one below.</p>
          </div>
        ) : (
          playlists.map((p) => (
            <button
              key={p.id}
              className={`${styles.pickRow} pressable`}
              onClick={() => handleAddToPlaylist(p.id)}
            >
              <span className={styles.pickName}>{p.name}</span>
              <span className={styles.pickCount}>
                {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
              </span>
            </button>
          ))
        )}
      </div>

      <button
        className={`${styles.btn} ${styles.btnSubmit} ${styles.newPlaylistBtn} pressable`}
        onClick={() => setShowNewPlaylist(true)}
      >
        <PlusIcon size={18} />
        New Playlist
      </button>
    </Sheet>
  );
}
