import assert from "node:assert/strict";
import test from "node:test";
import { CollectionSearchIndex, collectionSearchWords, collectionTrackMatches, collectionTrackSearchText } from "../src/rebuild/app/collectionSearch";
import { foldLatinAccents } from "../src/rebuild/core/searchText";
import { sortRoomTracks } from "../src/rebuild/app/trackSorting";
import type { MusicTrack } from "../src/rebuild/app/types";

function track(index = 0, patch: Partial<MusicTrack> = {}): MusicTrack {
  return { id: String(index), title: "Canción " + index, artists: ["Beyoncé", "歌手"], artistCredits: [{ name: "Featured artist", role: "featured" }], albumTitle: "夏の音楽", alternateTitles: ["별빛"], versionLabel: "Live recording", durationMs: 1000 + index, coverUrl: null, artistId: null, albumId: null, reference: { provider: "deezer", id: String(index) }, references: [], ...patch };
}

test("span normalization retains exact legacy mixed-script and accent semantics", () => {
  const legacy = (text: string) => text.normalize("NFKC").replace(/\p{Script=Latin}\p{M}*/gu, span => span.normalize("NFKD").replace(/\p{M}/gu, ""));
  const corpus = ["Beyoncé", "Canción", "Æsir ﬃ Ｆｕｌｌ", "a\u0301b\u0327", "काँव देवनागरी", "שָׁלוֹם", "العَرَبِيَّة", "Україна е\u0301", "Ελλάδα", "별빛 かな 漢字", "\u0301a\u0308 आरती", "a\u0301\u0327b\u0308"];
  for (const first of corpus) for (const second of corpus) assert.equal(foldLatinAccents(first + " / " + second), legacy(first + " / " + second));
  assert.equal(foldLatinAccents("ordinary ASCII 123"), "ordinary ASCII 123");
});

test("indexed search preserves metadata fields, every-word matches and sorted order", async () => {
  const tracks = Array.from({ length: 200 }, (_, index) => track(index));
  const index = new CollectionSearchIndex();
  for (const query of ["", "cancion beyonce", "歌手 夏", "featured live", "별빛", "missing title", "  SONG--- title "]) {
    for (const order of ["kept", "title", "duration"] as const) {
      const sorted = sortRoomTracks(tracks, order, "desc");
      assert.deepEqual(await index.filter(sorted, collectionSearchWords(query)), sortRoomTracks(tracks.filter(song => collectionTrackMatches(song, query)), order, "desc"));
    }
  }
});

test("unchanged immutable cards reuse search text, changed card identity rebuilds it", () => {
  let reads = 0;
  const card = track();
  const title = card.title;
  Object.defineProperty(card, "title", { get: () => { reads++; return title; } });
  const index = new CollectionSearchIndex();
  assert.equal(index.matches(card, ["cancion"]), true);
  assert.equal(index.matches(card, ["beyonce"]), true);
  assert.equal(reads, 1);
  const changed = { ...card, title: "Different recording" };
  assert.equal(index.matches(changed, ["different"]), true);
  assert.equal(index.matches(changed, ["cancion"]), false);
  assert.equal(index.text(changed), collectionTrackSearchText(changed));
});

test("cold indexing yields within batches and aborts before publishing obsolete results", async () => {
  const tracks = Array.from({ length: 1000 }, (_, position) => track(position));
  const controller = new AbortController();
  let time = 0, yields = 0;
  const index = new CollectionSearchIndex();
  await assert.rejects(index.filter(tracks, ["cancion"], {
    signal: controller.signal, now: () => time += 5,
    yield: async () => { yields++; controller.abort(); },
  }), error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(yields, 1);
  const matches = await index.filter(tracks, ["cancion"], { now: () => 0, yield: async () => { throw new Error("Warm bounded pass need not yield"); } });
  assert.equal(matches.length, tracks.length);
});
