import { JAPANESE_READING_VERSION } from "./versions";

export const READING_LANGUAGES = ["ja", "zh", "ko", "ru", "uk", "el", "hi", "ar", "te", "kn", "ml", "or", "sr", "ka"] as const;
export type ReadingLanguage = typeof READING_LANGUAGES[number];
export const READING_VERSION = "multilingual-reading-v3";
export const READING_LABELS: Record<ReadingLanguage, string> = {
  ja: "Japanese reading guide", zh: "Chinese Pinyin", ko: "Korean romanization",
  ru: "Russian transliteration", uk: "Ukrainian transliteration", el: "Greek transliteration",
  hi: "Hindi transliteration", ar: "Arabic transliteration", te: "Telugu transliteration",
  kn: "Kannada transliteration", ml: "Malayalam transliteration", or: "Odia transliteration",
  sr: "Serbian Latin", ka: "Georgian transliteration",
};
export const READING_SCRIPTS: Record<ReadingLanguage, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, zh: /\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u, ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u,
  sr: /\p{Script=Cyrillic}/u, el: /\p{Script=Greek}/u, hi: /\p{Script=Devanagari}/u,
  ar: /\p{Script=Arabic}/u, te: /\p{Script=Telugu}/u, kn: /\p{Script=Kannada}/u,
  ml: /\p{Script=Malayalam}/u, or: /\p{Script=Oriya}/u, ka: /\p{Script=Georgian}/u,
};
export function readingEngine(language: ReadingLanguage) { return language === "ja" ? JAPANESE_READING_VERSION : READING_VERSION + ":" + language; }

// Accept catalogue/user language evidence, including ISO 639-3 and BCP 47.
// Artist names, album countries and Latin lyric fragments are not language hints.
const LANGUAGE_ALIASES: Record<string, string> = {
  jpn: "ja", japanese: "ja", zho: "zh", chi: "zh", chinese: "zh", mandarin: "zh",
  kor: "ko", korean: "ko", rus: "ru", russian: "ru", ukr: "uk", ukrainian: "uk",
  ell: "el", gre: "el", greek: "el", hin: "hi", hindi: "hi", ara: "ar", arabic: "ar",
  tel: "te", telugu: "te", kan: "kn", kannada: "kn", mal: "ml", malayalam: "ml",
  ori: "or", ory: "or", odia: "or", oriya: "or", srp: "sr", serbian: "sr",
  kat: "ka", geo: "ka", georgian: "ka", mingrelian: "xmf", megrelian: "xmf", svan: "sva", laz: "lzz",
  tam: "ta", tamil: "ta", ben: "bn", bengali: "bn",
  pan: "pa", punjabi: "pa", guj: "gu", gujarati: "gu", mar: "mr", marathi: "mr",
  nep: "ne", nepali: "ne", npi: "ne", san: "sa", sanskrit: "sa", asm: "as", assamese: "as",
  konkani: "kok", tulu: "tcy", gondi: "gon", koya: "kff", santali: "sat",
  maithili: "mai", bhojpuri: "bho", dogri: "doi", awadhi: "awa", bodo: "brx", newari: "new", newar: "new",
  bul: "bg", bulgarian: "bg", mkd: "mk", mac: "mk", macedonian: "mk", bel: "be", belarusian: "be",
  kaz: "kk", kazakh: "kk", kir: "ky", kyrgyz: "ky", mon: "mn", mongolian: "mn", tgk: "tg", tajik: "tg",
  bos: "bs", bosnian: "bs", montenegrin: "cnr", tat: "tt", tatar: "tt", bak: "ba", bashkir: "ba", chv: "cv", chuvash: "cv", hbs: "sh", "serbo-croatian": "sh",
  fas: "fa", per: "fa", persian: "fa", urd: "ur", urdu: "ur", heb: "he", hebrew: "he",
  pus: "ps", pashto: "ps", snd: "sd", sindhi: "sd", uig: "ug", uyghur: "ug", kur: "ku", kurdish: "ku", sorani: "ckb", kas: "ks", kashmiri: "ks", balochi: "bal",
  tha: "th", thai: "th", hye: "hy", arm: "hy", armenian: "hy", cantonese: "yue",
};
export function normalizeLyricLanguageHint(hint?: string): string | undefined {
  const value = hint?.trim().toLowerCase();
  if (!value) return;
  return LANGUAGE_ALIASES[value] || LANGUAGE_ALIASES[value.split(/[-_]/)[0]] || value.split(/[-_]/)[0];
}

const DEVANAGARI_LANGUAGES = new Set(["hi", "mr", "ne", "sa", "kok", "mai", "bho", "doi", "awa", "brx", "new"]);
const CYRILLIC_LANGUAGES = new Set(["ru", "uk", "sr", "bg", "mk", "be", "kk", "ky", "mn", "tg", "bs", "cnr", "tt", "ba", "cv", "sh"]);
const ARABIC_LANGUAGES = new Set(["ar", "fa", "ur", "pa", "ps", "sd", "ug", "ku", "ckb", "ks", "bal"]);
type IndicLanguage = "te" | "kn" | "ml" | "or";
const INDIC_SCRIPT_LANGUAGES: Record<IndicLanguage, ReadonlySet<string>> = {
  te: new Set(["te", "sa", "gon", "ggo", "gno", "kff"]),
  kn: new Set(["kn", "sa", "kok", "tcy"]),
  ml: new Set(["ml", "sa"]), or: new Set(["or", "sa", "sat"]),
};
// Shared possessives (Hindi/Marathi तुझे, Hindi/Nepali मेरा, Russian/Ukrainian
// моя) do not establish a language. Require more distinctive vocabulary.
const HINDI_WORDS = new Set(["नहीं", "हूँ", "हूं", "हैं", "तुम्हें", "तुम्हारा", "मुझे", "हमारे", "क्यों", "कैसे", "क्या"]);
const RUSSIAN_WORDS = new Set(["привет", "крови", "рукаве", "тебя", "меня", "что", "это", "мой", "моё", "твоё"]);

