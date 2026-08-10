import {
  HAN_CHARS,
  HAN_JAPANESE_KUN,
  HAN_JAPANESE_ON,
  HAN_MANDARIN,
} from "./data/hanReadings";

/**
 * Romanisation for lyric text.
 *
 * ── Why this is written rather than installed ────────────────────────────────
 *
 * The obvious options were all worse:
 *
 *   A translation API (Google, DeepL, an LLM) translates rather than
 *   transliterates. Asked for Japanese lyrics it returns English *meaning*,
 *   which is a different feature — someone reading along wants to know how to
 *   pronounce the line they're hearing, not what it means. The provider
 *   already wired into /api/lyrics advertises `romanize=true` and, when tested,
 *   returns an English translation in that field. That is the trap this
 *   comment exists to stop the next person falling into.
 *
 *   npm packages exist per script (kuroshiro, pinyin, hangul-romanization,
 *   transliteration) but each pulls its own dictionary — kuroshiro alone ships
 *   a ~20MB MeCab dictionary — and covering six scripts would mean six
 *   dependencies with six release cadences for what is, for five of the six,
 *   a table lookup.
 *
 *   Intl has no romanisation facility at all. `Intl.Segmenter` can split
 *   Japanese into words but cannot tell you how any of them are read. It is
 *   used below for exactly what it is good at, and nothing more.
 *
 * So: the rule-based scripts are implemented directly, and the one genuinely
 * lexical case — Han characters — is a generated lookup from the Unicode
 * Consortium's own Unihan database, which is the source the dictionaries cite.
 *
 * ── Where this runs ──────────────────────────────────────────────────────────
 *
 * Server-side only. The Han table is 432KB; shipping it to a phone to romanise
 * a chorus would be indefensible, and the endpoint has to exist anyway for
 * rate limiting and shared caching. Keep this module out of client imports —
 * `detectScript` in lyrics.ts is the client-side half and is pure regex.
 *
 * ── What it does not claim ───────────────────────────────────────────────────
 *
 * Accuracy differs by script and the UI says so. Cyrillic, Greek, Hangul and
 * kana are deterministic and effectively exact. Han readings are
 * context-free — 行 is "xing" or "hang" depending on the word, and without
 * morphological analysis we take the most frequent. Arabic and Hebrew are
 * written without most vowels, so a consonantal skeleton is the honest ceiling.
 * Thai is not attempted: its vowels are written before, after, above and below
 * the consonant they follow in speech, and a wrong answer that looks confident
 * is worse than saying we can't.
 */

export type TransliterationScript =
  | "japanese"
  | "korean"
  | "chinese"
  | "cyrillic"
  | "arabic"
  | "devanagari"
  | "greek"
  | "hebrew";

export interface TransliterationQuality {
  /** Deterministic mapping — effectively exact. */
  exact: boolean;
  /** Shown to the user so they know how far to trust it. */
  note?: string;
}

export const SCRIPT_QUALITY: Record<TransliterationScript, TransliterationQuality> = {
  cyrillic: { exact: true },
  greek: { exact: true },
  korean: { exact: true },
  japanese: {
    exact: false,
    note: "Kanji can be read more than one way — these are the most common readings.",
  },
  chinese: {
    exact: false,
    note: "Some characters change sound depending on the word — these are the most common readings.",
  },
  arabic: {
    exact: false,
    note: "Arabic is written without most vowels, so these are approximate.",
  },
  hebrew: {
    exact: false,
    note: "Hebrew is written without most vowels, so these are approximate.",
  },
  devanagari: { exact: true },
};

/* ── Han ──────────────────────────────────────────────────────────────────── */

/**
 * Strip pinyin tone marks: nǐ hǎo → ni hao.
 *
 * Unihan gives readings with diacritics. They're dropped because this is a
 * *reading aid for singing along* — someone following a lyric wants to know
 * which syllable to make, and tone marks on unfamiliar letters slow that down
 * more than they help. Anyone who reads tones can read the original line, which
 * is displayed directly above.
 *
 * NFD splits a marked vowel into base + combining mark, so removing the
 * combining range leaves the bare letter. ü is preserved as "v"'s more
 * recognisable form rather than being flattened to "u", which would merge
 * distinct syllables (lü/lu).
 */
function stripToneMarks(reading: string): string {
  return (
    reading
      .normalize("NFD")
      // Combining grave, acute, macron, caron and diaeresis — the five marks
      // pinyin uses. Matched by codepoint rather than pasted literally so the
      // class survives an editor that normalises the file.
      .replace(/[̀́̄̌̈]/g, "")
      .normalize("NFC")
  );
}

