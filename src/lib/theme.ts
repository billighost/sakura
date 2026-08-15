"use client";

/**
 * The one owner of the app's theme.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The theme was previously spread across three places that each knew a
 * different amount: a blocking boot script in the root layout (paints from
 * localStorage), the settings page (wrote localStorage, set the attribute,
 * rewrote the theme-color metas), and globals.css (a `.theme-transition` class
 * whose comment claimed a `ThemeInit` component applied it — no such component
 * existed, so that rule was dead code and the swap was an instant, jarring
 * repaint).
 *
 * Nothing else in the app could ask what the theme was, nothing could react to
 * it changing, and a change made in one tab never reached another. This module
 * holds the whole contract, and `components/ThemeInit.tsx` mounts the listeners
 * that keep it honest.
 *
 * ── The three values, and the difference between two of them ────────────────
 *
 * `"light" | "dark"` are palettes. `"system"` is a *preference*, not a palette:
 * it means "no override", and it must be applied by **removing**
 * `data-theme` so the `:root:not([data-theme])` media query in globals.css
 * takes over. Writing `data-theme="system"` matches no stylesheet, so the
 * palette silently falls through to the `:root` dark default — which is exactly
 * the bug that made "Auto" always render dark.
 */

export type ThemeId = "light" | "dark" | "system";

/** Shared with the boot script in app/layout.tsx. Changing it needs both. */
export const THEME_STORAGE_KEY = "sakura-theme";

/**
 * Chrome colours, matching `--bg` closely enough that the status bar reads as
 * an extension of the page. Kept in sync with the `viewport.themeColor` entries
 * in app/layout.tsx.
 */
const CHROME_DARK = "#0E0B0F";
const CHROME_LIGHT = "#FAF8FA";

const THEME_EVENT = "sakura:themechange";

const listeners = new Set<() => void>();

/** Cached so `getSnapshot` can return a stable value between changes. */
let current: ThemeId | null = null;

function isTheme(value: unknown): value is ThemeId {
  return value === "light" || value === "dark" || value === "system";
}

/** The stored preference. "system" when nothing valid is stored. */
export function getTheme(): ThemeId {
  if (current !== null) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Safari in private mode throws on access; treat it as "nothing stored".
  }
  current = isTheme(stored) ? stored : "system";
  return current;
}

/**
 * Server snapshot for `useSyncExternalStore`. There is no storage on the
 * server, and guessing a palette would produce a hydration mismatch on every
 * light-mode device, so the honest answer is the preference that means
 * "whatever this device already is".
 */
export function getServerTheme(): ThemeId {
  return "system";
}

/** Which palette a preference resolves to right now. */
export function resolveTheme(theme: ThemeId): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Keep the browser/OS chrome in step with the active theme.
 *
 * The root layout declares theme-color through prefers-color-scheme media
 * queries, so when a user overrides the system theme the *page* switches while
 * the status bar keeps following the OS. For an explicit choice we collapse to
 * a single unscoped tag — per spec the browser uses the first tag whose media
 * matches, so leaving the media-scoped pair in place lets the OS win again. For
 * "system" the pair is restored, which is what keeps Auto tracking a change to
 * the system appearance while the app is open.
 */
export function syncThemeColor(theme: ThemeId): void {
  if (typeof document === "undefined") return;

  const existing = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  );

  if (theme === "system") {
    const wanted: [string, string][] = [
      ["(prefers-color-scheme: dark)", CHROME_DARK],
      ["(prefers-color-scheme: light)", CHROME_LIGHT],
    ];
    // Already correct — bail rather than churning <head> on every route change.
    const matches =
      existing.length === wanted.length &&
      wanted.every(
        ([media, color], i) =>
          existing[i].media === media && existing[i].content === color
      );
    if (matches) return;

    for (const meta of existing) meta.remove();
    for (const [media, color] of wanted) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = media;
      meta.content = color;
      document.head.appendChild(meta);
    }
    return;
  }

  const color = theme === "light" ? CHROME_LIGHT : CHROME_DARK;
  for (const meta of existing.slice(1)) meta.remove();
  const meta = existing[0] ?? document.createElement("meta");
  meta.name = "theme-color";
  meta.removeAttribute("media");
  meta.content = color;
  if (!meta.parentNode) document.head.appendChild(meta);
}

/** Reflect a preference onto <html>, without touching storage. */
export function paintTheme(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  syncThemeColor(theme);
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cross-fade the whole document for the duration of a swap.
 *
 * This is the one moment a page-wide colour transition earns its cost — every
 * surface, border and glyph changes at once, and an instant repaint of all of
 * them reads as a glitch. The class is removed again straight after, so the
 * cost stays bounded to the swap instead of sitting on every hover for the rest
 * of the session. Reduced-motion users get the instant swap: a 280ms fade of
 * every colour on screen is exactly the kind of full-viewport change the
 * setting exists to suppress.
 */
function animateSwap(): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const root = document.documentElement;
  root.classList.add("theme-transition");
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    root.classList.remove("theme-transition");
    transitionTimer = null;
  }, 300);
}

export interface SetThemeOptions {
  /** Skip the localStorage write — for values that came *from* storage. */
  persist?: boolean;
  /** Skip the cross-fade, e.g. when reconciling on load. */
  animate?: boolean;
}

/**
 * Apply and record a theme. Safe to call with the value already active: the
 * repaint is idempotent and subscribers are only notified on a real change.
 */
export function setTheme(theme: ThemeId, opts: SetThemeOptions = {}): void {
  const { persist = true, animate = true } = opts;
  const changed = getTheme() !== theme;

  if (changed && animate) animateSwap();

  current = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable — the paint below still applies for this session.
    }
  }

  paintTheme(theme);

  if (changed) {
    for (const listener of listeners) listener();
    window.dispatchEvent(new CustomEvent(THEME_EVENT));
  }
}

/**
 * Subscribe to theme changes — this tab's own, and another tab's.
 *
 * The `storage` event only fires in *other* tabs, which is exactly what makes
 * it the right cross-tab channel: a change here notifies local listeners
 * directly, and every other tab hears it through storage and repaints without a
 * reload. Shaped for `useSyncExternalStore`.
 */
export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    const next = isTheme(e.newValue) ? e.newValue : "system";
    if (next === current) return;
    // Another tab already wrote it, so don't write it back.
    setTheme(next, { persist: false });
  };

  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
