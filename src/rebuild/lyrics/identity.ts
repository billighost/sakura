/** Search normalization never changes the recording or its saved metadata. */
import { foldLatinAccents } from "../core/searchText";
import { parseRecordingTitle } from "../core/identity";
export function lyricText(value: string) {
  return foldLatinAccents(value).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

export function lyricEdition(title: string, versionLabel="") {
  const kinds=[...parseRecordingTitle(title).version.kinds,...parseRecordingTitle(`recording (${versionLabel})`).version.kinds];
  return [...new Set(kinds.filter(kind=>kind!=="remaster").map(kind=>kind==="karaoke"?"instrumental":kind))].sort();
}

/** Strip only identifiable catalogue annotations, never arbitrary parentheses. */
export function lyricTitleVariants(title: string) {
  const normalized = title.normalize("NFKC");
  const cleaned = normalized
    .replace(/\s*[([](?:feat(?:uring)?\.?|ft\.?)\s+[^)\]]+[)\]]/gi, "")
    .replace(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+.*$/gi, "")
    .replace(/\s*[([](?:love\s+)?theme\s+from\s+["'][^)\]]+[)\]]/giu, "")
    .replace(/\s*[([][^)\]]*(?:theme song|from the (?:tv|motion picture|film)|original soundtrack|电视剧|電視劇|主题曲|主題曲)[^)\]]*[)\]]/giu, "")
    .replace(/\s*[-–—]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?)(?:\s+\d{4})?$/gi, "")
    .replace(/\s*\((?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\)/gi, "")
    .trim();
  return [...new Set([title.trim(), cleaned].filter(Boolean))];
}

export function lyricArtistParts(artist: string) {
  return artist.split(/\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+|\s*[,;&、/]\s*/i).map(value => value.trim()).filter(Boolean);
}
