import type { MusicTrack } from "./types";
import { foldLatinAccents } from "../core/searchText";

export function collectionSearchText(value: string) {
  return foldLatinAccents(value).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}

/** Every word may match any member metadata field, independent of word order. */
export function collectionTrackMatches(track: MusicTrack, query: string) {
  const words = collectionSearchText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = collectionSearchText([track.title, ...track.artists,
    ...(track.artistCredits || []).map(credit => credit.name), track.albumTitle || "",
    track.versionLabel, ...(track.alternateTitles || [])].join(" "));
  return words.every(word => haystack.includes(word));
}
