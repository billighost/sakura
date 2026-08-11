"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A user choice that survives reloads — sort order, view mode, and friends.
 *
 * Every page that had one of these read it in a mount effect and mirrored it
 * into state:
 *
 *     const [view, setView] = useState("grid");
 *     useEffect(() => { const v = localStorage.getItem(KEY); if (v) setView(v); }, []);
 *
 * Three problems with that, in increasing order of how much they matter:
 *
 *  1. It renders once with the default and again with the stored value, so a
 *     list visibly re-sorts itself a frame after it appears.
 *  2. Nothing validates what comes back. `localStorage` is writable by any
 *     script that has ever run on this origin, and a stale value from an older
 *     build ("date" for a sort that no longer has one) silently selects
 *     nothing — the exact class of bug the house rules call out.
 *  3. Two tabs disagree forever.
 *
 * `useSyncExternalStore` is built for precisely this: an external, subscribable
 * value with a server snapshot. The `storage` event gives cross-tab sync for
 * free, and the validator makes an unrecognised value fall back rather than
 * poison the UI.
 */
export function usePersistedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): [T, (next: T) => void] {
  /*
   * A module-level listener set would be shared across every call site, so a
   * write to one key would re-render components watching another. Subscribing
   * per key keeps the fan-out honest — see `notify` below.
   */
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (e: StorageEvent) => {
        // `key === null` is a `localStorage.clear()`, which affects everything.
        if (e.key === null || e.key === key) onChange();
      };
      window.addEventListener("storage", onStorage);
      listeners.add(onChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        listeners.delete(onChange);
      };
    },
    [key]
  );

  const getSnapshot = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      // Strings compare by value, so returning the same stored string on every
      // call satisfies useSyncExternalStore's stability requirement.
      return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
    } catch {
      // Private mode, or storage disabled entirely.
      return fallback;
    }
  }, [key, allowed, fallback]);

  // The server has no per-user storage, so it renders the default and React
  // swaps in the real value on hydration without a mismatch warning.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        // Quota or private mode. The choice is lost on reload, which is a much
        // smaller failure than throwing out of an onClick.
      }
      // `storage` only fires in *other* tabs, so this tab has to be told.
      notify();
    },
    [key]
  );

  return [value, set];
}

/** Same-tab subscribers. The `storage` event covers the cross-tab case. */
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}
