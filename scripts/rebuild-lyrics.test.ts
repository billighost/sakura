import assert from "node:assert/strict";
import { test } from "node:test";
import { japaneseReadingCacheKey, romanizeJapanese, romanizeJapaneseLines, romanizeKana } from "../src/rebuild/lyrics/japanese";
import { activeLyricIndex, mergeVerifiedWordTimings, parseTimedLyrics } from "../src/rebuild/lyrics/parse";
import { fetchLrcLibLyrics, lyricCacheKey, lyricIdentityVariants, selectLyricsCandidate, type LrcLibTrack } from "../src/rebuild/lyrics/provider";
import { lyricInputKey } from "../src/rebuild/player/useLyrics";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import { LyricRequestError, parseLyricIdentity, parseReadingRequest } from "../src/rebuild/lyrics/request";
import { fetchLyricaLyrics, fetchNetEaseLyrics, fetchVerifiedLyrics, fetchLyricsOvh } from "../src/rebuild/lyrics/fallbacks";
import { lyricRetryAfter } from "../src/rebuild/lyrics/transport";
import { lyricRetryDelay, preserveLyricReadings } from "../src/rebuild/player/lyricRecovery";
import { JAPANESE_READING_VERSION } from "../src/rebuild/lyrics/versions";
import type { PlayerLyrics } from "../src/rebuild/player/useLyrics";

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

test("Featured-artist formatting does not hide the correct duration-verified lyrics", () => {
  const result = selectLyricsCandidate({ title: "Finesse", artist: "Bruno Mars", artists: ["Bruno Mars", "Cardi B"], durationSeconds: 217 }, [
    { ...original, id: 2, artistName: "Bruno Mars feat. Cardi B", duration: 217 },
  ]);
  assert.equal(result.status, "matched");
});

