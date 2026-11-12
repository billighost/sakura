import assert from "node:assert/strict";
import { test } from "node:test";
import type { MusicTrack } from "../src/rebuild/app/types";
import { prefetchLyrics, invalidateLyricsAfterPublication } from "../src/rebuild/player/useLyrics";

const track = (title: string) => ({ id: title, title, artists: ["Artist"], artistCredits: [{ name: "Guest" }], durationMs: 180_000, albumTitle: "Album", versionLabel: "Original recording", language: "ja" }) as MusicTrack;
const payload = (text = "Fixture words") => ({ schemaVersion: "verified-lyrics-v3", provider: "fixture", providerTrackId: 1, timing: "synced", lines: [{ text, start: 1 }] });

test("lyric intent preparation shares one request, preserves all credits/language and reuses the cache", async () => {
  const previous = globalThis.fetch;
  let calls = 0, query: URLSearchParams | undefined;
  globalThis.fetch = async address => { calls++; query = new URL(String(address), "https://sakura.test").searchParams; return Response.json(payload()); };
  try {
    const song = track("prefetch-shared");
    const [first, second] = await Promise.all([prefetchLyrics(song, new AbortController().signal), prefetchLyrics(song, new AbortController().signal)]);
    assert.equal(calls, 1); assert.deepEqual(first?.lines, second?.lines);
    assert.deepEqual(query?.getAll("artist"), ["Artist", "Guest"]); assert.equal(query?.get("language"), "ja");
    await prefetchLyrics({ ...song, id: "canonical-id" }, new AbortController().signal);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test("canceling one lyric prefetch leaves its second consumer active", async () => {
  const previous = globalThis.fetch;
  let finish!: (response: Response) => void, sharedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_address, options) => { sharedSignal = options?.signal; return new Promise(resolve => { finish = resolve; }); };
  try {
    const song = track("prefetch-cancellation"), one = new AbortController(), two = new AbortController();
    const first = prefetchLyrics(song, one.signal), rejected = assert.rejects(first, { name: "AbortError" });
    const second = prefetchLyrics(song, two.signal);
    await new Promise(resolve => setImmediate(resolve));
    one.abort(); await rejected; assert.equal(sharedSignal?.aborted, false);
    finish(Response.json(payload())); assert.equal((await second)?.lines[0].text, "Fixture words");
  } finally { globalThis.fetch = previous; }
});

test("publication acceptance clears a confirmed negative and aborts pre-publication flights", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({ status: "missing" }, { status: 404 }) : Response.json(payload("Published fixture")); };
  try {
    const song = track("prefetch-publication");
    await assert.rejects(prefetchLyrics(song, new AbortController().signal));
    await prefetchLyrics(song, new AbortController().signal); assert.equal(calls, 1);
    await invalidateLyricsAfterPublication(song);
    assert.equal((await prefetchLyrics(song, new AbortController().signal))?.lines[0].text, "Published fixture");
    assert.equal(calls, 2);

    const race = track("prefetch-publication-race");
    let oldResponse!: (response: Response) => void;
    globalThis.fetch = async () => new Promise(resolve => { oldResponse = resolve; });
    const old = prefetchLyrics(race, new AbortController().signal), oldRejected = assert.rejects(old, { name: "AbortError" });
    await new Promise(resolve => setImmediate(resolve));
    await invalidateLyricsAfterPublication(race);
    globalThis.fetch = async () => Response.json(payload("New publication"));
    assert.equal((await prefetchLyrics(race, new AbortController().signal))?.lines[0].text, "New publication");
    oldResponse(Response.json({ status: "missing" }, { status: 404 })); await oldRejected;
    assert.equal((await prefetchLyrics(race, new AbortController().signal))?.lines[0].text, "New publication");
  } finally { globalThis.fetch = previous; }
});

test("provider failures are retried instead of cached as missing lyrics", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({ status: "unavailable" }, { status: 503 }) : Response.json(payload()); };
  try {
    const song = track("prefetch-provider-outage");
    await assert.rejects(prefetchLyrics(song, new AbortController().signal));
    assert.equal((await prefetchLyrics(song, new AbortController().signal))?.timing, "synced"); assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});
