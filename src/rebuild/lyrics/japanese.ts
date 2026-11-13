/** Node/server only: the morphological dictionary must never enter a client bundle. */
import { createRequire } from "node:module";
import path from "node:path";
import kuromoji from "kuromoji";
import { toRomaji } from "wanakana";
import { JAPANESE_READING_VERSION } from "./versions";
export { JAPANESE_READING_VERSION } from "./versions";

export interface ReadingToken {
  surface: string;
  reading: string | null;
  romanized: string;
  source: "dictionary" | "kana" | "original" | "unresolved" | "reviewed";
  /** Original UTF-16 range, usable by an editor without replacing the lyric text. */
  start: number;
  end: number;
}

export interface JapaneseReading {
  text: string;
  romanized: string;
  tokens: ReadingToken[];
  reviewNeeded: boolean;
  engine: typeof JAPANESE_READING_VERSION;
}

/** A licensed/provider or human-reviewed reading, bound to the exact source span. */
export interface JapaneseReadingOverride {
  start: number;
  end: number;
  surface: string;
  kana: string;
  provenance: string;
}

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u;
let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | undefined;

/** One dictionary load per process; a failed load may be retried. */
export function getJapaneseTokenizer() {
  if (!tokenizerPromise) {
    const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
    const dicPath = process.env.SAKURA_JAPANESE_DICT_PATH ||
      path.join(path.dirname(requireFromProject.resolve("kuromoji/package.json")), "dict");
    tokenizerPromise = new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      });
    }).catch((error: unknown) => {
      tokenizerPromise = undefined;
      throw error;
    });
  }
  return tokenizerPromise;
}

/** Kana-faithful Hepburn: long vowels remain ou/oo/uu instead of disappearing. */
export function romanizeKana(reading: string): string {
  // Disambiguate syllabic n before a vowel or y: シンヨウ -> shin'you.
  return toRomaji(reading.normalize("NFKC").replace(/[んン](?=[あいうえおやゆよアイウエオヤユヨ])/gu, "n'"), {
    upcaseKatakana: false,
  });
}

function tokenReading(token: kuromoji.IpadicFeatures): string | null {
  if (!HAN.test(token.surface_form) && !KANA.test(token.surface_form)) return null;
  // These spellings differ from pronunciation when used as grammatical particles.
  if (token.pos === "助詞") {
    if (token.surface_form === "は") return "ワ";
    if (token.surface_form === "へ") return "エ";
    if (token.surface_form === "を") return "オ";
  }
  // The greeting is lexicalized; dictionary reading uses the written ハ.
  if (token.surface_form === "こんにちは") return "コンニチワ";
  if (token.surface_form === "こんばんは") return "コンバンワ";
  const reading = token.reading && token.reading !== "*" ? token.reading : null;
  return reading || (KANA_ONLY.test(token.surface_form) ? token.surface_form : null);
}

/** IPADIC separates counters and te/ta inflections; pronunciation crosses those boundaries. */
function pronunciationTokens(tokens: kuromoji.IpadicFeatures[]) {
  const result: kuromoji.IpadicFeatures[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = { ...tokens[index] };
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    if (next?.surface_form === "人" && next.pos_detail_1 === "接尾" && previous?.pos_detail_1 !== "数" &&
        tokens[index + 2]?.surface_form !== "称" && (token.surface_form === "一" || token.surface_form === "二")) {
      token.surface_form += next.surface_form;
      token.reading = tokens[index].surface_form === "一" ? "ヒトリ" : "フタリ";
      index++;
    }
    while (/[ッっ]$/.test(token.reading || "") && tokens[index + 1] && KANA.test(tokens[index + 1].reading || "")) {
      const continuation = tokens[++index];
      token.surface_form += continuation.surface_form;
      token.reading += tokenReading(continuation) || continuation.reading || continuation.surface_form;
    }
    result.push(token);
  }
  return result;
}

/**
 * Word-level readings replace per-kanji guesses. Unknown Han stays visible and
 * flagged; a dictionary can still disagree with a singer's deliberate reading.
 */
