import assert from "node:assert/strict";
import test from "node:test";
import { lyricReadingLanguage, normalizeLyricLanguageHint, READING_LANGUAGES, READING_LABELS, READING_VERSION, readingEngine } from "../src/rebuild/lyrics/language";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";
import { romanizeScriptSpan } from "../src/rebuild/lyrics/scriptReading";
import { createReadingTransformCache } from "../src/rebuild/lyrics/readingTransforms";
import { LyricRequestError, parseReadingRequest } from "../src/rebuild/lyrics/request";
import { upgradeCachedLyricReadings } from "../src/rebuild/player/readingCacheUpgrade";
import type { PlayerLyrics } from "../src/rebuild/player/useLyrics";
import { READING_SONG_EXCERPTS } from "./fixtures/reading-song-excerpts";

const cacheKey = (hint?: string) => JSON.stringify(["verified-lyrics-v3", "song", ["artist"], "album", 180, "Original recording", hint, null]);
const saved = (text: string): PlayerLyrics => ({ schemaVersion: "verified-lyrics-v3", lines: [{ text, start: 12, end: 16, words: [{ text, start: 12.2, end: 15.8 }] }], timing: "synced", provider: "verified fixture", providerTrackId: 451, hasJapanese: false });

test("Tamil has independently sourced actual songs and is available in the reading language choices", () => {
  assert.ok(READING_LANGUAGES.includes("ta"));
  assert.equal(READING_LABELS.ta, "Tamil transliteration");
  const songs = READING_SONG_EXCERPTS.filter(song => song.language === "ta");
  assert.ok(songs.length >= 15, "the expanded Tamil check requires fifteen different real songs");
  assert.equal(new Set(songs.map(song => song.title)).size, songs.length);
  for (const song of songs) {
    assert.ok(song.references?.native.length && song.references.reading.length, song.id);
    assert.ok(song.references.sourceReading && song.references.convention, song.id);
    assert.equal(song.mode, "script", "exact readings retain vowel length and Tamil consonant distinctions");
  }
});

test("Tamil detection follows native lyrics and accepts ISO, language names and BCP 47 hints", () => {
  for (const hint of ["ta", "tam", "Tamil", " ta-Taml-IN ", "tam_LK"]) {
    assert.equal(normalizeLyricLanguageHint(hint), "ta");
    assert.equal(lyricReadingLanguage("தமிழ் பாடல் வரிகள்", hint), "ta");
  }
  assert.equal(lyricReadingLanguage("தமிழ் பாடல் வரிகள்"), "ta");
  assert.equal(lyricReadingLanguage("தமிழ் பாடல் வரிகள்", "Hindi"), "ta", "unrelated stale catalogue metadata cannot override clear native script");
  assert.equal(lyricReadingLanguage("தமிழ் பாடல் வரிகள் தமிழ் பாடல் வரிகள் हूँ", "hi"), "ta", "a short Hindi refrain cannot replace predominant Tamil");
  assert.equal(lyricReadingLanguage("Hello Latin lyrics", "Tamil"), null, "Tamil metadata alone cannot manufacture a native reading");
  for (const hint of ["sa", "san", "Sanskrit", "bfq", "Badaga", "iru", "Irula"]) assert.equal(lyricReadingLanguage("சிவாய நம", hint), null, "Tamil script can also write other languages");
  assert.equal(lyricReadingLanguage("বাংলা গান বাংলা গান அம்மா", "ta"), null, "an unsupported primary script stays primary");
});

test("Tamil preserves all twelve vowel distinctions and canonical composed vowel signs", () => {
  assert.equal(romanizeScriptSpan("அ ஆ இ ஈ உ ஊ எ ஏ ஐ ஒ ஓ ஔ", "ta").romanized, "a ā i ī u ū e ē ai o ō au");
  const composed = "க கா கி கீ கு கூ கெ கே கை கொ கோ கௌ";
  assert.equal(romanizeScriptSpan(composed, "ta").romanized, "ka kā ki kī ku kū ke kē kai ko kō kau");
  assert.equal(romanizeScriptSpan(composed.normalize("NFD"), "ta").romanized, romanizeScriptSpan(composed, "ta").romanized);
});

test("Tamil pulli and conjunct joiners preserve dead consonants and gemination", () => {
  assert.equal(romanizeScriptSpan("அம்மா அக்கா அப்பா", "ta").romanized, "ammā akkā appā");
  assert.equal(romanizeScriptSpan("க் ங் ஞ் ண் ந் ன் ம் ர் ற் ல் ள் ழ்", "ta").romanized, "k ṅ ñ ṇ n ṉ m r ṟ l ḷ ḻ");
  for (const controls of ["\u200c", "\u200d", "\u200c\u200d"]) {
    assert.equal(romanizeScriptSpan(`அக்${controls}கா`, "ta").romanized, "akkā");
    assert.equal(romanizeScriptSpan(`அம்மா${controls}`, "ta").romanized, "ammā");
  }
});