test("Known native and romanized Japanese titles become verified lookup variants", () => {
  const variants = lyricIdentityVariants({ title: "Idol", artist: "YOASOBI", durationSeconds: 213 });
  assert.ok(variants.titles.some(title => title === "Idol"));
  assert.ok(variants.titles.length > 1);
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

test("Search fallback survives a transient exact-lookup outage", async () => {
  const fakeFetch: typeof fetch = async (url) => String(url).includes("/api/search?")
    ? Response.json([original])
    : new Response("offline", { status: 503 });
  const result = await fetchLrcLibLyrics({ title: "Finesse", artist: "Bruno Mars", durationSeconds: 191 }, { fetch: fakeFetch, timeoutMs: 10_000 });
  assert.equal(result.status, "matched");
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

test("Lyrics request retains all credited artists", () => {
  const identity = parseLyricIdentity(new URLSearchParams([["title", "Finesse"], ["artist", "Bruno Mars"], ["artist", "Cardi B"]]));
  assert.deepEqual(identity.artists, ["Bruno Mars", "Cardi B"]);
});

test("Browser lyric cache survives a temporary-to-canonical recording ID swap", () => {
  const base = { title: "Finesse", artists: ["Bruno Mars"], albumTitle: "24K Magic", durationMs: 191_200 };
  assert.equal(lyricInputKey({ ...base, id: "deezer:123" }), lyricInputKey({ ...base, id: "9e6382ea-b571-4c07-8943-bc0c773f2993" }));
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

test("one empty exact lookup cannot mask a failed search as missing lyrics", async () => {
  const result = await fetchLrcLibLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {
    fetch: async url => String(url).includes("/api/get?") ? new Response(null, {status: 404}) : new Response(null, {status: 503}),
    wait: async () => undefined,
  });
  assert.equal(result.status, "unavailable");
});

test("a thrown exact-lookup network error still permits verified search recovery", async () => {
  const result = await fetchLrcLibLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {
    fetch: async url => {if (String(url).includes("/api/get?")) throw new TypeError("failed to fetch"); return Response.json([original]);},
    wait: async () => undefined,
  });
  assert.equal(result.status, "matched");
});

test("title-only search can recover artist spelling differences through verified aliases", async () => {
  const result = await fetchLrcLibLyrics({title: "Lemon", artist: "Kenshi Yonezu", durationSeconds: 191}, {
    fetch: async url => {
      const query = new URL(String(url));
      return query.pathname.endsWith("/search") && !query.searchParams.has("artist_name") && !query.searchParams.has("q")
        ? Response.json([{...original, trackName: "Lemon", artistName: "米津玄師"}]) : new Response(null, {status: 404});
    },
  });
  assert.equal(result.status, "matched");
});

test("all completed empty LRCLib variants produce a genuine missing result", async () => {
  const requests: string[] = [];
  const result = await fetchLrcLibLyrics({title: "Idol", artist: "YOASOBI"}, {fetch: async url => {requests.push(String(url));return new Response(null, {status: 404});}});
  assert.equal(result.status, "missing");
  assert.ok(requests.some(url => url.includes("%E3%82%A2%E3%82%A4%E3%83%89%E3%83%AB")));
  assert.ok(requests.some(url => url.includes("/api/search?track_name=")));
});

test("provider long rate limits propagate a retry delay without hammering every alias", async () => {
  let requests = 0;
  const result = await fetchLrcLibLyrics({title: "Idol", artist: "YOASOBI"}, {
    now: () => 1000,
    fetch: async () => {requests++; return new Response(null, {status: 429, headers: {"Retry-After": "90"}});},
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.retryAfterMs, 90_000);
  assert.equal(requests, 1);
});

test("a short Retry-After is awaited before retrying the provider", async () => {
  let requests = 0, clock = 0;
  const waits: number[] = [];
  const result = await fetchLrcLibLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {
    now: () => clock, wait: async delay => {waits.push(delay); clock += delay;},
    fetch: async () => ++requests === 1 ? new Response(null, {status: 429, headers: {"Retry-After": "1"}}) : Response.json(original),
  });
  assert.equal(result.status, "matched");
  assert.deepEqual(waits, [1000]);
  assert.equal(requests, 2);
});

test("HTTP-date Retry-After and malformed values are handled correctly", () => {
  assert.equal(lyricRetryAfter("Mon, 09 Nov 2026 12:00:10 GMT", Date.parse("2026-11-09T12:00:00Z")), 10_000);
  assert.equal(lyricRetryAfter("invalid"), undefined);
  assert.equal(lyricRetryAfter("-2"), undefined);
});

test("verified lyrics cascade waits for every provider before announcing absence", async () => {
  let complete!: () => void;
  let settled = false;
  const result = fetchVerifiedLyrics({title: "Finesse", artist: "Bruno Mars"}, {providers: [
    async () => ({status: "missing", reason: "empty"}),
    async () => {await new Promise<void>(resolve => {complete = resolve;}); return {status: "missing", reason: "empty"};},
  ]}).then(value => {settled = true; return value;});
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  complete();
  assert.equal((await result).status, "missing");
});

test("verified fallback lyrics win immediately and cancel stalled sources", async () => {
  let stalledSignal!: AbortSignal;
  const result = await fetchVerifiedLyrics({title: "Finesse", artist: "Bruno Mars"}, {providers: [
    async (_, options) => {stalledSignal = options.signal!; return new Promise(() => undefined);},
    async () => ({status: "matched", track: original, provider: "netease"}),
  ]});
  assert.equal(result.status, "matched");
  assert.equal(stalledSignal.aborted, true);
});

test("a missing source and a rate-limited source produce retryable unavailable lyrics", async () => {
  const result = await fetchVerifiedLyrics({title: "Finesse", artist: "Bruno Mars"}, {providers: [
    async () => ({status: "missing", reason: "empty"}),
    async () => ({status: "unavailable", reason: "rate limit", retryAfterMs: 60_000}),
  ]});
  assert.equal(result.status, "unavailable");
  assert.equal(result.retryAfterMs, 60_000);
});

test("NetEase verifies recording metadata and retains only its original lyrics", async () => {
  const result = await fetchNetEaseLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {fetch: async url => {
    if (String(url).includes("/search/get")) return Response.json({code: 200, result: {songs: [{id: 52, name: "Finesse", duration: 191000, artists: [{name: "Bruno Mars"}], album: {name: "24K Magic"}}]}});
    return Response.json({code: 200, lrc: {lyric: "[00:01]original words"}, tlyric: {lyric: "[00:01]translated words"}});
  }});
  assert.equal(result.status, "matched");
  if (result.status === "matched") {assert.equal(result.provider, "netease"); assert.equal(result.track.syncedLyrics, "[00:01]original words");}
});

test("NetEase does not fetch lyrics for a different recording edition", async () => {
  let lyricCalls = 0;
  const result = await fetchNetEaseLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {fetch: async url => {
    if (String(url).includes("/song/lyric")) lyricCalls++;
    return Response.json({code: 200, result: {songs: [{id: 53, name: "Finesse (Remix)", duration: 217000, artists: [{name: "Bruno Mars"}], album: {name: "24K Magic"}}]}});
  }});
  assert.equal(result.status, "missing");
  assert.equal(lyricCalls, 0);
});

test("Lyrica original source text and returned metadata are verified before acceptance", async () => {
  let request = "";
  const result = await fetchLyricaLyrics({title: "Finesse", artist: "Bruno Mars", durationSeconds: 191}, {fetch: async url => {
    request = String(url);
    return Response.json({status: "success", data: {title: "Finesse", artist: "Bruno Mars", album: "24K Magic", duration: 191, lyrics: "original words", timed_lyrics: [{start_time: 1.5, text: "original words"}]}});
  }});
  assert.equal(result.status, "matched");
  assert.ok(request.includes("romanize=false"));
  assert.ok(!request.includes("language=en"));
  if (result.status === "matched") {assert.equal(result.provider, "lyrica");assert.equal(result.track.syncedLyrics, "[00:01.500]original words");}
});

test("Lyrica cannot match a metadata-free or translated Japanese response", async () => {
  const result = await fetchLyricaLyrics({title: "Idol", artist: "YOASOBI", durationSeconds: 213, language: "ja"}, {fetch: async () => Response.json({status: "success", data: {title: "Idol", artist: "YOASOBI", duration: 213, lyrics: "translated English words"}})});
  assert.equal(result.status, "missing");
});

test("verified stale lyrics survive provider outages and later empty indexes", async () => {
  let clock = 0, calls = 0;
  const resolver = createLyricsResolver({now: () => clock, load: async () => ++calls === 1 ? {status: "matched", track: original, provider: "lrclib"} : {status: "missing", reason: "index unavailable"}});
  const identity = {title: "Finesse", artist: "Bruno Mars", durationSeconds: 191};
  const verified = await resolver(identity);
  clock = 31 * 24 * 60 * 60 * 1000;
  assert.deepEqual(await resolver(identity), verified);
  assert.equal(calls, 2);
});

test("cached readings survive a refresh of identical original lyrics", () => {
  const originalLyrics: PlayerLyrics = {lines: [{text: "君の声", start: 1, end: 3, romanized: "kimi no koe", readingEngine: JAPANESE_READING_VERSION}], timing: "synced", provider: "lrclib", providerTrackId: 1, schemaVersion: "verified-lyrics-v3", hasJapanese: true};
  const fresh = {...originalLyrics, lines: [{text: "君の声", start: 1, end: 3}], provider: "netease"};
  assert.equal(preserveLyricReadings(originalLyrics, fresh).lines[0].romanized, "kimi no koe");
  assert.equal(preserveLyricReadings(originalLyrics, {...fresh, lines: [{text: "君の声", start: 2, end: 3}]}).lines[0].romanized, undefined);
  assert.equal(preserveLyricReadings(originalLyrics, {...fresh, lines: [{text: "違う声", start: 1, end: 3}]}).lines[0].romanized, undefined);
});

test("lyric retry policy waits for reset and does not retry invalid or expired sessions", () => {
  assert.equal(lyricRetryDelay(0, 429, 90_000), 90_000);
  assert.equal(lyricRetryDelay(0, 503), 5000);
  assert.equal(lyricRetryDelay(8, 503), 60_000);
  assert.equal(lyricRetryDelay(0, 404), 45_000);
  assert.equal(lyricRetryDelay(0, 401), undefined);
  assert.equal(lyricRetryDelay(0, 409), undefined);
});


test("lyrics.ovh encodes exact title and artist and returns only untimed original text", async () => {
  let requested = "";
  const result = await fetchLyricsOvh({title: "Song / One", artist: "Artist & Voice", durationSeconds: 180}, {fetch: async url => {
    requested = String(url); return Response.json({lyrics: "First line\r\nSecond line"});
  }});
  assert.equal(requested, "https://api.lyrics.ovh/v1/Artist%20%26%20Voice/Song%20%2F%20One");
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.provider, "lyrics.ovh");
    assert.equal(result.track.plainLyrics, "First line\nSecond line");
    assert.equal(result.track.syncedLyrics, null);
    assert.equal(result.track.duration, undefined);
  }
});

