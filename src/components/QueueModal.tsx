"use client";

import { useEffect, useRef } from "react";
import { TrackRow } from "./TrackRow";
import { Sheet } from "./Sheet";
import { DragHandleIcon } from "./Icons";
import { useReorder } from "@/lib/useReorder";
import styles from "./QueueModal.module.css";

/**
 * The queue.
 *
 * ── What changed about reordering ──────────────────────────────────────────
 *
 * It had a drag, and the drag half-worked: the row you held followed your finger
 * and nothing else moved. No gap opened, no neighbour shifted, so there was no
 * way to tell where the row would land until you let go and found out. The
 * pointer plumbing for it also lived in FullPlayer — four handlers and a piece of
 * drag state threaded through six props into this component — which is why the
 * same feature couldn't be reused on the playlist page.
 *
 * That's now `useReorder`, shared with the playlist page: neighbours displace to
 * open the gap, each detent passed fires a light haptic, the arrow keys on the
 * grip move a row for anyone not using a pointer, and dragging near the sheet's
 * edge scrolls it. FullPlayer just passes the two reorder callbacks the player
 * context has always exposed.
 *
 * ── And tapping a row ─────────────────────────────────────────────────────
 *
 * `onGoToQueueItem` was accepted as a prop and never called. Rows fell through to
 * TrackRow's default tap, which is `play(thisTrack)` with no queue — so tapping a
 * song in your queue *replaced* the queue with just that song. Now it jumps.
 */

interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration?: number;
}

interface QueueModalProps {
  open: boolean;
  onClose: () => void;
  currentTrack: QueueTrack;
  albumLabel: string;
  currentIndex: number;
  upNextQueue: QueueTrack[];
  tailQueue: QueueTrack[];
  onReorderUpNext: (from: number, to: number) => void;
  onReorderTail: (from: number, to: number) => void;
  onGoToQueueItem: (absoluteIndex: number) => void;
  onRemoveFromUpNext: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  /** Whether the taste radio is refilling this queue. */
  radioActive?: boolean;
}

function toRowTrack(t: QueueTrack) {
  return {
    id: t.id,
    title: t.title,
    artist: { name: t.artist, id: t.artistId },
    album: t.album ? { title: t.album, id: t.albumId, coverUrl: t.coverUrl } : null,
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl,
    duration: t.duration || 0,
  };
}

export function QueueModal({
  open,
  onClose,
  currentTrack,
  albumLabel,
  currentIndex,
  upNextQueue,
  tailQueue,
  onReorderUpNext,
  onReorderTail,
  onGoToQueueItem,
  onRemoveFromUpNext,
  onRemoveTrack,
  radioActive = false,
}: QueueModalProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const upNextRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);

  /*
   * The scrolling ancestor is Sheet's own body, which this component doesn't own
   * a ref to. Resolving it on open is less brittle than having Sheet hand its
   * internals out as a prop, and edge auto-scroll is the only thing that needs
   * it — a null scroller simply means no auto-scroll.
   *
   * Written straight into the ref rather than through state: `useReorder` reads
   * it inside pointer handlers, so nothing has to re-render when it resolves,
   * and mirroring it into a ref during render is a ref write in the render pass.
   */
  const scrollerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    scrollerRef.current = open
      ? (rootRef.current?.closest<HTMLElement>("[data-sheet-body]") ?? null)
      : null;
  }, [open]);

  const upNextReorder = useReorder({
    containerRef: upNextRef,
    count: upNextQueue.length,
    onReorder: onReorderUpNext,
    scrollerRef,
  });

  const tailReorder = useReorder({
    containerRef: tailRef,
    count: tailQueue.length,
    onReorder: onReorderTail,
    scrollerRef,
  });

  return (
    <Sheet open={open} onClose={onClose} title="Queue" maxHeight="82dvh">
      <div className={styles.list} ref={rootRef}>
        <p className={styles.listHeader}>Now playing</p>
        <div className={styles.rowActive}>
          <TrackRow track={toRowTrack(currentTrack)} index={currentIndex} hidePlayButton />
        </div>

        {upNextQueue.length > 0 && (
          <>
            <p className={styles.listHeader}>Up next</p>
            <div ref={upNextRef}>
              {upNextQueue.map((t, i) => (
                <div
                  key={t.id}
                  className={`${styles.row} ${
                    upNextReorder.dragging === i ? styles.rowDragging : ""
                  }`}
                  {...upNextReorder.itemProps(i)}
                >
                  <TrackRow
                    track={toRowTrack(t)}
                    index={i}
                    hidePlayButton
                    onRemove={onRemoveFromUpNext}
                    /*
                     * "Up next" is inserted ahead of the queue's natural order,
                     * so its entries have no absolute index to jump to. Playing
                     * one means promoting it, which the queue owner does by
                     * removing it and letting it play next — out of scope for a
                     * tap, so these rows aren't selectable and the grip and the
                     * remove button are the two things you can do.
                     */
                    dragHandle={
                      <button
                        type="button"
                        className={styles.grip}
                        aria-label={`Move ${t.title}. Use the up and down arrow keys.`}
                        {...upNextReorder.gripProps}
                      >
                        <DragHandleIcon size={16} />
                      </button>
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {tailQueue.length > 0 && (
          <>
            <p className={styles.listHeader}>Next from {albumLabel}</p>
            <div ref={tailRef}>
              {tailQueue.map((t, i) => (
                <div
                  key={t.id}
                  className={`${styles.row} ${
                    tailReorder.dragging === i ? styles.rowDragging : ""
                  }`}
                  {...tailReorder.itemProps(i)}
                >
                  <TrackRow
                    track={toRowTrack(t)}
                    index={currentIndex + 1 + i}
                    hidePlayButton
                    onRemove={onRemoveTrack}
                    onSelect={() => onGoToQueueItem(currentIndex + 1 + i)}
                    dragHandle={
                      <button
                        type="button"
                        className={styles.grip}
                        aria-label={`Move ${t.title}. Use the up and down arrow keys.`}
                        {...tailReorder.gripProps}
                      >
                        <DragHandleIcon size={16} />
                      </button>
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {upNextQueue.length === 0 && tailQueue.length === 0 && (
          <p className={styles.emptyState}>
            {radioActive
              ? "Nothing queued — Sakura will keep playing music that fits your taste."
              : "Nothing queued next. Add songs from any list to keep the music going."}
          </p>
        )}

        {radioActive && (upNextQueue.length > 0 || tailQueue.length > 0) && (
          <p className={styles.radioNote}>
            <span className={styles.radioDot} aria-hidden="true" />
            Autoplay is on — more like this will keep coming.
          </p>
        )}
      </div>
    </Sheet>
  );
}
