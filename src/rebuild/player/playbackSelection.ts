import type { PlaybackProgress, PlaybackProgressStore } from "../app/playbackProgress";

/** An unchanged verse remains the same external-store snapshot. The clock can
 * advance without asking the manuscript or its underlay to render again. */
export function createPlaybackSelection<T>(store: PlaybackProgressStore, select: (progress: PlaybackProgress) => T, equal: (left: T, right: T) => boolean) {
  const server = select(store.getServerSnapshot());
  let progress = store.getSnapshot(), value = select(progress);
  return {
    subscribe: store.subscribe,
    getServerSnapshot: () => server,
    getSnapshot: () => {
      const nextProgress = store.getSnapshot();
      if (nextProgress !== progress) {
        progress = nextProgress;
        const next = select(progress);
        if (!equal(value, next)) value = next;
      }
      return value;
    },
  };
}
