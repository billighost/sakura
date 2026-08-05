"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

interface ImportedTrack {
  title: string;
  artist: string;
  duration: number;
  messageId: number;
  albumArt?: string;
  status?: "pending" | "saved" | "exists" | "error";
  selected?: boolean;
}

interface ImportHistoryItem {
  url: string;
  timestamp: number;
  trackCount: number;
  title?: string;
  platform?: "spotify" | "deezer";
}

type ImportStep = "paste" | "preview" | "importing" | "done";

const STEPS: { key: ImportStep; label: string }[] = [
  { key: "paste", label: "Paste URL" },
  { key: "preview", label: "Preview" },
  { key: "importing", label: "Import" },
  { key: "done", label: "Done" },
];

function getPlatform(url: string): "spotify" | "deezer" | null {
  if (/open\.spotify\.com/i.test(url) || /spotify\.com/i.test(url)) return "spotify";
  if (/deezer\.com/i.test(url)) return "deezer";
  return null;
}

function isValidUrl(url: string): boolean {
  const platform = getPlatform(url);
  if (platform === "spotify") return /open\.spotify\.com\/(track|playlist|album)\//i.test(url);
  if (platform === "deezer") return /deezer\.com\/(track|playlist|album)\//i.test(url);
  return /^https?:\/\/.+/i.test(url);
}

function getPlatformName(url: string): string {
  const p = getPlatform(url);
  if (p === "spotify") return "Spotify";
  if (p === "deezer") return "Deezer";
  return "Unknown";
}

function formatDurationShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<ImportStep>("paste");
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sakura-import-history");
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    if (tracks.length > 0 && currentStep === "preview") return;
    if (importing) setCurrentStep("importing");
    if (tracks.length > 0 && !importing && currentStep === "importing") setCurrentStep("preview");
  }, [importing, tracks.length, currentStep]);

  const detectClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && isValidUrl(text.trim())) {
        setUrl(text.trim());
      }
    } catch {}
  }, []);

  useEffect(() => {
    detectClipboard();
  }, [detectClipboard]);

  const urlValid = url.trim().length > 0 && isValidUrl(url.trim());
  const platform = getPlatform(url);

  function addHistory(urlStr: string, count: number) {
    const item: ImportHistoryItem = {
      url: urlStr,
      timestamp: Date.now(),
      trackCount: count,
      platform: getPlatform(urlStr) || undefined,
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
        setError(data.error || "Failed to import. Check the URL and try again.");
        setCurrentStep("paste");
        return;
      }

      const newTracks = data.tracks.map((t: ImportedTrack) => ({ ...t, status: "pending" as const, selected: true }));
      setTracks(newTracks);
      addHistory(url.trim(), newTracks.length);
      setProgress(100);
      setCurrentStep("preview");
    } catch {
      setError("Could not connect to the import service. Please try again.");
      setCurrentStep("paste");
    } finally {
      clearInterval(progressInterval);
      setImporting(false);
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    setProgress(0);
    setCurrentStep("importing");
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
          prev.map((t) => {
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
      setCurrentStep("done");
    } catch {
      setError("Failed to save tracks to your library. Please try again.");
      setCurrentStep("preview");
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
    setCurrentStep("paste");
    setProgress(0);
    setError("");
  }

  const pendingCount = tracks.filter((t) => t.selected && t.status === "pending").length;
  const savedCount = tracks.filter((t) => t.status === "saved" || t.status === "exists").length;
  const errorCount = tracks.filter((t) => t.status === "error").length;

  return (
    <div className={styles.page}>
      <div className={styles.heroSection}>
        <h1 className={styles.title}>Import Music</h1>
        <p className={styles.subtitle}>
          Import your playlists and tracks from Spotify or Deezer
        </p>
      </div>

      <div className={styles.stepIndicator}>
        {STEPS.map((step, i) => (
          <div key={step.key} className={styles.stepItem}>
            <div
              className={`${styles.stepCircle} ${
                currentStep === step.key
                  ? styles.stepActive
                  : STEPS.findIndex((s) => s.key === currentStep) > i
                  ? styles.stepComplete
                  : ""
              }`}
            >
              {STEPS.findIndex((s) => s.key === currentStep) > i ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            <span className={`${styles.stepLabel} ${currentStep === step.key ? styles.stepLabelActive : ""}`}>
              {step.label}
            </span>
            {i < STEPS.length - 1 && <div className={styles.stepLine} />}
          </div>
        ))}
      </div>

      <div className={styles.inputGroup}>
        <div className={styles.inputWrapper}>
          {platform && (
            <div className={styles.platformBadge}>
              {platform === "spotify" ? (
                <svg viewBox="0 0 24 24" fill="#1DB954" width="14" height="14">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="#A238FF" width="14" height="14">
                  <path d="M12.012 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm4.095 13.04c-.18.29-.56.39-.86.2-2.36-1.44-5.34-1.77-8.85-.97-.34.08-.68-.14-.76-.48-.08-.34.14-.68.48-.76 3.86-.88 7.15-.51 9.8 1.11.3.18.39.56.19.9zm1.08-2.42c-.22.36-.7.48-1.06.24-2.7-1.66-6.82-2.14-10.02-1.17-.4.12-.82-.1-.94-.5-.12-.4.1-.82.5-.94 3.68-1.12 8.23-.59 11.38 1.34.36.22.48.7.26 1.03zm.1-2.54c-3.24-1.92-8.56-2.1-11.66-1.16-.48.14-1-.12-1.14-.6-.14-.48.12-1 .6-1.14 3.6-1.1 9.52-.9 13.32 1.36.44.26.58.84.32 1.28-.26.42-.84.56-1.26.32z" />
                </svg>
              )}
            </div>
          )}
          <input
            className={`${styles.urlInput} ${urlValid ? styles.urlValid : url.trim() && !urlValid ? styles.urlInvalid : ""}`}
            type="url"
            placeholder="Paste a Spotify or Deezer URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && urlValid && handleImport()}
          />
          {url.trim() && (
            <div className={styles.urlIndicator}>
              {urlValid ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sakura-success)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sakura-danger)" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
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
          {importing ? (
            <span className={styles.btnSpinner} />
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Import
            </>
          )}
        </button>
      </div>

      {importing && (
        <div className={styles.progressSection}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
          <div className={styles.progressText}>Fetching tracks...</div>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{error}</span>
          <button className={styles.errorDismiss} onClick={() => setError("")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {tracks.length > 0 && (
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            <label className={styles.selectAll}>
              <input
                type="checkbox"
                checked={tracks.every((t) => t.selected)}
                onChange={toggleSelectAll}
              />
              <span>{tracks.length} tracks found</span>
            </label>
            <div className={styles.resultsBadges}>
              {savedCount > 0 && <span className={styles.savedBadge}>{savedCount} saved</span>}
              {errorCount > 0 && <span className={styles.errorBadge}>{errorCount} failed</span>}
            </div>
          </div>

          {saving && (
            <div className={styles.progressSection}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${Math.min(progress, 100)}%` }} />
              </div>
              <div className={styles.progressText}>
                Saving {Math.round(progress)}% complete...
              </div>
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
                <span className={styles.trackDuration}>
                  {track.duration > 0 ? formatDurationShort(track.duration) : ""}
                </span>
                <div className={styles.trackStatus}>
                  {track.status === "pending" && (
                    <div className={`${styles.statusDot} ${styles.statusPending}`} title="Ready to save" />
                  )}
                  {track.status === "saved" && (
                    <div className={`${styles.statusDot} ${styles.statusSaved}`} title="Saved" />
                  )}
                  {track.status === "exists" && (
                    <div className={`${styles.statusDot} ${styles.statusExists}`} title="Already in library" />
                  )}
                  {track.status === "error" && (
                    <div className={`${styles.statusDot} ${styles.statusError}`} title="Failed to save" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {pendingCount > 0 && currentStep !== "done" && (
            <button
              className={styles.saveBtn}
              onClick={handleSaveAll}
              disabled={saving}
            >
              {saving ? (
                <span className={styles.btnSpinner} />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="16" height="16">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save {pendingCount} tracks to library
                </>
              )}
            </button>
          )}

          {currentStep === "done" && (
            <div className={styles.doneSection}>
              <div className={styles.doneIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-success)" strokeWidth={2.5} width="32" height="32">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className={styles.doneText}>
                {savedCount} track{savedCount !== 1 ? "s" : ""} added to your library
              </div>
              <button className={styles.importAnotherBtn} onClick={handleImportAnother}>
                Import Another Playlist
              </button>
            </div>
          )}
        </div>
      )}

      {tracks.length === 0 && !importing && (
        <>
          <div className={styles.platformsSection}>
            <div className={styles.platformCard}>
              <svg viewBox="0 0 24 24" fill="#1DB954" width="24" height="24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <div className={styles.platformInfo}>
                <div className={styles.platformName}>Spotify</div>
                <div className={styles.platformDesc}>Tracks & playlists</div>
              </div>
            </div>
            <div className={styles.platformCard}>
              <svg viewBox="0 0 24 24" fill="#A238FF" width="24" height="24">
                <path d="M12.012 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm4.095 13.04c-.18.29-.56.39-.86.2-2.36-1.44-5.34-1.77-8.85-.97-.34.08-.68-.14-.76-.48-.08-.34.14-.68.48-.76 3.86-.88 7.15-.51 9.8 1.11.3.18.39.56.19.9zm1.08-2.42c-.22.36-.7.48-1.06.24-2.7-1.66-6.82-2.14-10.02-1.17-.4.12-.82-.1-.94-.5-.12-.4.1-.82.5-.94 3.68-1.12 8.23-.59 11.38 1.34.36.22.48.7.26 1.03zm.1-2.54c-3.24-1.92-8.56-2.1-11.66-1.16-.48.14-1-.12-1.14-.6-.14-.48.12-1 .6-1.14 3.6-1.1 9.52-.9 13.32 1.36.44.26.58.84.32 1.28-.26.42-.84.56-1.26.32z" />
              </svg>
              <div className={styles.platformInfo}>
                <div className={styles.platformName}>Deezer</div>
                <div className={styles.platformDesc}>Tracks & playlists</div>
              </div>
            </div>
          </div>

          {history.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.historyHeader}>
                <div className={styles.historyTitle}>Recent Imports</div>
                <button
                  className={styles.historyClear}
                  onClick={() => { setHistory([]); localStorage.removeItem("sakura-import-history"); }}
                >
                  Clear
                </button>
              </div>
              {history.slice(0, 5).map((item, i) => (
                <button
                  key={i}
                  className={styles.historyItem}
                  onClick={() => setUrl(item.url)}
                >
                  <div className={styles.historyIcon}>
                    {item.platform === "spotify" ? (
                      <svg viewBox="0 0 24 24" fill="#1DB954" width="16" height="16">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                    ) : item.platform === "deezer" ? (
                      <svg viewBox="0 0 24 24" fill="#A238FF" width="16" height="16">
                        <path d="M12.012 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm4.095 13.04c-.18.29-.56.39-.86.2-2.36-1.44-5.34-1.77-8.85-.97-.34.08-.68-.14-.76-.48-.08-.34.14-.68.48-.76 3.86-.88 7.15-.51 9.8 1.11.3.18.39.56.19.9zm1.08-2.42c-.22.36-.7.48-1.06.24-2.7-1.66-6.82-2.14-10.02-1.17-.4.12-.82-.1-.94-.5-.12-.4.1-.82.5-.94 3.68-1.12 8.23-.59 11.38 1.34.36.22.48.7.26 1.03zm.1-2.54c-3.24-1.92-8.56-2.1-11.66-1.16-.48.14-1-.12-1.14-.6-.14-.48.12-1 .6-1.14 3.6-1.1 9.52-.9 13.32 1.36.44.26.58.84.32 1.28-.26.42-.84.56-1.26.32z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth="1.5" width="16" height="16">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 12h8M12 8v8" />
                      </svg>
                    )}
                  </div>
                  <div className={styles.historyContent}>
                    <div className={styles.historyUrl}>{item.url}</div>
                    <div className={styles.historyMeta}>
                      {item.trackCount} tracks · {new Date(item.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth="2" width="14" height="14">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          )}

          <div className={styles.tipsSection}>
            <div className={styles.tipsTitle}>How to import</div>
            <div className={styles.tipItem}>
              <div className={styles.tipNumber}>1</div>
              <div className={styles.tipText}>Open Spotify or Deezer and copy a track, album, or playlist URL</div>
            </div>
            <div className={styles.tipItem}>
              <div className={styles.tipNumber}>2</div>
              <div className={styles.tipText}>Paste the URL above and tap Import to preview the tracks</div>
            </div>
            <div className={styles.tipItem}>
              <div className={styles.tipNumber}>3</div>
              <div className={styles.tipText}>Select which tracks to save and add them to your library</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
