"use client";

import { useEffect, useState } from "react";
import { getCachedUserId, getDeviceId, isTrackDownloaded } from "@/lib/offline-db";
import { usePlayer } from "@/components/PlayerContext";

/**
 * How much of a collection is already on this device.
 *
 * Three pages needed this and all three got it slightly wrong in the same two
 * ways:
 *
 *  1. **Unscoped lookups.** They called `isTrackDownloaded(t.id)` and let the
 *     user and device arguments default. Those defaults read `localStorage` on
 *     every single call, and — worse — they're resolved *per track*, so a
 *     sign-out landing mid-loop compares the first half of the list against one
 *     user and the second half against another. Resolving both once, up front,
 *     is both correct and one storage read instead of N.
 *
 *  2. **All-or-nothing.** They broke out of the loop at the first missing
 *     track, so the only answer available was a boolean. That's why the UI
 *     could offer "download all" for a collection with one song left to fetch
 *     and give no hint that the other forty-nine were done. Counting costs the
 *     same asymptotically and lets the button say something true.
 *
 * Re-runs when the download queue's state changes, so a completed download
 * updates the count without a refresh.
 */
export function useDownloadedCount(trackIds: string[]): { downloaded: number; total: number } {
  const { downloadStates } = usePlayer();
  const [downloaded, setDownloaded] = useState(0);

  // A stable dependency: the array identity changes on every render of the
  // calling page (it's usually a .map), which would restart the effect forever.
  const key = trackIds.join(",");

  useEffect(() => {
    if (trackIds.length === 0) return;

    let cancelled = false;

    void (async () => {
      // Resolved once, before the loop — see note 1 above.
      const userId = getCachedUserId();
      const deviceId = getDeviceId();

      let count = 0;
      for (const id of trackIds) {
        // Bail out of a stale pass rather than finishing it: on a long list the
        // user can navigate away well before this completes.
        if (cancelled) return;
        if (await isTrackDownloaded(id, userId, deviceId)) count += 1;
      }

      if (!cancelled) setDownloaded(count);
    })();

    return () => {
      cancelled = true;
    };
    // `key` stands in for trackIds; downloadStates re-checks after a download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, downloadStates]);

  /*
   * Derived during render rather than stored, so an empty list reports zero
   * immediately instead of one render later. Without this the effect had to
   * `setDownloaded(0)` on the empty path — a synchronous setState in an effect
   * body, which is a cascading render for a value that was already knowable.
   */
  return { downloaded: trackIds.length === 0 ? 0 : downloaded, total: trackIds.length };
}
