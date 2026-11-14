/** Server-only Indic guides: maintained ISO maps and Tamil contextual readings. */
import Sanscript from "@indic-transliteration/sanscript";
import { romanizeTamilWord } from "./tamilReading";

export type IndicReadingLanguage = "te" | "kn" | "ml" | "or" | "ta";
const SCHEMES: Record<IndicReadingLanguage, string> = { te: "telugu", kn: "kannada", ml: "malayalam", or: "oriya", ta: "tamil" };
const WORDS: Record<IndicReadingLanguage, RegExp> = {
  te: /\p{Script=Telugu}[\p{Script=Telugu}\p{M}\u200c\u200d]*/gu,
  kn: /\p{Script=Kannada}[\p{Script=Kannada}\p{M}\u200c\u200d]*/gu,
  ml: /\p{Script=Malayalam}[\p{Script=Malayalam}\p{M}\u200c\u200d]*/gu,
  or: /\p{Script=Oriya}[\p{Script=Oriya}\p{M}\u200c\u200d]*/gu,
  ta: /\p{Script=Tamil}[\p{Script=Tamil}\p{M}\u200c\u200d]*/gu,
};
const CHILLUS: Record<string, string> = { "ൺ": "ണ്", "ൻ": "ന്", "ർ": "ര്", "ൽ": "ല്", "ൾ": "ള്", "ൿ": "ക്", "ൔ": "മ്", "ൕ": "യ്", "ൖ": "ഴ്" };

function malayalamPlain(text: string) {
  // Atomic and legacy consonant + virama + ZWJ chillus have the same reading.
  // Keep their dead consonants; Sanscript does not cover atomic chillus itself.
  return Sanscript.t(text.replace(/[ൺൻർൽൾൿൔൕൖ]/gu, character => CHILLUS[character]).replace(/[\u200c\u200d]/gu, ""), "malayalam", "iso");
}

function malayalamWord(word: string) {
  const text = word.normalize("NFC").replace(/ൌ/gu, "ൌ").replace(/ൗ/gu, "ൌ");
  let output = "", cursor = 0;
  // Unicode 17 §12.9: stacked ṟ+ṟ is alveolar ṯṯ, and explicitly stacked
  // n+ṟ is ṉṯ. Controls before virama only select the ligature style; controls
  // after virama in old ന്‍റ leave it ambiguous, as do plain ററ/ൻറ.
  for (const match of text.matchAll(/(?:റ[\u200c\u200d]*്റ|[നൻ][\u200c\u200d]*്റ)[\p{M}\u200c\u200d]*/gu)) {
    output += malayalamPlain(text.slice(cursor, match.index));
    output += malayalamPlain(match[0]).replace(/ṟṟ/gu, "ṯṯ").replace(/nṟ/gu, "ṉṯ");
    cursor = match.index! + match[0].length;
  }
  output += malayalamPlain(text.slice(cursor));
  // Only explicitly written u + candrakkala licenses half-u. Bare terminal
  // virama can be a pure consonant or half-u; do not invent a vowel for it.
  return /ു്[\u200c\u200d]*$/u.test(text) ? output.replace(/u$/u, "ŭ") : output;
}

function nasalReading(text: string, language: IndicReadingLanguage) {
  const reading = text.replace(/ṁ(?=[kg])/gu, "ṅ").replace(/ṁ(?=[cj])/gu, "ñ")
    .replace(/ṁ(?=[ṭḍ])/gu, "ṇ").replace(/ṁ(?=[tdn])/gu, "n").replace(/ṁ(?=[pbm])/gu, "m")
    .replace(/m\u0310/gu, "\u0303");
  // Telugu/Kannada/Malayalam final anusvara is the written final nasal /m/.
  // Odia keeps ISO's nasal marker: its vowel nasalization is not a final m rule.
  return (language === "or" ? reading : reading.replace(/ṁ$/u, "m")).normalize("NFC");
}

export function romanizeIndicSpan(text: string, language: IndicReadingLanguage): string {
  // Pass native words only. Literal punctuation, digits, Latin fragments and
  // Sanscript's ##/backslash controls in lyrics must never become instructions.
  return text.replace(WORDS[language], word => {
    if (language === "ta") return romanizeTamilWord(word);
    const normalized = word.normalize("NFC");
    const native = language === "or" ? normalized.replace(/ଡ଼/gu, "ଡ଼").replace(/ଢ଼/gu, "ଢ଼") : normalized;
    const reading = language === "ml" ? malayalamWord(native)
      : Sanscript.t(native.replace(/[\u200c\u200d]/gu, ""), SCHEMES[language], "iso");
    return nasalReading(reading, language);
  });
}
