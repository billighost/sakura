import assert from "node:assert/strict";
import test from "node:test";
import { holdMoved, horizontalIntent, sheetDismissIntent, songSwipeDirection } from "../src/rebuild/app/gestureIntent";

test("song swipes give vertical scrolling and ambiguous diagonal movement priority", () => {
  assert.equal(horizontalIntent(7, 3), "pending");
  assert.equal(horizontalIntent(18, 44), "vertical");
  assert.equal(songSwipeDirection(-120, 130, 300, -2), null);
  assert.equal(songSwipeDirection(-70, 8, 300), "next");
  assert.equal(songSwipeDirection(70, 8, 300), "previous");
});

test("a short intentional flick changes songs but an accidental drag or reversal does not", () => {
  assert.equal(songSwipeDirection(-31, 4, 600, -.8), "next");
  assert.equal(songSwipeDirection(-18, 2, 600, -2), null);
  assert.equal(songSwipeDirection(-35, 4, 600, .8), null);
  assert.equal(songSwipeDirection(-35, 4, 600, 0), null);
});

test("sheet dismissal requires a downward pull and ignores sideways and upward movement", () => {
  assert.equal(sheetDismissIntent(4, 150, 900), true);
  assert.equal(sheetDismissIntent(4, 48, 900, .9), true);
  assert.equal(sheetDismissIntent(4, 48, 900), false);
  assert.equal(sheetDismissIntent(120, 90, 900, 2), false);
  assert.equal(sheetDismissIntent(0, -200, 900, 2), false);
});

test("long presses tolerate hand tremor but cancel once a scroll begins", () => {
  assert.equal(holdMoved(4, 4), false);
  assert.equal(holdMoved(0, 10), true);
  assert.equal(holdMoved(7, 7), true);
});
