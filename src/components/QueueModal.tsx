"use client";

import { TrackRow } from "./TrackRow";
import { Sheet } from "./Sheet";
import { DragHandleIcon } from "./Icons";
import styles from "./QueueModal.module.css";

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

interface DragQueueItem {
  list: "upnext" | "tail";
  index: number;
  deltaY: number;
  rowHeight: number;
}

interface QueueModalProps {
  open: boolean;
  onClose: () => void;
  currentTrack: QueueTrack;
  isPlaying: boolean;
  albumLabel: string;
  currentIndex: number;
  upNextQueue: QueueTrack[];
  tailQueue: QueueTrack[];
  dragQueueItem: DragQueueItem | null;
  onRowPointerDown: (list: "upnext" | "tail", index: number, e: React.PointerEvent) => void;
  onRowPointerMove: (e: React.PointerEvent) => void;
  onRowPointerUp: (e: React.PointerEvent) => void;
  onRowPointerCancel: () => void;
  onGoToQueueItem: (absoluteIndex: number) => void;
  onRemoveFromUpNext: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  /** Whether the taste radio is refilling this queue. */
  radioActive?: boolean;
}

/**
 * Reorder grip. `touch-action: none` is load-bearing — without it the sheet's
 * scroller claims the vertical drag and the row never moves.
 */
function QueueGrip({
  list,
  index,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  list: "upnext" | "tail";
  index: number;
  onPointerDown: (list: "upnext" | "tail", index: number, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  return (
    <span
      className={styles.dragGrip}
      aria-hidden="true"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => onPointerDown(list, index, e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <DragHandleIcon size={16} />
    </span>
  );
}

export function QueueModal({
  open,
  onClose,
  currentTrack,
  isPlaying,
  albumLabel,
  currentIndex,
  upNextQueue,
  tailQueue,
  dragQueueItem,
  onRowPointerDown,
  onRowPointerMove,
  onRowPointerUp,
  onRowPointerCancel,
  onGoToQueueItem,
  onRemoveFromUpNext,
  onRemoveTrack,
  radioActive = false,
}: QueueModalProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Queue" maxHeight="82dvh">
      <div className={styles.list}>
          <div className={styles.listHeader}>Now Playing</div>
          <div className={styles.rowActive}>
            <TrackRow
              track={{
                id: currentTrack.id,
                title: currentTrack.title,
                artist: { name: currentTrack.artist, id: currentTrack.artistId },
                album: currentTrack.album ? { title: currentTrack.album, id: currentTrack.albumId, coverUrl: currentTrack.coverUrl } : null,
                coverUrl: currentTrack.coverUrl,
                audioUrl: currentTrack.audioUrl,
                duration: currentTrack.duration || 0,
              }}
              index={currentIndex}
              hidePlayButton
            />
          </div>

          {upNextQueue.length > 0 && (
            <>
              <div className={styles.listHeader}>Up Next</div>
              {upNextQueue.map((t, i) => {
                const isDragging = dragQueueItem?.list === "upnext" && dragQueueItem.index === i;
                const rowTrack = {
                  id: t.id,
                  title: t.title,
                  artist: { name: t.artist, id: t.artistId },
                  album: t.album ? { title: t.album, id: t.albumId, coverUrl: t.coverUrl } : null,
                  coverUrl: t.coverUrl,
                  audioUrl: t.audioUrl,
                  duration: t.duration || 0,
                };

                const dragGripNode = (
                  <QueueGrip
                    list="upnext"
                    index={i}
                    onPointerDown={onRowPointerDown}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                  />
                );

                return (
                  <div
                    key={t.id}
                    data-queue-row
                    className={`${styles.row} ${isDragging ? styles.rowDragging : ""}`}
                    style={isDragging ? { transform: `translateY(${dragQueueItem!.deltaY}px)`, transition: "none" } : undefined}
                  >
                    <TrackRow
                      track={rowTrack}
                      dragHandle={dragGripNode}
                      onRemove={onRemoveFromUpNext}
                      index={i}
                      hidePlayButton
                    />
                  </div>
                );
              })}
            </>
          )}

          {tailQueue.length > 0 && (
            <>
              <div className={styles.listHeader}>Next from: {albumLabel}</div>
              {tailQueue.map((t, i) => {
                const isDragging = dragQueueItem?.list === "tail" && dragQueueItem.index === i;
                const absoluteIndex = currentIndex + 1 + i;
                const rowTrack = {
                  id: t.id,
                  title: t.title,
                  artist: { name: t.artist, id: t.artistId },
                  album: t.album ? { title: t.album, id: t.albumId, coverUrl: t.coverUrl } : null,
                  coverUrl: t.coverUrl,
                  audioUrl: t.audioUrl,
                  duration: t.duration || 0,
                };

                const dragGripNode = (
                  <QueueGrip
                    list="tail"
                    index={i}
                    onPointerDown={onRowPointerDown}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                  />
                );

                return (
                  <div
                    key={t.id}
                    data-queue-row
                    className={`${styles.row} ${isDragging ? styles.rowDragging : ""}`}
                    style={isDragging ? { transform: `translateY(${dragQueueItem!.deltaY}px)`, transition: "none" } : undefined}
                  >
                    <TrackRow
                      track={rowTrack}
                      dragHandle={dragGripNode}
                      onRemove={onRemoveTrack}
                      index={absoluteIndex}
                      hidePlayButton
                    />
                  </div>
                );
              })}
            </>
          )}

          {upNextQueue.length === 0 && tailQueue.length === 0 && (
            <div className={styles.emptyState}>
              {radioActive
                ? "Nothing queued — we'll keep playing music that fits your taste."
                : "Nothing queued next. Add songs to keep the music going."}
            </div>
          )}

          {radioActive && (upNextQueue.length > 0 || tailQueue.length > 0) && (
            <div className={styles.radioNote}>
              <span className={styles.radioDot} aria-hidden="true" />
              Autoplay is on — more like this will keep coming.
            </div>
          )}
      </div>
    </Sheet>
  );
}
