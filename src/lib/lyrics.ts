import { getCachedLyrics, setCachedLyrics } from "./offline-db";

/**
 * Lyric data — line-synced, and word-synced where a provider has it.
 *
 * Word timings matter more than they look. Line-level sync can only tell the
 * view *which* line is current, so the best it can do is highlight the whole
 * line at once; the eye then has no idea where in the line the voice is. With
 * per-word timings the highlight travels through the line as it's sung, which
 * is the difference between a caption and a karaoke read. Two of the three
 * upstream sources can supply them — Musixmatch richsync via synclyrics, and
 * enhanced-LRC files from LRCLib — so the shape carries them optionally and
 * every consumer treats them as an enhancement.
 */

export interface LyricWord {
  /** Absolute time this chunk starts, in seconds. */
  time: number;
  /** Absolute time it ends. Derived from the next chunk when not given. */
  end: number;
  text: string;
}

export interface LyricLine {
  time: number;
  text: string;
  transliterated?: string;
  /** Present only when the provider had word timings for this line. */
  words?: LyricWord[];
  /**
   * When this line stops being current. Known for word-synced data; otherwise
   * inferred from the next line's start. Drives the progress of the highlight
   * and lets a trailing line fade rather than hang lit until the track ends.
   */
  end?: number;
}

export interface LyricData {
  lyrics?: string;
  syncedLyrics?: string;
  lines?: LyricLine[];
  isSynced: boolean;
  /** True when at least one line carries word timings. */
  isWordSynced?: boolean;
  /** Set once a transliteration has been generated or supplied. */
  hasTransliteration?: boolean;
}

/* ── Parsing ─────────────────────────────────────────────────────────────── */

const LINE_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/;
/** Enhanced-LRC word tag: `<00:12.34>`. */
const WORD_TAG = /<(\d+):(\d+)(?:[.:](\d+))?>/g;

function toSeconds(min: string, sec: string, frac?: string): number {
  // Fractions arrive as either centiseconds (`.34`) or milliseconds (`.340`).
  // Padding to three digits normalises both without a special case per source.
  const ms = frac ? parseInt(frac.padEnd(3, "0").slice(0, 3), 10) : 0;
  return parseInt(min, 10) * 60 + parseInt(sec, 10) + ms / 1000;
}

/**
 * Parse LRC, including the enhanced (A2) form that embeds per-word tags.
 *
 * Both live here because a single file can mix them: LRCLib returns plain LRC
 * for most tracks and enhanced LRC for some, and the caller shouldn't have to
 * sniff which it got.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  const result: LyricLine[] = [];

  for (const raw of lrcText.split("\n")) {
    const match = LINE_TAG.exec(raw);
    if (!match) continue;

    const time = toSeconds(match[1], match[2], match[3]);
    const body = raw.slice(match[0].length);

    const words = parseWordTags(body);
    // Strip the word tags for the plain text, so a caller that ignores word
    // timings still gets a clean line rather than one full of angle brackets.
    const text = body.replace(WORD_TAG, "").replace(/\s+/g, " ").trim();

    if (!text && !words) continue;
    result.push(words ? { time, text, words } : { time, text });
  }

  result.sort((a, b) => a.time - b.time);
  return closeLineEnds(result);
}

/** Pull `<mm:ss.xx>word` pairs out of one line, or null if there are none. */
function parseWordTags(body: string): LyricWord[] | undefined {
  WORD_TAG.lastIndex = 0;
  const marks: { time: number; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = WORD_TAG.exec(body))) {
    marks.push({ time: toSeconds(m[1], m[2], m[3]), index: m.index, length: m[0].length });
  }
  if (marks.length === 0) return undefined;

  const words: LyricWord[] = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].index + marks[i].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const text = body.slice(from, to);
    if (!text.trim()) continue;
    words.push({ time: marks[i].time, end: marks[i + 1]?.time ?? marks[i].time + 0.6, text });
  }
  return words.length ? words : undefined;
}

/**
 * Give every line an end time.
 *
 * A line's end is the next line's start, except across a gap: holding a line
 * lit through an eight-second instrumental break reads as the sync being
 * broken. Past `MAX_HOLD` the line ends and the view shows the gap honestly.
 */
const MAX_HOLD = 6;

function closeLineEnds(lines: LyricLine[]): LyricLine[] {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lastWord = line.words?.[line.words.length - 1];
    const next = lines[i + 1];
    const naturalEnd = next ? next.time : (lastWord?.end ?? line.time + 4);
    line.end = Math.min(naturalEnd, Math.max(lastWord?.end ?? 0, line.time + MAX_HOLD));
  }
  return lines;
}

/**
 * Normalise synclyrics' word-synced shape.
 *
 * Its `syncedLyric` entries are named `character` but hold whatever chunk the
 * provider emitted — a word in Latin scripts, often a single glyph in Japanese
 * or Chinese. Chunks are kept exactly as given, including their spacing, since
 * re-joining with spaces would corrupt scripts that don't use them.
 */
