import tamilInitials from "./data/tamil-initials.json";
import sourceReviewedInitials from "./data/tamil-reviewed-initials.json";

/** Server-only Tamil reading guide: written vowel/letter distinctions plus
 * predictable stop allophones. This is a conventional reading, not narrow IPA.
 *
 * References: Unicode 17 §12.6 (Tamil encoding), ISO 15919 letter distinctions,
 * Harold Schiffman's Tamil grammar (Penn), transliteration chapter:
 * https://ccat.sas.upenn.edu/plc/tamilweb/book/chapter1/node20.html
 * and https://en.wikipedia.org/wiki/Tamil_phonology (initial c/s examples).
 * Here g/b/d are conventional readings of variable g~h/b~v/d~ð allophones.
 * Native spelling alone cannot establish every
 * loan, dialect, compound boundary or singer's elision; those are not guessed.
 */
const VOWELS: Record<string, string> = {
  அ: "a", ஆ: "ā", இ: "i", ஈ: "ī", உ: "u", ஊ: "ū",
  எ: "e", ஏ: "ē", ஐ: "ai", ஒ: "o", ஓ: "ō", ஔ: "au",
};
const CONSONANTS: Record<string, string> = {
  க: "k", ங: "ṅ", ச: "c", ஞ: "ñ", ட: "ṭ", ண: "ṇ", த: "t", ந: "n",
  ப: "p", ம: "m", ய: "y", ர: "r", ல: "l", வ: "v", ழ: "ḻ", ள: "ḷ",
  ற: "ṟ", ன: "ṉ", ஜ: "j", ஶ: "ś", ஷ: "ṣ", ஸ: "s", ஹ: "h",
};
const SIGNS: Record<string, string> = {
  "ா": "ā", "ி": "i", "ீ": "ī", "ு": "u", "ூ": "ū", "ெ": "e",
  "ே": "ē", "ை": "ai", "ொ": "o", "ோ": "ō", "ௌ": "au", "்": "",
};
const VOICED: Record<string, string> = { க: "g", ச: "j", ட: "ḍ", த: "d", ப: "b" };
// Tamil nasal+stop clusters voice the stop; c→j requires the written palatal ñ.
// Other nasal+c combinations can cross a compound boundary and retain c.
// The written nasal is retained:
// அன்பு/முன்பே contain alveolar ṉ, not a guessed homorganic m.
const NASALS = new Set(["ங", "ஞ", "ண", "ந", "ம", "ன"]);
// Singleton stops also voice after a written glide/lateral/rhotic within a
// word. Independent peidhidum/moozhgidum song text verifies ய்+த and ழ்+க:
// https://www.tamil2lyrics.com/lyrics/nenjukkul-peidhidum-song-lyrics/
// https://bharatlyrics.com/nenjukkul-peidhidum-lyrics/
// Independent lexical IPA /muːɻɡɯ/ confirms the voiced ḻ+g cluster:
// https://en.wiktionary.org/wiki/மூழ்கு
// Keep ற out: Schiffman's grammar treats it as an underlying stop, so கற்க
// and கற்பனை must not acquire a spurious voiced cluster. Compound boundaries
// and borrowed clusters still require lexical evidence, as with other rules.
const MEDIAL_SONORANTS = new Set(["ய", "ர", "ல", "வ", "ழ", "ள"]);
// Exact reviewed initial-letter choices, never substring/title substitutions.
// Unknown initials retain their written consonant, particularly ambiguous c/s.
// The rest of each word still follows the vowel, pulli and contextual rules.
// These conventional source readings do not assert a universal dialect sound.
// Lexical c/s examples: Tamil phonology reference above; independent song text:
// https://bharatlyrics.com/adiye-bachelor-lyrics/
// https://www.tamil2lyrics.com/lyrics/adiye-song-lyrics-bachelor/
// https://bharatlyrics.com/kannaana-kanney-lyrics/ and Tamil2's same song
// https://www.tamil2lyrics.com/lyrics/unakenna-venum-sollu-song-lyrics/
// https://bharatlyrics.com/enna-solla-pogirai-lyrics/
// https://bharatlyrics.com/moongil-thottam-lyrics/
// https://bharatlyrics.com/rowdy-baby-lyrics/
// https://www.tamil2lyrics.com/lyrics/vennilavae-vennilavae-song-lyrics/
// Informal "th" in geetham does not prove an unvoiced medial t: only its
// independently printed initial g is selected; medial த retains normal d.
// https://en.wiktionary.org/wiki/கீதம் also gives /ɡiːd̪ɐm/ (and initial k),
// while பிம்பம் gives initial b/p alternatives. We select the checked lyric
// variant, without making that choice universal for all dialects.
const REVIEWED_INITIALS: Record<string, string> = {
  // Exact published preferred initials; metadata records tokens, URLs, hashes
  // and whether dictionary/second-source corroboration is established.
  // Inflected forms are individually listed, never generated from a stem.
  ...sourceReviewedInitials,
  சாவி: "s", சேலம்: "s", சரி: "s", சாய: "s", சாயாதே: "s", சில: "s",
  சட்டென்று: "s", சொல்லு: "s", சோடாவே: "s",
  போதை: "b", பிம்பம்: "b", கீதம்: "g", கோலி: "g",
};
// Separately licensed Dakshina data: exact words with at least three unanimous
// attestations and whole-word vowel/consonant alignment. No stems or complete
// Roman word replacements; reviewed source choices above always take priority.
// The server reading pipeline imports only this compact map, not its metadata.
// See data/README.md for attribution, license and reproducible source evidence.
const DATASET_INITIALS: Readonly<Record<string, string>> = tamilInitials;
const JOINER = /[\u200c\u200d]/u;

