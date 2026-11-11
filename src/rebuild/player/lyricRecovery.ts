import type { PlayerLyrics } from "./useLyrics";
import { JAPANESE_READING_VERSION } from "../lyrics/versions";

/** Fresh provider data must not discard an already verified pronunciation guide. */
export function preserveLyricReadings(previous: PlayerLyrics | undefined, next: PlayerLyrics): PlayerLyrics {
  if (!previous || previous.lines.length !== next.lines.length) return next;
  if (previous.lines.some((line, index) => {
    const incoming = next.lines[index];
    return line.text !== incoming.text || line.start !== incoming.start || line.end !== incoming.end || JSON.stringify(line.words) !== JSON.stringify(incoming.words);
  })) return next;
  return {...next, lines: next.lines.map((line, index) => {
    const old = previous.lines[index];
    return line.romanized === undefined && old.readingEngine === JAPANESE_READING_VERSION && typeof old.romanized === "string" ? {...line, romanized: old.romanized, readingEngine: old.readingEngine, readingReviewNeeded: old.readingReviewNeeded} : line;
  })};
}

/** Honor rate limits exactly; network backoff stays bounded while a song is open. */
export function lyricRetryDelay(attempt: number, status?: number, retryAfterMs?: number): number | undefined {
  if (status === 401 || status === 400 || status === 409 || status === 413 || status === 422) return;
  if (status === 404) return 45_000;
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.max(1000, retryAfterMs);
  return Math.min(60_000, 5000 * Math.pow(2, Math.min(4, Math.max(0, attempt))));
}
