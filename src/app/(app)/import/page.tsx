"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

interface ImportedTrack {
  title: string;
  artist: string;
  duration: number;
  messageId: number;
  status?: "pending" | "saved" | "exists" | "error";
  selected?: boolean;
}

interface ImportHistoryItem {
  url: string;
  timestamp: number;
  trackCount: number;
}

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importComplete, setImportComplete] = useState(false);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sakura-import-history");
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
  }, []);

  const urlValid = url.trim().length > 0 && /^https?:\/\//i.test(url.trim());

  function addHistory(urlStr: string, count: number) {
    const item: ImportHistoryItem = {
      url: urlStr,
      timestamp: Date.now(),
      trackCount: count,
    };
    const updated = [item, ...history.filter((h) => h.url !== urlStr)].slice(0, 20);
    setHistory(updated);
    localStorage.setItem("sakura-import-history", JSON.stringify(updated));
  }

  async function handleImport() {
    if (!url.trim()) return;
    setImporting(true);
    setError("");
    setTracks([]);
    setProgress(0);
    setImportComplete(false);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 10;
      });
    }, 300);

    try {
      const res = await fetch("/api/import/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      const newTracks = data.tracks.map((t: ImportedTrack) => ({ ...t, status: "pending" as const, selected: true }));
      setTracks(newTracks);
      addHistory(url.trim(), newTracks.length);
      setProgress(100);
    } catch {
      setError("Failed to connect to import service");
    } finally {
      clearInterval(progressInterval);
      setImporting(false);
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    setProgress(0);
    const selectedTracks = tracks.filter((t) => t.selected && t.status === "pending");
    const total = selectedTracks.length;

    try {
      const res = await fetch("/api/import/spotify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: tracks
            .filter((t) => t.selected)
            .map((t) => ({
              title: t.title,
              artist: t.artist,
              duration: t.duration,
              messageId: t.messageId,
            })),
        }),
      });
      const data = await res.json();

      if (data.results) {
        let completed = 0;
        setTracks((prev) =>
          prev.map((t, i) => {
            if (!t.selected) return t;
            const result = data.results.find((r: { messageId: number }) => r.messageId === t.messageId);
            if (result) {
              completed++;
              setProgress(Math.round((completed / total) * 100));
              return { ...t, status: result.status || "error" };
            }
            return t;
          })
        );
      }
      setImportComplete(true);
    } catch {
      setError("Failed to save tracks");
    } finally {
      setSaving(false);
    }
  }

  function toggleTrack(index: number) {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, selected: !t.selected } : t))
    );
  }

  function toggleSelectAll() {
    const allSelected = tracks.every((t) => t.selected);
    setTracks((prev) => prev.map((t) => ({ ...t, selected: !allSelected })));
  }

  function handlePaste() {
    navigator.clipboard.readText().then((text) => {
      if (text) setUrl(text.trim());
    }).catch(() => {});
  }

  function handleImportAnother() {
    setUrl("");
    setTracks([]);
    setImportComplete(false);
    setProgress(0);
    setError("");
  }

  const pendingCount = tracks.filter((t) => t.selected && t.status === "pending").length;
  const savedCount = tracks.filter((t) => t.status === "saved" || t.status === "exists").length;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Import Music</h1>
      <p className={styles.subtitle}>
        Paste a Spotify or Deezer track or playlist URL
      </p>

      <div className={styles.inputGroup}>
        <div className={styles.inputWrapper}>
          <input
            className={`${styles.urlInput} ${urlValid ? styles.urlValid : url.trim() ? styles.urlInvalid : ""}`}
            type="url"
            placeholder="https://open.spotify.com/playlist/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleImport()}
          />
          {url.trim() && (
            <div className={styles.urlIndicator}>
              {urlValid ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              )}
            </div>
          )}
          <button className={styles.pasteBtn} onClick={handlePaste} title="Paste from clipboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        </div>
        <button
          className={styles.importBtn}
          onClick={handleImport}
          disabled={importing || !url.trim()}
        >
          {importing ? "Importing..." : "Import"}
        </button>
      </div>

      {importing && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {tracks.length > 0 && (
        <div className={styles.results}>
          <div className={styles.header}>
            <label className={styles.selectAll}>
              <input
                type="checkbox"
                checked={tracks.every((t) => t.selected)}
                onChange={toggleSelectAll}
              />
              <span>{tracks.length} tracks found</span>
            </label>
            {savedCount > 0 && (
              <span className={styles.savedBadge}>{savedCount} saved</span>
            )}
          </div>

          {saving && (
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}

          <div className={styles.trackList}>
            {tracks.map((track, i) => (
              <div
                key={i}
                className={`${styles.trackItem} ${styles[track.status || "pending"]}`}
              >
                <label className={styles.trackCheck}>
                  <input
                    type="checkbox"
                    checked={track.selected}
                    onChange={() => toggleTrack(i)}
                    disabled={track.status === "saved" || track.status === "exists"}
                  />
                </label>
                <div className={styles.trackInfo}>
                  <div className={styles.trackTitle}>{track.title}</div>
                  <div className={styles.trackArtist}>{track.artist}</div>
                </div>
                <div className={styles.trackStatus}>
                  {track.status === "pending" && "⏳"}
                  {track.status === "saved" && "✅"}
                  {track.status === "exists" && "📋"}
                  {track.status === "error" && "❌"}
                </div>
              </div>
            ))}
          </div>

          {pendingCount > 0 && !importComplete && (
            <button
              className={styles.saveBtn}
              onClick={handleSaveAll}
              disabled={saving}
            >
              {saving ? "Saving..." : `Save ${pendingCount} tracks to library`}
            </button>
          )}

          {importComplete && (
            <button
              className={styles.saveBtn}
              onClick={handleImportAnother}
            >
              Import Another
            </button>
          )}
        </div>
      )}

      {tracks.length === 0 && !importing && (
        <>
          {history.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.historyTitle}>Recent Imports</div>
              {history.slice(0, 5).map((item, i) => (
                <button
                  key={i}
                  className={styles.historyItem}
                  onClick={() => setUrl(item.url)}
                >
                  <div className={styles.historyUrl}>{item.url}</div>
                  <div className={styles.historyMeta}>
                    {item.trackCount} tracks · {new Date(item.timestamp).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className={styles.examples}>
            <p className={styles.examplesTitle}>Supported URLs:</p>
            <ul className={styles.examplesList}>
              <li>Spotify track: open.spotify.com/track/...</li>
              <li>Spotify playlist: open.spotify.com/playlist/...</li>
              <li>Deezer track: deezer.com/track/...</li>
              <li>Deezer playlist: deezer.com/playlist/...</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
