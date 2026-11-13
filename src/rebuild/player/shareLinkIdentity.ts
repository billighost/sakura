import type { MusicTrack } from "../app/types";
import type { TimedLyric } from "../lyrics/parse";

/** Link identity follows the server payload. Raster layout and reading-guide
 * annotations are presentation state, and cannot invalidate a saved link. */
export function shareLinkPayload(track: MusicTrack, kind: "track" | "lyric", lines: readonly TimedLyric[], colorMode: "light" | "dark") {
  return { recordingId: track.id, reference: track.reference, kind,
    lines: kind === "lyric" ? lines.map(line => ({ text: line.text, start: line.start, ...(line.end !== undefined ? { end: line.end } : {}) })) : [], colorMode };
}
