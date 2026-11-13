import assert from "node:assert/strict";
import { test } from "node:test";
import { prefetchLyrics, prefetchPreferredReadings, prefetchReadings, lyricCacheMemoryStats } from "../src/rebuild/player/useLyrics";
import { readingEngine } from "../src/rebuild/lyrics/language";
import type { MusicTrack } from "../src/rebuild/app/types";

const track = (title: string) => ({ id: title, title, artists: ["Fixture"], durationMs: 180000, albumTitle: "Album", language: "ja" }) as MusicTrack;
const source = { schemaVersion: "verified-lyrics-v3", provider: "fixture", providerTrackId: 1, timing: "synced", lines: [{ text: "君の声", start: 1, end: 3 }] };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("one thousand persisted lyric reads bound decoded values and retire unused generations", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"), navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let reads = 0;
  const db = { close() {}, transaction() { return { objectStore() { return {
    get(key: string) {
      reads++; const request: { result?: unknown; onsuccess?: () => void } = {};
      queueMicrotask(() => { request.result = { key, savedAt: Date.now(), data: source }; request.onsuccess?.(); }); return request;
    },
  }; } }; } };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { const request: { result: typeof db; onsuccess?: () => void } = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request; } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  try {
    const songs = Array.from({ length: 1000 }, (_, index) => track("persisted-owned-" + index)), signal = new AbortController().signal;
    for (const song of songs) await prefetchLyrics(song, signal);
    assert.equal(reads, 1000);
    assert.ok(lyricCacheMemoryStats().entries <= 128); assert.ok(lyricCacheMemoryStats().generations <= 128);
    const before = reads; await prefetchLyrics(songs[0], signal);
    assert.equal(reads, before + 1, "an evicted decoded value must be read from durable storage again");
  } finally {
    // Retire the cached native connection before restoring the globals.
    (db as typeof db & { onversionchange?: () => void }).onversionchange?.();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB");
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator); else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("preferred preparation makes no pronunciation request when disabled and reuses visible reads", async () => {
  const original = globalThis.fetch; let lyrics = 0, readings = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("/api/v2/lyrics?")) { lyrics++; return Response.json(source); }
    readings++; const body = JSON.parse(String(options?.body));
    assert.equal(new Headers(options?.headers).get("X-Sakura-Account"), "fixture-account");
    return Response.json({ engine: readingEngine(body.language), lines: body.lines.map((line: object) => ({ ...line, romanized: "kimi no koe", readingEngine: readingEngine(body.language), readingReviewNeeded: false })) });
  };
  try {
    const song = track("preferred-owned"), signal = new AbortController().signal;
    await prefetchPreferredReadings(song, { japaneseReading: false }, signal, "fixture-account");
    assert.equal(readings, 0);
    await prefetchPreferredReadings(song, { japaneseReading: true }, signal, "fixture-account");
    assert.equal(lyrics, 1); assert.equal(readings, 1);
    await prefetchReadings(song, "ja", signal, "fixture-account"); assert.equal(readings, 1);
  } finally { globalThis.fetch = original; }
});

test("one saved reading preference prepares Japanese, Chinese and Korean songs and preserves lyric timing", async () => {
  const original = globalThis.fetch;
  const originals = {
    ja: [{ text: "君の声", start: 1, end: 3, words: [{ text: "君", start: 1, end: 2 }] }],
    zh: [{ text: "甜蜜蜜", start: 2, end: 5 }],
    ko: [{ text: "보고 싶다", start: 3, end: 7 }],
  };
  const requested: string[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("/api/v2/lyrics?")) {
      const language = new URL(String(url), "https://sakura.test").searchParams.get("language") as keyof typeof originals;
      return Response.json({ ...source, lines: originals[language] });
    }
    const body = JSON.parse(String(options?.body));
    requested.push(body.language);
    return Response.json({ engine: readingEngine(body.language), lines: body.lines.map((line: object) => ({ ...line, romanized: "saved pronunciation", readingEngine: readingEngine(body.language), readingReviewNeeded: false })) });
  };
  try {
    const signal = new AbortController().signal;
    for (const language of ["ja", "zh", "ko"] as const) {
      const song = { ...track("shared-preference-" + language), language };
      const disabled = await prefetchPreferredReadings(song, { japaneseReading: false, lyricReading: false }, signal, "fixture-account");
      assert.equal(disabled?.lines[0].romanized, undefined);
      const data = await prefetchPreferredReadings(song, { japaneseReading: true }, signal, "fixture-account");
      assert.equal(data?.readingLanguage, language);
      assert.equal(data?.lines[0].romanized, "saved pronunciation");
      assert.deepEqual(data?.lines.map(({ romanized, readingEngine, readingReviewNeeded, ...line }) => {
        void romanized; void readingEngine; void readingReviewNeeded; return line;
      }), originals[language]);
      await prefetchPreferredReadings(song, { lyricReading: true }, signal, "fixture-account");
    }
    assert.deepEqual(requested, ["ja", "zh", "ko"], "either legacy enabled flag applies across languages and completed readings are reused");
  } finally { globalThis.fetch = original; }
});

test("departing one reading owner preserves another; a departed last owner cannot save late readings", async () => {
  const original = globalThis.fetch; let complete!: (response: Response) => void, shared: AbortSignal | null | undefined, body: { language: string; lines: object[] };
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("/api/v2/lyrics?")) return Response.json(source);
    shared = options?.signal; body = JSON.parse(String(options?.body)); return new Promise(resolve => { complete = resolve; });
  };
  try {
    const song = track("reading-consumer-owned"), one = new AbortController(), two = new AbortController();
    await prefetchLyrics(song, two.signal);
    const first = prefetchReadings(song, "ja", one.signal), rejected = assert.rejects(first, { name: "AbortError" });
    const second = prefetchReadings(song, "ja", two.signal); await turn();
    one.abort(); await rejected; assert.equal(shared?.aborted, false);
    const secondRejected = assert.rejects(second, { name: "AbortError" }); two.abort(); await secondRejected;
    assert.equal(shared?.aborted, true);
    complete(Response.json({ engine: readingEngine("ja"), lines: body!.lines.map(line => ({ ...line, romanized: "abandoned", readingEngine: readingEngine("ja"), readingReviewNeeded: false })) }));
    await turn();
    const data = await prefetchLyrics(song, new AbortController().signal);
    assert.equal(data?.lines[0].romanized, undefined);
  } finally { globalThis.fetch = original; }
});
