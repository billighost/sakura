import assert from "node:assert/strict";
import { test } from "node:test";
import { StudioDraftWriter } from "../src/rebuild/player/studioDraftWriter";
import { PlaybackProgressStore } from "../src/rebuild/app/playbackProgress";
import { createPlaybackSelection } from "../src/rebuild/player/playbackSelection";
import { lyricMoment } from "../src/rebuild/player/lyricFollow";
import { shareLinkPayload } from "../src/rebuild/player/shareLinkIdentity";
import { artworkDimensions, artworkBitmapOptions } from "../src/rebuild/player/artworkDimensions";
import { shareAudioWorkingBytes } from "../src/rebuild/player/sharePreparation";
import { MAX_PREVIEW_WORKING_BYTES } from "../src/rebuild/audio/mediaInput";
import type { LyricStudioDraft } from "../src/rebuild/player/lyricStudio";
import type { MusicTrack } from "../src/rebuild/app/types";

const draft = (text: string) => ({ text, format: "plain" as const, lines: [text], times: [null] });
test("ordinary drafts coalesce at idle and flush within one second of uninterrupted input", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved: LyricStudioDraft[] = [], writer = new StudioDraftWriter(value => saved.push(value));
  for (let index = 0; index < 5; index++) { writer.update(draft(String(index))); t.mock.timers.tick(200); }
  assert.equal(saved.length, 1); assert.equal(saved[0].text, "4");
  writer.update(draft("last")); t.mock.timers.tick(249); assert.equal(saved.length, 1);
  t.mock.timers.tick(1); assert.equal(saved.length, 2); assert.equal(saved[1].text, "last");
});
test("tap snapshots, close/pagehide flush and publication fences preserve draft recovery", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved: LyricStudioDraft[] = [], writer = new StudioDraftWriter(value => saved.push(value));
  writer.update(draft("ordinary"));
  writer.update({ ...draft("tap"), times: [12.34] }, true);
  assert.equal(saved.length, 1); assert.deepEqual(saved[0].times, [12.34]);
  writer.update(draft("closing")); writer.flush(); assert.equal(saved[1].text, "closing");
  writer.update(draft("accepted")); writer.discard(); writer.flush(); t.mock.timers.tick(2000);
  writer.update(draft("late effect"), true); assert.equal(saved.length, 2);
});
test("a 400-line manuscript keeps the same selected snapshot between verses and duration ticks", () => {
  const store = new PlaybackProgressStore(), lines = Array.from({ length: 400 }, (_, index) => ({ start: index * 10, text: `Line ${index}` }));
  const selection = createPlaybackSelection(store, progress => lyricMoment(lines, progress.positionMs / 1000), (a,b) => a.index === b.index && a.kind === b.kind);
  const duration = createPlaybackSelection(store, progress => progress.durationMs, Object.is);
  store.update({ durationMs: 4_000_000, positionMs: 1000 });
  const first = selection.getSnapshot(), firstDuration = duration.getSnapshot();
  for (let index = 2; index < 100; index++) { store.setPosition(index * 100); assert.equal(selection.getSnapshot(), first); assert.equal(duration.getSnapshot(), firstDuration); }
  store.setPosition(10_000); assert.notEqual(selection.getSnapshot(), first); assert.equal(selection.getSnapshot().index, 1);
  store.setPosition(1000); assert.equal(selection.getSnapshot().index, 0);
});
test("link identity ignores raster layout/reading annotations but binds exact payload text, source and paper", () => {
  const track = { id: "track", reference: { provider: "deezer", id: "123" } } as MusicTrack;
  const selected = [{ text: "Words", start: 12.3, end: 13.2, romanized: "reading", words: [{ text: "Words", start: 12.4 }] }];
  const key = JSON.stringify(shareLinkPayload(track, "lyric", selected, "light"));
  assert.equal(key, JSON.stringify(shareLinkPayload(track, "lyric", [{ text: "Words", start: 12.3, end: 13.2 }], "light")));
  assert.notEqual(key, JSON.stringify(shareLinkPayload(track, "lyric", [{ text: "Changed", start: 12.3 }], "light")));
  assert.notEqual(key, JSON.stringify(shareLinkPayload(track, "lyric", selected, "dark")));
  assert.notEqual(key, JSON.stringify(shareLinkPayload({ ...track, reference: { provider: "deezer", id: "124" } }, "lyric", selected, "light")));
  assert.deepEqual(shareLinkPayload(track, "track", selected, "light").lines, []);
});
test("artwork headers identify square/portrait sources and only reduce known square covers", () => {
  const png = new Uint8Array(24), view = new DataView(png.buffer);
  png.set([137,80,78,71,13,10,26,10]); png.set([73,72,68,82],12);view.setUint32(16,4096);view.setUint32(20,4096);
  assert.deepEqual(artworkDimensions(png), { width:4096,height:4096 });
  assert.deepEqual(artworkBitmapOptions(artworkDimensions(png),745),{resizeWidth:745,resizeHeight:745,resizeQuality:"high"});
  view.setUint32(20,2048);assert.equal(artworkBitmapOptions(artworkDimensions(png),745),undefined);
  assert.equal(artworkBitmapOptions({width:320,height:320},745),undefined);assert.equal(artworkDimensions(png.subarray(0,12)),null);
  const jpeg = new Uint8Array([255,216,255,192,0,7,8,8,0,16,0]);assert.deepEqual(artworkDimensions(jpeg),{width:4096,height:2048});
  const webp = new Uint8Array(30);webp.set([82,73,70,70]);webp.set([87,69,66,80,86,80,56,88],8);webp.set([255,15,0],24);webp.set([255,7,0],27);
  assert.deepEqual(artworkDimensions(webp),{width:4096,height:2048});
});
test("working-memory preflight keeps ordinary eight-minute stereo usable while bounding high-rate/multichannel sources", () => {
  const metadata={durationSeconds:480,numberOfChannels:2,sampleRate:48_000,codec:"mp3",canDecode:true};
  assert.ok(shareAudioWorkingBytes(metadata,12*1024*1024)<MAX_PREVIEW_WORKING_BYTES);
  assert.ok(shareAudioWorkingBytes({...metadata,numberOfChannels:8},20*1024*1024)>MAX_PREVIEW_WORKING_BYTES);
  assert.ok(shareAudioWorkingBytes({...metadata,durationSeconds:3600},20*1024*1024)>MAX_PREVIEW_WORKING_BYTES);
});
