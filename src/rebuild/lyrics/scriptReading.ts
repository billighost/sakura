/** Server-only, script-specific reading rules. These never translate lyric words. */
import { transliterate } from "transliteration";

export type ScriptReadingLanguage = "ru" | "uk" | "el" | "hi" | "ar";
export interface ScriptReading { romanized: string; reviewNeeded: boolean }

const CYRILLIC: Record<string, string> = {
  а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"yo", ж:"zh", з:"z", и:"i", й:"y",
  к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f",
  х:"kh", ц:"ts", ч:"ch", ш:"sh", щ:"shch", ъ:"", ы:"y", ь:"", э:"e", ю:"yu", я:"ya",
};
const UKRAINIAN: Record<string, string> = {
  ...CYRILLIC, г:"h", ґ:"g", и:"y", і:"i", й:"i", є:"ie", ї:"i", ю:"iu", я:"ia",
};
const UKRAINIAN_INITIAL: Record<string, string> = { є:"ye", ї:"yi", й:"y", ю:"yu", я:"ya" };

function caseReading(source: string, reading: string) {
  if (!reading) return "";
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return [...source].length > 1 ? reading.toUpperCase() : reading[0]?.toUpperCase() + reading.slice(1);
  }
  if (source[0] !== source[0]?.toLowerCase()) return reading[0].toUpperCase() + reading.slice(1);
  return reading;
}

function cyrillic(text: string, language: "ru" | "uk") {
  const table = language === "uk" ? UKRAINIAN : CYRILLIC;
  let output = "", wordInitial = true;
  const characters = [...text.normalize("NFC")];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index], lower = character.toLowerCase();
    if (character === "\u0301") continue; // Written stress does not change the transliterated letter.
    if (language === "uk" && lower === "з" && characters[index + 1]?.toLowerCase() === "г") {
      output += caseReading(character + characters[++index], "zgh"); wordInitial = false; continue;
    }
    const reading = language === "uk" && wordInitial && UKRAINIAN_INITIAL[lower] !== undefined
      ? UKRAINIAN_INITIAL[lower] : table[lower];
    if (reading !== undefined) { output += caseReading(character, reading); wordInitial = false; }
    else {
      output += character;
      // The apostrophe is part of a Ukrainian word, not a new word boundary.
      if (!/[’ʼ']/u.test(character)) wordInitial = !/\p{L}/u.test(character);
    }
  }
  return output;
}

const GREEK: Record<string, string> = {
  α:"a", β:"v", γ:"g", δ:"d", ε:"e", ζ:"z", η:"i", θ:"th", ι:"i", κ:"k", λ:"l",
  μ:"m", ν:"n", ξ:"x", ο:"o", π:"p", ρ:"r", σ:"s", ς:"s", τ:"t", υ:"y", φ:"f",
  χ:"ch", ψ:"ps", ω:"o", ϊ:"ï", ϋ:"ÿ",
};
const GREEK_PAIRS: Record<string, string> = { ου:"ou", αι:"ai", ει:"ei", οι:"oi", υι:"yi", γγ:"ng", γκ:"gk", γχ:"nch", γξ:"nx" };
function greek(text: string) {
  // Keep diaeresis: αϊ is two vowels, whereas αι is a digraph.
  const characters = [...text.normalize("NFD").replace(/[\u0300\u0301\u0313\u0314\u0342\u0345]/gu, "").normalize("NFC")];
  let output = "";
  for (let index = 0; index < characters.length; index++) {
    const source = characters[index], lower = source.toLowerCase();
    const next = characters[index + 1]?.toLowerCase(), pair = lower + (next || "");
    let reading = GREEK_PAIRS[pair];
    if (pair === "αυ" || pair === "ευ" || pair === "ηυ") {
      const voiced = /[αεηιουωβγδζλμνρϊϋ]/u.test(characters[index + 2]?.toLowerCase() || "");
      reading = ({ αυ:"a", ευ:"e", ηυ:"i" })[pair] + (voiced ? "v" : "f");
    }
    if (reading !== undefined) { output += caseReading(source + characters[++index], reading); }
    else { output += GREEK[lower] === undefined ? source : caseReading(source, GREEK[lower]); }
  }
  return output;
}

