/**
 * Transliteration accuracy check.
 *
 * Not a unit-test suite — the project has no test runner — but a script that
 * romanises known strings and prints them against the expected reading, so the
 * output can be eyeballed and regressions are obvious.
 *
 * Run: npx tsx scripts/check-transliteration.ts
 *   (or: node --experimental-strip-types scripts/check-transliteration.ts)
 */

import { transliterateLine, type TransliterationScript } from "../src/lib/transliterate";
import { detectScript } from "../src/lib/lyrics";

interface Case {
  script: TransliterationScript;
  input: string;
  /** What a speaker would expect. Compared loosely — see `matches`. */
  expect: string;
  note?: string;
}

const CASES: Case[] = [
  /* ── Japanese: kana are exact, kanji are best-effort ──────────────────── */
  { script: "japanese", input: "こんにちは", expect: "konnichiha" },
  { script: "japanese", input: "ありがとう", expect: "arigatou" },
  // Sokuon: っ doubles the following consonant.
  { script: "japanese", input: "きって", expect: "kitte", note: "sokuon" },
  { script: "japanese", input: "がっこう", expect: "gakkou", note: "sokuon" },
  // Yōon digraphs.
  { script: "japanese", input: "きゃきゅきょ", expect: "kyakyukyo", note: "yōon" },
  { script: "japanese", input: "しゃしゅしょ", expect: "shashusho", note: "yōon" },
  { script: "japanese", input: "じゃじゅじょ", expect: "jajujo", note: "yōon" },
  // Katakana + chōonpu lengthening.
  { script: "japanese", input: "ラーメン", expect: "raamen", note: "chōonpu" },
  { script: "japanese", input: "コーヒー", expect: "koohii", note: "chōonpu" },
  { script: "japanese", input: "アイドル", expect: "aidoru", note: "katakana" },
  // Mixed script — the common case in J-pop.
  { script: "japanese", input: "夜に駆ける", expect: "yo ni kakeru", note: "kun'yomi via okurigana" },
  { script: "japanese", input: "東京", expect: "toukyou", note: "on'yomi compound" },
  { script: "japanese", input: "愛してる", expect: "ai shiteru", note: "on + te-form" },
  { script: "japanese", input: "好きだよ", expect: "suki da yo", note: "kun'yomi 好" },

  /* ── Korean: Revised Romanization, fully algorithmic ──────────────────── */
  { script: "korean", input: "안녕하세요", expect: "annyeonghaseyo" },
  { script: "korean", input: "한국어", expect: "hangugeo" },
  { script: "korean", input: "사랑", expect: "sarang" },
  { script: "korean", input: "김치", expect: "gimchi" },
  { script: "korean", input: "서울", expect: "seoul" },
  { script: "korean", input: "방탄소년단", expect: "bangtansonyeondan" },

  /* ── Chinese: Unihan kMandarin, context-free ──────────────────────────── */
  { script: "chinese", input: "你好", expect: "ni hao" },
  { script: "chinese", input: "北京", expect: "bei jing" },
  { script: "chinese", input: "我爱你", expect: "wo ai ni" },
  { script: "chinese", input: "音乐", expect: "yin yue" },

  /* ── Cyrillic: BGN/PCGN, deterministic ────────────────────────────────── */
  { script: "cyrillic", input: "привет", expect: "privet" },
  { script: "cyrillic", input: "Москва", expect: "Moskva" },
  { script: "cyrillic", input: "спасибо", expect: "spasibo" },
  { script: "cyrillic", input: "щука", expect: "shchuka", note: "щ digraph" },
  { script: "cyrillic", input: "ёлка", expect: "yolka" },
  { script: "cyrillic", input: "Я люблю", expect: "Ya lyublyu", note: "capitalisation" },

  /* ── Greek ────────────────────────────────────────────────────────────── */
  { script: "greek", input: "καλημέρα", expect: "kalimera" },
  { script: "greek", input: "ευχαριστώ", expect: "evcharisto", note: "ευ digraph" },
  { script: "greek", input: "μουσική", expect: "mousiki", note: "ου digraph" },

  /* ── Devanagari: abugida, inherent vowel + matras ─────────────────────── */
  { script: "devanagari", input: "नमस्ते", expect: "namaste", note: "virama" },
  { script: "devanagari", input: "प्यार", expect: "pyaara", note: "virama cluster" },
  { script: "devanagari", input: "दिल", expect: "dila", note: "matra" },
  { script: "devanagari", input: "गाना", expect: "gaanaa", note: "aa matra" },

  /* ── Arabic / Hebrew: consonantal, approximate by nature ──────────────── */
  { script: "arabic", input: "مرحبا", expect: "mrhba", note: "unvowelled" },
  { script: "arabic", input: "حبيبي", expect: "hbyby", note: "unvowelled" },
  { script: "hebrew", input: "שלום", expect: "shlvm", note: "unvowelled" },
];

/** Loose comparison: strip spaces and case, since spacing is a style choice. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s'’-]/g, "");
}

function matches(actual: string, expected: string): boolean {
  return normalise(actual) === normalise(expected);
}

let pass = 0;
let differ = 0;

const byScript = new Map<string, Case[]>();
for (const c of CASES) {
  const list = byScript.get(c.script) ?? [];
  list.push(c);
  byScript.set(c.script, list);
}

console.log("\nTRANSLITERATION CHECK\n" + "=".repeat(72));

for (const [script, cases] of byScript) {
  console.log(`\n${script.toUpperCase()}`);
  for (const c of cases) {
    const actual = transliterateLine(c.input, c.script);
    const ok = matches(actual, c.expect);
    if (ok) pass++;
    else differ++;

    const mark = ok ? "ok  " : "DIFF";
    const note = c.note ? `  (${c.note})` : "";
    console.log(`  ${mark}  ${c.input}`);
    console.log(`        got:  ${actual}`);
    if (!ok) console.log(`        want: ${c.expect}${note}`);
  }
}

/* ── Script detection: the gate that decides whether we offer at all ────── */

console.log("\n" + "=".repeat(72));
console.log("\nSCRIPT DETECTION\n");

const DETECT: { input: string; expect: string; note?: string }[] = [
  { input: "Hello darkness my old friend", expect: "latin" },
  { input: "夜に駆ける", expect: "japanese", note: "kana wins over Han" },
  { input: "안녕하세요 사랑", expect: "korean" },
  { input: "我爱你中国", expect: "chinese", note: "Han with no kana" },
  { input: "Привет мир", expect: "cyrillic" },
  { input: "مرحبا بالعالم", expect: "arabic" },
  { input: "नमस्ते दुनिया", expect: "devanagari" },
  { input: "καλημέρα κόσμε", expect: "greek" },
  // The threshold cases — these decide whether the control appears.
  { input: "Tokyo 東京 nights", expect: "latin", note: "incidental CJK, must NOT offer" },
  { input: "サマータイム Summertime", expect: "japanese", note: "loanwords, must offer" },
];

for (const d of DETECT) {
  const info = detectScript(d.input);
  const ok = info.script === d.expect;
  if (ok) pass++;
  else differ++;
  console.log(
    `  ${ok ? "ok  " : "DIFF"}  ${JSON.stringify(d.input)}\n` +
      `        got: ${info.script} (ratio ${info.ratio.toFixed(2)}, offer=${info.worthTransliterating})` +
      (ok ? "" : `\n        want: ${d.expect}${d.note ? `  (${d.note})` : ""}`)
  );
}

console.log("\n" + "=".repeat(72));
console.log(`\n${pass} matched, ${differ} differed\n`);
