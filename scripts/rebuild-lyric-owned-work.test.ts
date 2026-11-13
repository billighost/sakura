import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricMemory } from "../src/rebuild/player/lyricMemory";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import { createReadingTransformCache } from "../src/rebuild/lyrics/readingTransforms";
import { readingEngine } from "../src/rebuild/lyrics/language";
import { AbortableAdmission } from "../src/rebuild/server/abortableAdmission";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("lyric generations retire with evicted values but live writers preserve their fence", () => {
  const cache = new LyricMemory<{ key: string; text: string }>(2, 1000);
  const old = cache.acquire("song"), before = old.write();
  cache.set({ key: "song", text: "current" }); cache.delete("song");
  assert.equal(cache.writeCurrent(before), true);
  const publication = cache.acquire("song"); publication.publish();
  assert.equal(cache.publicationCurrent(before), false);
  publication.release(); old.release();
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0, generations: 0 });
  const fresh = cache.acquire("song"); fresh.write();
  assert.equal(cache.writeCurrent(before), false, "equal numeric revisions cannot resurrect a retired generation");
  fresh.release();
  for (let index = 0; index < 1000; index++) { const owner = cache.acquire(String(index)); cache.set({ key: String(index), text: "saved" }); owner.release(); }
  assert.equal(cache.stats().entries, 2); assert.equal(cache.stats().generations, 2);
});

test("decoded lyric retention respects bytes without deleting a live reader", () => {
  const cache = new LyricMemory<{ key: string; text: string }>(128, 300);
  const reader = cache.acquire("active"); cache.set({ key: "active", text: "x".repeat(60) });
  for (let index = 0; index < 100; index++) cache.set({ key: String(index), text: "x".repeat(60) });
  assert.ok(cache.get("active")); assert.ok(cache.stats().bytes <= 300);
  reader.release();
  cache.set({ key: "enormous", text: "x".repeat(1000) }); assert.equal(cache.get("enormous"), undefined);
  assert.ok(cache.stats().bytes <= 300);
});

test("server lyric cancellation is independent and abandoned late negatives never cache", async () => {
  let calls = 0, signal: AbortSignal | undefined, finish!: (value: { status: "missing"; reason: string }) => void;
  const resolver = createLyricsResolver({ load: async (_identity, supplied) => { calls++; signal = supplied; return new Promise(resolve => { finish = resolve; }); } });
  const identity = { title: "Owned server lookup", artist: "Fixture" }, one = new AbortController(), two = new AbortController();
  const first = resolver(identity, false, one.signal), rejected = assert.rejects(first, { name: "AbortError" });
  const second = resolver(identity, false, two.signal); await turn();
  one.abort(); await rejected; assert.equal(signal?.aborted, false); assert.equal(calls, 1);
  const secondRejected = assert.rejects(second, { name: "AbortError" }); two.abort(); await secondRejected;
  assert.equal(signal?.aborted, true); finish({ status: "missing", reason: "abandoned" }); await turn();
  const retry = resolver(identity); await turn(); assert.equal(calls, 2); finish({ status: "missing", reason: "confirmed" });
  assert.equal((await retry).status, "missing");
});

test("accepted publication changes server flight identity even before provider indexing", async () => {
  let calls = 0; const completions: Array<(value: { status: "missing"; reason: string }) => void> = [];
  const resolver = createLyricsResolver({ load: () => { calls++; return new Promise(resolve => completions.push(resolve)); } });
  const identity = { title: "Publication boundary", artist: "Fixture" };
  const old = resolver(identity), oldRejected = assert.rejects(old, { name: "AbortError" }); await turn();
  resolver.invalidate(identity);
  const fresh = resolver(identity, true); await turn(); assert.equal(calls, 2);
  completions[0]({ status: "missing", reason: "old publication index" }); await oldRejected;
  completions[1]({ status: "missing", reason: "current checked index" }); assert.equal((await fresh).status, "missing");
});

test("reading consumers cancel independently and preserve their own word/timing fields", async () => {
  let calls = 0, signal: AbortSignal | undefined, finish!: () => void;
  const cache = createReadingTransformCache({ transform: async (lines, language, supplied) => {
    calls++; signal = supplied; await new Promise<void>(resolve => { finish = resolve; });
    return lines.map(line => ({ romanized: line.text, readingReviewNeeded: false, readingEngine: readingEngine(language) }));
  } });
  const one = new AbortController(), two = new AbortController();
  const first = cache([{ text: "same", start: 1 }], "ko", { signal: one.signal }), rejected = assert.rejects(first, { name: "AbortError" });
  const second = cache([{ text: "same", start: 9, words: [{ text: "same", start: 9.5 }] }], "ko", { signal: two.signal });
  await turn(); one.abort(); await rejected; assert.equal(signal?.aborted, false); assert.equal(calls, 1);
  finish(); const result = await second; assert.equal(result[0].start, 9); assert.deepEqual(result[0].words, [{ text: "same", start: 9.5 }]);
});

test("cancellable admission does not start departed queued work or exceed unfinished work slots", async () => {
  const admission = new AbortableAdmission(1, 1), active = new AbortController(), queued = new AbortController();
  let finish!: () => void, starts = 0;
  const first = admission.run(active.signal, async () => { starts++; await new Promise<void>(resolve => { finish = resolve; }); });
  const waiting = admission.run(queued.signal, async () => { starts++; }), rejected = assert.rejects(waiting, { name: "AbortError" });
  await assert.rejects(admission.run(new AbortController().signal, async () => {}), /busy/);
  queued.abort(); await rejected; assert.equal(starts, 1); assert.deepEqual(admission.stats(), { active: 1, waiting: 0 });
  active.abort(); assert.equal(admission.stats().active, 1, "ignored cancellation retains its unfinished slot");
  finish(); await first; assert.deepEqual(admission.stats(), { active: 0, waiting: 0 });
});