interface Unit { source: string; reading: string; consonant?: string; vowel?: string }

function units(word: string): Unit[] {
  const characters = [...word];
  const output: Unit[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (JOINER.test(character)) continue; // Native glyph formatting only.
    const consonant = CONSONANTS[character];
    if (consonant !== undefined) {
      let end = index + 1;
      while (JOINER.test(characters[end] || "")) end++;
      const sign = SIGNS[characters[end]];
      const vowel = sign === undefined ? "a" : sign;
      if (sign !== undefined) end++;
      while (JOINER.test(characters[end] || "")) end++;
      output.push({ source: character, consonant: character, vowel, reading: consonant + vowel });
      index = end - 1;
    } else if (VOWELS[character] !== undefined) {
      output.push({ source: character, vowel: VOWELS[character], reading: VOWELS[character] });
    } else {
      const reading = character === "ஃ" ? "ḵ" : character === "ஂ" ? "ṁ" : character === "ௐ" ? "ōm" : character;
      // Stray signs and unfamiliar combining marks remain visible. They also
      // interrupt phonological context instead of silently changing a reading.
      output.push({ source: character, reading });
    }
  }
  return output;
}

export function romanizeTamilWord(word: string): string {
  const normalized = word.normalize("NFC");
  const plain = normalized.replace(/[\u200c\u200d]/gu, "");
  const parsed = units(normalized);
  return parsed.map((unit, index) => {
    const previous = parsed[index - 1], next = parsed[index + 1];
    if (unit.source === "ஃ" && next?.consonant === "ப") return "";
    if (!unit.consonant) return unit.reading;
    const vowel = unit.vowel!;
    if (unit.consonant === "ப" && previous?.source === "ஃ") return "f" + vowel;
    if (index === 0) {
      const initial = REVIEWED_INITIALS[plain] ?? DATASET_INITIALS[plain];
      if (initial !== undefined) return initial + vowel;
    }
    // மின்சாரம் is மின் + சாரம்; its reviewed s persists in the மின்சார-
    // noun/adjective/inflection family. This is lexical compound evidence,
    // not a general nasal+c rule or a song-title substitution.
    // https://en.wiktionary.org/wiki/மின்சாரம் (/mintʃāram/, [minsāram])
    // https://www.tamil2lyrics.com/lyrics/minsaara-poovae-pen-poovae-song-lyrics/
    // https://www.tamil2lyrics.com/lyrics/velicha-poovae-song-lyrics/
    if (index === 2 && unit.consonant === "ச" && plain.startsWith("மின்சார")) return "s" + vowel;
    const geminate = previous?.consonant === unit.consonant && previous.vowel === ""
      || vowel === "" && next?.consonant === unit.consonant;
    if (!geminate && vowel && VOICED[unit.consonant]) {
      if (previous?.vowel === "" && previous.consonant && NASALS.has(previous.consonant)) {
        if (unit.consonant !== "ச" || previous.consonant === "ஞ") return VOICED[unit.consonant] + vowel;
      }
      if (previous?.vowel) {
        return (unit.consonant === "ச" ? "s" : VOICED[unit.consonant]) + vowel;
      }
      if (unit.consonant !== "ச" && previous?.vowel === "" && previous.consonant && MEDIAL_SONORANTS.has(previous.consonant)) {
        return VOICED[unit.consonant] + vowel;
      }
      // Sonorant+c clusters retain c until their lexical c/s reading is known;
      // the independently supported ñ+c→j rule does not apply to them.
    }
    // ṟṟ and ṉṟ deliberately retain the written alveolar contrasts. Their
    // colloquial tt/nn/n/ṇ realizations vary, so a global rewrite is unreliable.
    return unit.reading;
  }).join("").normalize("NFC");
}