const HINDI_CONSONANTS: Record<string, string> = {
  क:"k", ख:"kh", ग:"g", घ:"gh", ङ:"ng", च:"ch", छ:"chh", ज:"j", झ:"jh", ञ:"ny",
  ट:"ṭ", ठ:"ṭh", ड:"ḍ", ढ:"ḍh", ण:"ṇ", त:"t", थ:"th", द:"d", ध:"dh", न:"n",
  प:"p", फ:"ph", ब:"b", भ:"bh", म:"m", य:"y", र:"r", ल:"l", व:"v", श:"sh", ष:"sh", स:"s", ह:"h",
  ळ:"ḷ", ऱ:"r", ऩ:"n", क़:"q", ख़:"kh", ग़:"gh", ज़:"z", ड़:"ṛ", ढ़:"ṛh", फ़:"f", य़:"y",
};
const HINDI_NUKTA: Record<string, string> = { क:"q", ख:"kh", ग:"gh", ज:"z", ड:"ṛ", ढ:"ṛh", फ:"f", य:"y", न:"n", र:"r", ल:"ḷ" };
const HINDI_VOWELS: Record<string, string> = { अ:"a", आ:"ā", इ:"i", ई:"ī", उ:"u", ऊ:"ū", ऋ:"ri", ॠ:"rī", ऌ:"li", ॡ:"lī", ए:"e", ऐ:"ai", ओ:"o", औ:"au", ऍ:"e", ऑ:"o" };
const HINDI_MATRAS: Record<string, string> = { "ा":"ā", "ि":"i", "ी":"ī", "ु":"u", "ू":"ū", "ृ":"ri", "ॄ":"rī", "ॢ":"li", "ॣ":"lī", "े":"e", "ै":"ai", "ो":"o", "ौ":"au", "ॅ":"e", "ॉ":"o", "ॆ":"e", "ॊ":"o" };
// An ending alone does not prove verb morphology: जननी and सरस्वती are nouns.
// These ordinary verb stems license the productive consonant + त/न endings;
// ambiguous noun/verb stems such as साध and रच deliberately remain unlisted.
const HINDI_VERB_STEMS = new Set([
  "सक", "कर", "रख", "मिल", "चल", "रह", "बन", "सुन", "लग", "भर", "मर", "डर", "हँस",
  "चाह", "देख", "लिख", "पढ़", "उठ", "बैठ", "बोल", "खेल", "खोल", "भूल", "तोड़", "जोड़",
  "सोच", "सीख", "भाग", "रोक", "कह", "माँग", "चुन", "थम", "थक", "कट", "छिप", "लुट", "लूट", "छूट", "टूट",
]);
const HINDI_FUNCTION_ENDINGS = new Set(["अपना", "अपने", "अपनी", "उसने", "इसने", "हमने", "तुमने", "जिसने", "किसने", "सबने"]);
interface HindiSyllable { consonant: string; vowel: string; inherent: boolean; marks: string }

/** Hindi is an abugida: a consonant has a vowel unless a matra/virama changes it. */
function hindiWord(word: string) {
  const syllables: HindiSyllable[] = [], characters = [...word.normalize("NFC")];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    let consonant = HINDI_CONSONANTS[character];
    if (character === "ज" && characters[index + 1] === "्" && characters[index + 2] === "ञ") {
      // The orthographic ज्ञ conjunct has the modern Hindi reading gy, not jny.
      consonant = "gy"; index += 2;
    } else if (consonant !== undefined && characters[index + 1] === "़") {
      consonant = HINDI_NUKTA[character] || consonant; index++;
    }
    if (consonant !== undefined) { syllables.push({consonant, vowel:"a", inherent:true, marks:""}); continue; }
    const previous = syllables.at(-1);
    if (HINDI_MATRAS[character] !== undefined && previous?.consonant) {
      previous.vowel = HINDI_MATRAS[character]; previous.inherent = false;
    } else if (character === "्" && previous?.consonant) {
      previous.vowel = ""; previous.inherent = false;
    } else if ((character === "ं" || character === "ँ") && previous) {
      // A learner-friendly nasal marker; m before labials, n elsewhere.
      previous.marks += /[पफबभम]/u.test(characters[index + 1] || "") ? "m" : "n";
    } else if (character === "ः" && previous) previous.marks += "h";
    else if (HINDI_VOWELS[character] !== undefined) syllables.push({consonant:"", vowel:HINDI_VOWELS[character], inherent:false, marks:""});
    else syllables.push({consonant:character === "ॐ" ? "om" : character === "ऽ" ? "'" : character, vowel:"", inherent:false, marks:""});
  }
  const final = syllables.at(-1);
  if (final?.inherent && !final.marks && syllables.slice(0, -1).some(syllable => syllable.vowel)) {
    final.vowel = ""; // Hindi word-final schwa deletion; explicit long vowels survive.
  }
  // Only established verb stems/function words justify this internal deletion:
  // सकते -> sakte, अपना -> apnā, सुनना -> sunnā. Preserve noun vowels otherwise.
  const suffix = syllables.at(-1), beforeSuffix = syllables.at(-2);
  const inflection = /^(.+)[तन][ाीे]$/u.exec(word.normalize("NFC"));
  const knownInflection = Boolean(inflection && HINDI_VERB_STEMS.has(inflection[1])) || HINDI_FUNCTION_ENDINGS.has(word.normalize("NFC"));
  if (suffix && /^(?:t|n)$/.test(suffix.consonant) && /^(?:ā|ī|e)$/.test(suffix.vowel)
      && knownInflection && beforeSuffix?.inherent && !beforeSuffix.marks && syllables.slice(0, -2).some(syllable => syllable.vowel)) {
    beforeSuffix.vowel = "";
  }
  return syllables.map(({consonant, vowel, marks}) => consonant + vowel + marks).join("");
}

