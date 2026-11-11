import type { MusicTrack, QueueEntry } from "./types";

/** Prepare before the last song ends; background pages cannot depend on a
 * timer or a new network request running at the transition. */
export function needsAutoplay(entries: readonly QueueEntry[], currentId: string | null, minimum = 4): boolean {
  const current = entries.findIndex(entry => entry.entryId === currentId);
  return current >= 0 && entries.length - current - 1 < minimum;
}

export interface AutoplayOptions { limit?: number; historyLimit?: number; additions?: number; localOnly?: boolean; allowReplay?: boolean }
/** Keep the listener's future choices in order and retire only old playback
 * history. Fresh suggestions lead; an exhausted offline shelf can cycle its
 * older songs without repeating the current recording immediately. */
export function appendAutoplay(entries: readonly QueueEntry[], currentId: string | null, candidates: readonly MusicTrack[], identify: (track: MusicTrack) => string, entryId: () => string, options: AutoplayOptions = {}): QueueEntry[] {
  const current = entries.findIndex(entry => entry.entryId === currentId);
  if (current < 0) return entries as QueueEntry[];
  const limit = Math.max(1, Math.min(80, options.limit ?? 80)), historyLimit = Math.max(0, Math.min(40, options.historyLimit ?? 12));
  const future = entries.slice(current + 1), selected = new Set(future.map(entry => identify(entry.track)));
  const now = identify(entries[current].track), heard = new Set(entries.slice(0, current + 1).map(entry => identify(entry.track)));
  const unique = [...new Map(candidates.map(track => [identify(track), track])).values()].filter(track => !selected.has(identify(track)));
  const fresh = unique.filter(track => !heard.has(identify(track)));
  const replay = options.allowReplay ? unique.filter(track => heard.has(identify(track)) && identify(track) !== now) : [];
  const chosen = [...fresh, ...replay].slice(0, Math.max(1, options.additions ?? 12));
  // With a single downloaded song, the only usable continuation is another
  // occurrence of that song. Each occurrence still has its own listening ID.
  if (!chosen.length && !future.length && options.allowReplay) {
    const same = unique.find(track => identify(track) === now); if (same) chosen.push(same);
  }
  if (!chosen.length) return entries as QueueEntry[];
  const retained = entries.slice(Math.max(0, current - historyLimit), current + 1);
  const room = Math.max(0, limit - retained.length - future.length);
  if (!room) return entries as QueueEntry[];
  const additions = chosen.slice(0, room).map(track => ({ entryId: entryId(), track, priority: "automatic" as const, context: "autoplay", ...(options.localOnly ? { localOnly: true } : {}) }));
  return [...retained, ...future, ...additions];
}
