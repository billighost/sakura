"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useOffline } from "next/offline";
import { usePlayer } from "./PlayerContext";
import {
  isTrackDownloaded,
  removeDownloadedTrack,
  getCachedUserId,
  getDeviceId,
} from "@/lib/offline-db";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";
import { isTelegramStreamUrl } from "@/lib/audioUrl";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import {
  DownloadedIcon,
  HeartIcon,
  MoreHorizontalIcon,
  NowPlayingBars,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  QueueIcon,
  ShareIcon,
  CloseIcon,
  TrashIcon,
} from "./Icons";
import { haptic } from "@/lib/haptics";
import styles from "./TrackRow.module.css";

/**
 * The single most-repeated element in the app.
 *
 * ── What it now says that it didn't ───────────────────────────────────────
 *
 * The row knew four things about a track and showed one of them. It computed
 * `offline` and used it only to decide whether a context-menu item appeared —
 * so whether a song was saved to the device, which is the whole point of this
 * app, was invisible until you opened a menu. And a track that *isn't* saved is
 * unplayable with no connection, which the row also didn't mention: with no
 * signal, tapping it just silently did nothing.
 *
 * Four states, each with one mark and no more:
 *   playing/paused  NowPlayingBars — a live readout that dances and freezes,
 *                   rather than the hand-rolled three-span `.eq` this replaces.
 *   saved offline   a small filled arrow beside the artist.
 *   downloading     a progress ring, using the real percentage. It used to fall
 *                   back to a hardcoded 30% or 70% when no progress had arrived,
 *                   which is an invented number presented as a measurement; now
 *                   an unknown percentage spins instead of lying.
 *   needs a signal  dimmed, with an offline glyph, when we're offline and this
 *                   one isn't on the device.
 *
 * ── Why the row is no longer role="button" ────────────────────────────────
 *
 * It was a `role="button"` `tabIndex={0}` div containing two links and three
 * buttons. Nested interactive content is invalid, it's why every child needed a
 * `stopPropagation`, and it made the row a keyboard trap that announced itself as
 * one control with five inside it. Tapping the row still plays — that's a pointer
 * affordance and it stays — but the keyboard path is now the title link (go to
 * the song) and the play button (play it), which is what the row already
 * contained.
 */

interface TrackRowProps {
  track: {
    id: string;
    title: string;
    artist: { name: string; id?: string };
    album?: { title: string; coverUrl?: string; id?: string } | null;
    coverUrl?: string;
    audioUrl?: string; // undefined for an online track that needs resolving
    duration: number;
    source?: "library" | "deezer";
  };
  queue?: TrackRowProps["track"][];
  index?: number;
  showNumber?: boolean;
  dragHandle?: React.ReactNode;
  onRemove?: (trackId: string) => void;
  hidePlayButton?: boolean;
  /**
   * Overrides what tapping the row does.
   *
   * The queue sheet needs this: its rows are already *in* the queue, so the
   * default behaviour — `play(track)` with no queue — threw the queue away and
   * started a one-song one in its place. Tapping a queued song now jumps to it.
   */
  onSelect?: () => void;
}

/**
 * Download progress ring.
 *
 * `progress` is null while the transfer has started but reported nothing yet, and
 * the ring spins in that state rather than showing a made-up figure. The speed
 * readout that used to be drawn as 6px text inside the 28px SVG is gone: at that
 * size it was illegible, and the ring already answers the only question the row
 * needs to ("is this moving?").
 */
function ProgressRing({ progress }: { progress: number | null }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 28 28"
      className={`${styles.ring} ${progress === null ? styles.ringSpin : ""}`}
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r={radius} className={styles.ringTrack} />
      <circle
        cx="14"
        cy="14"
        r={radius}
        className={styles.ringFill}
        strokeDasharray={circumference}
        // Indeterminate: a quarter arc, spun by CSS.
        strokeDashoffset={
          progress === null ? circumference * 0.75 : circumference * (1 - progress / 100)
        }
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}

