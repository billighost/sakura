import { lyricReadingLanguage, READING_LANGUAGES, READING_VERSION, readingEngine, type ReadingLanguage } from "../lyrics/language";
import type { PlayerLyrics } from "./useLyrics";

function cacheLanguageHint(key: string): string | undefined {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && typeof value[6] === "string" ? value[6] : undefined;
  } catch { return; }
}

/** Historical v2 detection, used only to distinguish saved manual selections
 * from the old automatic Hindi/Russian defaults. Never generate new readings
 * with these defaults. Cached v2 data did not record selection provenance. */
function legacyAutomaticLanguage(text: string, hint?: string): ReadingLanguage | null {
  const hinted = hint?.trim().toLowerCase().split(/[-_]/)[0];
  const count = (expression: RegExp) => text.match(expression)?.length || 0;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu), han = count(/\p{Script=Han}/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const attached = [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+/gu)]
    .filter(match => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(match[0]))
    .reduce((sum, match) => sum + countHan(match[0]), 0);
  const japaneseHan = hinted === "ja" && (kana || !hangul) ? han : attached;
  const koreanHan = hinted === "ko" ? han - japaneseHan : 0;
  const choices: Array<[ReadingLanguage, number]> = [
    ["ja", kana + japaneseHan], ["ko", hangul + koreanHan], ["zh", han - japaneseHan - koreanHan],
    [/[іїєґ]/iu.test(text) || hinted === "uk" ? "uk" : "ru", count(/\p{Script=Cyrillic}/gu)],
    ["el", count(/\p{Script=Greek}/gu)], ["hi", count(/\p{Script=Devanagari}/gu)], ["ar", count(/\p{Script=Arabic}/gu)],
  ];
  choices.sort((a, b) => b[1] - a[1]);
  return choices[0][1] ? choices[0][0] : null;
}
const countHan = (text: string) => text.match(/\p{Script=Han}/gu)?.length || 0;

/** Upgrade guides and detection locally, even offline. Original lyrics,
 * verification, word times and provider freshness never belong to an engine. */
export function upgradeCachedLyricReadings(lyrics: PlayerLyrics, key: string): PlayerLyrics {
  const text = lyrics.lines.map(line => line.text).join("\n"), hint = cacheLanguageHint(key);
  const previous = lyrics.readingLanguage && READING_LANGUAGES.includes(lyrics.readingLanguage) ? lyrics.readingLanguage : null;
  const explicit = lyrics.readingLanguageSource === "chosen" || lyrics.readingLanguageSource !== "detected"
    && Boolean(previous && previous !== legacyAutomaticLanguage(text, hint));
  const language = explicit && previous ? previous : lyricReadingLanguage(text, hint);
  const engine = language ? readingEngine(language) : null;
  let changed = lyrics.readingLanguageVersion !== READING_VERSION || lyrics.readingLanguage !== language
    || lyrics.readingLanguageSource !== (explicit ? "chosen" : "detected");
  const lines = lyrics.lines.map(line => {
    if (line.romanized === undefined && line.readingEngine === undefined && line.readingReviewNeeded === undefined
      || engine && line.readingEngine === engine && typeof line.romanized === "string") return line;
    const { romanized, readingEngine: oldEngine, readingReviewNeeded, ...original } = line;
    void romanized; void oldEngine; void readingReviewNeeded;
    changed = true;
    return original;
  });
  return changed ? { ...lyrics, lines, readingLanguage: language, readingLanguageSource: explicit ? "chosen" : "detected", readingLanguageVersion: READING_VERSION } : lyrics;
}
