"use client";

import styles from "./QueueModal.module.css";

interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
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
}

/**
 * Queue, as a bottom sheet over the player — not a swap-out of the album art.
 * All the drag-to-reorder gesture state/logic still lives in FullPlayer (it's
 * entangled with that component's long-press + pointer capture machinery);
 * this component is presentation only.
 */
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
            <img src={currentTrack.coverUrl || ""} alt="" className={styles.art} />
            <div className={styles.info}>
              <div className={styles.titleActive}>{currentTrack.title}</div>
              <div className={styles.artist}>{currentTrack.artist}</div>
            </div>
            {isPlaying && (
              <div className={styles.nowPlayingBadge} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {upNextQueue.length > 0 && (
            <>
              <div className={styles.listHeader}>Up Next</div>
              {upNextQueue.map((t, i) => {
                const isDragging = dragQueueItem?.list === "upnext" && dragQueueItem.index === i;
                return (
                  <div
                    key={t.id}
                    className={`${styles.row} ${isDragging ? styles.rowDragging : ""}`}
                    style={isDragging ? { transform: `translateY(${dragQueueItem!.deltaY}px)`, transition: "none" } : undefined}
                    onPointerDown={(e) => onRowPointerDown("upnext", i, e)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                    onClick={() => {
                      if (!dragQueueItem) onGoToQueueItem(currentIndex + 1);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Play ${t.title} by ${t.artist}`}
                  >
                    <span className={styles.dragGrip} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <circle cx="9" cy="6" r="1.4" />
                        <circle cx="15" cy="6" r="1.4" />
                        <circle cx="9" cy="12" r="1.4" />
                        <circle cx="15" cy="12" r="1.4" />
                        <circle cx="9" cy="18" r="1.4" />
                        <circle cx="15" cy="18" r="1.4" />
                      </svg>
                    </span>
                    <img src={t.coverUrl || ""} alt="" className={styles.art} />
                    <div className={styles.info}>
                      <div className={styles.title2}>{t.title}</div>
                      <div className={styles.artist}>{t.artist}</div>
                    </div>
                    <button
                      data-no-drag
                      className={styles.removeBtn}
                      onClick={() => onRemoveFromUpNext(t.id)}
                      aria-label={`Remove ${t.title} from queue`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
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
                return (
                  <div
                    key={t.id}
                    className={`${styles.row} ${isDragging ? styles.rowDragging : ""}`}
                    style={isDragging ? { transform: `translateY(${dragQueueItem!.deltaY}px)`, transition: "none" } : undefined}
                    onPointerDown={(e) => onRowPointerDown("tail", i, e)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                    onClick={() => {
                      if (!dragQueueItem) onGoToQueueItem(absoluteIndex);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Play ${t.title} by ${t.artist}`}
                  >
                    <span className={styles.dragGrip} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <circle cx="9" cy="6" r="1.4" />
                        <circle cx="15" cy="6" r="1.4" />
                        <circle cx="9" cy="12" r="1.4" />
                        <circle cx="15" cy="12" r="1.4" />
                        <circle cx="9" cy="18" r="1.4" />
                        <circle cx="15" cy="18" r="1.4" />
                      </svg>
                    </span>
                    <img src={t.coverUrl || ""} alt="" className={styles.art} />
                    <div className={styles.info}>
                      <div className={styles.title2}>{t.title}</div>
                      <div className={styles.artist}>{t.artist}</div>
                    </div>
                    <button
                      data-no-drag
                      className={styles.removeBtn}
                      onClick={() => onRemoveTrack(t.id)}
                      aria-label={`Remove ${t.title} from queue`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {upNextQueue.length === 0 && tailQueue.length === 0 && (
            <div className={styles.emptyState}>Nothing queued next. Add songs to keep the music going.</div>
          )}
        </div>
      </div>
    </div>
  );
}
