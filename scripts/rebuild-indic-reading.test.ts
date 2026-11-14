import assert from "node:assert/strict";
import test from "node:test";
import { lyricReadingLanguage, normalizeLyricLanguageHint, READING_LANGUAGES, readingEngine, READING_VERSION } from "../src/rebuild/lyrics/language";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";
import { romanizeScriptSpan } from "../src/rebuild/lyrics/scriptReading";
import { createReadingTransformCache } from "../src/rebuild/lyrics/readingTransforms";
import { japaneseReadingCacheKey } from "../src/rebuild/lyrics/readingIdentity";
import { LyricRequestError, parseReadingRequest } from "../src/rebuild/lyrics/request";
import { upgradeCachedLyricReadings } from "../src/rebuild/player/readingCacheUpgrade";
import { READING_SONG_EXCERPTS } from "./fixtures/reading-song-excerpts";
import type { PlayerLyrics } from "../src/rebuild/player/useLyrics";

const added = ["te", "kn", "ml", "or", "sr", "ka", "ta"] as const;
const cacheKey = (hint?: string) => JSON.stringify(["verified-lyrics-v3", "song", ["artist"], "album", 180, "Original recording", hint, null]);
const saved = (text: string): PlayerLyrics => ({ schemaVersion: "verified-lyrics-v3", lines: [{ text, start: 12, end: 16, words: [{ text, start: 12.2, end: 15.8 }] }], timing: "synced", provider: "verified fixture", providerTrackId: 451, hasJapanese: false });

test("every added language has two actual songs with independently checked native and reading sources", () => {
  for (const language of added) {
    assert.ok(READING_LANGUAGES.includes(language));
    const songs = READING_SONG_EXCERPTS.filter(song => song.language === language);
    assert.ok(songs.length >= 2, language);
    assert.equal(new Set(songs.map(song => song.title)).size, songs.length);
    for (const song of songs) {
      assert.ok(song.references?.native.length && song.references.reading.length, song.id);
      assert.ok(song.references.sourceReading && song.references.convention, song.id);
      assert.equal(song.mode, "script", "vowel length and consonant distinctions must use exact readings, not lossy letter normalization");
    }
  }
});