function hindi(text: string) {
  return text.replace(/[\p{Script=Devanagari}\p{M}]+/gu, hindiWord);
}

const ARABIC: Record<string, string> = {
  "ء":"ʾ", "أ":"ʾ", "إ":"ʾ", "آ":"ʾā", "ؤ":"ʾ", "ئ":"ʾ", "ا":"ā", "ب":"b", "ت":"t",
  "ث":"th", "ج":"j", "ح":"ḥ", "خ":"kh", "د":"d", "ذ":"dh", "ر":"r", "ز":"z", "س":"s", "ش":"sh",
  "ص":"ṣ", "ض":"ḍ", "ط":"ṭ", "ظ":"ẓ", "ع":"ʿ", "غ":"gh", "ف":"f", "ق":"q", "ك":"k", "ل":"l",
  "م":"m", "ن":"n", "ه":"h", "و":"w", "ي":"y", "ى":"ā", "ة":"h", "ٱ":"a", "ـ":"",
};
function arabic(text: string) {
  // Arabic normally omits short vowels. Read the written marks, long-vowel
  // letters and shadda; never fill in a singer's/dialect's unwritten vowels.
  const letters: Array<{character:string; marks:string}> = [];
  for (const character of text.normalize("NFKC")) {
    const previous = letters.at(-1);
    if (/\p{M}/u.test(character) && previous) previous.marks += character;
    else letters.push({character, marks:""});
  }
  let output = "";
  for (let index = 0; index < letters.length; index++) {
    const {character, marks} = letters[index], next = letters[index + 1];
    let consonant = ARABIC[character];
    if (consonant === undefined) { output += transliterate(character) || character; continue; }
    if (character === "ا" && next?.character === "ل" && (!index || !/\p{L}/u.test(letters[index - 1].character))) consonant = "a";
    output += consonant + (marks.includes("ّ") ? consonant : "");
    const mater = next && (!next.marks || next.marks === "ْ");
    if (marks.includes("َ")) {
      if (mater && (next.character === "ا" || next.character === "ى")) { output += "ā"; index++; }
      else output += "a";
    } else if (marks.includes("ِ")) {
      if (mater && next.character === "ي") { output += "ī"; index++; }
      else output += "i";
    } else if (marks.includes("ُ")) {
      if (mater && next.character === "و") { output += "ū"; index++; }
      else output += "u";
    } else if (marks.includes("ً")) output += "an";
    else if (marks.includes("ٍ")) output += "in";
    else if (marks.includes("ٌ")) output += "un";
    if (marks.includes("ٰ")) output += "ā";
  }
  return output;
}

export function romanizeScriptSpan(text: string, language: ScriptReadingLanguage): ScriptReading {
  const romanized = language === "ru" || language === "uk" ? cyrillic(text, language)
    : language === "el" ? greek(text) : language === "hi" ? hindi(text) : arabic(text);
  // Internal provenance stays conservative, particularly for Hindi schwas and
  // unvocalized Arabic. The listening UI decides how to present the guide.
  return {romanized, reviewNeeded: romanized !== text};
}
