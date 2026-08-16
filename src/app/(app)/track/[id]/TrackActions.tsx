"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "@/components/PlayerContext";
import { useShare } from "@/components/share/ShareContext";
import { AddToPlaylistModal } from "@/components/AddToPlaylistModal";
import { haptic } from "@/lib/haptics";
import { isTrackDownloaded, getCachedUserId, getDeviceId } from "@/lib/offline-db";
import {
  DownloadIcon,
  DownloadedIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ShareIcon,
  SpinnerIcon,
} from "@/components/Icons";
import styles from "./page.module.css";

/**
 * The track page's action row.
 *
 * This replaces a component that was only a play button, which meant the one
 * page dedicated to a single song was the one place you couldn't like it, save
 * it offline, add it to a playlist or share it — every one of which was
 * available from a track *row* two taps away. Everything here already exists in
 * the player context or the share studio; the page simply wasn't asking for it.
 */

interface TrackActionsProps {
  trackId: string;
  audioUrl: string;
  title: string;
  artistName: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

export function TrackActions({
  trackId,
  audioUrl,
  title,
  artistName,
  album,
  coverUrl,
  duration,
}: TrackActionsProps) {
  const {
    play,
    currentTrack,
    isPlaying,
    togglePlay,
    favoriteTrackIds,
    toggleLikeTrack,
    downloadStates,
    addToDownloadQueue,
  } = usePlayer();
  const { openShare } = useShare();

  const [offline, setOffline] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  /*
   * `resolvedId` as well as `id`: a track opened from a search result carries a
   * `deezer-…` id until it's been downloaded, at which point the player swaps in
   * the real row id. Matching on `id` alone meant the page's own song could be
   * playing while this button still offered to start it.
   */
  const isCurrent =
    currentTrack?.id === trackId || currentTrack?.resolvedId === trackId;
  const playingThis = isCurrent && isPlaying;

  const liked = favoriteTrackIds.has(trackId);
  const downloadState = downloadStates[trackId];
  const downloading = downloadState === "queued" || downloadState === "downloading";
  const saved = offline || downloadState === "completed";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cached = await isTrackDownloaded(trackId, getCachedUserId(), getDeviceId());
        if (active) setOffline(cached);
      } catch {
        // An unreadable cache means "not saved", which is the safe default —
        // it offers the download rather than claiming a file that isn't there.
      }
    })();
    return () => {
      active = false;
    };
  }, [trackId, downloadState]);

  const asTrack = {
    id: trackId,
    title,
    artist: artistName,
    album,
    coverUrl,
    audioUrl,
    duration: duration || 0,
  };

  function handlePlay() {
    haptic(isCurrent ? "selection" : "impact");
    if (isCurrent) {
      togglePlay();
      return;
    }
    play(asTrack, [asTrack]);
  }

  function handleDownload() {
    if (saved || downloading) return;
    haptic("impact");
    addToDownloadQueue([asTrack], true);
  }

  return (
    <>
      {/*
        Play alone on the first row, then the rest with words underneath. A
        single strip of five equal circles made "share" look as consequential as
        "play", and left four glyphs to be decoded — on the one page in the app
        dedicated to a single song, which is exactly where the actions should be
        unambiguous.
      */}
      <div className={styles.primaryActions}>
        <button
          type="button"
          className={`${styles.play} pressable`}
          onClick={handlePlay}
          aria-label={playingThis ? `Pause ${title}` : `Play ${title}`}
        >
          {playingThis ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          {playingThis ? "Pause" : "Play"}
        </button>
      </div>

      <div className={styles.secondaryActions}>
        <button
          type="button"
          className={`${styles.ghost} ${liked ? styles.ghostOn : ""} pressable`}
          onClick={() => {
            haptic(liked ? "selection" : "success");
            toggleLikeTrack(trackId);
          }}
          aria-pressed={liked}
        >
          <HeartIcon size={16} filled={liked} />
          {liked ? "Liked" : "Like"}
        </button>

        {/*
          Three states, matching the collection transport row: not saved offers
          the save, in-flight spins, and saved becomes a statement rather than a
          button that would do nothing.
        */}
        {saved ? (
          <span className={styles.savedBadge}>
            <DownloadedIcon size={16} />
            Saved offline
          </span>
        ) : (
          <button
            type="button"
            className={`${styles.ghost} pressable`}
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <SpinnerIcon size={16} className={styles.spin} />
            ) : (
              <DownloadIcon size={16} />
            )}
            {downloading ? "Saving…" : "Save offline"}
          </button>
        )}

        <button
          type="button"
          className={`${styles.ghost} pressable`}
          onClick={() => setPlaylistOpen(true)}
        >
          <PlusIcon size={16} />
          Add to playlist
        </button>

        <button
          type="button"
          className={`${styles.ghost} pressable`}
          onClick={() =>
            openShare({
              track: { id: trackId, title, artist: artistName, album, coverUrl, audioUrl, duration },
            })
          }
        >
          <ShareIcon size={16} />
          Share
        </button>
      </div>

      {playlistOpen && (
        <AddToPlaylistModal
          isOpen
          trackId={trackId}
          onClose={() => setPlaylistOpen(false)}
        />
      )}
    </>
  );
}
