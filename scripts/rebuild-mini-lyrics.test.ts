import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricFlights } from "../src/rebuild/player/lyricFlight";
import { miniLyricCue } from "../src/rebuild/player/miniLyric";

test("mini player lyrics follow seeks, silent intervals and simultaneous multilingual lines", () => {
  const lines = [
    { text: "hello", start: 2, end: 5 }, { text: "", start: 5, end: 8 },
    { text: "君の声", start: 8, end: 11 }, { text: "네 목소리", start: 8, end: 11 },
    { text: "goodbye", start: 11, end: 14 },
  ];
  assert.equal(miniLyricCue(lines, 1000), null);
  assert.equal(miniLyricCue(lines, 5000), null);
  assert.equal(miniLyricCue(lines, 7000), null);
  assert.equal(miniLyricCue(lines, 8000)?.text, "君の声 · 네 목소리");
  assert.equal(miniLyricCue(lines, 11000)?.text, "goodbye");
  assert.equal(miniLyricCue(lines, 2500)?.text, "hello");
  assert.equal(miniLyricCue(lines, 14000), null);
  assert.equal(miniLyricCue(lines, Number.NaN), null);
});

test("mini and fullscreen lyric subscribers coalesce; closing one retains the other", async () => {
  const flights = new LyricFlights<string>();
  let resolve!: (value: string) => void;
  let calls = 0;
  let signal!: AbortSignal;
  const load = (value: AbortSignal) => { calls++; signal = value; return new Promise<string>(done => { resolve = done; }); };
  const mini = flights.acquire("same recording", load), full = flights.acquire("same recording", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  mini.release(); mini.release();
  assert.equal(signal.aborted, false);
  resolve("the same words");
  assert.equal(await full.promise, "the same words");
  assert.equal(await mini.promise, "the same words");
  full.release();
});

test("a switched recording cancels abandoned lyric work and permits a fresh retry", async () => {
  const flights = new LyricFlights<string>();
  let signal!: AbortSignal;
  const first = flights.acquire("old", value => {
    signal = value;
    return new Promise<string>((_, reject) => value.addEventListener("abort", () => reject(value.reason), { once: true }));
  });
  await Promise.resolve();
  const failure = assert.rejects(first.promise, { name: "AbortError" });
  first.release();
  assert.equal(signal.aborted, true);
  await failure;
  const retry = flights.acquire("old", async () => "fresh"), next = flights.acquire("next", async () => "another recording");
  assert.equal(await retry.promise, "fresh");
  assert.equal(await next.promise, "another recording");
  retry.release(); next.release();
});

test("failed lyric requests do not poison subsequent opens", async () => {
  const flights = new LyricFlights<string>();
  const failed = flights.acquire("same", async () => { throw new Error("temporary disconnect"); });
  await assert.rejects(failed.promise, /temporary disconnect/);
  failed.release();
  const retry = flights.acquire("same", async () => "recovered");
  assert.equal(await retry.promise, "recovered");
  retry.release();
});
