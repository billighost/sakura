/** Server-only dictionaries. Original text and every timing field stay intact. */
import { readingEngine, type ReadingLanguage } from "./language";

let japanese: Promise<typeof import("./japanese")> | undefined;
let chinese: Promise<Awaited<ReturnType<typeof chineseTools>>> | undefined;
let korean: Promise<typeof import("es-hangul")> | undefined;
let other: Promise<typeof import("./scriptReading")> | undefined;
const loadJapanese = () => japanese || (japanese = import("./japanese").catch(error => { japanese = undefined; throw error; }));
async function chineseTools() {
  const [tools, opencc] = await Promise.all([import("pinyin-pro"), import("opencc-js/t2cn")]);
  // The pinyin-pro phrase dictionary uses simplified text. Its optional
  // traditional dictionary is empty unless one is supplied by the application.
  // Taiwan conversion also resolves aspect 著 to 着, while retaining 著作/著名.
  return { ...tools, simplify: opencc.Converter({ from: "tw", to: "cn" }) };
}
const loadChinese = () => chinese || (chinese = chineseTools().catch(error => { chinese = undefined; throw error; }));
const loadKorean = () => korean || (korean = import("es-hangul").catch(error => { korean = undefined; throw error; }));
const loadOther = () => other || (other = import("./scriptReading").catch(error => { other = undefined; throw error; }));

interface SpanReading { romanized: string; reviewNeeded: boolean }
const CJK_SPAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}ー々〆〻ﾞﾟ]+/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const remainingScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Arabic}]/u;

/** Separate a converted word from adjoining original words without altering punctuation. */
async function replaceReadingSpans(text: string, expression: RegExp, read: (span: string) => Promise<SpanReading>, checkpoint: () => Promise<void>): Promise<SpanReading> {
  let romanized = "", cursor = 0, reviewNeeded = false;
  for (const match of text.matchAll(expression)) {
    await checkpoint();
    const start = match.index!, end = start + match[0].length;
    const result = await read(match[0]);
    romanized += text.slice(cursor, start);
    if (result.romanized !== match[0]) {
      if (/[\p{L}\p{N}]$/u.test(text.slice(Math.max(0, start - 2), start)) && /^[\p{L}\p{N}]/u.test(result.romanized)) romanized += " ";
      romanized += result.romanized;
      if (/[\p{L}\p{N}]$/u.test(result.romanized) && /^[\p{L}\p{N}]/u.test(text.slice(end, end + 2))) romanized += " ";
    } else romanized += result.romanized;
    reviewNeeded ||= result.reviewNeeded;
    cursor = end;
  }
  return { romanized: romanized + text.slice(cursor), reviewNeeded };
}

/** Verb + 得 + a degree/result complement uses neutral de, not lexical dé. */
function neutralComplementIndices(text: string) {
  const indices = new Set<number>();
  const complement = /[笑哭唱说讲跑走跳飞睡吃喝看听想爱学做过长变活穿累忙急气]得(?=[很太真更最好坏美高低快慢远近冷热大小甜苦酸清紧深浅开痛难轻重漂幸自可不没])/gu;
  for (const match of text.matchAll(complement)) indices.add(match.index! + 1);
  return indices;
}

export async function romanizeLyricLines<T extends { text: string }>(lines: readonly T[], language: ReadingLanguage, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (lines.length > 400 || lines.reduce((sum, line) => sum + line.text.length, 0) > 20_000) throw new RangeError("Lyrics exceed reading limits");
  const result = [];
  let deadline = performance.now() + 8;
  const checkpoint = async () => {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      deadline = performance.now() + 8;
    }
  };
  for (const line of lines) {
    await checkpoint();
    // Transform each script independently. A Japanese word keeps its Han and
    // kana together, while Korean, Cyrillic etc. in the same line get their own
    // engine. The requested language resolves genuinely ambiguous Han spans.
    let reading = await replaceReadingSpans(line.text, CJK_SPAN, async span => {
      if (!HAN.test(span) && !KANA.test(span)) return { romanized: span, reviewNeeded: false };
      if (KANA.test(span) || language === "ja") {
        const { romanizeJapanese } = await loadJapanese();
        await checkpoint();
        return romanizeJapanese(span.normalize("NFKC"));
      }
      // Hanja needs Korean vocabulary evidence; Mandarin would invent a wrong
      // Korean reading. Keep it visible until such evidence is available.
      if (language === "ko") return { romanized: span, reviewNeeded: true };
      const { pinyin, simplify } = await loadChinese();
      await checkpoint();
      const simplified = simplify(span);
      const neutral = neutralComplementIndices(simplified);
      const syllables = pinyin(simplified, { toneType: "symbol", type: "all", segmentit: 2 });
      let offset = 0;
      const romanized = syllables.map(syllable => {
        const value = neutral.has(offset) ? "de" : syllable.result;
        offset += syllable.origin.length;
        return value;
      }).join(" ");
      return { romanized, reviewNeeded: syllables.some(syllable => syllable.polyphonic.length > 1) || HAN.test(romanized) };
    }, checkpoint);
    const hangul = await replaceReadingSpans(reading.romanized, /\p{Script=Hangul}[\p{Script=Hangul}\p{M}]*/gu, async span => {
      const { romanize } = await loadKorean();
      await checkpoint();
      const romanized = romanize(span.normalize("NFC"));
      return { romanized, reviewNeeded: /\p{Script=Hangul}/u.test(romanized) };
    }, checkpoint);
    reading = { romanized: hangul.romanized, reviewNeeded: reading.reviewNeeded || hangul.reviewNeeded };
    const scripts: Array<["ru" | "uk" | "el" | "hi" | "ar", RegExp]> = [
      [language === "uk" || /[іїєґ]/iu.test(line.text) ? "uk" : "ru", /\p{Script=Cyrillic}[\p{Script=Cyrillic}\p{M}'’ʼ]*/gu],
      ["el", /\p{Script=Greek}[\p{Script=Greek}\p{M}]*/gu],
      ["hi", /\p{Script=Devanagari}[\p{Script=Devanagari}\p{M}]*/gu],
      ["ar", /\p{Script=Arabic}[\p{Script=Arabic}\p{M}]*/gu],
    ];
    for (const [spanLanguage, expression] of scripts) {
      const next = await replaceReadingSpans(reading.romanized, expression, async span => {
        const { romanizeScriptSpan } = await loadOther();
        await checkpoint();
        return romanizeScriptSpan(span, spanLanguage);
      }, checkpoint);
      reading = { romanized: next.romanized, reviewNeeded: reading.reviewNeeded || next.reviewNeeded };
    }
    await checkpoint();
    result.push({ ...line, romanized: reading.romanized, readingReviewNeeded: reading.reviewNeeded || remainingScript.test(reading.romanized), readingEngine: readingEngine(language) });
  }
  return result;
}
