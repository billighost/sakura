"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : new Date().toISOString().slice(0, 10);

declare const __BUILD_DATE__: string;

interface ThemeOption {
  id: string;
  name: string;
  icon: string;
  preview: string;
}

const themes: ThemeOption[] = [
  { id: "dark", name: "Dark", icon: "🌙", preview: "linear-gradient(135deg, #0E0B0F, #1A1620)" },
  { id: "light", name: "Light", icon: "☀️", preview: "linear-gradient(135deg, #FAF8FA, #FFFFFF)" },
  { id: "system", name: "System", icon: "💻", preview: "linear-gradient(135deg, #0E0B0F 50%, #FAF8FA 50%)" },
];

const audioQualities = [
  { id: "low", name: "Low", description: "96 kbps — Save bandwidth" },
  { id: "medium", name: "Medium", description: "160 kbps — Balanced" },
  { id: "high", name: "High", description: "320 kbps — Best quality" },
];

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState({
    theme: "dark",
    audioQuality: "high",
    crossfadeSeconds: 0,
    autoDownloadLiked: false,
  });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [storageUsed, setStorageUsed] = useState("0 MB");
  const [storageTotal, setStorageTotal] = useState("0 MB");
  const [clearingCache, setClearingCache] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "updated" | "latest">("idle");
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data) setSettings(data);
      });
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          setUsername(data.username || "");
          setEmail(data.email || "");
        }
      });
    estimateStorage();
  }, []);

  function estimateStorage() {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      navigator.storage.estimate().then((est) => {
        const used = est.usage || 0;
        const total = est.quota || 0;
        const usedMB = (used / (1024 * 1024)).toFixed(1);
        const totalGB = (total / (1024 * 1024 * 1024)).toFixed(1);
        setStorageUsed(`${usedMB} MB`);
        setStorageTotal(`${totalGB} GB`);
      });
    }
  }

  async function updateSettings(patch: Partial<typeof settings>) {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    setSaving(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);

    if (patch.theme) {
      document.documentElement.setAttribute("data-theme", patch.theme);
      localStorage.setItem("sakura-theme", patch.theme);
    }
  }

  async function clearCache() {
    setClearingCache(true);
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      localStorage.removeItem("sakura-cache");
      estimateStorage();
    } catch (err) {
      console.error("Cache clear failed:", err);
    } finally {
      setClearingCache(false);
    }
  }

  async function checkForUpdates() {
    setUpdateStatus("checking");
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.update();
        }
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      setUpdateStatus("updated");
      setTimeout(() => setUpdateStatus("latest"), 3000);
    } catch {
      setUpdateStatus("latest");
    }
  }

  return (
    <div className={styles.page} style={{ paddingTop: "4.5rem", position: "relative" }}>
      {/* Floating Glassmorphic Back Button */}
      <button
        onClick={() => router.back()}
        style={{
          position: "absolute",
          top: "1.25rem",
          left: "1.25rem",
          background: "rgba(0, 0, 0, 0.4)",
          border: "none",
          borderRadius: "50%",
          width: "2.5rem",
          height: "2.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          cursor: "pointer",
          backdropFilter: "blur(4px)",
          zIndex: 10,
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        }}
        aria-label="Go Back"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Appearance</h2>
        </div>
        <div className={styles.themeGrid}>
          {themes.map((theme) => (
            <button
              key={theme.id}
              className={`${styles.themeCard} ${settings.theme === theme.id ? styles.themeCardActive : ""}`}
              onClick={() => updateSettings({ theme: theme.id })}
            >
              <div className={styles.themePreview} style={{ background: theme.preview }} />
              <div className={styles.themeName}>{theme.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Playback</h2>
        </div>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Audio Quality</span>
            <select
              className={styles.select}
              value={settings.audioQuality}
              onChange={(e) => updateSettings({ audioQuality: e.target.value })}
            >
              {audioQualities.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.qualityInfo}>
            {audioQualities.find((q) => q.id === settings.audioQuality)?.description}
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Crossfade</span>
            <span className={styles.rowValue}>{settings.crossfadeSeconds}s</span>
          </div>
          <div className={styles.crossfadeVisual}>
            <div className={styles.crossfadeTrack}>
              <div className={styles.crossfadeFill} style={{ width: `${(settings.crossfadeSeconds / 12) * 100}%` }} />
            </div>
            <input
              className={styles.crossfadeSlider}
              type="range"
              min={0}
              max={12}
              step={1}
              value={settings.crossfadeSeconds}
              onChange={(e) => updateSettings({ crossfadeSeconds: Number(e.target.value) })}
            />
          </div>
          <div className={styles.crossfadeLabels}>
            <span>Off</span>
            <span>12s</span>
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Auto-download liked</span>
            <button
              className={`${styles.toggle} ${settings.autoDownloadLiked ? styles.toggleOn : ""}`}
              onClick={() => updateSettings({ autoDownloadLiked: !settings.autoDownloadLiked })}
            >
              <div className={`${styles.toggleKnob} ${settings.autoDownloadLiked ? styles.toggleKnobOn : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Storage</h2>
        </div>
        <div className={styles.group}>
          <div className={styles.storageBar}>
            <div className={styles.storageLabel}>
              <span>{storageUsed} used</span>
              <span>{storageTotal} available</span>
            </div>
            <div className={styles.storageTrack}>
              <div className={styles.storageFill} style={{ width: storageTotal !== "0 MB" ? `${(parseFloat(storageUsed) / parseFloat(storageTotal.replace(" GB", "")) * 100)}%` : "0%" }} />
            </div>
          </div>
          <button
            className={styles.row}
            onClick={clearCache}
            disabled={clearingCache}
          >
            <span className={styles.rowLabel}>Clear Cache</span>
            <span className={styles.rowAction}>
              {clearingCache ? (
                <div className={styles.spinner} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              )}
            </span>
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>What&apos;s New</h2>
        </div>
        <button className={styles.group} onClick={() => setWhatsNewOpen(!whatsNewOpen)}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Sakura v0.1.0</span>
            <span className={styles.rowAction}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: whatsNewOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
          {whatsNewOpen && (
            <div className={styles.whatsNewContent}>
              <ul className={styles.whatsNewList}>
                <li>Initial release of Sakura music library</li>
                <li>Telegram bot integration for music import</li>
                <li>Playlist management and organization</li>
                <li>Audio visualizations</li>
                <li>Dark and light theme support</li>
              </ul>
            </div>
          )}
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Help & Support</h2>
        </div>
        <div className={styles.group}>
          <a
            href="https://github.com/sakura-music/sakura/issues"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.row}
          >
            <span className={styles.rowLabel}>Report an Issue</span>
            <span className={styles.rowAction}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </span>
          </a>
          <a
            href="https://github.com/sakura-music/sakura/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.row}
          >
            <span className={styles.rowLabel}>Community Discussions</span>
            <span className={styles.rowAction}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </span>
          </a>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Links</h2>
        </div>
        <div className={styles.group}>
          <Link href="/about" className={styles.row}>
            <div className={styles.rowLabelWithIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              About
            </div>
            <span className={styles.rowAction}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
            </span>
          </Link>
          <Link href="/terms" className={styles.row}>
            <div className={styles.rowLabelWithIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Terms of Service
            </div>
            <span className={styles.rowAction}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
            </span>
          </Link>
          <Link href="/privacy" className={styles.row}>
            <div className={styles.rowLabelWithIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Privacy Policy
            </div>
            <span className={styles.rowAction}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
            </span>
          </Link>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Account</h2>
        </div>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Username</span>
            <span className={styles.rowValue}>{username}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span className={styles.rowValue}>{email}</span>
          </div>
        </div>
        <button
          className={styles.logoutBtn}
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Log Out
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <h2 className={styles.sectionTitle}>Developer</h2>
        </div>
        <div className={styles.group}>
          <a
            href="https://github.com/sakura-music/sakura"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.row}
          >
            <div className={styles.rowLabelWithIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
              </svg>
              GitHub
            </div>
            <span className={styles.rowAction}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            </span>
          </a>
          <button
            className={styles.row}
            onClick={checkForUpdates}
            disabled={updateStatus === "checking"}
          >
            <span className={styles.rowLabel}>Check for Updates</span>
            <span className={styles.rowAction}>
              {updateStatus === "checking" ? (
                <div className={styles.spinner} />
              ) : updateStatus === "updated" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sakura-success)" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
              )}
            </span>
          </button>
        </div>
      </div>

      <div className={styles.appInfo}>
        <div className={styles.appLogo}>🌸</div>
        <div className={styles.appName}>Sakura</div>
        <div className={styles.versionBadge}>v0.1.0</div>
        <div className={styles.buildInfo}>Build {BUILD_DATE}</div>
        <div className={styles.appDesc}>Personal music library</div>
      </div>
    </div>
  );
}
