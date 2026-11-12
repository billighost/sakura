import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLrcLibLyrics } from "../src/rebuild/lyrics/provider";

test("bounded lyric searches return a verified sibling immediately and cancel the stalled alias", async () => {
  let active = 0, maximum = 0, searches = 0, aborted = 0;
  const fetcher: typeof fetch = async (address, options) => {
    const url = new URL(String(address));
    if (url.pathname.endsWith("/get")) return new Response(null, { status: 404 });
    searches++; active++; maximum = Math.max(maximum, active);
    if (url.searchParams.has("track_name")) {
      return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => {
        active--; aborted++; reject(options!.signal!.reason);
      }, { once: true }));
    }
    active--;
    return Response.json([{ id: 1, trackName: "Song", artistName: "Artist", duration: 180, syncedLyrics: "[00:01]Fixture words" }]);
  };
  const result = await fetchLrcLibLyrics({ title: "Song", artist: "Artist", durationSeconds: 180 }, { fetch: fetcher });
  assert.equal(result.status, "matched");
  assert.equal(maximum, 2); assert.equal(searches, 2); assert.equal(aborted, 1);
});

test("concurrent empty and failed searches retain unavailable rather than a false negative", async () => {
  const result = await fetchLrcLibLyrics({ title: "Song", artist: "Artist", durationSeconds: 180 }, {
    wait: async () => {},
    fetch: async address => {
      const url = new URL(String(address));
      if (url.pathname.endsWith("/get")) return new Response(null, { status: 404 });
      return url.searchParams.has("track_name") ? new Response(null, { status: 503 }) : Response.json([]);
    },
  });
  assert.equal(result.status, "unavailable");
});
