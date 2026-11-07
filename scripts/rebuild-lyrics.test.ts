import assert from "node:assert/strict";
import { test } from "node:test";
import { japaneseReadingCacheKey, romanizeJapanese, romanizeJapaneseLines, romanizeKana } from "../src/rebuild/lyrics/japanese";
import { activeLyricIndex, mergeVerifiedWordTimings, parseTimedLyrics } from "../src/rebuild/lyrics/parse";
import { fetchLrcLibLyrics, lyricCacheKey, selectLyricsCandidate, type LrcLibTrack } from "../src/rebuild/lyrics/provider";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import { LyricRequestError, parseLyricIdentity, parseReadingRequest } from "../src/rebuild/lyrics/request";

const compact = (text: string) => text.replace(/\s/g, "");
const READING_CASES: Array<[string, string]> = [
  ["夜に駆ける", "yorunikakeru"], ["今日", "kyou"], ["大人", "otona"], ["一人", "hitori"],
  ["音楽", "ongaku"], ["花火", "hanabi"], ["東京へ行く", "toukyoueiku"],
  ["私は音楽を聴く", "watashiwaongakuokiku"], ["生きる", "ikiru"], ["生まれる", "umareru"],
  ["愛している", "aishiteiru"], ["好きだよ", "sukidayo"], ["雨が降っている", "amegafutteiru"],
  ["群青", "gunjou"], ["怪物", "kaibutsu"], ["三原色", "sangenshoku"], ["祝福", "shukufuku"],
  ["勇者", "yuusha"], ["切手", "kitte"], ["学校", "gakkou"], ["ラーメン", "raamen"],
  ["コーヒー", "koohii"], ["こんにちは", "konnichiwa"], ["こんばんは", "konbanwa"],
  ["二人で歩く", "futaridearuku"], ["走っている", "hashitteiru"], ["買った", "katta"], ["待って", "matte"],
  ["一人称", "ichininshou"],
];

for (const [text, expected] of READING_CASES) {
  test(`Japanese contextual reading: ${text}`, async () => {
    const reading = await romanizeJapanese(text);
    assert.equal(compact(reading.romanized), expected);
    assert.equal(reading.text, text);
    assert.equal(reading.tokens.map((token) => token.surface).join(""), text);
    assert.equal(reading.reviewNeeded, false);
  });
}

test("Syllabic n remains distinct from nya and vowel syllables", () => {
  assert.equal(romanizeKana("シンヨウ"), "shin'you");
  assert.equal(romanizeKana("アンイ"), "an'i");
});

test("Mixed English, punctuation, emoji and source offsets survive", async () => {
  const text = "🌸 東京へ行く、Hello world!\n私はここにいる。";
  const result = await romanizeJapanese(text);
  assert.ok(result.romanized.includes("🌸"));
  assert.ok(result.romanized.includes("Hello world!\n"));
  assert.ok(result.romanized.includes("、"));
  for (const token of result.tokens) assert.equal(text.slice(token.start, token.end), token.surface);
});

test("Unknown kanji is retained and needs review rather than receiving a guess", async () => {
  const text = "𠮷𰻞";
  const result = await romanizeJapanese(text);
  assert.equal(result.romanized, text);
  assert.equal(result.reviewNeeded, true);
});

test("Romanization preserves line count, timestamps, blank lines and word timings", async () => {
  const lines = [
    { text: "東京へ行く", start: 1.25, end: 3, words: [{ text: "東京", start: 1.25, end: 2 }] },
    { text: "", start: 3, end: 6, words: [] },
    { text: "大人", start: 6, end: 8, words: [{ text: "大人", start: 6, end: 8 }] },
  ];
  const transformed = await romanizeJapaneseLines(lines);
  assert.equal(transformed.length, lines.length);
  assert.deepEqual(transformed.map(({ text, start, end, words }) => ({ text, start, end, words })), lines);
  assert.equal(transformed[1].romanized, "");
});

