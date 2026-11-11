/** Server-only dictionaries. Original text and every timing field stay intact. */
import { pinyin, polyphonic } from "pinyin-pro";
import { romanize } from "es-hangul";
import { transliterate } from "transliteration";
import { romanizeJapanese } from "./japanese";
import { lyricReadingLanguage, readingEngine, type ReadingLanguage } from "./language";

export async function romanizeLyricLines<T extends {text: string}>(lines: readonly T[], language: ReadingLanguage) {
  if (lines.length > 400 || lines.reduce((sum,line)=>sum+line.text.length,0)>20_000) throw new RangeError("Lyrics exceed reading limits");
  const result = [];
  for (const line of lines) {
    // A mixed-language song can have whole Korean/Chinese/Japanese lines. Han
    // within a Japanese sentence belongs to its Japanese word dictionary.
    const detected = lyricReadingLanguage(line.text);
    const lineLanguage = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line.text) ? detected || language : language;
    let romanized = line.text, reviewNeeded = false;
    if (lineLanguage === "ja") {
      const reading = await romanizeJapanese(line.text);
      romanized = reading.romanized; reviewNeeded = reading.reviewNeeded;
    } else if (lineLanguage === "zh") {
      // Phrase-aware Mandarin with tones and sandhi; preserve non-Han spans.
      romanized = line.text.replace(/\p{Script=Han}+/gu, span => pinyin(span, {toneType:"symbol", type:"array"}).join(" "));
      reviewNeeded = (polyphonic(line.text, {type:"array"}) as string[][]).some(options=>options.length>1) || /\p{Script=Han}/u.test(romanized);
    } else if (lineLanguage === "ko") {
      romanized = line.text.replace(/\p{Script=Hangul}+/gu, span => romanize(span));
      reviewNeeded = /[\p{Script=Han}\p{Script=Hangul}]/u.test(romanized);
    } else {
      const script = {ru:"Cyrillic",uk:"Cyrillic",el:"Greek",hi:"Devanagari",ar:"Arabic"}[lineLanguage];
      if (script) romanized = line.text.replace(new RegExp(`\\p{Script=${script}}[\\p{Script=${script}}\\p{M}]*`, "gu"), span => transliterate(span));
      // Script transliteration cannot infer unwritten vowels or a singer's reading.
      reviewNeeded = romanized !== line.text;
    }
    result.push({...line, romanized, readingReviewNeeded:reviewNeeded, readingEngine:readingEngine(language)});
  }
  return result;
}
