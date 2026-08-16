"use client";

import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { usePlayer } from "./PlayerContext";
import {
  AlbumIcon,
  DownloadIcon,
  DownloadedIcon,
  HeartIcon,
  PlaylistIcon,
  QueueIcon,
  RadioIcon,
  ShareIcon,
  SpinnerIcon,
  UserIcon,
} from "./Icons";
import styles from "./NowPlayingMenu.module.css";

interface NowPlayingTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

interface NowPlayingMenuProps {
  open: boolean;
  onClose: () => void;
  track: NowPlayingTrack;
  /** Dismisses the player itself — navigation out needs the player gone. */
  onLeavePlayer: () => void;
  onAddToPlaylist: () => void;
  onShare: () => void;
}

/**
 * The now-playing overflow menu, behind the header's "⋯".
 *
 * That button existed before this and did nothing at all — no handler, no menu,
 * just an `aria-label` promising "More options". Everything here is wired to a
 * capability the app already has; nothing is a placeholder.
 *
 * Ordered by how often it's wanted, not by category: the two queue actions and
 * "add to playlist" are the reasons people open this menu, so they're at the top
 * where the thumb already is. Navigation is last, because it means leaving the
 * player.
 *
 * Rows that can't apply are *absent*, not disabled — there's no album to go to
 * for a track imported from a link, and a greyed row that never becomes
 * available is just a permanent question.
 */
export function NowPlayingMenu({
  open,
  onClose,
  track,
  onLeavePlayer,
  onAddToPlaylist,
  onShare,
}: NowPlayingMenuProps) {
  const router = useRouter();
  const {
    playNext,
    addToQueue,
    startRadio,
    radioLoading,
    addToDownloadQueue,
    downloadStates,
    isLiked,
    toggleLiked,
    showToast,
  } = usePlayer();

  const downloadState = downloadStates[track.id] ?? "idle";
  const downloaded = downloadState === "completed";
  const downloading = downloadState === "queued" || downloadState === "downloading";

  /** Every row closes the menu; some also close the player. */
  function act(fn: () => void, alsoLeave = false) {
    onClose();
    fn();
    if (alsoLeave) onLeavePlayer();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Song options" maxHeight="80dvh">
      <div className={styles.identity}>
        {track.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className={styles.cover} src={track.coverUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className={styles.cover} data-placeholder>
            <AlbumIcon size={18} />
          </span>
        )}
        <span className={styles.identityText}>
          <span className={styles.identityTitle}>{track.title}</span>
          <span className={styles.identityArtist}>{track.artist}</span>
        </span>
      </div>

      <div className={styles.rows} role="group" aria-label="Actions for this song">
        <button
          type="button"
          className={`${styles.row} pressable`}
          onClick={() => act(toggleLiked)}
        >
          <HeartIcon size={19} filled={isLiked} />
          <span>{isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}</span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          onClick={() => act(onAddToPlaylist)}
        >
          <PlaylistIcon size={19} />
          <span>Add to playlist</span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          onClick={() =>
            act(() => {
              playNext(track);
              showToast("Playing next", "success");
            })
          }
        >
          <QueueIcon size={19} />
          <span>Play next</span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          onClick={() =>
            act(() => {
              addToQueue(track);
              showToast("Added to queue", "success");
            })
          }
        >
          <QueueIcon size={19} />
          <span>Add to queue</span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          disabled={downloaded || downloading}
          onClick={() =>
            act(() => {
              addToDownloadQueue(
                [
                  {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    coverUrl: track.coverUrl,
                    audioUrl: track.audioUrl,
                    duration: track.duration,
                  },
                ],
                true
              );
              // The queue itself is silent, and this sheet closes on the way
              // out — without a toast the tap would have no visible result at
              // all until the file finished.
              showToast("Downloading for offline", "success");
            })
          }
        >
          {downloaded ? (
            <DownloadedIcon size={19} />
          ) : downloading ? (
            <SpinnerIcon size={19} className={styles.spin} />
          ) : (
            <DownloadIcon size={19} />
          )}
          <span>
            {downloaded
              ? "Downloaded"
              : downloading
                ? "Downloading…"
                : "Download for offline"}
          </span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          disabled={radioLoading}
          onClick={() =>
            act(() => {
              void startRadio(track);
            })
          }
        >
          <RadioIcon size={19} />
          <span>Start radio from this song</span>
        </button>

        <button
          type="button"
          className={`${styles.row} pressable`}
          onClick={() => act(onShare)}
        >
          <ShareIcon size={19} />
          <span>Share</span>
        </button>

        {track.artistId && (
          <button
            type="button"
            className={`${styles.row} pressable`}
            onClick={() => act(() => router.push(`/artist/${track.artistId}`), true)}
          >
            <UserIcon size={19} />
            <span>Go to {track.artist}</span>
          </button>
        )}

        {track.albumId && (
          <button
            type="button"
            className={`${styles.row} pressable`}
            onClick={() => act(() => router.push(`/album/${track.albumId}`), true)}
          >
            <AlbumIcon size={19} />
            <span>Go to {track.album || "album"}</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}
