import assert from "node:assert/strict";
import test from "node:test";
import { appendAutoplay, needsAutoplay } from "../src/rebuild/app/autoplay";
import type { MusicTrack, QueueEntry } from "../src/rebuild/app/types";
const song = (id: string) => ({ id, title: id } as MusicTrack);
const entry = (id: string, priority: "manual" | "automatic" = "automatic"): QueueEntry => ({ entryId: "entry-" + id, track: song(id), priority });
const identity = (track: MusicTrack) => track.id;
let occurrence = 0;
const nextId = () => "autoplay-" + occurrence++;

test("continuation prepares before exhaustion and never runs without a current occurrence", () => {
  assert.equal(needsAutoplay([entry("one")], "entry-one"), true);
  assert.equal(needsAutoplay([entry("one"), ...["two", "three", "four", "five"].map(id => entry(id))], "entry-one"), false);
  assert.equal(needsAutoplay([entry("one")], null), false);
});
test("personalized additions preserve manual future choices and avoid queued and current songs", () => {
  const original = [entry("past"), entry("current"), entry("my-pick", "manual"), entry("album-next")];
  const result = appendAutoplay(original, "entry-current", ["current", "my-pick", "new", "new", "another"].map(song), identity, nextId);
  assert.deepEqual(result.slice(0, 4), original);
  assert.deepEqual(result.slice(4).map(item => item.track.id), ["new", "another"]);
  assert.ok(result.slice(4).every(item => item.priority === "automatic" && item.context === "autoplay"));
});
test("a long listening session retires old played history without truncating intentional future picks", () => {
  const history = Array.from({ length: 78 }, (_, index) => entry(String(index)));
  const current = entry("current"), manual = entry("my-pick", "manual");
  const result = appendAutoplay([...history, current, manual], current.entryId, [song("new")], identity, nextId);
  assert.equal(result.length, 15);
  assert.equal(result[12], current); assert.equal(result[13], manual); assert.equal(result[14].track.id, "new");
});
test("an exhausted offline shelf cycles older downloads after fresh choices and gives songs separate occurrences", () => {
  let queue = [entry("first"), entry("second")];
  queue = appendAutoplay(queue, "entry-second", [song("first"), song("second"), song("fresh")], identity, nextId, { allowReplay: true, localOnly: true });
  assert.deepEqual(queue.slice(2).map(item => item.track.id), ["fresh", "first"]);
  assert.ok(queue.slice(2).every(item => item.localOnly));
  assert.notEqual(queue[3].entryId, queue[0].entryId);
});
test("one downloaded recording can continue with a new occurrence while an unavailable shelf stays empty", () => {
  const only = [entry("only")];
  const result = appendAutoplay(only, only[0].entryId, [song("only")], identity, nextId, { allowReplay: true, localOnly: true });
  assert.equal(result.length, 2); assert.notEqual(result[0].entryId, result[1].entryId);
  assert.equal(appendAutoplay(only, only[0].entryId, [], identity, nextId, { allowReplay: true }), only);
});