test("Cache content hashes prevent same-count different-song and edited-text collisions", () => {
  assert.notEqual(japaneseReadingCacheKey(["今日"]), japaneseReadingCacheKey(["大人"]));
  assert.notEqual(japaneseReadingCacheKey(["今日"], "same-song"), japaneseReadingCacheKey(["昨日"], "same-song"));
  assert.notEqual(japaneseReadingCacheKey(["a", "b"]), japaneseReadingCacheKey(["a\nb"]));
  assert.equal(japaneseReadingCacheKey(["今日"]), japaneseReadingCacheKey(["今日"]));
  assert.notEqual(japaneseReadingCacheKey(["炎"], "homura", "review-1"), japaneseReadingCacheKey(["炎"], "homura", "review-2"));
});

test("Reviewed poetic readings override the dictionary only for an exact matching source span", async () => {
  const reading = await romanizeJapanese("炎", { overrides: [{ start: 0, end: 1, surface: "炎", kana: "ホムラ", provenance: "reviewed:artist-title" }] });
  assert.equal(reading.romanized, "homura");
  assert.equal(reading.tokens[0].source, "reviewed");
  await assert.rejects(romanizeJapanese("光", { overrides: [{ start: 0, end: 1, surface: "炎", kana: "ホムラ", provenance: "reviewed:artist-title" }] }));
});

test("LRC parses multiple chorus stamps, negative offsets and blank instrumental lines", () => {
  const lines = parseTimedLyrics("[offset:-100]\n[00:01.00][00:11.00]same chorus\n[00:04.250]\n[00:05.50]<00:05.50>two <00:06.00>words");
  assert.deepEqual(lines.map(({ start, text }) => ({ start, text })), [
    { start: 0.9, text: "same chorus" }, { start: 4.15, text: "" },
    { start: 5.4, text: "two words" }, { start: 10.9, text: "same chorus" },
  ]);
  assert.equal(lines[2].words?.[0].start, 5.4);
  assert.equal(activeLyricIndex(lines, 4.5), -1);
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 1), 0);
});

test("Word timings from another textual version cannot contaminate the chosen lyrics", () => {
  const lines = [{ start: 1, text: "original words" }];
  const mismatch = [{ start: 1, text: "remix words", words: [{ start: 1, text: "remix" }] }];
  assert.equal(mergeVerifiedWordTimings(lines, mismatch)[0].words, undefined);
  const correct = [{ start: 1.1, text: "Original words!", words: [{ start: 1.1, text: "Original" }] }];
  assert.deepEqual(mergeVerifiedWordTimings(lines, correct)[0].words, correct[0].words);
});

const original: LrcLibTrack = { id: 1, trackName: "Finesse", artistName: "Bruno Mars", duration: 191, albumName: "24K Magic", plainLyrics: "original", syncedLyrics: "[00:01]original" };
test("Lyrics refuse original/remix, wrong artist and duration mismatches", () => {
  const identity = { title: "Finesse", artist: "Bruno Mars", durationSeconds: 191 };
  const remix = { ...original, id: 2, trackName: "Finesse (Remix)", artistName: "Bruno Mars feat. Cardi B", duration: 217 };
  assert.equal(selectLyricsCandidate(identity, [remix]).status, "missing");
  assert.equal(selectLyricsCandidate(identity, [{ ...original, artistName: "Other artist" }]).status, "missing");
  assert.equal(selectLyricsCandidate(identity, [{ ...original, duration: 220 }]).status, "missing");
  assert.equal(selectLyricsCandidate(identity, [remix, original]).status, "matched");
});

test("Translated English text cannot satisfy a Japanese lyric request", () => {
  const candidate = { id: 2, trackName: "Idol", artistName: "YOASOBI", duration: 213, plainLyrics: "translated English words" };
  assert.equal(selectLyricsCandidate({ title: "Idol", artist: "YOASOBI", durationSeconds: 213, language: "ja" }, [candidate]).status, "missing");
});

test("Japanese synced lyrics are retained while a translated plain field is discarded", () => {
  const candidate = { id: 2, trackName: "Idol", artistName: "YOASOBI", duration: 213, plainLyrics: "translated English words", syncedLyrics: "[00:01]私はここにいる" };
  const result = selectLyricsCandidate({ title: "Idol", artist: "YOASOBI", durationSeconds: 213, language: "ja" }, [candidate]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.track.plainLyrics, null);
    assert.equal(result.track.syncedLyrics, candidate.syncedLyrics);
  }
});

