import test from "node:test";
import assert from "node:assert/strict";
import { isSyncedLyricText, lyricStudioError, lyricStudioLines, lrcTimestamp, readStudioDraft, recoverStudioTiming, stampStudioLine, timedStudioText } from "../src/rebuild/player/lyricStudio";
import { parseTimedLyrics } from "../src/rebuild/lyrics/parse";

test("tap timing records ordered media time and rejects skipped lines or backwards seeks", () => {
  const first = stampStudioLine([null, null, null], 0, 1234)!;
  assert.deepEqual(first, [1.23, null, null]);
  assert.equal(stampStudioLine(first, 2, 4000), undefined);
  assert.equal(stampStudioLine(first, 1, 900), undefined);
  assert.equal(stampStudioLine([1, null, 5], 1, 6000), undefined);
  const next = stampStudioLine(first, 1, 4012)!;
  const complete = stampStudioLine(next, 2, 7100)!;
  assert.deepEqual(parseTimedLyrics(timedStudioText(["First", "Second", "Third"], complete)).map(line => [line.text, line.start]), [["First", 1.23], ["Second", 4.01], ["Third", 7.1]]);
});
test("timestamp rounding carries into the next minute without invalid seconds", () => {
  assert.equal(lrcTimestamp(59.999), "[01:00.00]");
  assert.equal(lrcTimestamp(600.123), "[10:00.12]");
  assert.equal(lrcTimestamp(-1), "[00:00.00]");
});
test("preview and capture preserve text identity without adding invented timings", () => {
  assert.deepEqual(lyricStudioLines(" First\r\n\r\n Second ", "plain"), ["First", "Second"]);
  assert.deepEqual(lyricStudioLines("[00:01]First\n[00:03]Second", "lrc"), ["First", "Second"]);
  assert.equal(timedStudioText(["First", "Second"], [1, null]), "[00:01.00]First");
});
test("complete pasted LRC is recognized as already synced while partial or plain lyrics are not", () => {
  assert.equal(isSyncedLyricText("[ar:Artist]\n[00:01.00]First\n[00:03.25]Second"), true);
  assert.equal(isSyncedLyricText("[00:01.00]<00:01.10>First <00:01.50>line"), true);
  assert.equal(isSyncedLyricText("[00:01.00]First\nSecond"), false);
  assert.equal(isSyncedLyricText("First\nSecond"), false);
});
test("client validation refuses partially parsed LRC and timestamps outside the recording", () => {
  assert.match(lyricStudioError("[00:12]First\nSecond", "lrc", 30000)!, /every lyric line/);
  assert.match(lyricStudioError("[00:90]First", "lrc", 30000)!, /timestamp/);
  assert.match(lyricStudioError("[00:12][00:90]First", "lrc", 30000)!, /timestamp/);
  assert.match(lyricStudioError("[00:42]First", "lrc", 30000)!, /beyond this song/);
  assert.match(lyricStudioError("[00:01]<00:99>First", "lrc", 30000)!, /word timestamp/i);
  assert.match(lyricStudioError("[00:01]<00:04>First <00:02>Second", "lrc", 30000)!, /move forward/);
  assert.match(lyricStudioError("[00:01]<00:04>First\n[00:03]Second", "lrc", 30000)!, /within their lyric line/);
  assert.match(lyricStudioError("[00:01]<00:45>First", "lrc", 30000)!, /within their lyric line/);
  assert.equal(lyricStudioError("[00:12.50]First\n[00:20.20]Second", "lrc", 30000), undefined);
  assert.match(lyricStudioError(Array(401).fill("word").join("\n"), "plain", 30000)!, /400 lines/);
});
test("saved drafts restore exact partial work and reject corrupt timing", () => {
  const valid = { text: "First\nSecond", format: "plain", lines: ["First", "Second"], times: [1.5, null], savedAt: 20 };
  let data = JSON.stringify(valid);
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => data } });
  try {
    assert.deepEqual(readStudioDraft("fixture"), valid);
    data = JSON.stringify({ ...valid, times: [10, 1] }); assert.equal(readStudioDraft("fixture"), undefined);
    data = JSON.stringify({ ...valid, times: [1] }); assert.equal(readStudioDraft("fixture"), undefined);
    data = "{"; assert.equal(readStudioDraft("fixture"), undefined);
  } finally { if (prior) Object.defineProperty(globalThis, "localStorage", prior); else Reflect.deleteProperty(globalThis, "localStorage"); }
});
test("reopening keeps partial and complete timing and resumes before the next untimed line", () => {
  const source = { lines: ["First", "Second", "Third"], times: [2.25, 4.5, null] };
  const resumed = recoverStudioTiming("First\nSecond\nThird", "plain", source);
  assert.deepEqual(resumed.times, source.times); assert.equal(resumed.positionMs, 3000); assert.equal(resumed.complete, false);
  const completed = recoverStudioTiming("First\nSecond\nThird", "plain", { ...source, times: [2.25, 4.5, 8.75] });
  assert.equal(completed.complete, true); assert.deepEqual(completed.times, [2.25, 4.5, 8.75]);
  const editedLrc = recoverStudioTiming("[00:02.25]First\n[00:04.50]Second", "lrc", { lines: [], times: [] });
  assert.equal(editedLrc.complete, true); assert.deepEqual(editedLrc.times, [2.25, 4.5]);
});
test("changing manuscript words invalidates their old timing without losing the new text", () => {
  const recovered = recoverStudioTiming("Changed first\nSecond", "plain", { lines: ["First", "Second"], times: [1, 3] });
  assert.deepEqual(recovered.lines, ["Changed first", "Second"]); assert.deepEqual(recovered.times, [null, null]);
  assert.equal(recovered.complete, false);
});
test("repairing a mixed LRC import by tap timing preserves all its unstamped words", () => {
  assert.deepEqual(lyricStudioLines("[ar:Artist]\n[00:01]First\nSecond without a timestamp\n[00:04]Third", "lrc"), ["First", "Second without a timestamp", "Third"]);
  assert.deepEqual(recoverStudioTiming("[00:01]First\nSecond", "lrc").times, [null, null]);
});
