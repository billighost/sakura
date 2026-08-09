"use client";

import { useCallback, useRef, useState } from "react";
import { usePlayer } from "@/components/PlayerContext";
import { isTrackDownloaded, getCachedUserId, getDeviceId } from "@/lib/offline-db";

/**
 * "Download everything here for offline" — as a single shared hook.
 *
 * Six pages (album, artist, liked, mix, playlist, system playlist) each had
 * their own copy of this: a sequential `for` loop that fetched each track and
 * awaited the blob inline. That meant the tab was tied up for minutes on a
 * long playlist, nothing could be cancelled, a single failure mid-way left no
 * record of what had succeeded, and closing the page lost the rest.
 *
 * `PlayerContext`'s download queue already solves all of that properly — it
 * persists across reloads, pauses on low battery in the background, boosts
 * whatever is about to play, and reports per-track progress. This hook just
 * hands the work to it.
 */

export type DownloadableTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration: number;
  albumId?: string;
};

/** Above this many tracks, confirm before committing someone's data/storage. */
const CONFIRM_THRESHOLD = 5;

export function useDownloadAll() {
  const { addToDownloadQueue, downloadStates, showToast } = usePlayer();
  /**
   * The guard and the spinner need different mechanisms, and using one for both
   * breaks the other.
   *
   * The ref is the mutex: `useState` doesn't flush synchronously, so two taps in
   * the same tick both read `checking === false` and both run the pre-flight.
   * Only a ref rejects the second one.
   *
   * The state is what `checking` returns, and it has to stay: four pages bind it
   * to a spinner (`checking: downloading` in artist, liked, mix and system
   * playlist pages). Returning the ref instead means mutating it never triggers
   * a render, so those spinners read `false` forever and never appear.
   */
  const checkingRef = useRef(false);
  const [checking, setChecking] = useState(false);

  const downloadAll = useCallback(
    async (tracks: DownloadableTrack[], label = "tracks") => {
      if (tracks.length === 0 || checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);

      try {
        const uId = getCachedUserId();
        const dId = getDeviceId();

        // Filter out anything already on the device or already moving through
        // the queue. Checked in parallel — this used to be a serial await per
        // track just to decide what to do.
        const flags = await Promise.all(
          tracks.map(async (t) => {
            if (downloadStates[t.id] === "completed" || downloadStates[t.id] === "downloading") {
              return false;
            }
            try {
              return !(await isTrackDownloaded(t.id, uId, dId));
            } catch {
              return true; // if the check fails, let the queue try
            }
          })
        );

        const pending = tracks.filter((_, i) => flags[i]);

        if (pending.length === 0) {
          showToast("Already downloaded", "success");
          return;
        }

        if (pending.length > CONFIRM_THRESHOLD) {
          const ok = window.confirm(
            `Download ${pending.length} ${label} for offline listening? This uses data and storage.`
          );
          if (!ok) return;
        }

        addToDownloadQueue(
          pending.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            coverUrl: t.coverUrl,
            audioUrl: t.audioUrl,
            duration: t.duration,
            albumId: t.albumId,
          }))
        );

        showToast(
          pending.length === 1
            ? "Downloading in the background"
            : `Downloading ${pending.length} tracks in the background`,
          "success"
        );
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [addToDownloadQueue, downloadStates, showToast]
  );

  /** True while the pre-flight "what's missing" check runs. */
  return { downloadAll, checking };
}