test("native scripts and reliable ISO/name/BCP 47 hints resolve languages without inventing shared-script certainty", () => {
  for (const [hint, expected] of [[" hin-Deva-IN ", "hi"], ["Tamil", "ta"], ["Telugu", "te"], ["mal-Mlym-IN", "ml"], ["kan", "kn"], ["Odia", "or"], ["ori", "or"], ["ory", "or"], ["Serbian", "sr"], ["srp-Cyrl-RS", "sr"], ["geo", "ka"]]) assert.equal(normalizeLyricLanguageHint(hint), expected);
  assert.equal(lyricReadingLanguage("कविता", "Hindi"), "hi");
  assert.equal(lyricReadingLanguage("कविता"), null, "shared Devanagari without distinguishing evidence stays ambiguous");
  assert.equal(lyricReadingLanguage("हम तेरे बिन अब रह नहीं सकते"), "hi");
  for (const text of ["तुझे नाव", "मेरा मन"]) assert.equal(lyricReadingLanguage(text), null, "shared possessives cannot establish Hindi");
  assert.equal(lyricReadingLanguage("मेरा मन", "Hindi"), "hi");
  for (const hint of ["mr", "mar", "Marathi", "ne-NP", "nep", "Nepali", "san", "Sanskrit"]) assert.equal(lyricReadingLanguage("हम मन माया", hint), null, hint);
  assert.equal(lyricReadingLanguage("Тамо далеко"), null);
  assert.equal(lyricReadingLanguage("Љубав Његош Џез ја"), null, "these letters also occur in Macedonian");
  assert.equal(lyricReadingLanguage("Тамо далеко", "srp-Cyrl-RS"), "sr");
  assert.equal(lyricReadingLanguage("Моя мама"), null, "a shared Russian/Ukrainian phrase requires evidence");
  assert.equal(lyricReadingLanguage("Моя мама", "Russian"), "ru");
  assert.equal(lyricReadingLanguage("Моя мама", "Ukrainian"), "uk");
  assert.equal(lyricReadingLanguage("Моћном руком"), "sr");
  assert.equal(lyricReadingLanguage("Обійми мене", "ru"), "uk");
  assert.equal(lyricReadingLanguage("Љубав", "mk"), null);
  assert.equal(lyricReadingLanguage("Ѓорѓи"), null);
  assert.equal(lyricReadingLanguage("Мила Родино", "Bulgarian"), null);
  for (const hint of ["mon", "Mongolian", "kaz", "Kazakh", "kir", "Kyrgyz", "tgk", "Tajik", "bos", "Bosnian", "Montenegrin", "tat", "Tatar", "bak", "Bashkir", "chv", "Chuvash"]) assert.equal(lyricReadingLanguage("Привет", hint), null, hint);
  for (const hint of ["Konkani", "Maithili", "Bhojpuri", "Dogri", "Awadhi", "Bodo", "Newari"]) assert.equal(lyricReadingLanguage("हमारे मन", hint), null, hint);
  assert.equal(lyricReadingLanguage("معاك", "Persian"), null);
  assert.equal(lyricReadingLanguage("پیار", "Urdu"), null);
  for (const hint of ["pus", "Pashto", "snd", "Sindhi", "uig", "Uyghur", "kur", "Kurdish", "Sorani", "kas", "Kashmiri", "Balochi"]) assert.equal(lyricReadingLanguage("معاك", hint), null, hint);
  assert.equal(lyricReadingLanguage("世界", "Cantonese"), null);
  for (const hint of ["xmf", "Mingrelian", "sva", "Svan", "lzz", "Laz"]) assert.equal(lyricReadingLanguage("ქართული", hint), null, hint);
  assert.equal(lyricReadingLanguage("అమ్మ", "Tamil"), "te", "unequivocal native script wins over unrelated stale metadata");
  assert.equal(lyricReadingLanguage("ವಿಜಯ ಕನ್ನಡ ಪದಗಳು", "Hindi"), "kn");
  for (const [language, hints] of [["te", ["Sanskrit", "Gondi", "Koya"]], ["kn", ["Sanskrit", "Konkani", "Tulu"]], ["ml", ["Sanskrit"]], ["or", ["Sanskrit", "Santali"]]] as const) {
    const song = READING_SONG_EXCERPTS.find(song => song.language === language)!;
    for (const hint of hints) assert.equal(lyricReadingLanguage(song.text, hint), null, `${language}/${hint}: the script is shared`);
  }
  for (const text of ["বাংলা গান", "ਪੰਜਾਬੀ ਗੀਤ", "ગુજરાતી ગીત", "เพลงไทย", "עברית", "հայերեն"]) assert.equal(lyricReadingLanguage(text), null, text);
  assert.equal(lyricReadingLanguage("தமிழ் பாடல் வரிகள் தமிழ் பாடல் வரிகள் हम", "ta"), "ta", "Tamil primary lyrics outweigh a short Hindi refrain");
  assert.equal(lyricReadingLanguage("Hello Latin lyrics", "te"), null);
});

test("Telugu and Kannada keep inherent vowels, vowel length, conjuncts, gemination and homorganic nasals", () => {
  assert.equal(romanizeScriptSpan("అ ఆ ఇ ఈ ఉ ఊ ఎ ఏ ఐ ఒ ఓ ఔ", "te").romanized, "a ā i ī u ū e ē ai o ō au");
  assert.equal(romanizeScriptSpan("ಕಮಲ ಅಕ್ಕ ಮತ್ತೆ ಎ ಏ ಒ ಓ", "kn").romanized, "kamala akka matte e ē o ō");
  assert.equal(romanizeScriptSpan("మనసు కమలము అమ్మ అక్క క్ క్ర క్‍ర", "te").romanized, "manasu kamalamu amma akka k kra kra");
  assert.equal(romanizeScriptSpan("అంకం అంచు కంఠం అందం అంబరం", "te").romanized, "aṅkam añcu kaṇṭham andam ambaram");
  assert.equal(romanizeScriptSpan("ಅಂಕ ಅಂಚು ಕಂಠ ಅಂದ ಅಂಬರ", "kn").romanized, "aṅka añcu kaṇṭha anda ambara");
});

test("Malayalam atomic and legacy chillus stay pure consonants, while explicitly written half-u survives", () => {
  assert.equal(romanizeScriptSpan("അവൻ അവന്‍ മാൽ മാല്‍", "ml").romanized, "avan avan māl māl");
  assert.equal(romanizeScriptSpan("ൺ ൻ ർ ൽ ൾ ൿ ൔ ൕ ൖ", "ml").romanized, "ṇ n r l ḷ k m y ḻ");
  assert.equal(romanizeScriptSpan("അവനു് നു്", "ml").romanized, "avanŭ nŭ");
  assert.equal(romanizeScriptSpan("അവന് സൂററ്റ്", "ml").romanized, "avan sūṟaṯṯ", "bare terminal virama does not justify a guessed vowel");
});

