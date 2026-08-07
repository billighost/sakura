"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCachedLibraryData,
  setCachedLibraryData,
  getCachedUserId,
} from "./offline-db";
import { apiBatch } from "./apiBatch";

/**
 * Stale-while-revalidate over IndexedDB.
 *
 * The rule this implements: **the device cache always paints first**, online or
 * not. A page that has been visited before shows real content on the first
 * frame and quietly reconciles with the server afterwards; a page that hasn't
 * shows a skeleton exactly once, ever.
 *
 * Previously each page hand-rolled this with a `hasLoadedFromCache` ref and a
 * pair of `getCachedLibraryData`/`setCachedLibraryData` calls. That worked but
 * drifted — some pages set `loading` false only in the network `finally`, so
 * they showed a spinner over perfectly good cached data, and none of them
 * deduplicated concurrent requests or shared results between components asking
 * for the same thing.
 *
 * Three layers, checked in order:
 *   1. Module-level memory cache — instant, survives navigation within a session.
 *   2. IndexedDB — instant-ish, survives reloads and works offline.
 *   3. Network — authoritative, writes back through both.
 */

type Listener<T> = (data: T) => void;

const memoryCache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<Listener<any>>>();

/** Fan a fresh value out to every mounted hook watching this key. */
function publish<T>(key: string, data: T) {
  memoryCache.set(key, data);
  listeners.get(key)?.forEach((fn) => fn(data));
}

/**
 * Cross-tab coherence. Without this, liking a song in one tab leaves every
 * other tab showing stale data until it happens to refetch.
 */
let channel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  channel = new BroadcastChannel("sakura-data");
  channel.onmessage = (e) => {
    const { key, data } = e.data ?? {};
    if (typeof key === "string") publish(key, data);
  };
}

export interface OfflineDataOptions<T> {
  /** Skip the request entirely (e.g. waiting on an id). */
  enabled?: boolean;
  /**
   * How long cached data is considered fresh. Inside this window the network
   * is not touched at all, which is what makes back-navigation instant.
   */
  freshMs?: number;
  /** Seed value used before any cache read resolves. */
  placeholder?: T;
  /** Reshape the raw response before caching. */
  select?: (raw: any) => T;
}

export interface OfflineDataResult<T> {
  data: T | null;
  /** True only when there is nothing at all to show yet. */
  loading: boolean;
  /** True while a background refresh is running over existing data. */
  revalidating: boolean;
  error: Error | null;
  /** Data came from cache and the network hasn't confirmed it yet. */
  isStale: boolean;
  refresh: () => Promise<void>;
  /** Write a new value locally (optimistic update). */
  mutate: (updater: T | ((prev: T | null) => T)) => void;
}

const lastFetchedAt = new Map<string, number>();