export function TrackRow({
  track,
  queue,
  index,
  showNumber,
  dragHandle,
  onRemove,
  hidePlayButton,
  onSelect,
}: TrackRowProps) {
  const {
    currentTrack,
    isPlaying,
    play,
    togglePlay,
    addToQueue,
    favoriteTrackIds,
    toggleLikeTrack,
    showToast,
    downloadStates,
    downloadProgress,
    addToDownloadQueue,
    removeFromDownloadQueue,
  } = usePlayer();

  const networkDown = useOffline();

  const liked = favoriteTrackIds?.has(track.id) || false;

  /*
   * Is this the row that's playing?
   *
   * Ids first. The title/artist comparison is a necessary fallback — the same
   * song carries a different id on a search result, an album page and a library
   * row, so playing from one and then opening another would otherwise show
   * nothing as active — but on its own it matches *any* row with the same title
   * and artist, so a single that also appears on an album lit up twice.
   *
   * Duration disambiguates those: two masters of the same song are rarely within
   * a second of each other, and the tolerance absorbs the rounding difference
   * between a provider's length and our own stored one.
   */
  const idMatch =
    currentTrack?.id === track.id ||
    Boolean(currentTrack?.resolvedId && currentTrack.resolvedId === track.id);
  const nameMatch =
    !!currentTrack &&
    currentTrack.title.toLowerCase() === track.title.toLowerCase() &&
    currentTrack.artist.toLowerCase() === track.artist.name.toLowerCase() &&
    // A missing duration on either side can't disprove a match, so it passes.
    (!currentTrack.duration ||
      !track.duration ||
      Math.abs(currentTrack.duration - track.duration) <= 2);
  const isActive = idMatch || nameMatch;

  const [offline, setOffline] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [addPlaylistModalOpen, setAddPlaylistModalOpen] = useState(false);

  const cover = track.coverUrl || track.album?.coverUrl;

  const stateInQueue = downloadStates[track.id];
  const transferring = stateInQueue === "queued" || stateInQueue === "downloading";
  const busy = transferring || resolving;

  /*
   * Playable without a connection? Either it's on the device, or we're online.
   * Anything else is a row that will fail if tapped, and saying so up front is
   * better than a toast after the fact.
   */
  const unavailable = networkDown && !offline;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const uId = getCachedUserId();
        const dId = getDeviceId();
        const cached = await isTrackDownloaded(track.id, uId, dId);
        if (active) setOffline(cached);
      } catch {
        // An unreadable cache means "not saved" — the safe direction, since it
        // offers the download rather than promising a file that isn't there.
      }
    })();
    return () => {
      active = false;
    };
  }, [track.id, stateInQueue]);

  function playTrack(actualId: string, actualAudioUrl: string, actualCover?: string) {
    const q = queue?.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist.name,
      artistId: t.artist.id,
      album: t.album?.title,
      albumId: t.album?.id,
      coverUrl: t.coverUrl || t.album?.coverUrl || undefined,
      audioUrl: t.audioUrl || "",
      duration: t.duration,
    }));
    play(
      {
        id: track.id,
        resolvedId: actualId !== track.id ? actualId : undefined,
        title: track.title,
        artist: track.artist.name,
        artistId: track.artist.id,
        album: track.album?.title,
        albumId: track.album?.id,
        coverUrl: actualCover || cover,
        audioUrl: actualAudioUrl,
        duration: track.duration,
      },
      q,
      index
    );
  }

  async function handlePlay() {
    if (onSelect) {
      onSelect();
      return;
    }

    if (isActive) {
      togglePlay();
      return;
    }

    if (busy) return; // Already resolving; a second tap would start a second one.

    if (unavailable) {
      // Named rather than silent. The old row did nothing at all here.
      haptic("warning");
      showToast("You'll need a connection for this one — or save it for offline first", "error");
      return;
    }

    const isAudioUsable = isTelegramStreamUrl(track.audioUrl);

    // Already on the device, or already carrying a usable stream URL.
    if (offline || track.source === "library" || isAudioUsable) {
      playTrack(track.id, track.audioUrl!);
      return;
    }

    // Otherwise it has to be resolved and streamed first.
    setResolving(true);
    try {
      const res = await fetch("/api/music/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist.name,
          duration: track.duration,
          albumId: track.album?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data?.error || "No track id returned");

      const newId = data.id;
      const newAudioUrl = data.audioUrl;
      const finalCoverUrl = data.coverUrl || cover;

      setResolving(false);
      playTrack(newId, newAudioUrl, finalCoverUrl);

      // Save it in the background, boosted — they're listening to it now.
      addToDownloadQueue(
        [
          {
            id: newId,
            title: track.title,
            artist: track.artist.name,
            album: track.album?.title,
            coverUrl: finalCoverUrl,
            audioUrl: newAudioUrl,
            duration: track.duration,
            albumId: track.album?.id,
          },
        ],
        true
      );
    } catch {
      showToast("We couldn't get that song. Try again in a moment.", "error");
      /*
       * Clear the queued state as well as the local one. Without this,
       * `downloadStates[id]` stays "queued", the row shows a spinner forever and
       * tapping again is refused by the `busy` guard — so a single failure made
       * the row permanently unplayable until a reload.
       */
      removeFromDownloadQueue(track.id);
      setResolving(false);
      haptic("error");
    }
  }

  async function handleRemoveOffline() {
    try {
      // The full removal path, not the bare metadata delete: a track whose audio
      // landed under a resolved id (Deezer → Telegram) keeps its blob and any
      // partial chunks otherwise, so "Removed from device" would free nothing
      // while claiming to.
      await removeDownloadedTrack(track.id, getCachedUserId(), getDeviceId());
      setOffline(false);
      showToast("Removed from this device", "success");
    } catch {
      // Was a silent catch. A failed delete that says nothing leaves the user
      // believing they freed space they didn't.
      showToast("Couldn't remove that download", "error");
    }
  }

  function openMenuFromButton(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: rect.right - 180, y: rect.bottom + 4 });
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const rawProgress = downloadProgress[track.id];
  const progress = typeof rawProgress === "number" ? rawProgress : null;

  return (
    <div
      className={`${styles.root} ${isActive ? styles.active : ""} ${
        busy ? styles.busy : ""
      } ${unavailable ? styles.unavailable : ""}`}
      onClick={handlePlay}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {dragHandle}

      {showNumber && index !== undefined ? (
        <span className={`${styles.number} ${isActive ? styles.numberActive : ""}`}>
          {isActive ? <NowPlayingBars playing={isPlaying} size={13} /> : index + 1}
        </span>
      ) : null}

      {cover ? (
        <span className={styles.artWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" className={styles.art} referrerPolicy="no-referrer" />
          {isActive && !showNumber && (
            <span className={styles.artBadge}>
              <NowPlayingBars playing={isPlaying} size={13} />
            </span>
          )}
        </span>
      ) : null}

      <span className={styles.info}>
        <span className={styles.titleRow}>
          <Link
            href={`/track/${track.id}`}
            onClick={(e) => e.stopPropagation()}
            className={`${styles.title} ${isActive ? styles.titleActive : ""}`}
          >
            {track.title}
          </Link>
          {liked && (
            <span className={styles.likedMark} title="In your Liked songs">
              <HeartIcon size={11} filled />
            </span>
          )}
        </span>

        <span className={styles.meta}>
          {/*
            The offline marks lead the line rather than trailing it: they're the
            answer to "can I play this right now", which is worth more than the
            artist name you can already see from the title.
          */}
          {unavailable ? (
            <span className={styles.stateMark} title="Not saved to this device">
              <OfflineIcon size={12} />
            </span>
          ) : offline ? (
            <span className={`${styles.stateMark} ${styles.stateSaved}`} title="Saved on this device">
              <DownloadedIcon size={12} />
            </span>
          ) : null}

          {track.artist.id ? (
            <Link
              href={`/artist/${track.artist.id}`}
              onClick={(e) => e.stopPropagation()}
              className={styles.metaLink}
            >
              {track.artist.name}
            </Link>
          ) : (
            track.artist.name
          )}

          {track.album?.title ? (
            <>
              <span aria-hidden="true"> · </span>
              {track.album.id ? (
                <Link
                  href={`/album/${track.album.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className={styles.metaLink}
                >
                  {track.album.title}
                </Link>
              ) : (
                track.album.title
              )}
            </>
          ) : null}
        </span>
      </span>

      <span className={styles.actions}>
        {track.duration > 0 && !busy && (
          <span className={styles.duration}>{formatDuration(track.duration)}</span>
        )}

        {busy ? (
          <span className={styles.ringWrap}>
            <ProgressRing progress={progress} />
          </span>
        ) : (
          !hidePlayButton && (
            <button
              type="button"
              className={`${styles.playBtn} pressable`}
              onClick={(e) => {
                e.stopPropagation();
                handlePlay();
              }}
              aria-label={
                unavailable
                  ? `${track.title} needs a connection`
                  : isActive && isPlaying
                    ? `Pause ${track.title}`
                    : `Play ${track.title}`
              }
            >
              {isActive && isPlaying ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
            </button>
          )
        )}

        {onRemove && (
          <button
            type="button"
            data-no-drag
            className={`${styles.iconBtn} pressable`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onRemove(track.id);
            }}
            // The reorder grip and the row both listen for pointer events; this
            // control has to keep its own.
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            aria-label={`Remove ${track.title}`}
          >
            <CloseIcon size={15} />
          </button>
        )}

        <button
          type="button"
          className={`${styles.iconBtn} pressable`}
          onClick={openMenuFromButton}
          aria-label={`More options for ${track.title}`}
          aria-haspopup="menu"
        >
          <MoreHorizontalIcon size={18} />
        </button>
      </span>

      {menuPos && (
        <ContextMenu x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              toggleLikeTrack(track.id);
            }}
            icon={<HeartIcon size={16} filled={liked} />}
          >
            {liked ? "Remove from Liked" : "Add to Liked"}
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              setAddPlaylistModalOpen(true);
            }}
            icon={<PlusIcon size={16} />}
          >
            Add to a playlist
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              addToQueue({
                id: track.id,
                title: track.title,
                artist: track.artist.name,
                artistId: track.artist.id,
                album: track.album?.title,
                albumId: track.album?.id,
                coverUrl: cover,
                audioUrl: track.audioUrl || "",
                duration: track.duration,
              });
              showToast("Added to the queue", "success");
            }}
            icon={<QueueIcon size={16} />}
          >
            Play next
          </ContextMenuItem>

          {/*
            Saving is offered here when the song isn't on the device — previously
            the menu only ever showed the *remove* side, so the one action that
            makes this app useful on a plane was reachable from a collection page
            but not from an individual row.
          */}
          {offline ? (
            <ContextMenuItem
              onClick={() => {
                setMenuPos(null);
                handleRemoveOffline();
              }}
              icon={<TrashIcon size={16} />}
            >
              Remove download
            </ContextMenuItem>
          ) : (
            !busy && (
              <ContextMenuItem
                onClick={() => {
                  setMenuPos(null);
                  addToDownloadQueue([
                    {
                      id: track.id,
                      title: track.title,
                      artist: track.artist.name,
                      album: track.album?.title,
                      coverUrl: cover,
                      audioUrl: track.audioUrl,
                      duration: track.duration,
                      albumId: track.album?.id,
                    },
                  ]);
                }}
                icon={<DownloadedIcon size={16} />}
              >
                Save for offline
              </ContextMenuItem>
            )
          )}

          <ContextMenuItem
            onClick={() => {
              setMenuPos(null);
              // Into the share studio, like every other track share. Sending a
              // bare /track/<id> URL gave the recipient no idea what the song
              // was until they opened it.
              //
              // Flattened on the way out: a row's `artist`/`album` are objects,
              // while the studio (and the card renderer) want plain strings.
              window.dispatchEvent(
                new CustomEvent("sakura:share", {
                  detail: {
                    track: {
                      id: track.id,
                      title: track.title,
                      artist: track.artist.name,
                      album: track.album?.title,
                      coverUrl: track.coverUrl ?? track.album?.coverUrl,
                      audioUrl: track.audioUrl,
                      duration: track.duration,
                    },
                  },
                })
              );
            }}
            icon={<ShareIcon size={16} />}
          >
            Share
          </ContextMenuItem>
        </ContextMenu>
      )}

      <AddToPlaylistModal
        isOpen={addPlaylistModalOpen}
        onClose={() => setAddPlaylistModalOpen(false)}
        trackId={track.id}
      />
    </div>
  );
}