/** An Indic alphabet can write another language; known compatible hints win. */
export function indicReadingLanguage(language: IndicLanguage, hint?: string): IndicLanguage | null {
  const hinted = normalizeLyricLanguageHint(hint);
  return hinted && hinted !== language && INDIC_SCRIPT_LANGUAGES[language].has(hinted) ? null : language;
}

/** Shared script is not a language. Resolve it only with compatible evidence. */
export function devanagariReadingLanguage(text: string, hint?: string, fallback?: ReadingLanguage): "hi" | null {
  const language = normalizeLyricLanguageHint(hint);
  if (language && DEVANAGARI_LANGUAGES.has(language)) return language === "hi" ? "hi" : null;
  if (fallback === "hi") return "hi";
  return (text.match(/[\p{Script=Devanagari}\p{M}]+/gu) || []).some(word => HINDI_WORDS.has(word)) ? "hi" : null;
}
export function cyrillicReadingLanguage(text: string, hint?: string, fallback?: ReadingLanguage): "ru" | "uk" | "sr" | null {
  const language = normalizeLyricLanguageHint(hint);
  if (language && CYRILLIC_LANGUAGES.has(language) && !["ru", "uk", "sr"].includes(language)) return null;
  // Macedonian and other unsupported alphabets must not inherit Russian rules.
  if (/[ѓќѕўқңүұҳҷҫӑӗӧ]/iu.test(text)) return null;
  const ukrainian = /[іїєґ]/iu.test(text), serbian = /[ђћ]/iu.test(text);
  if (ukrainian && serbian) return language === "uk" || language === "sr" ? language : null;
  if (ukrainian) return "uk";
  if (serbian) return "sr";
  if (language === "ru" || language === "uk" || language === "sr") return language;
  if (fallback === "ru" || fallback === "uk" || fallback === "sr") return fallback;
  // љ, њ, џ and ј also occur in Macedonian. A hint is needed for these words.
  if (/[љњџј]/iu.test(text)) return null;
  return (text.match(/\p{Script=Cyrillic}+/gu) || []).some(word => RUSSIAN_WORDS.has(word.toLowerCase())) ? "ru" : null;
}
export function arabicReadingLanguage(text: string, hint?: string): "ar" | null {
  const language = normalizeLyricLanguageHint(hint);
  if (language && ARABIC_LANGUAGES.has(language)) return language === "ar" ? "ar" : null;
  return /[پچژگکۍےٹڈڑںھ]/u.test(text) ? null : "ar";
}

/** Native script wins over unrelated metadata; hints resolve shared scripts. */
export function lyricReadingLanguage(text: string, hint?: string): ReadingLanguage | null {
  const hinted = normalizeLyricLanguageHint(hint);
  const count = (expression: RegExp) => text.match(expression)?.length || 0;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu), han = count(/\p{Script=Han}/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const attachedJapaneseHan = [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+/gu)]
    .filter(match => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(match[0]))
    .reduce((total, match) => total + (match[0].match(/\p{Script=Han}/gu)?.length || 0), 0);
  const japaneseHan = hinted === "ja" && (kana || !hangul) ? han : attachedJapaneseHan;
  const koreanHan = hinted === "ko" ? han - japaneseHan : 0;
  const choices: Array<[ReadingLanguage | null, number]> = [
    ["ja", kana + japaneseHan], ["ko", hangul + koreanHan],
    [hinted === "yue" ? null : "zh", han - japaneseHan - koreanHan],
    [cyrillicReadingLanguage(text, hinted), count(/\p{Script=Cyrillic}/gu)],
    ["el", count(/\p{Script=Greek}/gu)],
    [devanagariReadingLanguage(text, hinted), count(/\p{Script=Devanagari}/gu)],
    [arabicReadingLanguage(text, hinted), count(/\p{Script=Arabic}/gu)],
    [indicReadingLanguage("te", hinted), count(/\p{Script=Telugu}/gu)], [indicReadingLanguage("kn", hinted), count(/\p{Script=Kannada}/gu)],
    [indicReadingLanguage("ml", hinted), count(/\p{Script=Malayalam}/gu)], [indicReadingLanguage("or", hinted), count(/\p{Script=Oriya}/gu)],
    [hinted === "xmf" || hinted === "sva" || hinted === "lzz" ? null : "ka", count(/\p{Script=Georgian}/gu)],
    // Unsupported primary lyrics must not become a reading for a short refrain.
    [null, count(/\p{Script=Tamil}/gu)], [null, count(/\p{Script=Bengali}/gu)],
    [null, count(/\p{Script=Gurmukhi}/gu)], [null, count(/\p{Script=Gujarati}/gu)],
    [null, count(/\p{Script=Armenian}/gu)], [null, count(/\p{Script=Thai}/gu)],
    [null, count(/\p{Script=Hebrew}/gu)],
  ];
  choices.sort((a, b) => b[1] - a[1] || Number(b[0] === hinted) - Number(a[0] === hinted));
  return choices[0][1] ? choices[0][0] : null;
}
