"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import styles from "./page.module.css";

const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : new Date().toISOString().slice(0, 10);

declare const __BUILD_DATE__: string;

export default function SettingsPage() {
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
  const [clearingCache, setClearingCache] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "updated" | "latest">("idle");
  const [themePreview, setThemePreview] = useState<"dark" | "light">("dark");

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
        const mb = (used / (1024 * 1024)).toFixed(1);
        setStorageUsed(`${mb} MB`);
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
    <div className={styles.page}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Appearance</div>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Theme</span>
            <select
              className={styles.select}
              value={settings.theme}
              onChange={(e) => updateSettings({ theme: e.target.value })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Preview</span>
            <div className={styles.themePreview}>
              <button
                className={`${styles.themeBtn} ${settings.theme === "dark" || (settings.theme === "system" && themePreview === "dark") ? styles.themeBtnActive : ""}`}
                onClick={() => setThemePreview("dark")}
              >
                🌙
              </button>
              <button
                className={`${styles.themeBtn} ${settings.theme === "light" || (settings.theme === "system" && themePreview === "light") ? styles.themeBtnActive : ""}`}
                onClick={() => setThemePreview("light")}
              >
                ☀️
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Playback</div>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Audio Quality</span>
            <select
              className={styles.select}
              value={settings.audioQuality}
              onChange={(e) => updateSettings({ audioQuality: e.target.value })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Crossfade</span>
            <div className={styles.sliderGroup}>
              <span className={styles.rowValue}>{settings.crossfadeSeconds}s</span>
              <input
                className={styles.slider}
                type="range"
                min={0}
                max={12}
                step={1}
                value={settings.crossfadeSeconds}
                onChange={(e) => updateSettings({ crossfadeSeconds: Number(e.target.value) })}
              />
            </div>
          </div>
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
        <div className={styles.sectionTitle}>Storage</div>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Cache</span>
            <span className={styles.rowValue}>{storageUsed}</span>
          </div>
          <button
            className={styles.row}
            onClick={clearCache}
            disabled={clearingCache}
            style={{ width: "100%", cursor: "pointer", background: "none", border: "none", textAlign: "left" }}
          >
            <span className={styles.rowLabel}>Clear Cache</span>
            <span className={styles.rowValue}>{clearingCache ? "Clearing..." : "Clear"}</span>
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Updates</div>
        <div className={styles.group}>
          <button
            className={styles.row}
            onClick={checkForUpdates}
            disabled={updateStatus === "checking"}
            style={{ width: "100%", cursor: "pointer", background: "none", border: "none", textAlign: "left" }}
          >
            <span className={styles.rowLabel}>Check for updates</span>
            <span className={styles.rowValue}>
              {updateStatus === "checking" && "Checking..."}
              {updateStatus === "updated" && "Updated!"}
              {updateStatus === "latest" && "Latest"}
              {updateStatus === "idle" && "Check"}
            </span>
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Links</div>
        <div className={styles.group}>
          <Link href="/about" className={styles.row} style={{ textDecoration: "none" }}>
            <span className={styles.rowLabel}>About</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth={2} width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
          <Link href="/terms" className={styles.row} style={{ textDecoration: "none" }}>
            <span className={styles.rowLabel}>Terms of Service</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth={2} width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
          <Link href="/privacy" className={styles.row} style={{ textDecoration: "none" }}>
            <span className={styles.rowLabel}>Privacy Policy</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth={2} width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Account</div>
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
      </div>

      <div className={styles.section}>
        <button
          className={`${styles.row} ${styles.dangerRow}`}
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{ width: "100%", cursor: "pointer", background: "none", border: "none", textAlign: "left" }}
        >
          <span className={styles.rowLabel} style={{ color: "var(--sakura-danger)" }}>Log Out</span>
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Developer</div>
        <div className={styles.group}>
          <a
            href="https://github.com/sakura-music"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.row}
            style={{ textDecoration: "none" }}
          >
            <span className={styles.rowLabel}>GitHub</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--sakura-text-secondary)" strokeWidth={2} width="16" height="16"><path d="M9 18l6-6-6-6" /></svg>
          </a>
        </div>
      </div>

      <div className={styles.appInfo}>
        <div>Sakura v0.1.0</div>
        <div className={styles.version}>Build {BUILD_DATE}</div>
        <div className={styles.version}>Personal music library</div>
      </div>
    </div>
  );
}