test("Malayalam AU compatibility and explicit alveolar stacking do not rewrite ambiguous old digraphs", () => {
  assert.equal(romanizeScriptSpan("കൗ കൌ കൌ ഔ", "ml").romanized, "kau kau kau au");
  assert.equal(romanizeScriptSpan("പാറ്റ എന്റെ എൻ്റേ", "ml").romanized, "pāṯṯa eṉṯe eṉṯē");
  assert.equal(romanizeScriptSpan("റ്റ റ‍്റ റ‌്റ", "ml").romanized, "ṯṯa ṯṯa ṯṯa", "joiners before virama change the ligature style, not its consonants");
  assert.equal(romanizeScriptSpan("ന്റ ന‍്റ ന‌്റ ൻ‍്റ ൻ‌്റ", "ml").romanized, "ṉṯa ṉṯa ṉṯa ṉṯa ṉṯa");
  assert.equal(romanizeScriptSpan("എൻറോൾ എന്‍റേ ററ", "ml").romanized, "enṟōḷ enṟē ṟaṟa", "plain/legacy n+r is ambiguous, unlike explicit stacked forms");
});

test("Odia keeps its medial and final inherent vowels and canonical nukta equivalents", () => {
  assert.equal(romanizeScriptSpan("ଜନନୀ ବନକୁ କର ଦଳନ", "or").romanized, "jananī banaku kara daḷana");
  assert.equal(romanizeScriptSpan("ଅ ଆ ଏ ଓ", "or").romanized, "a ā ē ō");
  assert.equal(romanizeScriptSpan("ଡ଼ ଡ଼ ଢ଼ ଢ଼", "or").romanized, "ṛa ṛa ṛha ṛha");
});

test("Serbian Latin preserves distinct consonants, digraph case and original punctuation", () => {
  assert.equal(romanizeScriptSpan("Љубав Његош Џез Ђорђе Ћирилица Чаролија", "sr").romanized, "Ljubav Njegoš Džez Đorđe Ćirilica Čarolija");
  assert.equal(romanizeScriptSpan("ЉУБАВ ЊЕГОШ ЏЕЗ", "sr").romanized, "LJUBAV NJEGOŠ DŽEZ");
  assert.equal(romanizeScriptSpan("Hello, Србија — Ѯ! 🌸", "sr").romanized, "Hello, Srbija — Ѯ! 🌸");
});

test("Georgian national romanization retains ejective contrasts and Mtavruli case", () => {
  assert.equal(romanizeScriptSpan("კ ქ პ ფ ტ თ ყ წ ც ჭ ჩ", "ka").romanized, "k' k p' p t' t q' ts' ts ch' ch");
  assert.equal(romanizeScriptSpan("Ნეტავ", "ka").romanized, "Net'av");
  assert.equal(romanizeScriptSpan("ᲥᲐᲠᲗᲣᲚᲘ", "ka").romanized, "KARTULI");
  assert.equal(romanizeScriptSpan("Ⴀ", "ka").romanized, "Ⴀ", "unsupported historical letters stay visible");
});

test("mixed language lines keep punctuation, Latin spelling, timing and readable script boundaries", async () => {
  const original = { text: "Helloఇంకేంಅಮ್ಮമലരേକର! — हूँHello, 🌸", start: 1, end: 5, words: [{ text: "Hello", start: 1, end: 2 }] };
  const [line] = await romanizeLyricLines([original], "hi");
  assert.equal(line.romanized, "Hello iṅkēm amma malarē kara! — hū̃ Hello, 🌸");
  assert.deepEqual({ text: line.text, start: line.start, end: line.end, words: line.words }, original);
  const [scriptControls] = await romanizeLyricLines([{ text: "అమ్మ##అక్క\\అమ్మ <b>అమ్మ</b>" }], "te");
  assert.equal(scriptControls.romanized, "amma##akka\\amma <b>amma</b>", "lyric punctuation is not Sanscript control syntax");
});

test("reliable original-language hints survive mixed scripts and distinguish cached transforms", async () => {
  const original = [{ text: "అమ్మ मन माया", start: 2, end: 4 }];
  let transforms = 0;
  const cache = createReadingTransformCache({ transform: async (lines, language, signal, hint) => { transforms++; return romanizeLyricLines(lines, language, signal, hint); } });
  assert.equal((await cache(original, "te", { languageHint: "Marathi" }))[0].romanized, "amma मन माया");
  assert.equal((await cache(original, "te", { languageHint: "Hindi" }))[0].romanized, "amma man māyā");
  const retimed = [{ ...original[0], start: 9, end: 12 }];
  const [reused] = await cache(retimed, "te", { languageHint: "hin-IN" });
  assert.equal(reused.start, 9); assert.equal(reused.end, 12); assert.equal(transforms, 2, "equivalent normalized hints reuse pronunciation without borrowing timing");
  assert.equal((await romanizeLyricLines([{ text: "అమ్మ Привет" }], "te", undefined, "bg"))[0].romanized, "amma Привет");
  assert.equal((await romanizeLyricLines([{ text: "అమ్మ معاك" }], "te", undefined, "fa"))[0].romanized, "amma معاك");
  assert.equal((await romanizeLyricLines([{ text: "అమ్మ ქართული" }], "te", undefined, "Laz"))[0].romanized, "amma ქართული");
  assert.equal((await romanizeLyricLines([{ text: "విజయ ಅಮ್ಮ" }], "te", undefined, "Konkani"))[0].romanized, "vijaya ಅಮ್ಮ");
  assert.equal((await romanizeLyricLines([{ text: "చందనం" }], "te", undefined, "Sanskrit"))[0].romanized, "చందనం");
});

