import type { MusicTrack } from "./types";
import { foldLatinAccents } from "../core/searchText";

export function collectionSearchText(value: string) {
  return foldLatinAccents(value).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}

export function collectionSearchWords(query: string) {
  return collectionSearchText(query).split(" ").filter(Boolean);
}

export function collectionTrackSearchText(track: MusicTrack) {
  return collectionSearchText([track.title, ...track.artists,
    ...(track.artistCredits || []).map(credit => credit.name), track.albumTitle || "",
    track.versionLabel, ...(track.alternateTitles || [])].join(" "));
}

/** Immutable card identities release their search text when the card is GC'd. */
export class CollectionSearchIndex {
  private readonly texts = new WeakMap<MusicTrack, string>();

  text(track: MusicTrack) {
    const existing = this.texts.get(track);
    if (existing !== undefined) return existing;
    const text = collectionTrackSearchText(track);
    this.texts.set(track, text);
    return text;
  }

  matches(track: MusicTrack, words: readonly string[]) {
    return !words.length || words.every(word => this.text(track).includes(word));
  }

  /** Cold large indexes yield, while an already indexed search stays one pass. */
  async filter(tracks: readonly MusicTrack[], words: readonly string[], options: {
    signal?: AbortSignal;
    yield?: () => Promise<void>;
    now?: () => number;
    budgetMs?: number;
  } = {}) {
    const now = options.now || (() => performance.now());
    const pause = options.yield || (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    const result: MusicTrack[] = [];
    let started = now();
    for (let i = 0; i < tracks.length; i++) {
      options.signal?.throwIfAborted();
      if (this.matches(tracks[i], words)) result.push(tracks[i]);
      if (i % 64 === 63 && now() - started >= (options.budgetMs ?? 4)) {
        await pause();
        options.signal?.throwIfAborted();
        started = now();
      }
    }
    return result;
  }
}

/** Every word may match any member metadata field, independent of word order. */
export function collectionTrackMatches(track: MusicTrack, query: string) {
  const words = collectionSearchWords(query);
  if (!words.length) return true;
  const haystack = collectionTrackSearchText(track);
  return words.every(word => haystack.includes(word));
}