export function useOfflineData<T = any>(
  key: string | null,
  path: string,
  options: OfflineDataOptions<T> = {}
): OfflineDataResult<T> {
  const { enabled = true, freshMs = 30_000, placeholder = null, select } = options;

  const [data, setData] = useState<T | null>(
    () => (key ? (memoryCache.get(key) as T) ?? placeholder : placeholder) ?? null
  );
  const [loading, setLoading] = useState(() => !(key && memoryCache.has(key)));
  // A hook with no key or one that's switched off is never "loading" — treat
  // that as derived rather than something an effect has to correct after mount.
  const isLoading = loading && Boolean(key) && enabled;
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState(false);

  // `select` is usually an inline arrow, so it is held in a ref to keep it out
  // of the fetch effect's dependencies — otherwise every parent render would
  // re-trigger a network revalidation. Written in an effect, not during render.
  const selectRef = useRef(select);
  const mountedRef = useRef(true);

  useEffect(() => {
    selectRef.current = select;
  }, [select]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to updates published by other hooks / tabs for the same key.
  useEffect(() => {
    if (!key) return;
    const set = listeners.get(key) ?? new Set();
    const fn: Listener<T> = (fresh) => {
      if (mountedRef.current) {
        setData(fresh);
        setLoading(false);
        setIsStale(false);
      }
    };
    set.add(fn);
    listeners.set(key, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) listeners.delete(key);
    };
  }, [key]);

  const fetchFresh = useCallback(
    async (force: boolean) => {
      if (!key || !enabled) return;

      const age = Date.now() - (lastFetchedAt.get(key) ?? 0);
      if (!force && age < freshMs && memoryCache.has(key)) return;

      // Offline: nothing to do — the cache read already gave us what we have.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (mountedRef.current) {
          setRevalidating(false);
          setLoading(false);
        }
        return;
      }

      // Share one request across every caller for this key.
      let request = inFlight.get(key);
      if (!request) {
        request = apiBatch(key, path).finally(() => inFlight.delete(key));
        inFlight.set(key, request);
      }

      if (mountedRef.current) setRevalidating(true);

      try {
        const raw = await request;
        const next = (selectRef.current ? selectRef.current(raw) : raw) as T;

        lastFetchedAt.set(key, Date.now());
        publish(key, next);
        void setCachedLibraryData(key, next);
        channel?.postMessage({ key, data: next });

        if (mountedRef.current) setError(null);
      } catch (err) {
        // A failed refresh must never blank out good cached data — it only
        // surfaces as an error if there was nothing to show in the first place.
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mountedRef.current) {
          setRevalidating(false);
          setLoading(false);
        }
      }
    },
    [key, path, enabled, freshMs]
  );

  // Cache read, then revalidate.
  useEffect(() => {
    // Nothing to load. `loading` is derived rather than set here, so a disabled
    // hook reports "not loading" without an extra render pass.
    if (!key || !enabled) return;

    let cancelled = false;

    (async () => {
      // Memory first — no await, no flash.
      if (memoryCache.has(key)) {
        if (!cancelled) {
          setData(memoryCache.get(key) as T);
          setLoading(false);
          setIsStale(true);
        }
      } else {
        const cached = await getCachedLibraryData<T>(key);
        if (!cancelled && cached != null) {
          memoryCache.set(key, cached);
          setData(cached);
          setLoading(false);
          setIsStale(true);
        }
      }

      if (!cancelled) void fetchFresh(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [key, enabled, fetchFresh]);

  // Refresh when the tab regains focus or the device comes back online. This is
  // what makes the app feel live after it's been backgrounded on a phone.
  useEffect(() => {
    if (!key || !enabled) return;

    const onFocus = () => {
      if (document.visibilityState === "visible") void fetchFresh(false);
    };
    const onOnline = () => void fetchFresh(true);

    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [key, enabled, fetchFresh]);

  const refresh = useCallback(() => fetchFresh(true), [fetchFresh]);

  const mutate = useCallback(
    (updater: T | ((prev: T | null) => T)) => {
      if (!key) return;
      const current = (memoryCache.get(key) as T) ?? null;
      const next =
        typeof updater === "function"
          ? (updater as (prev: T | null) => T)(current)
          : updater;

      publish(key, next);
      void setCachedLibraryData(key, next);
      channel?.postMessage({ key, data: next });
    },
    [key]
  );

  return { data, loading: isLoading, revalidating, error, isStale, refresh, mutate };
}

/**
 * Update a cached key from outside React — for mutations that should be
 * reflected immediately across every screen (liking a track, renaming a
 * playlist) without waiting for a refetch.
 */
export function mutateCache<T>(key: string, updater: T | ((prev: T | null) => T)) {
  const current = (memoryCache.get(key) as T) ?? null;
  const next =
    typeof updater === "function"
      ? (updater as (prev: T | null) => T)(current)
      : updater;

  publish(key, next);
  void setCachedLibraryData(key, next);
  channel?.postMessage({ key, data: next });
}

/** Force the next read of these keys to hit the network. */
export function invalidateCache(...keys: string[]) {
  for (const key of keys) lastFetchedAt.delete(key);
}

/**
 * Drop everything. Called on sign-out — otherwise the next account to sign in
 * on this device paints the previous user's library from memory before their
 * own data arrives.
 */
export function clearAllCaches() {
  memoryCache.clear();
  inFlight.clear();
  lastFetchedAt.clear();
}

/** Prime the cache for a route the user is likely to open next. */
export async function prefetch(key: string, path: string) {
  if (memoryCache.has(key) || inFlight.has(key)) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  try {
    const request = apiBatch(key, path).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    const data = await request;
    lastFetchedAt.set(key, Date.now());
    publish(key, data);
    void setCachedLibraryData(key, data);
  } catch {
    // Prefetch is best-effort by definition.
  }
}

export { getCachedUserId };