test("reading request validation accepts every added language and bounds optional hint evidence", () => {
  for (const language of added) assert.equal(parseReadingRequest({ language, lines: ["native fixture"] }).language, language);
  assert.equal(parseReadingRequest({ language: "te", languageHint: "Marathi", lines: ["అమ్మ मन"] }).languageHint, "mr");
  for (const language of ["bn", "pa", "gu", "mr", "ne", "bg", "mk", "hy", "th", "he", "fa"]) assert.throws(() => parseReadingRequest({ language, lines: ["fixture"] }), LyricRequestError);
  for (const languageHint of [42, {}, "a".repeat(49)]) assert.throws(() => parseReadingRequest({ language: "te", languageHint, lines: ["అమ్మ"] }), LyricRequestError);
  assert.notEqual(japaneseReadingCacheKey(["東京 мова"], "song", "review-1", "uk"), japaneseReadingCacheKey(["東京 мова"], "song", "review-1", "ru"));
  assert.notEqual(japaneseReadingCacheKey(["炎"], "song", "review-1", "ja"), japaneseReadingCacheKey(["炎"], "song", "review-2", "ja"));
});

test("offline cache upgrades detect new languages and remove obsolete guides without touching verified originals", () => {
  for (const language of added) {
    const song = READING_SONG_EXCERPTS.find(song => song.language === language)!;
    const original = saved(song.text);
    const old = { ...original, readingLanguage: null, readingLanguageVersion: "multilingual-reading-v2", lines: original.lines.map(line => ({ ...line, romanized: "obsolete reading", readingEngine: "multilingual-reading-v2:hi" })) };
    const upgraded = upgradeCachedLyricReadings(old, cacheKey(song.hintRequired ? language : undefined));
    assert.equal(upgraded.readingLanguage, language); assert.equal(upgraded.readingLanguageVersion, READING_VERSION);
    assert.equal(upgraded.lines[0].romanized, undefined);
    assert.deepEqual(upgraded.lines, original.lines);
    assert.equal(upgraded.provider, original.provider); assert.equal(upgraded.providerTrackId, original.providerTrackId); assert.equal(upgraded.schemaVersion, original.schemaVersion);
  }
  const native = saved("माझे मन तुझ्याकडे आहे");
  const old: PlayerLyrics = { ...native, readingLanguage: "hi", lines: native.lines.map(line => ({ ...line, romanized: "wrong Hindi default", readingEngine: "multilingual-reading-v2:hi" })) };
  const upgraded = upgradeCachedLyricReadings(old, cacheKey("Marathi"));
  assert.equal(upgraded.readingLanguage, null); assert.deepEqual(upgraded.lines, native.lines);
});

test("cache upgrades retain known manual selections and current guides; repeated reads are stable", () => {
  const old: PlayerLyrics = { ...saved("君の声"), hasJapanese: true, readingLanguage: "zh" };
  const inferred = upgradeCachedLyricReadings(old, cacheKey());
  assert.equal(inferred.readingLanguage, "zh"); assert.equal(inferred.readingLanguageSource, "chosen");
  const chosen: PlayerLyrics = { ...saved("Тамо далеко"), readingLanguage: "sr", readingLanguageSource: "chosen", readingLanguageVersion: READING_VERSION, lines: [{ text: "Тамо далеко", start: 12, end: 16, romanized: "Tamo daleko", readingEngine: readingEngine("sr") }] };
  assert.equal(upgradeCachedLyricReadings(chosen, cacheKey()), chosen);
  const legacyDefault: PlayerLyrics = { ...saved("Тамо далеко"), readingLanguage: "ru", readingLanguageVersion: "multilingual-reading-v2" };
  assert.equal(upgradeCachedLyricReadings(legacyDefault, cacheKey("sr")).readingLanguage, "sr");
  assert.equal(upgradeCachedLyricReadings(legacyDefault, cacheKey("mk")).readingLanguage, null);
});