test("plain fallback runs after every primary source completes and cannot displace a match", async () => {
  const completed: string[] = [];
  const identity = {title: "Finesse", artist: "Bruno Mars"};
  const result = await fetchVerifiedLyrics(identity, {providers: [
    async () => {completed.push("first");return {status:"missing",reason:"empty"};},
    async () => {await Promise.resolve();completed.push("second");return {status:"unavailable",reason:"offline"};},
  ],plainFallback: async () => {
    assert.deepEqual(new Set(completed), new Set(["first","second"]));
    return {status:"matched",provider:"lyrics.ovh",track:{...original,syncedLyrics:null}};
  }});
  assert.equal(result.status,"matched");
  let fallbackCalls = 0;
  const primary = await fetchVerifiedLyrics(identity, {providers:[async () => ({status:"matched",provider:"lrclib",track:original})],plainFallback:async()=>{
    fallbackCalls++;return {status:"missing",reason:"empty"};
  }});
  assert.equal(primary.status,"matched");
  assert.equal(fallbackCalls,0);
});

test("OVH misses do not conceal a primary rate limit and OVH failures remain retryable", async () => {
  const identity = {title:"Finesse",artist:"Bruno Mars"};
  const rateLimited = await fetchVerifiedLyrics(identity,{providers:[async()=>({status:"unavailable",reason:"rate limited",retryAfterMs:60000})],plainFallback:async()=>({status:"missing",reason:"empty"})});
  assert.equal(rateLimited.status,"unavailable");
  assert.equal(rateLimited.retryAfterMs,60000);
  const thrown = await fetchVerifiedLyrics(identity,{providers:[async()=>({status:"missing",reason:"empty"})],plainFallback:async()=>{throw new TypeError("network");}});
  assert.equal(thrown.status,"unavailable");
  const missing = await fetchVerifiedLyrics(identity,{providers:[async()=>({status:"missing",reason:"empty"})],plainFallback:async()=>({status:"missing",reason:"empty"})});
  assert.equal(missing.status,"missing");
});

test("OVH never substitutes translated words for requested Japanese lyrics",async()=>{
  const result = await fetchLyricsOvh({title:"Idol",artist:"YOASOBI",language:"ja"},{fetch:async()=>Response.json({lyrics:"English translation"})});
  assert.equal(result.status,"missing");
});
