"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { getStorageEstimate, clearAudioCache, clearLibraryCache } from "@/lib/offline-db";
import { clearServiceWorkerCaches } from "@/components/SWRegister";
import { clearPageState } from "@/lib/usePageState";
import {
  getServerTheme,
  getStoredTheme,
  getTheme,
  setTheme as applyThemeGlobally,
  subscribeTheme,
  type ThemeId,
} from "@/lib/theme";
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
 *
 * The mechanics — storage, the `data-theme` attribute, the theme-color metas,
 * the swap cross-fade, cross-tab sync — all live in `lib/theme.ts`. This page
 * only chooses; it no longer owns a second private copy of the rules.
 */
const THEMES: readonly { id: ThemeId; name: string; Icon: typeof SunIcon }[] = [
  { id: "light", name: "Light", Icon: SunIcon },
  { id: "dark", name: "Dark", Icon: MoonIcon },
  { id: "system", name: "Auto", Icon: ContrastIcon },
];

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
 * Moved to `lib/theme.ts` — it has to run on boot and after every navigation
 * (Next re-inserts the metas it owns), not only when this page happens to be
 * mounted. `components/ThemeInit.tsx` drives it.
 */

export default function SettingsPage() {
  const router = useRouter();
  const { autoplayRadio, setAutoplayRadio } = usePlayer();

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  /*
   * The theme is read from the shared store rather than held in local state.
   *
   * Two things fall out of that. The radio can't drift from what the page is
   * actually painted as — which it could when this was `useState("dark")`,
   * showing Dark selected over a light page until the settings fetch resolved.
   * And a change made in another tab moves this control, because the store
   * publishes cross-tab updates.
   *
   * `getServerTheme` returns "system" so the server render commits to no
   * palette; the real preference arrives on hydration without a mismatch.
   */
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
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

  /*
   * Set the moment the user picks a theme here, so the settings fetch — which
   * may land afterwards — doesn't overwrite the choice they just made with the
   * server's older value.
   */
  const themeChosenLocally = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!alive) return;

        /*
         * Reconcile the server's theme with what this device actually painted.
         *
         * ── The bug this shape exists to prevent ────────────────────────────
         *
         * This used to adopt the server's value whenever it differed from
         * `getTheme()`. `UserSettings.theme` defaulted to `"dark"` and the GET
         * handler returned `"dark"` when the row didn't exist, while `getTheme()`
         * reports `"system"` for a device that has stored nothing. Those differ,
         * so merely *opening this page* repainted the app dark and persisted it —
         * a theme change nobody asked for, from a value nobody had chosen. On a
         * light-mode device it was plainly visible: the page changed colour a
         * beat after it loaded.
         *
         * So the question is no longer "do these differ" but "has this device
         * ever chosen?" — `getStoredTheme()` returns null when it hasn't.
         *
         *   - No local choice → adopt the account's, if it has one. This is what
         *     makes a freshly-installed device pick up your preference.
         *   - Local choice → it stands, and the server is brought into line with
         *     it. Appearance is a per-device setting everywhere else (iOS,
         *     Android, macOS all treat it that way), and a device silently
         *     overriding the choice you made *on that device* is never right.
         *
         * A choice made on this page in the last second beats both, since it's
         * newer than either.
         */
        const serverTheme: ThemeId | null =
          data.theme === "light" || data.theme === "dark" || data.theme === "system"
            ? data.theme
            : null;

        if (!themeChosenLocally.current) {
          const localTheme = getStoredTheme();

          if (localTheme === null) {
            // No cross-fade: this is reconciliation on load, not a user action,
            // and fading the whole page a beat after it appears reads as a fault.
            if (serverTheme) applyThemeGlobally(serverTheme, { animate: false });
          } else if (serverTheme !== localTheme) {
            /*
             * The device has decided. Tell the server, so the next device to
             * sign in inherits something real instead of a column default.
             *
             * Queued straight into `pending` rather than through `save()`: the
             * initial load hasn't resolved yet at this point, which is precisely
             * the case `save` handles by recording and waiting — and calling it
             * here would put a value that changes on every render into this
             * effect's dependencies, re-running the fetch. The
             * flush-when-loaded effect below sends it.
             */
            pending.current.theme = localTheme;
          }
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

  /**
   * Queue a settings write.
   *
   * The write is recorded even before the initial load resolves — it used to
   * early-return on `!loaded`, so a control touched in the first few hundred
   * milliseconds looked like it had taken effect (the UI moved, the theme
   * repainted) while the server never heard about it. The flush is what waits:
   * writing before the load lands would race the response we're about to
   * reconcile against.
   */
  const save = useCallback(
    (key: string, value: unknown) => {
      pending.current[key] = value;
      if (!loaded) return;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, 350);
    },
    [loaded, flush]
  );

  // Anything the user changed while the page was still loading is sent as soon
  // as it's safe to.
  useEffect(() => {
    if (!loaded) return;
    if (Object.keys(pending.current).length === 0) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 350);
  }, [loaded, flush]);

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
   * Paint a theme and record it.
   *
   * The painting is the shared store's job (`lib/theme.ts`): the attribute, the
   * localStorage write, the chrome colour, the cross-fade and telling other tabs
   * all happen there. This adds the one thing that's specific to this screen —
   * persisting the choice to the account so it follows the user to their other
   * devices.
   */
  const chooseTheme = useCallback(
    (next: ThemeId) => {
      haptic("selection");
      themeChosenLocally.current = true;
      applyThemeGlobally(next);
      save("theme", next);
    },
    [save]
  );

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

    /*
     * Purge everything on this device that belongs to the account, but leave the
     * downloads alone.
     *
     * None of this was being cleared: `clearServiceWorkerCaches` was exported
     * and never called, and the IndexedDB library cache and in-memory page state
     * both survived sign-out. On a shared device the next person to sign in was
     * handed the previous user's cached pages, library lists and last screens —
     * their liked songs and playlists included.
     *
     * Downloaded audio is deliberately excluded. It's a file on this device,
     * paid for with this device's storage and data, and it stays across sign-out
     * and account switches by design — see the scoping note in lib/offline-db.
     * Clearing it here would silently delete someone else's downloads too.
     *
     * Best-effort: a failure here must not strand the user in a half-signed-out
     * state, so the redirect happens regardless.
     */
    try {
      clearPageState();
      clearServiceWorkerCaches();
      await clearLibraryCache();
    } catch {
      /* nothing useful to do — the redirect below still has to happen */
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
              onClick={() => chooseTheme(t.id)}
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