test("Edition ambiguity requires metadata instead of blindly selecting the best result", () => {
  assert.equal(selectLyricsCandidate({ title: "Finesse", artist: "Bruno Mars" }, [original, { ...original, id: 2, duration: 230 }]).status, "ambiguous");
});

test("Lyrics cache varies by album, duration and language", () => {
  const key = lyricCacheKey({ title: "Idol", artist: "YOASOBI", durationSeconds: 213, language: "ja" });
  assert.notEqual(key, lyricCacheKey({ title: "Idol", artist: "YOASOBI", durationSeconds: 213, language: "en" }));
  assert.notEqual(key, lyricCacheKey({ title: "Idol", artist: "YOASOBI", durationSeconds: 210, language: "ja" }));
});

test("Verified exact lookup returns after one request and does not wait on other providers", async () => {
  const requests: string[] = [];
  const fakeFetch: typeof fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify(original), { status: 200 });
  };
  const result = await fetchLrcLibLyrics({ title: "Finesse", artist: "Bruno Mars", durationSeconds: 191 }, { fetch: fakeFetch });
  assert.equal(result.status, "matched");
  assert.equal(requests.length, 1);
});

test("Provider outage is an explicit unavailable result", async () => {
  const fakeFetch: typeof fetch = async () => new Response("offline", { status: 503 });
  const result = await fetchLrcLibLyrics({ title: "Idol", artist: "YOASOBI" }, { fetch: fakeFetch });
  assert.equal(result.status, "unavailable");
});

test("Reading requests reject malformed text, oversized lyrics and invalid timing", () => {
  assert.throws(() => parseReadingRequest({ lines: [42] }), LyricRequestError);
  assert.throws(() => parseReadingRequest({ lines: ["a".repeat(20_001)] }), (error: unknown) => error instanceof LyricRequestError && error.status === 413);
  assert.throws(() => parseReadingRequest({ lines: [{ text: "今日", start: 5, end: 1 }] }), LyricRequestError);
  assert.throws(() => parseReadingRequest({ lines: [{ text: "今日", start: Number.NaN }] }), LyricRequestError);
  assert.throws(() => parseReadingRequest({ language: "en", lines: ["Hello"] }), LyricRequestError);
  assert.deepEqual(parseReadingRequest({ lines: ["今日", ""] }).lines, [{ text: "今日", start: 0 }, { text: "", start: 0 }]);
});

test("Lyrics requests validate duration instead of allowing NaN cache collisions", () => {
  assert.throws(() => parseLyricIdentity(new URLSearchParams({ title: "Idol", artist: "YOASOBI", duration: "NaN" })), LyricRequestError);
  assert.throws(() => parseLyricIdentity(new URLSearchParams({ title: "Idol", artist: "YOASOBI", duration: "-1" })), LyricRequestError);
  assert.equal(parseLyricIdentity(new URLSearchParams({ title: "Idol", artist: "YOASOBI", duration: "213" })).durationSeconds, 213);
});

test("Concurrent identical lyric loads share one request and reuse the verified result", async () => {
  let loads = 0;
  const resolver = createLyricsResolver({ load: async () => { loads++; await Promise.resolve(); return { status: "matched", track: original, provider: "lrclib" }; } });
  const identity = { title: "Finesse", artist: "Bruno Mars", durationSeconds: 191 };
  const [one, two] = await Promise.all([resolver(identity), resolver(identity)]);
  assert.deepEqual(one, two);
  await resolver(identity);
  assert.equal(loads, 1);
});

test("Missing lyrics retry after a short TTL while provider outages are never cached", async () => {
  let clock = 0;
  let loads = 0;
  const resolver = createLyricsResolver({ now: () => clock, load: async () => { loads++; return { status: "missing", reason: "missing" }; } });
  const identity = { title: "Idol", artist: "YOASOBI" };
  await resolver(identity);
  await resolver(identity);
  assert.equal(loads, 1);
  clock = 30_001;
  await resolver(identity);
  assert.equal(loads, 2);
  let outages = 0;
  const unavailable = createLyricsResolver({ load: async () => { outages++; return { status: "unavailable", reason: "offline" }; } });
  await unavailable(identity);
  await unavailable(identity);
  assert.equal(outages, 2);
});
