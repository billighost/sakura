"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────
   Icons
──────────────────────────────────────────────────────────── */
function PaletteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2 1.5 1.5 0 0 1 1.5-1.5H17a3 3 0 0 0 3-3 10 10 0 0 0-8-13.5z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="11.5" cy="7" r="1" fill="currentColor" />
      <circle cx="16" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}
function SoundIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3z" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
   Small reusable controls
──────────────────────────────────────────────────────────── */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className={`${styles.toggleKnob} ${on ? styles.toggleKnobOn : ""}`} />
    </button>
  );
}

function Row({
  icon,
  label,
  value,
  onClick,
  control,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
  control?: React.ReactNode;
}) {
  const content = (
    <>
      <span className={icon ? styles.rowLabelWithIcon : styles.rowLabel}>
        {icon}
        {label}
      </span>
      {control ?? (
        <span className={styles.rowAction} style={{ display: "flex", gap: "0.5rem" }}>
          {value && <span className={styles.rowValue}>{value}</span>}
          {onClick && <ChevronRight />}
        </span>
      )}
    </>
  );

  if (onClick && !control) {
    return (
      <button type="button" className={styles.row} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={styles.row}>{content}</div>;
}

/* ────────────────────────────────────────────────────────────
   Theme options — tokens pulled straight from globals.css
──────────────────────────────────────────────────────────── */
const THEMES: { id: "dark" | "light" | "system"; name: string; preview: string }[] = [
  { id: "dark", name: "Dark", preview: "linear-gradient(135deg, #0E0B0F, #1A1620)" },
  { id: "light", name: "Light", preview: "linear-gradient(135deg, #FAF8FA, #F0ECF2)" },
  { id: "system", name: "System", preview: "linear-gradient(135deg, #0E0B0F 50%, #FAF8FA 50%)" },
];

const AUDIO_QUALITIES = ["Low (96 kbps)", "Normal (160 kbps)", "High (320 kbps)", "Lossless"];

export default function SettingsPage() {
  const router = useRouter();

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [quality, setQuality] = useState("High (320 kbps)");
  const [downloadQuality, setDownloadQuality] = useState("High (320 kbps)");
  const [crossfade, setCrossfade] = useState(4);
  const [gaplessPlayback, setGaplessPlayback] = useState(true);
  const [normalizeVolume, setNormalizeVolume] = useState(true);
  const [explicitContent, setExplicitContent] = useState(true);
  const [privateSession, setPrivateSession] = useState(false);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [newReleaseAlerts, setNewReleaseAlerts] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setTheme(data.theme || "dark");
        setQuality(data.audioQuality || "High (320 kbps)");
        setDownloadQuality(data.downloadQuality || "High (320 kbps)");
        setCrossfade(data.crossfadeSeconds || 0);
        setGaplessPlayback(data.gaplessPlayback ?? true);
        setNormalizeVolume(data.normalizeVolume ?? true);
        setExplicitContent(data.explicitContent ?? true);
        setPrivateSession(data.privateSession ?? false);
        setPushNotifications(data.pushNotifications ?? true);
        setNewReleaseAlerts(data.newReleaseAlerts ?? true);
        
        setSettingsLoaded(true);
      });
  }, []);

  function updateSetting(key: string, value: any) {
    if (!settingsLoaded) return;
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
  }

  function applyTheme(next: "dark" | "light" | "system") {
    setTheme(next);
    updateSetting("theme", next);
    localStorage.setItem("sakura-theme", next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
  }

  const storageUsedGb = 3.4;
  const storageTotalGb = 8;
  const storagePct = Math.round((storageUsedGb / storageTotalGb) * 100);

  return (
    <div className={styles.page}>
      {/* ── Appearance ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <PaletteIcon />
          </span>
          <h2 className={styles.sectionTitle}>Appearance</h2>
        </div>
        <div className={styles.themeGrid}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.themeCard} ${theme === t.id ? styles.themeCardActive : ""}`}
              onClick={() => applyTheme(t.id)}
              aria-pressed={theme === t.id}
            >
              <div className={styles.themePreview} style={{ background: t.preview }} />
              <span className={styles.themeName}>{t.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Playback ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <SoundIcon />
          </span>
          <h2 className={styles.sectionTitle}>Playback</h2>
        </div>
        <div className={styles.group}>
          <Row
            label="Streaming quality"
            control={
              <select className={styles.select} value={quality} onChange={(e) => {
                setQuality(e.target.value);
                updateSetting("audioQuality", e.target.value);
              }}>
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            }
          />
          <Row
            label="Download quality"
            control={
              <select className={styles.select} value={downloadQuality} onChange={(e) => {
                setDownloadQuality(e.target.value);
                updateSetting("downloadQuality", e.target.value);
              }}>
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            }
          />
          <Row label="Gapless playback" control={<Toggle on={gaplessPlayback} onChange={(v) => { setGaplessPlayback(v); updateSetting("gaplessPlayback", v); }} label="Gapless playback" />} />
          <Row label="Normalize volume" control={<Toggle on={normalizeVolume} onChange={(v) => { setNormalizeVolume(v); updateSetting("normalizeVolume", v); }} label="Normalize volume" />} />
        </div>
        <div className={styles.qualityInfo}>Higher quality uses more data and storage.</div>

        <div className={styles.group} style={{ marginTop: "0.75rem" }}>
          <div className={styles.crossfadeVisual}>
            <div className={styles.crossfadeTrack}>
              <div className={styles.crossfadeFill} style={{ width: `${(crossfade / 12) * 100}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={12}
              value={crossfade}
              onChange={(e) => {
                setCrossfade(Number(e.target.value));
                updateSetting("crossfadeSeconds", Number(e.target.value));
              }}
              className={styles.crossfadeSlider}
              aria-label="Crossfade duration"
            />
          </div>
          <div className={styles.crossfadeLabels}>
            <span>Off</span>
            <span>Crossfade — {crossfade}s</span>
            <span>12s</span>
          </div>
        </div>
      </section>

      {/* ── Privacy ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <ShieldIcon />
          </span>
          <h2 className={styles.sectionTitle}>Privacy</h2>
        </div>
        <div className={styles.group}>
          <Row label="Allow explicit content" control={<Toggle on={explicitContent} onChange={(v) => { setExplicitContent(v); updateSetting("explicitContent", v); }} label="Allow explicit content" />} />
          <Row
            label="Private session"
            control={<Toggle on={privateSession} onChange={(v) => { setPrivateSession(v); updateSetting("privateSession", v); }} label="Private session" />}
          />
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <BellIcon />
          </span>
          <h2 className={styles.sectionTitle}>Notifications</h2>
        </div>
        <div className={styles.group}>
          <Row label="Push notifications" control={<Toggle on={pushNotifications} onChange={(v) => { setPushNotifications(v); updateSetting("pushNotifications", v); }} label="Push notifications" />} />
          <Row label="New release alerts" control={<Toggle on={newReleaseAlerts} onChange={(v) => { setNewReleaseAlerts(v); updateSetting("newReleaseAlerts", v); }} label="New release alerts" />} />
        </div>
      </section>

      {/* ── Storage ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Storage</h2>
        </div>
        <div className={styles.group}>
          <div className={styles.storageBar}>
            <div className={styles.storageLabel}>
              <span>{storageUsedGb} GB used</span>
              <span>{storageTotalGb} GB total</span>
            </div>
            <div className={styles.storageTrack}>
              <div className={styles.storageFill} style={{ width: `${storagePct}%` }} />
            </div>
          </div>
          <Row label="Clear download cache" onClick={() => {}} />
        </div>
      </section>

      {/* ── About ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <InfoIcon />
          </span>
          <h2 className={styles.sectionTitle}>About</h2>
        </div>
        <div className={styles.group}>
          <Row label="What's new" onClick={() => {}} />
          <div className={styles.whatsNewContent}>
            <ul className={styles.whatsNewList}>
              <li>Faster search results across your library</li>
              <li>Crossfade now works between downloaded tracks</li>
              <li>Fixed playback glitches on lock screen</li>
            </ul>
          </div>
          <Row label="Terms of service" onClick={() => {}} />
          <Row label="Privacy policy" onClick={() => {}} />
        </div>
      </section>

      <button type="button" className={styles.logoutBtn} onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? <span className={styles.spinner} /> : <LogOutIcon />}
        {loggingOut ? "Signing out…" : "Sign out"}
      </button>

      <div className={styles.appInfo}>
        <div className={styles.appLogo}>🌸</div>
        <div className={styles.appName}>Sakura</div>
        <div className={styles.versionBadge}>Version 1.4.2</div>
        <div className={styles.buildInfo}>Build 2026.08.01</div>
        <div className={styles.appDesc}>Your personal music library</div>
      </div>
    </div>
  );
}
