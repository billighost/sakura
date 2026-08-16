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
 * The stored preference, or null when this device has never chosen one.
 *
 * ── Why this is separate from `getTheme` ────────────────────────────────────
 *
 * `getTheme()` collapses "the user chose System" and "nothing has ever been
 * stored" into the same value, because for *painting* they mean the same thing:
 * no override. For *reconciling against the server* they mean opposite things,
 * and conflating them was a real bug.
 *
 * The settings page adopts the server's theme when it differs from the local
 * one. `UserSettings.theme` used to default to `"dark"`, and `/api/settings`
 * returned `"dark"` when the row didn't exist at all — so for anyone who had
 * never explicitly picked a theme, the server said "dark" purely as a column
 * default while `getTheme()` said "system". Those differ, so every visit to the
 * settings page silently repainted the app dark and wrote that to localStorage.
 * On a light-mode phone you watched the page change colour for no reason you
 * asked for. It looked like the page was "fetching the theme from the server",
 * which is exactly what it was doing — with a value nobody had chosen.
 *
 * With this, the page can ask the question that actually matters: has this
 * device made a choice? If it has, that choice stands and the server is brought
 * into line with it. If it hasn't, adopting the account's value is right.
 */
export function getStoredTheme(): ThemeId | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
  return isTheme(stored) ? stored : null;
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
 * the status bar keeps following the OS. Per spec the browser uses the first
 * `theme-color` tag whose media matches, so an explicit choice needs a single
 * unscoped tag ahead of that pair.
 *
 * ── Why this owns exactly one tag and never touches the others ──────────────
 *
 * It used to `.remove()` the media-scoped pair and re-create it. Those tags come
 * from `viewport.themeColor`, which means **React created them** — Next renders
 * route metadata into `<head>` as part of the tree. Detaching a node React owns
 * leaves React holding a reference whose `parentNode` is now null, and the next
 * commit that touches it dies in the mutation phase:
 *
 *     Cannot read properties of null (reading 'removeChild')
 *
 * That throw aborts the commit. Since this ran on every route change, every
 * navigation destroyed the metas React was about to reconcile: the URL updated,
 * the RSC payload arrived, and the new tree never landed — then every subsequent
 * update threw too, because the root was left inconsistent, so the page went
 * dead until the router gave up and hard-navigated. It presented as "the URL
 * changes but the page doesn't", which is nothing like a theming bug, which is
 * why it survived so long here.
 *
 * So: this function creates, updates and removes exactly one tag — its own,
 * marked with `data-sakura-theme-color` — and treats everything else in `<head>`
 * as somebody else's property. Ours is kept at the front of `<head>` because
 * first-match-wins is the only reason it outranks the pair.
 */
const OWN_TAG = "data-sakura-theme-color";

function ownTag(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>(`meta[${OWN_TAG}]`);
}

export function syncThemeColor(theme: ThemeId): void {
  if (typeof document === "undefined") return;

  const ours = ownTag();

  /*
   * "System" means the layout's media-scoped pair should govern, so our
   * override is withdrawn. Removing *this* node is safe in a way that removing
   * React's is not: we created it, nothing else holds a reference to it.
   */
  if (theme === "system") {
    ours?.remove();
    return;
  }

  const color = theme === "light" ? CHROME_LIGHT : CHROME_DARK;
  const meta = ours ?? document.createElement("meta");
  if (!ours) {
    meta.setAttribute(OWN_TAG, "");
    meta.name = "theme-color";
  }
  // Guarded so a no-op re-assert doesn't dirty <head> on every navigation.
  if (meta.content !== color) meta.content = color;

  /*
   * First in `<head>`, re-checked rather than assumed: Next re-applies route
   * metadata on navigation and can insert its own tags ahead of ours, which
   * would silently hand the match back to the media-scoped pair. Moving a node
   * we own is free of the hazard described above.
   */
  if (document.head.firstChild !== meta) {
    document.head.insertBefore(meta, document.head.firstChild);
  }
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
  }
}

/**
 * Subscribe to theme changes — this tab's own, and another tab's.
 *
 * The `storage` event only fires in *other* tabs, which is exactly what makes
 * it the right cross-tab channel: a change here notifies local listeners
 * directly, and every other tab hears it through storage and repaints without a
 * reload. Shaped for `useSyncExternalStore`.
 */export function subscribeTheme(onChange: () => void): () => void {
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
