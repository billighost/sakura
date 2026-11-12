import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadingTransformCache } from "../src/rebuild/lyrics/readingTransforms";
import { readingEngine } from "../src/rebuild/lyrics/language";
import { ARTWORK_CACHE_SECONDS, ARTWORK_MAX_BYTES, ArtworkDeliveryError, createArtworkDelivery } from "../src/rebuild/player/artworkDelivery";

test("reading consumers share text work and keep their distinct line and word timings", async () => {
  let calls = 0;
  const read = createReadingTransformCache({ transform: async (lines, language) => {
    calls++; await Promise.resolve();
    return lines.map(line => ({ romanized: `reading:${line.text}`, readingReviewNeeded: false, readingEngine: readingEngine(language) }));
  } });
  const first = [{ text: "same", start: 1, end: 2, words: [{ text: "same", start: 1.5 }], custom: "first" }];
  const second = [{ text: "same", start: 9, words: [{ text: "same", start: 9.5 }], custom: "second" }];
  const [a, b] = await Promise.all([read(first, "ja"), read(second, "ja")]);
  assert.equal(calls, 1); assert.deepEqual(a[0], { ...first[0], romanized: "reading:same", readingReviewNeeded: false, readingEngine: readingEngine("ja") });
  assert.equal(b[0].start, 9); assert.deepEqual(b[0].words, second[0].words); assert.equal(b[0].custom, "second");
  a[0].romanized = "changed"; assert.equal((await read(second, "ja"))[0].romanized, "reading:same");
  await read(second, "zh"); await read([{ text: "different" }], "ja"); assert.equal(calls, 3);
});

test("reading failures retry and entries obey the retained memory limits", async () => {
  let calls = 0;
  const read = createReadingTransformCache({ maxEntries: 1, transform: async (lines, language) => {
    if (++calls === 1) throw new Error("dictionary unavailable");
    return lines.map(line => ({ romanized: line.text, readingReviewNeeded: false, readingEngine: readingEngine(language) }));
  } });
  await assert.rejects(read([{ text: "a" }], "ja")); await read([{ text: "a" }], "ja"); await read([{ text: "b" }], "ja"); await read([{ text: "a" }], "ja"); assert.equal(calls, 4);
  let uncached = 0;
  const tiny = createReadingTransformCache({ maxBytes: 1, transform: async (lines, language) => { uncached++; return lines.map(line => ({ romanized: line.text, readingReviewNeeded: false, readingEngine: readingEngine(language) })); } });
  await tiny([{ text: "a" }], "ko"); await tiny([{ text: "a" }], "ko"); assert.equal(uncached, 2);
});

const image = (bytes = new Uint8Array([1, 2, 3])) => new Response(bytes, { headers: { "Content-Type": "image/png" } });
const base = "https://e-cdns-images.dzcdn.net/cover.png";
test("validated artwork coalesces normalized URLs and reuses bytes and ETag until expiry", async () => {
  let calls = 0, now = 0;
  const load = createArtworkDelivery({ now: () => now, fetch: async () => { calls++; await Promise.resolve(); return image(); } });
  const [a, b] = await Promise.all([load(base), load(base + "#ignored")]);
  assert.equal(calls, 1); assert.equal(a, b); assert.match(a.etag, /^"[a-f0-9]{64}"$/); assert.deepEqual([...a.bytes], [1, 2, 3]);
  assert.equal(await load(base), a); now = ARTWORK_CACHE_SECONDS * 1000; await load(base); assert.equal(calls, 2);
});

test("artwork rejects unsupported redirect hosts, response types and oversized streams without caching failures", async () => {
  let calls = 0;
  const load = createArtworkDelivery({ fetch: async () => { calls++; return calls === 1 ? new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } }) : image(); } });
  await assert.rejects(load(base), /Unsupported artwork host/); await load(base); assert.equal(calls, 2);
  const wrongType = createArtworkDelivery({ fetch: async () => new Response("<script/>", { headers: { "Content-Type": "text/html" } }) });
  await assert.rejects(wrongType(base), error => error instanceof ArtworkDeliveryError && error.status === 415);
  const huge = createArtworkDelivery({ fetch: async () => image(new Uint8Array(ARTWORK_MAX_BYTES + 1)) });
  await assert.rejects(huge(base), error => error instanceof ArtworkDeliveryError && error.status === 413);
});

test("artwork cache evicts by byte budget and entry recency", async () => {
  let calls = 0;
  const load = createArtworkDelivery({ maxBytes: 4, maxEntries: 2, fetch: async () => { calls++; return image(); } });
  await load(base + "?a"); await load(base + "?b"); await load(base + "?a"); assert.equal(calls, 3);
});