export async function romanizeJapanese(text: string, options: { overrides?: readonly JapaneseReadingOverride[] } = {}): Promise<JapaneseReading> {
  if (text.length > 20_000) throw new RangeError("Japanese lyric text exceeds 20,000 characters");
  if (!text) return { text, romanized: "", tokens: [], reviewNeeded: false, engine: JAPANESE_READING_VERSION };
  const overrides = [...(options.overrides || [])].sort((a, b) => a.start - b.start);
  let priorEnd = 0;
  for (const override of overrides) {
    if (!Number.isInteger(override.start) || !Number.isInteger(override.end) || override.start < priorEnd ||
        override.end <= override.start || override.end > text.length || text.slice(override.start, override.end) !== override.surface ||
        !KANA_ONLY.test(override.kana) || !override.provenance.trim()) throw new Error("Reviewed reading does not match its source span");
    priorEnd = override.end;
  }
  if (overrides.length) {
    const tokens: ReadingToken[] = [];
    let cursor = 0;
    for (const override of overrides) {
      if (override.start > cursor) {
        const prefix = await romanizeJapanese(text.slice(cursor, override.start));
        tokens.push(...prefix.tokens.map((token) => ({ ...token, start: token.start + cursor, end: token.end + cursor })));
      }
      tokens.push({ surface: override.surface, reading: override.kana, romanized: romanizeKana(override.kana), source: "reviewed", start: override.start, end: override.end });
      cursor = override.end;
    }
    if (cursor < text.length) {
      const tail = await romanizeJapanese(text.slice(cursor));
      tokens.push(...tail.tokens.map((token) => ({ ...token, start: token.start + cursor, end: token.end + cursor })));
    }
    return { text, romanized: joinReadingTokens(tokens), tokens, reviewNeeded: tokens.some((token) => token.source === "unresolved"), engine: JAPANESE_READING_VERSION };
  }
  const tokenizer = await getJapaneseTokenizer();
  const parsed = pronunciationTokens(tokenizer.tokenize(text));
  const tokens: ReadingToken[] = [];
  let cursor = 0;
  for (const token of parsed) {
    const surface = token.surface_form;
    // Kuromoji word_position counts codepoints inconsistently around emoji;
    // locate in original text instead, so token editor offsets remain correct.
    const start = text.indexOf(surface, cursor);
    if (start < 0) throw new Error("Tokenizer could not be aligned with the original lyric");
    if (start > cursor) {
      const gap = text.slice(cursor, start);
      tokens.push({ surface: gap, reading: null, romanized: gap, source: "original", start: cursor, end: start });
    }
    const reading = tokenReading(token);
    const source = reading ? (token.word_type === "KNOWN" ? "dictionary" : "kana") :
      HAN.test(surface) || KANA.test(surface) ? "unresolved" : "original";
    tokens.push({ surface, reading, romanized: reading ? romanizeKana(reading) : surface, source, start, end: start + surface.length });
    cursor = start + surface.length;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    tokens.push({ surface: tail, reading: null, romanized: tail, source: "original", start: cursor, end: text.length });
  }
  // Word spaces help a learner. Preserve all original punctuation, line breaks,
  // English fragments, and existing whitespace rather than replacing the lyrics.
  return { text, romanized: joinReadingTokens(tokens), tokens, reviewNeeded: tokens.some((token) => token.source === "unresolved"), engine: JAPANESE_READING_VERSION };
}

function joinReadingTokens(tokens: readonly ReadingToken[]) {
  let romanized = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (previous && /[\p{L}\p{N}]$/u.test(romanized) && /^[\p{L}\p{N}]/u.test(token.romanized) &&
        (previous.source !== "original" || token.source !== "original")) romanized += " ";
    romanized += token.romanized;
  }
  return romanized;
}

/** Preserve timestamps, word timings, blank instrumental lines and source fields. */
export async function romanizeJapaneseLines<T extends { text: string }>(lines: readonly T[]) {
  if (lines.length > 400) throw new RangeError("Japanese lyrics exceed 400 lines");
  if (lines.reduce((sum, line) => sum + line.text.length, 0) > 20_000) throw new RangeError("Japanese lyrics exceed 20,000 characters");
  await getJapaneseTokenizer();
  const result: Array<T & { romanized: string; readingReviewNeeded: boolean; readingEngine: string }> = [];
  for (const line of lines) {
    const reading = await romanizeJapanese(line.text);
    result.push({ ...line, romanized: reading.romanized, readingReviewNeeded: reading.reviewNeeded, readingEngine: reading.engine });
  }
  return result;
}

export { japaneseReadingCacheKey } from "./readingIdentity";
