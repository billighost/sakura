import { JAPANESE_READING_VERSION } from "./versions";

export const READING_LANGUAGES = ["ja", "zh", "ko", "ru", "uk", "el", "hi", "ar"] as const;
export type ReadingLanguage = typeof READING_LANGUAGES[number];
export const READING_VERSION = "multilingual-reading-v2";
export const READING_LABELS: Record<ReadingLanguage, string> = {
  ja: "Japanese reading guide", zh: "Chinese Pinyin", ko: "Korean romanization",
  ru: "Cyrillic transliteration", uk: "Cyrillic transliteration", el: "Greek transliteration",
  hi: "Devanagari transliteration", ar: "Arabic transliteration",
};
export function readingEngine(language: ReadingLanguage) { return language === "ja" ? JAPANESE_READING_VERSION : READING_VERSION+":"+language; }

/** Source script wins over stale metadata; hints resolve Han and shared Cyrillic. */
export function lyricReadingLanguage(text: string, hint?: string): ReadingLanguage | null {
  const hinted = hint?.trim().toLowerCase().split(/[-_]/)[0];
  const count = (expression: RegExp) => text.match(expression)?.length || 0;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = count(/\p{Script=Han}/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const cyrillic = count(/\p{Script=Cyrillic}/gu);
  const attachedJapaneseHan = [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+/gu)]
    .filter(match => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(match[0]))
    .reduce((total, match) => total + (match[0].match(/\p{Script=Han}/gu)?.length || 0), 0);
  const japaneseHan = hinted === "ja" && (kana || !hangul) ? han : attachedJapaneseHan;
  const koreanHan = hinted === "ko" ? han - japaneseHan : 0;
  const choices: Array<[ReadingLanguage, number]> = [
    ["ja", kana + japaneseHan],
    ["ko", hangul + koreanHan],
    ["zh", han - japaneseHan - koreanHan],
    [/[іїєґ]/iu.test(text) || hinted === "uk" ? "uk" : "ru", cyrillic],
    ["el", count(/\p{Script=Greek}/gu)],
    ["hi", count(/\p{Script=Devanagari}/gu)],
    ["ar", count(/\p{Script=Arabic}/gu)],
  ];
  choices.sort((a, b) => b[1] - a[1]);
  return choices[0][1] ? choices[0][0] : null;
}