export function normalizeWordSynced(
  raw: Array<{
    start: number;
    end: number;
    lyric: string;
    syncedLyric?: Array<{ character: string; time: number }> | null;
  }>
): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry.start !== "number") continue;
    const text = (entry.lyric ?? "").trim();
    const chunks = entry.syncedLyric ?? [];

    // Provider times are milliseconds here, seconds in the LRC path.
    const start = entry.start / 1000;
    const end = typeof entry.end === "number" ? entry.end / 1000 : start + 4;

    const words: LyricWord[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (!c || typeof c.time !== "number" || !c.character) continue;
      words.push({
        time: c.time / 1000,
        end: chunks[i + 1] ? chunks[i + 1].time / 1000 : end,
        text: c.character,
      });
    }

    if (!text && words.length === 0) continue;
    lines.push({
      time: start,
      end,
      text: text || words.map((w) => w.text).join(""),
      ...(words.length ? { words } : null),
    });
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/* ── Script detection ────────────────────────────────────────────────────── */

/**
 * Which writing system a block of lyrics is in.
 *
 * This exists to answer one product question: should we offer to transliterate?
 * Offering "Get transliteration" on an English song is noise, so detection has
 * to be confident before the control appears.
 *
 * Unicode property escapes rather than hand-rolled codepoint ranges — `\p{sc=…}`
 * is a supported regex feature in every browser this app targets, and it stays
 * correct for the codepoints a range list always forgets (kana extensions,
 * Cyrillic supplements, the Arabic presentation forms).
 */
export type LyricScript =
  | "latin"
  | "japanese"
  | "korean"
  | "chinese"
  | "cyrillic"
  | "arabic"
  | "devanagari"
  | "greek"
  | "hebrew"
  | "thai"
  | "other";

const SCRIPT_TESTS: { script: LyricScript; re: RegExp }[] = [
  // Japanese first: Japanese text contains Han characters too, so testing for
  // Chinese before kana would misclassify most J-pop as Chinese.
  { script: "japanese", re: /[\p{sc=Hiragana}\p{sc=Katakana}]/u },
  { script: "korean", re: /\p{sc=Hangul}/u },
  { script: "chinese", re: /\p{sc=Han}/u },
  { script: "cyrillic", re: /\p{sc=Cyrillic}/u },
  { script: "arabic", re: /\p{sc=Arabic}/u },
  { script: "devanagari", re: /\p{sc=Devanagari}/u },
  { script: "greek", re: /\p{sc=Greek}/u },
  { script: "hebrew", re: /\p{sc=Hebrew}/u },
  { script: "thai", re: /\p{sc=Thai}/u },
];

/** Scripts the transliteration endpoint can actually romanise. */
export const TRANSLITERABLE: ReadonlySet<LyricScript> = new Set<LyricScript>([
  "japanese",
  "korean",
  "chinese",
  "cyrillic",
  "arabic",
  "devanagari",
  "greek",
  "hebrew",
]);

export interface ScriptInfo {
  script: LyricScript;
  /** Share of letters that are non-Latin, 0→1. */
  ratio: number;
  /** True when transliterating would genuinely help. */
  worthTransliterating: boolean;
}

/**
 * A threshold rather than "contains any non-Latin character": an English song
 * with one stray CJK character in a title shouldn't trigger the offer, and a
 * Japanese song with English loanwords in the chorus should. A fifth of the
 * letters being non-Latin is comfortably past incidental use either way.
 */
const NON_LATIN_RATIO = 0.2;

export function detectScript(text: string): ScriptInfo {
  if (!text) return { script: "latin", ratio: 0, worthTransliterating: false };

  // Sample rather than scan: full lyrics run to thousands of characters and
  // this is called on every track change, on the render path.
  const sample = text.length > 4000 ? text.slice(0, 4000) : text;

  let letters = 0;
  let nonLatin = 0;
  for (const ch of sample) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (!/\p{sc=Latin}/u.test(ch)) nonLatin++;
  }

  if (letters === 0) return { script: "latin", ratio: 0, worthTransliterating: false };

  const ratio = nonLatin / letters;
  if (ratio < NON_LATIN_RATIO) {
    return { script: "latin", ratio, worthTransliterating: false };
  }

  const found = SCRIPT_TESTS.find((t) => t.re.test(sample));
  const script = found?.script ?? "other";
  return { script, ratio, worthTransliterating: TRANSLITERABLE.has(script) };
}

/** Human name for the script, for UI copy. */
export const SCRIPT_LABELS: Record<LyricScript, string> = {
  latin: "Latin",
  japanese: "Japanese",
  korean: "Korean",
  chinese: "Chinese",
  cyrillic: "Cyrillic",
  arabic: "Arabic",
  devanagari: "Hindi",
  greek: "Greek",
  hebrew: "Hebrew",
  thai: "Thai",
  other: "this script",
};

