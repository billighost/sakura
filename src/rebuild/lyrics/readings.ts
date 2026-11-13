/** Server-only dictionaries. Original text and every timing field stay intact. */
import { lyricReadingLanguage, readingEngine, type ReadingLanguage } from "./language";

let japanese: Promise<typeof import("./japanese")> | undefined;
let chinese: Promise<typeof import("pinyin-pro")> | undefined;
let korean: Promise<typeof import("es-hangul")> | undefined;
let other: Promise<typeof import("transliteration")> | undefined;
const loadJapanese = () => japanese || (japanese = import("./japanese").catch(error => { japanese = undefined; throw error; }));
const loadChinese = () => chinese || (chinese = import("pinyin-pro").catch(error => { chinese = undefined; throw error; }));
const loadKorean = () => korean || (korean = import("es-hangul").catch(error => { korean = undefined; throw error; }));
const loadOther = () => other || (other = import("transliteration").catch(error => { other = undefined; throw error; }));

export async function romanizeLyricLines<T extends {text: string}>(lines: readonly T[], language: ReadingLanguage, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (lines.length > 400 || lines.reduce((sum,line)=>sum+line.text.length,0)>20_000) throw new RangeError("Lyrics exceed reading limits");
  const result = [];
  let deadline = performance.now() + 8;
  for (const line of lines) {
    signal?.throwIfAborted();
    // A mixed-language song can have whole Korean/Chinese/Japanese lines. Han
    // within a Japanese sentence belongs to its Japanese word dictionary.
    const detected = lyricReadingLanguage(line.text);
    const lineLanguage = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line.text) ? detected || language : language;
    let romanized = line.text, reviewNeeded = false;
    if (lineLanguage === "ja") {
      const { romanizeJapanese, getJapaneseTokenizer } = await loadJapanese();
      await getJapaneseTokenizer(); signal?.throwIfAborted();
      const reading = await romanizeJapanese(line.text);
      romanized = reading.romanized; reviewNeeded = reading.reviewNeeded;
    } else if (lineLanguage === "zh") {
      const { pinyin, polyphonic } = await loadChinese(); signal?.throwIfAborted();
      // Phrase-aware Mandarin with tones and sandhi; preserve non-Han spans.
      romanized = line.text.replace(/\p{Script=Han}+/gu, span => pinyin(span, {toneType:"symbol", type:"array"}).join(" "));
      reviewNeeded = (polyphonic(line.text, {type:"array"}) as string[][]).some(options=>options.length>1) || /\p{Script=Han}/u.test(romanized);
    } else if (lineLanguage === "ko") {
      const { romanize } = await loadKorean(); signal?.throwIfAborted();
      romanized = line.text.replace(/\p{Script=Hangul}+/gu, span => romanize(span));
      reviewNeeded = /[\p{Script=Han}\p{Script=Hangul}]/u.test(romanized);
    } else {
      const script = {ru:"Cyrillic",uk:"Cyrillic",el:"Greek",hi:"Devanagari",ar:"Arabic"}[lineLanguage];
      if (script) { const { transliterate } = await loadOther(); signal?.throwIfAborted(); romanized = line.text.replace(new RegExp(`\\p{Script=${script}}[\\p{Script=${script}}\\p{M}]*`, "gu"), span => transliterate(span)); }
      // Script transliteration cannot infer unwritten vowels or a singer's reading.
      reviewNeeded = romanized !== line.text;
    }
    result.push({...line, romanized, readingReviewNeeded:reviewNeeded, readingEngine:readingEngine(language)});
    if (performance.now() >= deadline) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); deadline = performance.now() + 8; }
  }
  return result;
}
