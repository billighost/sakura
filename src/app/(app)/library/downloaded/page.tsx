"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/components/PlayerContext";
import {
  CollectionHero,
  CollectionTransport,
  EmptyState,
  TrackListSkeleton,
} from "@/components/CollectionHero";
import { DownloadedIcon, OfflineIcon, TrashIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { getAllDownloadedTracks, getCachedUserId, getDeviceId, clearAudioCache } from "@/lib/offline-db";
import { formatCollectionMeta, shuffled } from "@/lib/collection";
import { haptic } from "@/lib/haptics";
import styles from "./page.module.css";

interface OfflineTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  savedAt: number;
}

export default function DownloadedPage() {
  const { play, downloadQueue, downloadStates, showToast } = usePlayer();
  const [tracks, setTracks] = useState<OfflineTrack[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Reload whenever a queued download lands. The old version fetched once on
   * mount, so a track that finished while the page was open stayed invisible
   * until a full reload — on a page whose entire job is to show what's saved,
   * the fresh completion is the one row the user is actually waiting for.
   */
  const queueSignature = downloadQueue.map((q) => `${q.id}:${downloadStates[q.id]}`).join(",");

  /* Bumped to force a re-read after clearing, which changes nothing the
   * effect's other dependencies would notice. */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const uId = getCachedUserId();
        const dId = getDeviceId();
        const all = await getAllDownloadedTracks(uId, dId);
        if (cancelled) return;
        setTracks([...all].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
      } catch {
        /* silent — nothing useful to do with an IndexedDB failure here */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-runs when a queued download's state flips (queued → downloading →
    // completed), which is when new rows appear in the store.
  }, [reloadToken, queueSignature]);

  /**
   * Rows for downloads in flight but not yet in the store.
   *
   * `savedAt: 0` rather than `Date.now()`: these are prepended unconditionally
   * (they're the ones the user is waiting on), so the field is never actually
   * sorted by — and calling a clock during render makes the memo produce a
   * different value on every pass, which is both impure and defeats the memo.
   */
  const pending = useMemo(
    () =>
      downloadQueue
        .filter((item) => {
          const state = downloadStates[item.id];
          return (state === "queued" || state === "downloading") && !tracks.some((t) => t.id === item.id);
        })
        .map((item) => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverUrl: item.coverUrl,
          audioUrl: item.audioUrl || "",
          duration: item.duration || 0,
          savedAt: 0,
        })),
    [downloadQueue, downloadStates, tracks]
  );

  const display = useMemo(() => [...pending, ...tracks], [pending, tracks]);

  const toQueue = (t: OfflineTrack) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl,
    duration: t.duration,
  });

  const playAll = () => {
    const q = display.map(toQueue);
    if (q.length) play(q[0], q);
  };

  const shufflePlay = () => {
    const q = shuffled(display).map(toQueue);
    if (q.length) play(q[0], q);
  };

  /* Summed play time, guarded per track: a download interrupted before its
   * metadata landed can carry a NaN duration, and one of those poisons the
   * whole sum into "NaN min". */
  const totalSeconds = useMemo(
    () =>
      display.reduce((sum, t) => {
        const n = Number(t.duration);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [display]
  );

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  /**
   * Deleting every download is irreversible and re-downloading costs real data,
   * so it asks first. The previous pages had no destructive control at all,
   * which meant the only way to reclaim the space was Settings → clear storage.
   */
  const removeAll = useCallback(() => {
    setClearing(true);
    void (async () => {
      try {
        await clearAudioCache();
        reload();
        haptic("success");
        showToast("Downloads removed from this device.", "success");
      } catch {
        haptic("error");
        showToast("Couldn't remove downloads. Try again.", "error");
      } finally {
        setClearing(false);
        setConfirmClear(false);
      }
    })();
  }, [reload, showToast]);

  const trackRows = display.map((t) => ({
    id: t.id,
    title: t.title,
    artist: { name: t.artist },
    album: t.album ? { title: t.album, coverUrl: t.coverUrl } : null,
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl,
    duration: t.duration,
  }));

  const meta = loading && display.length === 0 ? undefined : formatCollectionMeta(display.length, totalSeconds);

  return (
    <div className={styles.page}>
      <CollectionHero
        eyebrow="On this device"
        title="Downloaded Songs"
        coverUrl={tracks[0]?.coverUrl}
        fallbackIcon={<DownloadedIcon size={36} />}
        loading={loading && display.length === 0}
        meta={meta}
        actions={
          display.length > 0 ? (
            <button
              type="button"
              className={`${styles.iconBtn} pressable`}
              onClick={() => {
                haptic("selection");
                setConfirmClear(true);
              }}
              aria-label="Remove all downloads from this device"
            >
              <TrashIcon size={18} />
            </button>
          ) : undefined
        }
      >
        {display.length > 0 && (
          <p className={styles.note}>
            <OfflineIcon size={14} />
            Saved to this device — plays with no connection.
          </p>
        )}
      </CollectionHero>

      {display.length > 0 && (
        <CollectionTransport
          onPlay={playAll}
          onShuffle={shufflePlay}
          disabled={display.length === 0}
          // Everything on this page is already downloaded by definition, so
          // the transport shows a statement rather than a button.
          downloaded={display.length}
          total={display.length}
        />
      )}

      <div className={styles.list}>
        {loading && display.length === 0 ? (
          <TrackListSkeleton rows={6} />
        ) : display.length === 0 ? (
          <EmptyState
            icon={<DownloadedIcon size={26} />}
            title="Nothing saved yet"
            body="Download a song (or a whole playlist) and it lands here, ready to play with no connection. It only counts against your phone's storage, not your data."
            action={{ href: "/library", label: "Browse your library" }}
            secondaryAction={{ href: "/search", label: "Find something to save" }}
          />
        ) : (
          <div className="anim-stagger">
            {display.map((track, i) => (
              <div key={track.id} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <TrackRow track={trackRows[i]} queue={trackRows} index={i} showNumber />
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        variant="dialog"
        title="Remove all downloads?"
        dismissible={!clearing}
        footer={
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={`${styles.confirmCancel} pressable`}
              onClick={() => setConfirmClear(false)}
              disabled={clearing}
            >
              Keep them
            </button>
            <button
              type="button"
              className={`${styles.confirmDanger} pressable`}
              onClick={removeAll}
              disabled={clearing}
            >
              {clearing ? "Removing…" : `Remove ${display.length}`}
            </button>
          </div>
        }
      >
        <p className={styles.confirmBody}>
          This frees up space on your phone. The songs stay in your library and
          you can download them again whenever you like — but that uses data.
        </p>
      </Sheet>
    </div>
  );
}
