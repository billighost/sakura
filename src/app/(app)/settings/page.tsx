"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/PlayerContext";
import { PageHeader } from "@/components/PageHeader";
import {
  PaletteIcon,
  SoundIcon,
  ShieldIcon,
  DatabaseIcon,
  InfoIcon,
  ChevronRightIcon,
  LogOutIcon,
  SunIcon,
  MoonIcon,
  ContrastIcon,
  CheckIcon,
} from "@/components/Icons";
import { getStorageEstimate, clearAudioCache } from "@/lib/offline-db";
import { haptic } from "@/lib/haptics";
import styles from "./page.module.css";

/* ── Controls ──────────────────────────────────────────────────────────────
 * A switch with a real 44px target. The old one was a 30px pill, below the
 * minimum comfortable touch size, which is part of why settings felt fiddly.
 */
function Toggle({
  on,
  onChange,
  label,
  busy,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      onClick={() => {
        haptic("selection");
        onChange(!on);
      }}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

function Row({
  label,
  sublabel,
  control,
  href,
  onClick,
  value,
  danger,
}: {
  label: string;
  sublabel?: string;
  control?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  value?: string;
  danger?: boolean;
}) {
  const body = (
    <>
      <span className={styles.rowText}>
        <span className={danger ? styles.rowLabelDanger : styles.rowLabel}>
          {label}
        </span>
        {sublabel && <span className={styles.rowSublabel}>{sublabel}</span>}
      </span>
      <span className={styles.rowAction}>
        {value && <span className={styles.rowValue}>{value}</span>}
        {control}
        {(href || onClick) && !control && (
          <ChevronRightIcon size={16} className={styles.chevron} />
        )}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${styles.row} ${styles.rowTappable}`}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.row} ${styles.rowTappable}`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return <div className={styles.row}>{body}</div>;
}

/* ── Theme ─────────────────────────────────────────────────────────────────
 * Swatches drawn from real surface tokens instead of the three decorative
 * 135° gradients that used to stand in for previews.
 */
const THEMES = [
  { id: "light", name: "Light", Icon: SunIcon },
  { id: "dark", name: "Dark", Icon: MoonIcon },
  { id: "system", name: "Auto", Icon: ContrastIcon },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

/**
 * Quality is stored as a stable token, never as the label shown on screen.
 *
 * The previous version wrote the display string ("High (320 kbps)") into the
 * database column whose default was `"high"`. Nothing read it back correctly:
 * on reload the `<select>` got a value that matched no `<option>`, so the
 * control silently reset to the first entry and the user's choice appeared to
 * have been forgotten.
 */
const QUALITIES = [
  { id: "low", label: "Data saver", detail: "Uses the least data" },
  { id: "normal", label: "Balanced", detail: "Good quality, moderate data" },
  { id: "high", label: "High", detail: "Best quality, most data" },
] as const;

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Keep the browser/OS chrome in step with the active theme.
 *
 * The layout declares theme-color via prefers-color-scheme media queries, so
 * when the user overrides the system theme the *page* switches but the status
 * bar and tab colour keep following the OS. Rewriting the meta tags to the
 * resolved palette fixes the mismatch.
 */
function syncThemeColor(next: ThemeId) {
  const DARK = "#0E0B0F";
  const LIGHT = "#FAF8FA";

  const existing = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  );

  if (next === "system") {
    /*
     * Hand control back to the OS. Restoring the two media-scoped tags the
     * layout ships means Auto tracks a change to the system appearance while
     * the app is open, which a single resolved colour would freeze.
     */
    for (const m of existing) m.remove();
    for (const [scheme, color] of [
      ["dark", DARK],
      ["light", LIGHT],
    ] as const) {
      const m = document.createElement("meta");
      m.name = "theme-color";
      m.media = `(prefers-color-scheme: ${scheme})`;
      m.content = color;
      document.head.appendChild(m);
    }
    return;
  }

  // An explicit choice outranks the OS, so collapse to one unscoped tag —
  // leaving the media-scoped pair in place would let the OS win again.
  for (const m of existing.slice(1)) m.remove();
  const meta = existing[0] ?? document.createElement("meta");
  meta.name = "theme-color";
  meta.removeAttribute("media");
  meta.content = next === "light" ? LIGHT : DARK;
  if (!meta.parentNode) document.head.appendChild(meta);
}

export default function SettingsPage() {
  const router = useRouter();
  const { autoplayRadio, setAutoplayRadio } = usePlayer();

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [quality, setQuality] = useState<string>("high");
  const [privateSession, setPrivateSession] = useState(false);

  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(
    null
  );
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [loggingOut, setLoggingOut] = useState(false);

  /* One in-flight PATCH at a time, coalescing rapid toggles. */
  const pending = useRef<Record<string, unknown>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!alive) return;

        const serverTheme = (data.theme as ThemeId) || "dark";
        setTheme(serverTheme);

        /*
         * Reconcile the server's theme with what this device actually painted.
         *
         * The boot script in the root layout paints from localStorage, which
         * is per-device. If the theme was last changed on another device the
         * two disagree, and the radio would show "Light" over a dark page.
         * Re-apply only on a mismatch, so the common case does no DOM work.
         */
        let localTheme: string | null = null;
        try {
          localTheme = localStorage.getItem("sakura-theme");
        } catch {
          // Storage unavailable — fall through and apply.
        }
        if (localTheme !== serverTheme) {
          applyTheme(serverTheme, { fromServer: true });
        }

        setQuality(data.audioQuality || "high");
        setPrivateSession(data.privateSession ?? false);
        setLoaded(true);
      } catch {
        // The old code had no error branch: a failed load left `settingsLoaded`
        // false forever, and because `updateSetting` early-returns on that
        // flag, every control on the page silently stopped saving.
        if (alive) setLoadFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
    // applyTheme is re-created each render but only closes over `save`, which
    // is itself inert until `loaded` flips — so running this once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getStorageEstimate().then(setStorage).catch(() => {});
  }, []);

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (Object.keys(body).length === 0) return;

    setSaveState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaveState("idle");
    } catch {
      // Previously this was fire-and-forget with no `.catch`, so a failed save
      // was invisible *and* produced an unhandled rejection.
      setSaveState("error");
    }
  }, []);

  const save = useCallback(
    (key: string, value: unknown) => {
      if (!loaded) return;
      pending.current[key] = value;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, 350);
    },
    [loaded, flush]
  );

  // Don't lose a debounced write if the page unmounts mid-timer.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flush();
      }
    };
  }, [flush]);

  /**
   * Paints a theme and records it.
   *
   * `fromServer: true` skips the server write — the value already came from
   * there, so saving it back is a pointless round trip that also races the
   * debounced flush.
   */
  function applyTheme(next: ThemeId, opts?: { fromServer?: boolean }) {
    setTheme(next);
    if (!opts?.fromServer) save("theme", next);
    try {
      localStorage.setItem("sakura-theme", next);
    } catch {
      // Private-mode Safari throws on write; the in-memory change still applies.
    }
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    syncThemeColor(next);
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearAudioCache();
      const next = await getStorageEstimate();
      setStorage(next);
      setCleared(true);
      setTimeout(() => setCleared(false), 2400);
    } catch {
      // Leave the number as-is; the button returns to rest and can be retried.
    } finally {
      setClearing(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Sign out locally even if the round trip fails.
    }
    // `replace`, not `push` — otherwise Back returns to a signed-out app shell.
    router.replace("/login");
  }

  const usedPct =
    storage && storage.quota > 0
      ? Math.min(100, Math.round((storage.used / storage.quota) * 100))
      : 0;

  return (
    <div className={styles.page} data-page-scroll>
      {/* Settings is a push destination from the profile, not a tab, so it
          needs a back control — `backFallback` covers the deep-link case where
          there's no history to pop and a standalone PWA has no browser chrome
          to fall back on. */}
      <PageHeader
        title="Settings"
        backFallback="/profile"
        actions={
          saveState === "saving" ? (
            <span className={styles.saveHint}>Saving…</span>
          ) : saveState === "error" ? (
            <span className={styles.saveError}>Couldn&apos;t save</span>
          ) : null
        }
      />

      {loadFailed && (
        <div className={styles.banner}>
          We couldn&apos;t load your settings, so changes won&apos;t be saved.
          <button
            type="button"
            className={styles.bannerBtn}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )}

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <PaletteIcon size={15} />
          <h2 className={styles.sectionTitle}>Appearance</h2>
        </div>
        <div className={styles.themeRow} role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              className={`${styles.themeCard} ${theme === t.id ? styles.themeCardActive : ""}`}
              onClick={() => applyTheme(t.id)}
            >
              <span className={styles.themeIcon}>
                <t.Icon size={20} />
              </span>
              <span className={styles.themeName}>{t.name}</span>
              {theme === t.id && (
                <span className={styles.themeCheck}>
                  <CheckIcon size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── Playback ─────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <SoundIcon size={15} />
          <h2 className={styles.sectionTitle}>Playback</h2>
        </div>
        <div className={styles.group}>
          {QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={quality === q.id}
              className={`${styles.row} ${styles.rowTappable}`}
              onClick={() => {
                setQuality(q.id);
                save("audioQuality", q.id);
              }}
            >
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>{q.label}</span>
                <span className={styles.rowSublabel}>{q.detail}</span>
              </span>
              <span className={styles.rowAction}>
                <span
                  className={`${styles.radio} ${quality === q.id ? styles.radioOn : ""}`}
                />
              </span>
            </button>
          ))}
        </div>
        <div className={styles.group}>
          <Row
            label="Keep the music going"
            sublabel="When a playlist ends, play more songs like it"
            control={
              <Toggle
                on={autoplayRadio}
                onChange={setAutoplayRadio}
                label="Keep the music going"
              />
            }
          />
        </div>
      </section>

      {/* ── Privacy ──────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <ShieldIcon size={15} />
          <h2 className={styles.sectionTitle}>Privacy</h2>
        </div>
        <div className={styles.group}>
          <Row
            label="Private session"
            sublabel="Nothing you play is used for your recommendations"
            control={
              <Toggle
                on={privateSession}
                onChange={(v) => {
                  setPrivateSession(v);
                  save("privateSession", v);
                }}
                label="Private session"
              />
            }
          />
          {/* An "Allow explicit content" toggle used to live here. Nothing
              could honour it: the Track model carries no explicit flag, so
              there is no field to filter playback on. It has been dropped
              rather than left as a switch that silently does nothing. */}
        </div>
      </section>

      {/* ── Storage ──────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <DatabaseIcon size={15} />
          <h2 className={styles.sectionTitle}>Downloads</h2>
        </div>
        <div className={styles.group}>
          {/* Real numbers from the Storage API. This panel previously showed a
              hardcoded "3.4 GB of 8 GB" to every user on every device. */}
          <div className={styles.storage}>
            {storage && storage.quota > 0 ? (
              <>
                <div className={styles.storageLabel}>
                  <span>{formatBytes(storage.used)} used on this device</span>
                  <span className={styles.storageQuota}>
                    {formatBytes(storage.quota)} available
                  </span>
                </div>
                <div
                  className={styles.storageTrack}
                  role="progressbar"
                  aria-valuenow={usedPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Storage used"
                >
                  <div
                    className={styles.storageFill}
                    style={{ width: `${Math.max(1.5, usedPct)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className={styles.storageUnknown}>
                Your browser doesn&apos;t report how much space is in use.
              </p>
            )}
          </div>
          <Row
            label={cleared ? "Downloads cleared" : "Clear downloads"}
            sublabel="Frees up space. You can download songs again any time."
            onClick={clearing || cleared ? undefined : handleClearCache}
            control={
              clearing ? (
                <span className={styles.spinner} />
              ) : cleared ? (
                <CheckIcon size={16} className={styles.okIcon} />
              ) : undefined
            }
          />
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <InfoIcon size={15} />
          <h2 className={styles.sectionTitle}>About</h2>
        </div>
        <div className={styles.group}>
          {/* These four rows were `onClick={() => {}}` — they looked tappable,
              highlighted on press, and did nothing. Now they go somewhere. */}
          <Row label="Terms of use" href="/terms" />
          <Row label="Privacy policy" href="/privacy" />
        </div>
      </section>

      <button
        type="button"
        className={`${styles.logoutBtn} pressable`}
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? <span className={styles.spinner} /> : <LogOutIcon size={16} />}
        {loggingOut ? "Signing out…" : "Sign out"}
      </button>

      <p className={styles.version}>Sakura · Version 1.4.2</p>
    </div>
  );
}
