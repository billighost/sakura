"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { Sheet } from "./Sheet";

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (playlistId: string) => void;
}

interface PreviewTrack {
  title: string;
  artist: string;
  duration: number;
  coverUrl: string;
  id: string; // generated client-side for keyed mapping
}

export function PlaylistModal({ isOpen, onClose, onSuccess }: PlaylistModalProps) {
  const router = useRouter();
  const { showToast } = usePlayer();
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  
  const [step, setStep] = useState<"input" | "preview">("input");
  const [previewTracks, setPreviewTracks] = useState<PreviewTrack[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [removedTrack, setRemovedTrack] = useState<{ track: PreviewTrack, index: number } | null>(null);

  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setStep("input");
        setPreviewTracks([]);
        setRemovedTrack(null);
        setName("");
        setDescription("");
        setImportUrl("");
      }, 300);
    }
  }, [isOpen]);

  async function handleFetchPreview() {
    if (!importUrl.trim()) return;
    setIsLoading(true);
    setStatus("Fetching playlist details...");

    try {
      const res = await fetch("/api/import/spotify/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch playlist");

      const tracksWithIds = data.tracks.map((t: any) => ({
        ...t,
        id: Math.random().toString(36).substring(7),
      }));

      setPreviewTracks(tracksWithIds);
      setPlaylistName(data.name || "Imported Playlist");
      setStep("preview");
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  }

  function handleRemoveTrack(index: number) {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    const track = previewTracks[index];
    setRemovedTrack({ track, index });
    
    setPreviewTracks(prev => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });

    undoTimeoutRef.current = setTimeout(() => {
      setRemovedTrack(null);
    }, 5000);
  }

  function handleUndoRemove() {
    if (removedTrack) {
      setPreviewTracks(prev => {
        const copy = [...prev];
        copy.splice(removedTrack.index, 0, removedTrack.track);
        return copy;
      });
      setRemovedTrack(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    }
  }

  async function handleConfirmImport() {
    setIsLoading(true);
    setStatus("Creating playlist...");
    
    try {
      const finalName = name.trim() || playlistName || "Imported Playlist";
      
      const createRes = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, description }),
      });
      
      if (!createRes.ok) throw new Error("Failed to create playlist");
      const playlist = await createRes.json();
      
      setStatus("Saving tracks...");
      
      const batchRes = await fetch(`/api/playlists/${playlist.id}/tracks/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: previewTracks }),
      });
      
      if (!batchRes.ok) throw new Error("Failed to save tracks");

      showToast(`Imported ${previewTracks.length} tracks successfully!`, "success");
      if (onSuccess) onSuccess(playlist.id);
      
      onClose();
      router.refresh();
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  }

  async function handleCreateEmpty(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      
      if (!res.ok) throw new Error("Failed to create playlist");
      
      const data = await res.json();
      showToast("Playlist created!", "success");
      if (onSuccess) onSuccess(data.id);
      
      onClose();
      router.refresh();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Something went wrong", "error");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title={step === "preview" ? "Preview Playlist" : "New Playlist"}
      variant="dialog"
      dismissible={!isLoading}
    >
      {step === "input" ? (
        <form onSubmit={handleCreateEmpty}>
          <div className={styles.inputGroup}>
            <label htmlFor="playlist-name" className={styles.label}>Name</label>
            <input
              id="playlist-name"
              className={styles.input}
              placeholder="My Awesome Playlist"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className={styles.inputGroup} style={{ marginTop: 12 }}>
            <label htmlFor="playlist-desc" className={styles.label}>Description (optional)</label>
            <textarea
              id="playlist-desc"
              className={`${styles.input} ${styles.textarea}`}
              placeholder="A brief description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className={styles.divider} style={{ margin: "20px 0" }}>OR</div>

          <div className={styles.inputGroup}>
            <label htmlFor="playlist-import" className={styles.label}>Import Public Spotify Playlist</label>
            <input
              id="playlist-import"
              className={styles.input}
              placeholder="https://open.spotify.com/playlist/..."
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {isLoading && status && (
            <div className={styles.progressContainer}>
              <div className={styles.spinner} />
              <div className={styles.progressText} role="status" aria-live="polite">
                {status}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            {importUrl.trim() ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSubmit} pressable`}
                onClick={handleFetchPreview}
                disabled={isLoading}
              >
                Preview
              </button>
            ) : (
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnSubmit} pressable`}
                disabled={isLoading || !name.trim()}
              >
                Create
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className={styles.previewContainer}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>{playlistName}</h3>
            <span className={styles.previewCount}>{previewTracks.length} tracks</span>
          </div>
          
          <div className={styles.trackList}>
            {previewTracks.map((track, i) => (
              <div key={track.id} className={styles.trackRow}>
                {track.coverUrl ? (
                  <img src={track.coverUrl} className={styles.trackCover} alt="" />
                ) : (
                  <div className={styles.trackCoverPlaceholder} />
                )}
                <div className={styles.trackInfo}>
                  <div className={styles.trackTitle}>{track.title}</div>
                  <div className={styles.trackArtist}>{track.artist}</div>
                </div>
                <button 
                  className={styles.removeBtn}
                  onClick={() => handleRemoveTrack(i)}
                  title="Remove track"
                  disabled={isLoading}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {removedTrack && (
            <div className={styles.undoToast}>
              <span>Removed "{removedTrack.track.title}"</span>
              <button onClick={handleUndoRemove} className={styles.undoBtn}>Undo</button>
            </div>
          )}

          {isLoading && status && (
            <div className={styles.progressContainer}>
              <div className={styles.spinner} />
              <div className={styles.progressText}>{status}</div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => setStep("input")}
              disabled={isLoading}
            >
              Back
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              onClick={handleConfirmImport}
              disabled={isLoading || previewTracks.length === 0}
            >
              Confirm Import
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
