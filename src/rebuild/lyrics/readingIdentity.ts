import { createHash } from "node:crypto";
import { JAPANESE_READING_VERSION } from "./versions";

/** Hashing a cache identity does not initialize a pronunciation dictionary. */
export function japaneseReadingCacheKey(lines: readonly string[], recordingId = "adhoc", reviewedReadingsVersion = "", languageHint?: string) {
  const digest = createHash("sha256").update(JSON.stringify({ engine: JAPANESE_READING_VERSION, lines, reviewedReadingsVersion, languageHint })).digest("hex");
  return `reading:${JAPANESE_READING_VERSION}:${recordingId}:${digest}`;
}
