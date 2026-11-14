import type { TimedLyric, TimedWord } from "./parse";
import type { LyricIdentity } from "./provider";
import { normalizeLyricLanguageHint, READING_LANGUAGES, type ReadingLanguage } from "./language";

export class LyricRequestError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const boundedString = (value: unknown, name: string, maximum = 200, optional = false) => {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new LyricRequestError(`${name} is required`);
  }
  if (typeof value !== "string" || value.length > maximum || !value.trim()) throw new LyricRequestError(`${name} is invalid`);
  return value.trim();
};

export function parseLyricIdentity(query: URLSearchParams): LyricIdentity {
  const title = boundedString(query.get("title"), "title", 600)!;
  const artists = query.getAll("artist").map((value) => boundedString(value, "artist")!);
  const artist = artists[0];
  if (!artist) throw new LyricRequestError("artist is required");
  const album = boundedString(query.get("album"), "album", 200, true);
  const recordingId = boundedString(query.get("recordingId"), "recordingId", 100, true);
  const language = boundedString(query.get("language"), "language", 12, true);
  const rawDuration = query.get("duration");
  const durationSeconds = rawDuration === null || rawDuration === "" ? undefined : Number(rawDuration);
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60)) {
    throw new LyricRequestError("duration must be a positive number of seconds");
  }
  if (artists.length > 16) throw new LyricRequestError("Too many artist credits");
  const alternateTitles = query.getAll("alternateTitle").map(value => boundedString(value, "alternate title", 600)!);
  if (alternateTitles.length > 8) throw new LyricRequestError("Too many alternate titles");
  return { title, artist, artists: [...new Set(artists)], album, recordingId, durationSeconds, language, alternateTitles, versionLabel: boundedString(query.get("version"), "version", 200, true) };
}

const time = (value: unknown, name: string, fallback?: number) => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 24 * 60 * 60) throw new LyricRequestError(`${name} is invalid`);
  return value;
};

export function parseReadingRequest(body: unknown): { recordingId?: string; language: ReadingLanguage; languageHint?: string; lines: TimedLyric[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new LyricRequestError("A reading request object is required");
  const value = body as Record<string, unknown>;
  const language = value.language === undefined ? "ja" : value.language;
  if (!READING_LANGUAGES.includes(language as ReadingLanguage)) throw new LyricRequestError("Unsupported reading language");
  const recordingId = boundedString(value.recordingId, "recordingId", 100, true);
  const languageHint = normalizeLyricLanguageHint(boundedString(value.languageHint, "languageHint", 48, true));
  if (!Array.isArray(value.lines) || !value.lines.length) throw new LyricRequestError("lines are required");
  if (value.lines.length > 400) throw new LyricRequestError("Lyrics exceed 400 lines", 413);
  let characters = 0;
  let wordCount = 0;
  const lines = value.lines.map((raw: unknown): TimedLyric => {
    const line = typeof raw === "string" ? { text: raw } : raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!line || typeof line.text !== "string") throw new LyricRequestError("Each line requires string text");
    characters += line.text.length;
    const start = time("start" in line ? line.start : undefined, "Line start", 0);
    const end = "end" in line && line.end !== undefined ? time(line.end, "Line end") : undefined;
    if (end !== undefined && end < start) throw new LyricRequestError("Line end precedes its start");
    let words: TimedWord[] | undefined;
    if ("words" in line && line.words !== undefined) {
      if (!Array.isArray(line.words)) throw new LyricRequestError("words must be an array");
      wordCount += line.words.length;
      words = line.words.map((rawWord: unknown): TimedWord => {
        if (!rawWord || typeof rawWord !== "object") throw new LyricRequestError("Each word requires text and timing");
        const word = rawWord as Record<string, unknown>;
        if (typeof word.text !== "string" || word.text.length > 2000) throw new LyricRequestError("Word text is invalid");
        const wordStart = time(word.start, "Word start");
        const wordEnd = word.end === undefined ? undefined : time(word.end, "Word end");
        if (wordEnd !== undefined && wordEnd < wordStart) throw new LyricRequestError("Word end precedes its start");
        return { text: word.text, start: wordStart, ...(wordEnd === undefined ? {} : { end: wordEnd }) };
      });
    }
    return { text: line.text, start, ...(end === undefined ? {} : { end }), ...(words === undefined ? {} : { words }) };
  });
  if (characters > 20_000 || wordCount > 5000) throw new LyricRequestError("Lyrics exceed the reading request limit", 413);
  return { recordingId, language:language as ReadingLanguage, ...(languageHint ? { languageHint } : {}), lines };
}