test("Tamil contextual readings voice singleton stops while retaining nasal place and doubled stops", () => {
  // Written Tamil does not distinguish voiced/voiceless stops. The Tamil
  // phonology references identify singleton post-nasal/intervocalic voicing;
  // these ordinary words exercise the rule beyond the checked song titles.
  assert.equal(romanizeScriptSpan("தங்கம் பஞ்சு வண்டு அந்த அம்பு", "ta").romanized, "taṅgam pañju vaṇḍu anda ambu");
  assert.equal(romanizeScriptSpan("நகம் படகு அது", "ta").romanized, "nagam paḍagu adu");
  assert.equal(romanizeScriptSpan("அக்கா பச்சை பட்டம் பத்து அப்பா", "ta").romanized, "akkā paccai paṭṭam pattu appā");
  assert.equal(romanizeScriptSpan("கற்றேன் என்றேன்", "ta").romanized, "kaṟṟēṉ eṉṟēṉ", "written alveolar sequences stay distinct from dialect-dependent simplification");
});

test("Tamil distinct nasals, laterals and Grantha letters survive the hybrid reading", () => {
  assert.equal(romanizeScriptSpan("ந ன ண ல ள ழ ர ற", "ta").romanized, "na ṉa ṇa la ḷa ḻa ra ṟa");
  assert.equal(romanizeScriptSpan("ஜ ஶ ஷ ஸ ஹ ஸ்ரீ", "ta").romanized, "ja śa ṣa sa ha srī");
  assert.equal(romanizeScriptSpan("ஃ ஃபா ஃபோன்", "ta").romanized, "ḵ fā fōṉ", "modern written f and isolated historical aytham remain distinguishable");
});

test("Tamil c and s readings combine documented lexical choices with medial and geminate context", () => {
  // Tamil phonology references explicitly distinguish cinna/Chennai from
  // sāvi/Salem; one initial-letter substitution cannot cover these examples.
  assert.equal(romanizeScriptSpan("சின்ன சென்னை சாவி சேலம் சரி", "ta").romanized, "ciṉṉa ceṉṉai sāvi sēlam sari");
  assert.equal(romanizeScriptSpan("ஆசை அச்சம் நெஞ்சம்", "ta").romanized, "āsai accam neñjam");
});

test("Tamil reviewed initial readings retain the remaining word's vowels and consonant rules", () => {
  assert.equal(romanizeScriptSpan("சாய சொல்லு போதை பிம்பம் கீதம் கோலி சோடாவே", "ta").romanized, "sāya sollu bōdai bimbam gīdam gōli sōḍāvē");
  assert.equal(romanizeScriptSpan("சாயாதே சில சட்டென்று", "ta").romanized, "sāyādē sila saṭṭeṉṟu", "independently verified Vennilave verse selects reviewed s initials");
  assert.equal(romanizeScriptSpan("சாயல் சோடா", "ta").romanized, "cāyal cōḍā", "unreviewed forms retain conservative initial letters rather than borrowing a substring match");
});

test("Tamil singleton stops voice after sonorants while historical stop clusters and geminates remain distinct", () => {
  assert.equal(romanizeScriptSpan("பெய்திடும் மூழ்கிடும்", "ta").romanized, "peydiḍum mūḻgiḍum", "independently printed Nenjukkul verse checks y and ḻ continuations");
  assert.equal(romanizeScriptSpan("கற்க கற்பனை", "ta").romanized, "kaṟka kaṟpaṉai", "written ṟ is excluded from the sonorant continuation rule");
  assert.equal(romanizeScriptSpan("வாழ்க்கை", "ta").romanized, "vāḻkkai", "a preceding sonorant cannot voice a doubled stop");
});

test("Tamil palatal nasals and written compound boundaries do not share a blanket c-to-j rule", () => {
  assert.equal(romanizeScriptSpan("அஞ்சு பஞ்சு", "ta").romanized, "añju pañju");
  assert.equal(romanizeScriptSpan("நன்செய் வன்சொல்", "ta").romanized, "naṉcey vaṉcol", "unreviewed alveolar-n compounds retain their c spelling variant");
  assert.equal(romanizeScriptSpan("மின்சாரம் மின்சார மின்சாரத்தால்", "ta").romanized, "miṉsāram miṉsāra miṉsārattāl", "the independently reviewed electric compound retains its s across written inflections");
});

test("mixed Tamil lines preserve original text, word timing, Latin spelling and literal punctuation", async () => {
  const original = { text: "Helloஅம்மாПривет — हूँ! 🌸", start: 1, end: 5, words: [{ text: "அம்மா", start: 2, end: 3 }] };
  const [line] = await romanizeLyricLines([original], "ta", undefined, "Hindi");
  assert.equal(line.romanized, "Hello ammā Privet — hū̃! 🌸");
  assert.deepEqual({ text: line.text, start: line.start, end: line.end, words: line.words }, original);
  assert.equal(line.readingEngine, readingEngine("ta"));
  const [literal] = await romanizeLyricLines([{ text: "அம்மா##அக்கா\\அம்மா <b>அம்மா</b> ௧௨" }], "ta");
  assert.equal(literal.romanized, "ammā##akkā\\ammā <b>ammā</b> ௧௨", "script control-like punctuation and original digits stay literal");
  const [sanskrit] = await romanizeLyricLines([{ text: "சிவாய நம" }], "ta", undefined, "Sanskrit");
  assert.equal(sanskrit.romanized, "சிவாய நம", "compatible Sanskrit evidence suppresses invented Tamil pronunciation");
});

