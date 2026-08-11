/**
 * Small helpers shared by every collection page.
 *
 * These were each implemented three or four times with quiet differences:
 * `formatTotalDurationLong` said "1 hours", one shuffle used
 * `sort(() => Math.random() - 0.5)` — which is not a shuffle, it's a biased
 * permutation that leaves the first few items near where they started, and on
 * V8 it can even return the input unchanged for short arrays.
 */

/** Fisher-Yates. Unbiased, unlike the `sort(random)` idiom it replaces. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * "12 songs · 48 min" — the metadata line under a collection title.
 *
 * `totalSeconds` is summed from track durations, which can be missing or NaN
 * for a track that never loaded metadata. Guarding here rather than at each
 * call site is what keeps "NaN min" off the screen.
 */
export function formatCollectionMeta(count: number, totalSeconds: number): string {
  const songs = `${count} song${count === 1 ? "" : "s"}`;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return songs;

  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);

  if (hours > 0) {
    return `${songs} · ${hours} hr${minutes ? ` ${minutes} min` : ""}`;
  }
  // Under a minute still reads as "1 min" rather than "0 min", because a
  // collection that exists has some length.
  return `${songs} · ${Math.max(1, minutes)} min`;
}

/** "1.4 GB" / "820 MB". Used for on-device storage readouts. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "under 1 MB";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