let hanMandarin: Map<string, string> | null = null;
let hanJapaneseOn: Map<string, string> | null = null;
let hanJapaneseKun: Map<string, string> | null = null;

/**
 * Build the lookup on first use, not at import.
 *
 * The generated module is four strings; turning them into 20k-entry Maps costs
 * real time, and most requests to this server never transliterate anything.
 * Paying it lazily means a deploy's first Chinese lyric is slightly slower and
 * every other request is unaffected.
 */
function buildHanMap(readings: string): Map<string, string> {
  const map = new Map<string, string>();
  const values = readings.split("");
  for (let i = 0; i < HAN_CHARS.length && i < values.length; i++) {
    if (values[i]) map.set(HAN_CHARS[i], values[i]);
  }
  return map;
}

/**
 * Reading for one Han character.
 *
 * Japanese has two readings per character and which is right depends on the
 * word. The one signal available without a morphological analyser is
 * okurigana: kana directly after the kanji mean it stands as its own word and
 * takes the kun'yomi (駆ける → "kakeru"), while kana before it are particles
 * and a compound reading (on'yomi) applies (夜に → "yoru"). Anything else
 * defaults to on'yomi, which is correct more often than not.
 */
function hanReading(
  ch: string,
  mode: "chinese" | "japanese",
  nextIsKana: boolean
): string | undefined {
  if (mode === "chinese") {
    hanMandarin ??= buildHanMap(HAN_MANDARIN);
    const reading = hanMandarin.get(ch);
    return reading ? stripToneMarks(reading) : undefined;
  }

  if (nextIsKana) {
    hanJapaneseKun ??= buildHanMap(HAN_JAPANESE_KUN);
    const kun = hanJapaneseKun.get(ch);
    if (kun) return kun;
  }

  hanJapaneseOn ??= buildHanMap(HAN_JAPANESE_ON);
  const on = hanJapaneseOn.get(ch);
  if (on) return on;

  // Unihan has no Japanese reading for some characters that still occur in
  // Japanese text. A Mandarin reading is a poor substitute but closer than
  // dropping the character and leaving a hole in the line.
  hanMandarin ??= buildHanMap(HAN_MANDARIN);
  const fallback = hanMandarin.get(ch);
  return fallback ? stripToneMarks(fallback) : undefined;
}

/* ── Cyrillic ─────────────────────────────────────────────────────────────── */

/**
 * BGN/PCGN-flavoured, which is what a reader expects to see rather than the
 * ISO 9 scheme with its diacritics — "shch" is recognisable, "ŝ" is not.
 * Ukrainian and Serbian letters are included since they cost nothing.
 */
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Ukrainian / Belarusian / Serbian
  і: "i", ї: "yi", є: "ye", ґ: "g", ў: "w", ђ: "dj", ј: "j", љ: "lj",
  њ: "nj", ћ: "c", џ: "dz",
};

/* ── Greek ────────────────────────────────────────────────────────────────── */

const GREEK_DIGRAPHS: Record<string, string> = {
  ου: "ou", αι: "ai", ει: "ei", οι: "oi", υι: "yi", αυ: "av", ευ: "ev",
  ηυ: "iv", γγ: "ng", γκ: "gk", γξ: "nx", γχ: "nch", μπ: "b", ντ: "d",
  τσ: "ts", τζ: "tz",
};

const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
  κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
  ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
  // Accented forms, which are extremely common and would otherwise pass through.
  ά: "a", έ: "e", ή: "i", ί: "i", ό: "o", ύ: "y", ώ: "o", ϊ: "i", ϋ: "y",
  ΐ: "i", ΰ: "y",
};

/* ── Hangul ───────────────────────────────────────────────────────────────── */

/**
 * Revised Romanization. Hangul syllables are composed arithmetically from
 * initial/medial/final jamo, so this needs no dictionary at all — the
 * codepoint *is* the decomposition.
 */
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JAMO_MEDIAL_COUNT = 21;
const JAMO_FINAL_COUNT = 28;

const HANGUL_INITIAL = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj",
  "ch", "k", "t", "p", "h",
];
const HANGUL_MEDIAL = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe",
  "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];