test("Tamil request validation retains line and word times and bounds malformed input", async () => {
  const line = { text: "அம்மா", start: 1, end: 4, words: [{ text: "அம்மா", start: 1.5, end: 3.5 }] };
  const request = parseReadingRequest({ language: "ta", languageHint: "tam-Taml-IN", lines: [line] });
  assert.equal(request.language, "ta");
  assert.equal(request.languageHint, "ta");
  assert.deepEqual(request.lines, [line]);
  assert.throws(() => parseReadingRequest({ language: "ta", lines: [{ ...line, end: 0 }] }), LyricRequestError);
  assert.throws(() => parseReadingRequest({ language: "ta", languageHint: 42, lines: [line] }), LyricRequestError);
  assert.throws(() => parseReadingRequest({ language: "ta", lines: Array.from({ length: 401 }, () => "அ") }), LyricRequestError);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(romanizeLyricLines([line], "ta", cancelled.signal), { name: "AbortError" });
});

test("Tamil transform caching reuses readings for retimed lyrics and separates compatible language evidence", async () => {
  let transforms = 0;
  const cache = createReadingTransformCache({ transform: async (lines, language, signal, hint) => { transforms++; return romanizeLyricLines(lines, language, signal, hint); } });
  const original = [{ text: "அம்மா", start: 2, end: 4, words: [{ text: "அம்மா", start: 2.1, end: 3.9 }] }];
  assert.equal((await cache(original, "ta", { languageHint: "Tamil" }))[0].romanized, "ammā");
  const retimed = [{ ...original[0], start: 9, end: 12, words: [{ text: "அம்மா", start: 9.1, end: 11.9 }] }];
  const [reused] = await cache(retimed, "ta", { languageHint: "tam-IN" });
  assert.deepEqual({ text: reused.text, start: reused.start, end: reused.end, words: reused.words }, retimed[0]);
  assert.equal(transforms, 1, "equivalent hints reuse pronunciation without old timestamps");
  assert.equal((await cache(original, "ta", { languageHint: "Sanskrit" }))[0].romanized, "அம்மா");
  assert.equal(transforms, 2, "shared-script evidence cannot reuse a Tamil pronunciation");
});

test("offline reading migration detects Tamil and invalidates v3 guides without losing verified originals", () => {
  const original = saved("அம்மா");
  const old: PlayerLyrics = { ...original, readingLanguage: null, readingLanguageSource: "detected", readingLanguageVersion: "multilingual-reading-v3", lines: original.lines.map(line => ({ ...line, romanized: "obsolete reading", readingEngine: "multilingual-reading-v3:hi" })) };
  const upgraded = upgradeCachedLyricReadings(old, cacheKey("Tamil"));
  assert.equal(upgraded.readingLanguage, "ta");
  assert.equal(upgraded.readingLanguageVersion, READING_VERSION);
  assert.notEqual(READING_VERSION, "multilingual-reading-v3", "mixed-script cached guides must be regenerated to include Tamil");
  assert.deepEqual(upgraded.lines, original.lines);
  assert.equal(upgraded.provider, original.provider);
  assert.equal(upgraded.providerTrackId, original.providerTrackId);
  assert.equal(upgraded.schemaVersion, original.schemaVersion);
  const current: PlayerLyrics = { ...upgraded, lines: upgraded.lines.map(line => ({ ...line, romanized: "ammā", readingEngine: readingEngine("ta") })) };
  assert.equal(upgradeCachedLyricReadings(current, cacheKey("Tamil")), current, "current cached guides do not churn");
});

test("Japanese-selected mixed guides also invalidate old Tamil omissions while preserving saved originals", () => {
  const original = saved("君の声 அம்மா");
  const old: PlayerLyrics = { ...original, hasJapanese: true, readingLanguage: "ja", readingLanguageSource: "chosen", readingLanguageVersion: "multilingual-reading-v4", lines: original.lines.map(line => ({ ...line, romanized: "kimi no koe அம்மா", readingEngine: "ja-ipadic-hepburn-v3" })) };
  const upgraded = upgradeCachedLyricReadings(old, cacheKey());
  assert.equal(upgraded.readingLanguage, "ja");
  assert.equal(upgraded.readingLanguageSource, "chosen");
  assert.deepEqual(upgraded.lines, original.lines);
  assert.notEqual(readingEngine("ja"), "ja-ipadic-hepburn-v3");
  assert.equal(upgraded.providerTrackId, original.providerTrackId);
  assert.equal(upgraded.schemaVersion, original.schemaVersion);
});