/** The script of a whole lyric set, sampled across lines. */
export function detectLyricScript(data: LyricData | null): ScriptInfo {
  if (!data) return { script: "latin", ratio: 0, worthTransliterating: false };
  const text = data.lines?.length
    ? data.lines.map((l) => l.text).join("\n")
    : data.lyrics ?? "";
  return detectScript(text);
}

/* ── Fetching ────────────────────────────────────────────────────────────── */

/**
 * Lyrics for a track, IndexedDB-first.
 *
 * The cache is checked before the network unconditionally: lyrics for a given
 * track never change, and this runs on every track change including offline.
 */
export async function getLyrics(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
}): Promise<LyricData | null> {
  const cached = await getCachedLyrics(track.id);
  if (cached) return cached as LyricData;

  try {
    const params = new URLSearchParams({
      title: track.title,
      artist: track.artist,
      duration: track.duration ? String(track.duration) : "",
    });
    if (track.album) params.set("album", track.album);

    const res = await fetch(`/api/lyrics?${params}`);
    if (!res.ok) return null;

    const result = await res.json();
    if (!result || (!result.syncedLyrics && !result.plainLyrics && !result.wordSynced)) {
      return null;
    }

    const data = formatLyricResponse(result);
    await setCachedLyrics(track.id, data);
    return data;
  } catch (err) {
    console.error("Lyrics lookup failed:", err);
    return null;
  }
}

interface LyricsApiResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  timedLyrics?: Array<{ start_time: number; text: string; romanized?: string }> | null;
  wordSynced?: Parameters<typeof normalizeWordSynced>[0] | null;
}

function formatLyricResponse(data: LyricsApiResponse): LyricData {
  const syncedLyrics = data.syncedLyrics || "";
  const lyrics = data.plainLyrics || "";
  let lines: LyricLine[] = [];

  // Best available timing wins: word-synced, then a provider's own timed array
  // (which carries romanisations we'd otherwise have to generate), then LRC.
  if (data.wordSynced?.length) {
    lines = normalizeWordSynced(data.wordSynced);
    // Enhanced LRC for the same track sometimes covers lines the word-synced
    // payload skipped; prefer whichever is more complete.
    if (syncedLyrics) {
      const fromLrc = parseLrc(syncedLyrics);
      if (fromLrc.length > lines.length * 1.25) lines = mergeWordTimings(fromLrc, lines);
    }
  } else if (data.timedLyrics?.length) {
    lines = closeLineEnds(
      data.timedLyrics
        .filter((l) => l && typeof l.start_time === "number")
        .map((l) => ({
          time: l.start_time / 1000,
          text: l.text ?? "",
          ...(l.romanized ? { transliterated: l.romanized } : null),
        }))
        .sort((a, b) => a.time - b.time)
    );
  } else if (syncedLyrics) {
    lines = parseLrc(syncedLyrics);
  }

  const isWordSynced = lines.some((l) => l.words && l.words.length > 0);

  return {
    lyrics: lyrics || undefined,
    syncedLyrics: syncedLyrics || undefined,
    lines: lines.length > 0 ? lines : undefined,
    isSynced: lines.length > 0,
    isWordSynced,
    hasTransliteration: lines.some((l) => l.transliterated),
  };
}

/**
 * Graft word timings onto the more complete line set.
 *
 * Matched by nearest start time rather than by index — the two sources
 * disagree about whether to include section markers like "[Chorus]", so index
 * alignment drifts after the first mismatch and lands words on the wrong line.
 */
function mergeWordTimings(target: LyricLine[], wordSynced: LyricLine[]): LyricLine[] {
  const TOLERANCE = 0.6;
  for (const line of target) {
    let best: LyricLine | undefined;
    let bestDelta = TOLERANCE;
    for (const w of wordSynced) {
      const delta = Math.abs(w.time - line.time);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = w;
      }
    }
    if (best?.words) line.words = best.words;
  }
  return target;
}

/* ── Playback helpers ────────────────────────────────────────────────────── */

/**
 * Index of the line current at `time`, or -1 before the first line.
 *
 * Binary search because this runs on every timeupdate — roughly 4Hz from the
 * audio element, more while scrubbing — and a linear scan over a 120-line set
 * is wasted work on the frame budget of a mid-range phone.
 */
export function lineIndexAt(lines: LyricLine[] | undefined, time: number): number {
  if (!lines?.length || time < lines[0].time) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * How far through the active line the voice is, 0→1.
 *
 * Word timings when present, linear interpolation across the line's span
 * otherwise. The caller uses this to drive the highlight sweep, so it has to
 * stay defined even for line-only data — a sweep that only works on
 * word-synced tracks would make everything else look broken by comparison.
 */
export function lineProgressAt(line: LyricLine | undefined, time: number): number {
  if (!line) return 0;
  const end = line.end ?? line.time + 4;
  const span = end - line.time;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (time - line.time) / span));
}

/** Index of the word being sung, or -1. Assumes `words` is time-ordered. */
export function wordIndexAt(words: LyricWord[] | undefined, time: number): number {
  if (!words?.length) return -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].time <= time) return i;
  }
  return -1;
}