/*
 * Jongseong (final consonant), indexed 0–27 where 0 is "no final".
 *
 * The order is fixed by Unicode and must be exactly 28 entries: one short and
 * every value from that point on is attributed to the wrong consonant. An
 * earlier version of this table had 27, which shifted ㅇ onto ㅆ's slot and
 * romanised 사랑 as "sarat" — the single most common final in the language,
 * silently wrong in every song.
 *
 * ㄱㄲㄳ ㄴㄵㄶ ㄷ ㄹㄺㄻㄼㄽㄾㄿㅀ ㅁ ㅂㅄ ㅅㅆ ㅇ ㅈㅊ ㅋㅌㅍㅎ
 */
const HANGUL_FINAL = [
  "",   "k",  "k",  "k",  "n",  "n",  "n",
  "t",  "l",  "k",  "m",  "l",  "l",  "l",
  "p",  "l",  "m",  "p",  "p",  "t",  "t",
  "ng", "t",  "t",  "k",  "t",  "p",  "t",
];

/**
 * Finals that revoice when the next syllable starts with ㅇ (a null onset).
 *
 * Revised Romanization resyllabifies across the boundary: 한국어 is *hangugeo*,
 * not *hangukeo*, because the ㄱ slides into the empty onset and voices there.
 * Without this the output is understandable but visibly not how the word is
 * written anywhere a reader would have seen it before.
 */
const FINAL_LIAISON: Record<string, string> = {
  k: "g",
  t: "d",
  p: "b",
  l: "r",
};

interface HangulParts {
  initial: number;
  medial: number;
  final: number;
}

/** Decompose a precomposed syllable, or null if it isn't one. */
function decomposeHangul(ch: string): HangulParts | null {
  const code = ch.codePointAt(0)!;
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;

  const index = code - HANGUL_BASE;
  return {
    initial: Math.floor(index / (JAMO_MEDIAL_COUNT * JAMO_FINAL_COUNT)),
    medial: Math.floor((index % (JAMO_MEDIAL_COUNT * JAMO_FINAL_COUNT)) / JAMO_FINAL_COUNT),
    final: index % JAMO_FINAL_COUNT,
  };
}

/** Index of ㅇ as an initial — the null onset that triggers liaison. */
const INITIAL_IEUNG = 11;

/**
 * Romanise a run of Hangul, applying liaison across syllable boundaries.
 *
 * Done over the whole string rather than per character because Revised
 * Romanization is not context-free: a final consonant changes when the next
 * syllable begins with ㅇ, so a per-syllable map cannot get 한국어 right.
 */
function romanizeHangul(text: string): string {
  const chars = [...text];
  let out = "";

  for (let i = 0; i < chars.length; i++) {
    const parts = decomposeHangul(chars[i]);
    if (!parts) {
      out += chars[i];
      continue;
    }

    let final = HANGUL_FINAL[parts.final];

    // Liaison: the final slides into a following null onset and voices there.
    if (final && FINAL_LIAISON[final]) {
      const next = decomposeHangul(chars[i + 1] ?? "");
      if (next && next.initial === INITIAL_IEUNG) {
        final = FINAL_LIAISON[final];
      }
    }

    out += HANGUL_INITIAL[parts.initial] + HANGUL_MEDIAL[parts.medial] + final;
  }

  return out;
}

/* ── Kana ─────────────────────────────────────────────────────────────────── */

/** Hepburn — the romanisation a non-Japanese reader can actually pronounce. */
const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa", ゔ: "vu",
};

/** Digraphs (yōon): きゃ is "kya", not "kiya". Checked before single kana. */
const KANA_DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
   うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};

/** Katakana and hiragana share a layout 0x60 apart, so one table serves both. */
function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/* ── Arabic ───────────────────────────────────────────────────────────────── */

const ARABIC: Record<string, string> = {
  ا: "a", أ: "a", إ: "i", آ: "aa", ء: "'", ؤ: "u", ئ: "i",
  ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "dh",
  ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z",
  ع: "'", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n",
  ه: "h", و: "w", ي: "y", ى: "a", ة: "h", ﻻ: "la",
  // Short vowels, when the text is voweled (rare, but lyrics sometimes are).
  "َ": "a", "ُ": "u", "ِ": "i", "ً": "an",
  "ٌ": "un", "ٍ": "in", "ْ": "",
  // Persian/Urdu letters that appear in lyrics from those languages.
  پ: "p", چ: "ch", ژ: "zh", گ: "g", ک: "k", ی: "y",
};

/** Shadda doubles the preceding consonant. */
const ARABIC_SHADDA = "ّ";

/* ── Hebrew ───────────────────────────────────────────────────────────────── */

