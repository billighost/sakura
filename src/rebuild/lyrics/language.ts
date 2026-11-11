import { JAPANESE_READING_VERSION } from "./versions";

export const READING_LANGUAGES = ["ja", "zh", "ko", "ru", "uk", "el", "hi", "ar"] as const;
export type ReadingLanguage = typeof READING_LANGUAGES[number];
export const READING_VERSION = "multilingual-reading-v1";
export const READING_LABELS: Record<ReadingLanguage, string> = {
  ja: "Japanese reading guide", zh: "Chinese Pinyin", ko: "Korean romanization",
  ru: "Cyrillic transliteration", uk: "Cyrillic transliteration", el: "Greek transliteration",
  hi: "Devanagari transliteration", ar: "Arabic transliteration",
};
export function readingEngine(language: ReadingLanguage) { return language === "ja" ? JAPANESE_READING_VERSION : READING_VERSION+":"+language; }

/** Kana and Hangul supply evidence; Han alone is never classified as Japanese. */
export function lyricReadingLanguage(text: string, hint?: string): ReadingLanguage | null {
  const hinted=hint?.toLowerCase().split(/[-_]/)[0];
  if (hinted && READING_LANGUAGES.includes(hinted as ReadingLanguage)) return hinted as ReadingLanguage;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(text)) return /[іїєґ]/iu.test(text) ? "uk" : "ru";
  if (/\p{Script=Greek}/u.test(text)) return "el";
  if (/\p{Script=Devanagari}/u.test(text)) return "hi";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  return null;
}
