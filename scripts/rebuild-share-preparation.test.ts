import assert from "node:assert/strict";
import { test } from "node:test";
import type { MusicTrack } from "../src/rebuild/app/types";
import { ShareAudioPreparation, shareAudioSourceKey } from "../src/rebuild/player/sharePreparation";
import { shareCardKey, shareVideoKey } from "../src/rebuild/player/shareRender";

const track = { id: "recording", title: "Fixture", artists: ["Fixture artist"], coverUrl: null, versionLabel: "Original recording",
  reference: { provider: "deezer", id: "123" }, audioUrl: "https://example.test/audio.mp3" } as MusicTrack;
const buffer = { length: 48_000, numberOfChannels: 2 } as AudioBuffer;

test("share preparation coalesces consumers without canceling the remaining export", async () => {
  let calls = 0, providerSignal: AbortSignal | undefined, finish!: (buffer: AudioBuffer) => void;
  const preparation = new ShareAudioPreparation({ load: async (_track, _account, signal) => {
    calls++; providerSignal = signal; return new Promise(resolve => { finish = resolve; });
  } });
  try {
    const first = new AbortController(), second = new AbortController();
    const a = preparation.prepare(track, "account", first.signal);
    const rejected = assert.rejects(a, { name: "AbortError" });
    const b = preparation.prepare(track, "account", second.signal);
    await new Promise(resolve => setImmediate(resolve));
    first.abort();
    await rejected;
    assert.equal(providerSignal?.aborted, false);
    finish(buffer);
    assert.equal(await b, buffer);
    assert.equal(await preparation.prepare(track, "account", second.signal), buffer);
    assert.equal(calls, 1);
  } finally { preparation.clear(); }
});

test("prepared audio varies by account and exact active source and expires", async () => {
  let now = 0, calls = 0;
  const preparation = new ShareAudioPreparation({ now: () => now, retainMs: 100, load: async () => { calls++; return buffer; } });
  const signal = new AbortController().signal;
  try {
    await preparation.prepare(track, "one", signal);
    await preparation.prepare(track, "one", signal);
    await preparation.prepare(track, "two", signal);
    await preparation.prepare({ ...track, audioUrl: "blob:different-file" }, "two", signal);
    assert.equal(calls, 3);
    now = 101;
    await preparation.prepare({ ...track, audioUrl: "blob:different-file" }, "two", signal);
    assert.equal(calls, 4);
    assert.notEqual(shareAudioSourceKey(track, "one"), shareAudioSourceKey(track, "two"));
  } finally { preparation.clear(); }
});

test("closing preparation aborts work and late native decode cannot resurrect the cache", async () => {
  let calls = 0, providerSignal: AbortSignal | undefined, finish!: (value: AudioBuffer) => void;
  const preparation = new ShareAudioPreparation({ load: async (_track, _account, signal) => {
    calls++; providerSignal = signal;
    return calls === 1 ? new Promise(resolve => { finish = resolve; }) : buffer;
  } });
  const signal = new AbortController().signal;
  try {
    const pending = preparation.prepare(track, "one", signal);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await new Promise(resolve => setImmediate(resolve));
    preparation.clear();
    assert.equal(providerSignal?.aborted, true);
    finish(buffer);
    await rejected;
    await preparation.prepare(track, "one", signal);
    assert.equal(calls, 2);
  } finally { preparation.clear(); }
});

test("large decoded audio is usable once but never retained; remote intent does not download audio", async () => {
  let calls = 0;
  const preparation = new ShareAudioPreparation({ maxBytes: 1, load: async () => { calls++; return buffer; } });
  const signal = new AbortController().signal;
  try {
    assert.equal(await preparation.warm(track, "one", signal), null);
    assert.equal(calls, 0);
    await preparation.prepare(track, "one", signal);
    await preparation.prepare(track, "one", signal);
    assert.equal(calls, 2);
  } finally { preparation.clear(); }
});

test("ready card survives canonical ID resolution while video keys bind time and source", () => {
  const input = { track, lines: [], colorMode: "light" as const, layout: "square" as const };
  assert.equal(shareCardKey(input), shareCardKey({ ...input, track: { ...track, id: "canonical-id" } }));
  assert.notEqual(shareVideoKey(input, "one", 0, 8), shareVideoKey(input, "one", 2, 8));
  assert.notEqual(shareVideoKey(input, "one", 0, 8), shareVideoKey({ ...input, track: { ...track, audioUrl: "blob:replacement" } }, "one", 0, 8));
  assert.notEqual(shareCardKey(input), shareCardKey({ ...input, track: { ...track, coverUrl: "https://example.test/changed.png" } }));
});
