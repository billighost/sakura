"use client";

import { useEffect, useState } from "react";

/**
 * `useState` that survives leaving the page and coming back.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * Every page in this app is a client component holding its state in `useState`.
 * A client-side navigation unmounts the page, so all of it is gone: search for
 * something, open a result, press Back, and you're staring at an empty search
 * box with your query, your results, your tab and your scroll position all
 * discarded. The page then re-fetches everything it just had, so returning to a
 * page you were looking at a second ago is one of the *slowest* things in the
 * app rather than the fastest.
 *
 * ── Why a module-level store ────────────────────────────────────────────────
 *
 * Module state outlives component state across client-side navigation: the
 * route's chunk stays loaded, so this Map is still here when the page mounts
 * again. Reading it in the `useState` initialiser means the restored value is
 * present on the *first* render — no effect, no second paint, no flash of empty
 * state. That's what makes the return trip instant rather than merely fast.
 *
 * Alternatives considered:
 *   - sessionStorage: survives reloads too, but every write is a synchronous
 *     main-thread serialise, and search results are large enough that typing
 *     would pay for it on every keystroke.
 *   - React `cache`/context lifted to the layout: works, but needs every page's
 *     state hoisted into a shared provider, which couples pages that have
 *     nothing to do with each other.
 *
 * Deliberately *not* persistent across a full reload. A reload is the user
 * asking for a clean slate, and stale search results reappearing after one
 * would be a bug, not a feature.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 * Drop-in for `useState` — same tuple, same setter semantics:
 *
 *   const [query, setQuery] = usePageState("search:query", "");
 *
 * Keys are global, so prefix them with the page (`"search:"`, `"library:"`).
 * Use it for state the user would expect to find as they left it: queries,
 * fetched lists, active tab, expanded sections. Don't use it for transient
 * flags like `loading` or `error` — restoring a stale "loading" leaves a
 * spinner nothing will ever resolve.
 */

const store = new Map<string, unknown>();

export function usePageState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  /*
   * Synced in an effect rather than inside the setter. Writing to the store
   * from within a `setValue` updater would be a side effect in a function React
   * is allowed to call more than once per commit; doing it here keeps the hook
   * pure and still lands well before any remount can read it.
   */
  useEffect(() => {
    store.set(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}

/**
 * Drop all cached page state.
 *
 * Called on sign-out: some of this is another person's library, and a shared
 * device must not hand the next user the last one's screens. See
 * `clearServiceWorkerCaches` for the same reasoning applied to the SW caches.
 */
export function clearPageState(): void {
  store.clear();
}