const HEBREW: Record<string, string> = {
  א: "", ב: "v", ג: "g", ד: "d", ה: "h", ו: "v", ז: "z", ח: "ch",
  ט: "t", י: "y", כ: "kh", ך: "kh", ל: "l", מ: "m", ם: "m", נ: "n",
  ן: "n", ס: "s", ע: "", פ: "f", ף: "f", צ: "ts", ץ: "ts", ק: "k",
  ר: "r", ש: "sh", ת: "t",
  // Niqqud, for the rare voweled text.
  "ְ": "e", "ֱ": "e", "ֲ": "a", "ֳ": "o", "ִ": "i",
  "ֵ": "e", "ֶ": "e", "ַ": "a", "ָ": "a", "ֹ": "o",
  "ֻ": "u", "ּ": "", "ׁ": "", "ׂ": "",
};

/* ── Devanagari ───────────────────────────────────────────────────────────── */

/**
 * An abugida: a consonant carries an inherent "a" unless a vowel sign replaces
 * it or a virama removes it. That structure is what the loop below implements,
 * and it's why this can't be a flat character table like Cyrillic.
 */
const DEVA_CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  क़: "q", ख़: "kh", ग़: "gh", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f",
};

const DEVA_VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au",
};

/** Matras — vowel signs that replace the inherent "a". */
const DEVA_MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u",
  "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai",
  "ो": "o", "ौ": "au",
};

const DEVA_VIRAMA = "्";
const DEVA_MARKS: Record<string, string> = {
  "ं": "n", "ँ": "n", "ः": "h",
};

/* ── The transliterator ───────────────────────────────────────────────────── */

