import assert from "node:assert/strict";
import { test } from "node:test";
import { lyricIsInView, lyricMoment, lyricReadingViewport, lyricScrollTarget } from "../src/rebuild/player/lyricFollow";

test("Current words rejoin following only when their reading centre is visible", () => {
  const viewport = { top: 100, bottom: 500 };
  assert.equal(lyricIsInView({ top: 180, bottom: 260 }, viewport), true);
  assert.equal(lyricIsInView({ top: 20, bottom: 120 }, viewport), false);
  assert.equal(lyricIsInView({ top: 480, bottom: 580 }, viewport), false);
  assert.equal(lyricIsInView({ top: 510, bottom: 590 }, viewport), false);
  assert.equal(lyricIsInView({ top: 90, bottom: 650 }, viewport), true, "a long verse need not fit entirely");
  assert.equal(lyricIsInView({ top: 0, bottom: 0 }, viewport), false, "hidden lines cannot resume following");
});

test("The sticky transport is excluded from the lyric reading viewport", () => {
  assert.deepEqual(lyricReadingViewport({ top: 100, bottom: 700 }, { top: 570, bottom: 700 }), { top: 112, bottom: 558 });
  assert.equal(lyricIsInView({ top: 580, bottom: 620 }, lyricReadingViewport({ top: 100, bottom: 700 }, { top: 570, bottom: 700 })), false);
  assert.deepEqual(lyricReadingViewport({ top: 100, bottom: 700 }, { top: 800, bottom: 900 }), { top: 112, bottom: 688 });
});

test("Following places the verse in the reading region and never scrolls above the start", () => {
  assert.equal(lyricScrollTarget(200, { top: 500, bottom: 600 }, { top: 100, bottom: 600 }), 450);
  assert.equal(lyricScrollTarget(0, { top: 100, bottom: 150 }, { top: 100, bottom: 600 }), 0);
});

test("Instrumental timestamps retain their own active scroll anchor", () => {
  const lines = [{ start: 2, end: 5, text: "First words" }, { start: 5, end: 9, text: "" }, { start: 9, end: 12, text: "Next words" }];
  assert.deepEqual(lyricMoment(lines, 0), { index: 0, kind: "intro" });
  assert.deepEqual(lyricMoment(lines, 2), { index: 0, kind: "line" });
  assert.deepEqual(lyricMoment(lines, 7), { index: 1, kind: "interlude" });
  assert.deepEqual(lyricMoment(lines, 9), { index: 2, kind: "line" });
  assert.deepEqual(lyricMoment(lines, 13), { index: 2, kind: "outro" });
  assert.deepEqual(lyricMoment([], 0), { index: -1, kind: "empty" });
  assert.deepEqual(lyricMoment(lines, Number.NaN), { index: -1, kind: "empty" });
});

test("Seeking backwards and repeated timestamps find the correct moment", () => {
  const lines = [{ start: 0, text: "a" }, { start: 0, text: "b" }, { start: 20, text: "c" }, { start: 40, text: "d" }];
  assert.deepEqual(lyricMoment(lines, 45), { index: 3, kind: "line" });
  assert.deepEqual(lyricMoment(lines, 5), { index: 1, kind: "line" });
});
