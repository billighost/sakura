"use client";

import { TrackRow } from "./TrackRow";
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
    <div className={`${styles.overlay} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.sheet} data-block-drag role="dialog" aria-label="Queue" aria-modal="true">
        <div className={styles.dragHandleRow}>
          <div className={styles.dragHandle} />
        </div>

        <div className={styles.header}>
          <h2 className={styles.title}>Queue</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close queue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

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
                  <span
                    className={styles.dragGrip}
                    aria-hidden="true"
                    onPointerDown={(e) => onRowPointerDown("upnext", i, e)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <circle cx="9" cy="6" r="1.4" />
                      <circle cx="15" cy="6" r="1.4" />
                      <circle cx="9" cy="12" r="1.4" />
                      <circle cx="15" cy="12" r="1.4" />
                      <circle cx="9" cy="18" r="1.4" />
                      <circle cx="15" cy="18" r="1.4" />
                    </svg>
                  </span>
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
                  <span
                    className={styles.dragGrip}
                    aria-hidden="true"
                    onPointerDown={(e) => onRowPointerDown("tail", i, e)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <circle cx="9" cy="6" r="1.4" />
                      <circle cx="15" cy="6" r="1.4" />
                      <circle cx="9" cy="12" r="1.4" />
                      <circle cx="15" cy="12" r="1.4" />
                      <circle cx="9" cy="18" r="1.4" />
                      <circle cx="15" cy="18" r="1.4" />
                    </svg>
                  </span>
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
      </div>
    </div>
  );
}
