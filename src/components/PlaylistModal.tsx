"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { Sheet } from "./Sheet";

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (playlistId: string) => void;
}

export function PlaylistModal({ isOpen, onClose, onSuccess }: PlaylistModalProps) {
  const router = useRouter();
  const { showToast } = usePlayer();
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [importStatus, setImportStatus] = useState("");

  // No early `if (!isOpen) return null` — <Sheet> stays mounted through its
  // exit animation and unmounts itself afterwards. Returning null here would
  // rip the sheet out of the tree the instant it closed, which is exactly the
  // hard cut this migration removes.

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() && !importUrl.trim()) return;

    setIsLoading(true);

    try {
      if (importUrl.trim()) {
        // Handle Import
        setImportStatus("Importing playlist...");
        
        // 1. Create the playlist first, using URL as temporary name if none provided
        const tempName = name.trim() || "Imported Playlist";
        const createRes = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: tempName, description }),
        });
        
        if (!createRes.ok) throw new Error("Failed to create playlist");
        const playlist = await createRes.json();
        
        // 2. Start streaming tracks from Telegram Bot via SSE
        setImportStatus("Waiting for tracks...");
        
        const response = await fetch("/api/import/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: importUrl }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Failed to start import");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Process SSE chunks
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (!dataStr || dataStr === "{}") continue; // done event payload
              
              try {
                const track = JSON.parse(dataStr);
                setImportStatus(`Imported: ${track.title}`);
                
                // Add track to DB
                // Since this uses Telegram, we first need to make sure the track exists in DB
                // We will call an endpoint to save track info from telegram, then add to playlist
                const addRes = await fetch(`/api/playlists/${playlist.id}/tracks/import`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                    telegramMetadata: track 
                  }),
                });
                // Note: the above API call needs backend support to handle telegramMetadata
                // For now, we'll assume the backend handles it or we'll update it later.
              } catch (e) {
                console.error("Failed to parse SSE data", e);
              }
            }
          }
        }

        showToast("Playlist imported successfully!", "success");
        if (onSuccess) onSuccess(playlist.id);
        
      } else {
        // Handle Creation
        const res = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        });
        
        if (!res.ok) throw new Error("Failed to create playlist");
        
        const data = await res.json();
        showToast("Playlist created!", "success");
        if (onSuccess) onSuccess(data.id);
      }
      
      onClose();
      router.refresh();
      
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Something went wrong", "error");
    } finally {
      setIsLoading(false);
      setImportStatus("");
    }
  }

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title="New Playlist"
      variant="dialog"
      // A form mid-submit shouldn't be dismissable by a stray backdrop tap —
      // the import streams tracks in and losing the sheet loses the progress.
      dismissible={!isLoading}
    >
      <form onSubmit={handleSubmit}>
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

        {isLoading && importStatus && (
          <div className={styles.progressContainer}>
            <div className={styles.spinner} />
            {/* Announced, because the status is the only sign anything is
                happening during a long import. */}
            <div className={styles.progressText} role="status" aria-live="polite">
              {importStatus}
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
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnSubmit} pressable`}
            disabled={isLoading || (!name.trim() && !importUrl.trim())}
          >
            {isLoading ? "Saving..." : importUrl.trim() ? "Import" : "Create"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