/** Longest key first, so `щ` beats `ш` and `きゃ` beats `き`. */
function replaceWithTable(text: string, table: Record<string, string>): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    // Two-character keys are the longest any table here uses.
    const pair = text.slice(i, i + 2);
    if (table[pair] !== undefined) {
      out += table[pair];
      i += 2;
      continue;
    }
    const ch = text[i];
    const mapped = table[ch] ?? table[ch.toLowerCase()];
    if (mapped !== undefined) {
      // Preserve the original capitalisation, which carries sentence structure
      // the reader is relying on to follow along.
      out += ch !== ch.toLowerCase() ? capitalise(mapped) : mapped;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function romanizeKana(text: string): string {
  const hira = katakanaToHiragana(text);
  let out = "";
  let i = 0;

  while (i < hira.length) {
    const ch = hira[i];

    // Sokuon (っ) doubles the next consonant: きって → "kitte".
    if (ch === "っ") {
      const nextPair = KANA_DIGRAPHS[hira.slice(i + 1, i + 3)];
      const next = nextPair ?? KANA[hira[i + 1]];
      if (next) out += next[0];
      i += 1;
      continue;
    }

    // Chōonpu (ー) lengthens the preceding vowel.
    if (ch === "ー") {
      const last = out[out.length - 1];
      if (last && "aiueo".includes(last)) out += last;
      i += 1;
      continue;
    }

    const digraph = KANA_DIGRAPHS[hira.slice(i, i + 2)];
    if (digraph) {
      out += digraph;
      i += 2;
      continue;
    }

    const single = KANA[ch];
    if (single !== undefined) {
      out += single;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function romanizeHan(text: string, mode: "chinese" | "japanese"): string {
  let out = "";
  // Iterating by code point rather than by index: some Han characters are
  // outside the BMP and a per-index loop splits them into broken surrogates.
  for (const ch of text) {
    // Chinese has one reading per character, so the okurigana signal is moot.
    const reading = hanReading(ch, mode, false);
    if (reading) {
      // A space between readings — pinyin syllables are otherwise unreadable
      // run together, and this is the convention every pinyin renderer uses.
      out += (out && !out.endsWith(" ") ? " " : "") + reading;
    } else {
      out += ch;
    }
  }
  return out;
}

/** True for hiragana, katakana and the chōonpu. */
function isKanaChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0)!;
  return (code >= 0x3040 && code <= 0x30ff) || ch === "ー";
}

/** Hiragana only — okurigana is never katakana. */
function isHiragana(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0)!;
  return code >= 0x3040 && code <= 0x309f;
}

function romanizeJapanese(text: string): string {
  let out = "";
  let buffer = "";

  const flushKana = () => {
    if (buffer) {
      out += romanizeKana(buffer);
      buffer = "";
    }
  };

  // Indexed so each kanji can look ahead for okurigana.
  const chars = [...text];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const code = ch.codePointAt(0)!;
    const isHan = code >= 0x4e00 && code <= 0x9fff;

    if (isKanaChar(ch)) {
      buffer += ch;
      continue;
    }

    flushKana();

    if (isHan) {
      /*
       * Hiragana immediately after a kanji is okurigana — the inflecting tail
       * of a native word — which means the kun'yomi applies. Katakana doesn't
       * count: it marks a separate loanword rather than inflecting what
       * precedes it.
       */
      const next = chars[i + 1];
      const nextCode = next?.codePointAt(0) ?? 0;
      const nextIsOkurigana = nextCode >= 0x3040 && nextCode <= 0x309f;

      const reading = hanReading(ch, "japanese", nextIsOkurigana);

      /*
       * Unihan's kun'yomi are dictionary forms with the okurigana included and
       * no stem marker: 駆 is "KAKERU", of which only "ka" is the kanji and
       * "keru" is the kana that follow it in the text. Those kana are about to
       * be romanised from the text itself, so emitting the whole reading gives
       * "kakerukeru".
       *
       * The fix is to romanise the okurigana first and drop that suffix from
       * the reading when it matches. Where it doesn't match — a different
       * inflection from the one Unihan lists — the full reading is kept, since
       * a slightly long romanisation is better than a truncated guess.
       */
      let text = reading;
      if (reading && nextIsOkurigana) {
        let tail = "";
        for (let j = i + 1; j < chars.length && isHiragana(chars[j]); j++) {
          tail += chars[j];
        }
        const romanTail = romanizeKana(tail);
        if (romanTail && reading.endsWith(romanTail)) {
          text = reading.slice(0, -romanTail.length);
        }
      }

      // Space-separate readings so kanji compounds don't run into the kana
      // around them as one unreadable string.
      out += (out && !/\s$/.test(out) ? " " : "") + (text ?? ch);
      if (text && !nextIsOkurigana) out += " ";
    } else {
      out += ch;
    }
  }

  flushKana();
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

function romanizeArabic(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ARABIC_SHADDA) {
      // Double whatever consonant we just emitted.
      const last = out[out.length - 1];
      if (last) out += last;
      continue;
    }
    const mapped = ARABIC[ch];
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

function romanizeDevanagari(text: string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    // Two-character consonants (nukta forms like क़) come first.
    const pair = text.slice(i, i + 2);
    const consonant = DEVA_CONSONANTS[pair] ? pair : text[i];
    const base = DEVA_CONSONANTS[consonant];

    if (base !== undefined) {
      i += consonant.length;
      const next = text[i];

      if (next === DEVA_VIRAMA) {
        // Virama: no vowel at all, the consonants cluster.
        out += base;
        i += 1;
      } else if (next !== undefined && DEVA_MATRAS[next] !== undefined) {
        out += base + DEVA_MATRAS[next];
        i += 1;
      } else {
        // Nothing following: the inherent vowel surfaces.
        out += base + "a";
      }
      continue;
    }

    const ch = text[i];
    const vowel = DEVA_VOWELS[ch] ?? DEVA_MARKS[ch];
    out += vowel !== undefined ? vowel : ch;
    i += 1;
  }

  return out;
}

/** Romanise one line. Returns the input unchanged for unsupported scripts. */
export function transliterateLine(text: string, script: TransliterationScript): string {
  if (!text.trim()) return text;

  switch (script) {
    case "cyrillic":
      return replaceWithTable(text, CYRILLIC);
    case "greek": {
      // Digraphs first — ου is "ou", not "oy".
      const withDigraphs = replaceWithTable(text.toLowerCase(), GREEK_DIGRAPHS);
      return replaceWithTable(withDigraphs, GREEK);
    }
    case "korean":
      return romanizeHangul(text);
    case "japanese":
      return romanizeJapanese(text);
    case "chinese":
      return romanizeHan(text, "chinese");
    case "arabic":
      return romanizeArabic(text);
    case "hebrew":
      return replaceWithTable(text, HEBREW);
    case "devanagari":
      return romanizeDevanagari(text);
    default:
      return text;
  }
}

/**
 * Romanise a set of lines.
 *
 * Lines already carrying a transliteration keep it — a provider's own
 * romanisation is human-checked and better than anything generated here.
 */
export function transliterateLines(
  lines: { text: string; transliterated?: string }[],
  script: TransliterationScript
): string[] {
  return lines.map((line) =>
    line.transliterated?.trim() ? line.transliterated : transliterateLine(line.text, script)
  );
}
