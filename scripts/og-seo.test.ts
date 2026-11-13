import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool, QueryConfig } from "pg";
import sharp from "sharp";
import { OG_PAGES, OG_SIZE } from "../src/rebuild/og/catalog";
import { OG_SELECTIONS } from "../src/rebuild/og/selections";
import { staticOgData, staticPageMetadata, cleanPreviewText } from "../src/rebuild/seo/metadata";
import { resolveSiteOrigin } from "../src/rebuild/seo/site";
import { publicArtwork, readPublicEntityPreview, validPublicEntityId } from "../src/rebuild/seo/public-data";
import { DeezerCatalogService } from "../src/rebuild/server/catalog";
import { createOgRenderer, createPublicOgHandler } from "../src/rebuild/og/production";
import { renderOgImage } from "../src/rebuild/og/image";
import { encodeOgImage } from "../src/rebuild/og/encode";
import type { PublicShare } from "../src/rebuild/player/SharedSong";

const collectionId = "a345cc65-cefa-42c0-9b4a-067f1fba8a61";
const art = "https://cdn-images.dzcdn.net/images/cover/fixture/500x500.jpg";
const bytes = (text: string) => new TextEncoder().encode(text);
const request = (query = "", headers?: HeadersInit) => new Request("https://sakura.example/og/test" + query, { headers });

test("all 26 selected page contexts have compact, correctly encoded production images", async () => {
  const manifest = JSON.parse(await readFile("public/og/manifest.json", "utf8")) as { images: { page: string; direction: string; format: string; file: string; bytes: number }[] };
  assert.equal(manifest.images.length, OG_PAGES.length * 2);
  assert.equal(OG_PAGES.length, 26);
  for (const page of OG_PAGES) {
    for (const format of ["jpeg", "webp"]) {
      const item = manifest.images.find(image => image.page === page.id && image.format === format)!;
      assert.ok(item, page.id);
      assert.equal(item.direction, OG_SELECTIONS[page.id]);
      const image = await readFile("public/og/" + item.file);
      const metadata = await sharp(image).metadata();
      assert.equal(metadata.format, format);
      assert.equal(metadata.width, OG_SIZE.width);
      assert.equal(metadata.height, OG_SIZE.height);
      assert.equal(image.byteLength, item.bytes);
      assert.ok(image.byteLength < 250_000);
    }
  }
});

test("fallbacks use brand copy rather than fabricated artist or account information", () => {
  for (const id of ["artist", "album", "track", "playlist", "mix", "shared-track", "lyric"]) {
    const data = staticOgData(id);
    assert.equal(data.artwork, undefined);
    assert.equal(data.collage, undefined);
    assert.doesNotMatch(JSON.stringify(data), /Ayra Starr|Commas|The Year I Turned 21|24 songs/);
  }
  assert.doesNotMatch(JSON.stringify(staticOgData("bloom-story")), /November|2026/);
  for (const id of ["home", "library", "profile", "settings", "login"]) assert.equal((staticPageMetadata(id).robots as { index: boolean }).index, false);
  for (const id of ["default", "about", "privacy", "terms"]) assert.equal((staticPageMetadata(id).robots as { index: boolean }).index, true);
});

test("canonical origins and public artwork references reject unsafe inputs", () => {
  assert.equal(resolveSiteOrigin("https://sakura.example/"), "https://sakura.example");
  assert.equal(resolveSiteOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["http://sakura.example", "https://user:secret@sakura.example", "https://sakura.example/a", "https://sakura.example?q=1", "https://sakura.example#fragment"]) assert.throws(() => resolveSiteOrigin(value));
  for (const value of ["http://localhost/a.jpg", "https://127.0.0.1/a.jpg", "https://dzcdn.net.attacker.example/a.jpg", "https://user:secret@cdn-images.dzcdn.net/a.jpg", "data:image/png;base64,abc"]) assert.equal(publicArtwork(value), undefined);
  assert.equal(publicArtwork(art), art);
  assert.equal(cleanPreviewText(" <title>\u0000\n sample  ", 80), "<title> sample");
  assert.equal(validPublicEntityId("mix", "deezer:42"), false);
  assert.equal(validPublicEntityId("playlist", collectionId), true);
  for (const value of ["../secret", "deezer:0", "spotify:wrong", "x".repeat(5000)]) assert.equal(validPublicEntityId("artist", value), false);
});

test("artist summaries perform one public catalogue request without expanding listening data", async () => {
  const paths: string[] = [];
  const catalogue = new DeezerCatalogService((async input => {
    paths.push(String(input));
    return Response.json({ id: 110, name: "Real catalogue artist", picture_xl: art });
  }) as typeof fetch);
  const result = await catalogue.summary("artist", "deezer:110");
  assert.equal(result.title, "Real catalogue artist");
  assert.deepEqual(paths, ["https://api.deezer.com/artist/110"]);
  await assert.rejects(catalogue.summary("artist", "deezer:../account"));
});

test("collection preview reads expose only authorized names and validated artwork, and stay fresh", async t => {
  const runtime = globalThis as unknown as { sakuraV2ProductPool?: Pool };
  const previous = runtime.sakuraV2ProductPool;
  let title = "My real collection";
  let present = true;
  const queries: QueryConfig[] = [];
  runtime.sakuraV2ProductPool = { query: async (query: QueryConfig) => {
    queries.push(query);
    return { rows: present ? [{ title, artwork: art, collage: [art, "https://127.0.0.1/private.png"], account_id: "private owner", email: "private email", description: "private listening history", playback: "private playback" }] : [] };
  } } as unknown as Pool;
  t.after(() => { runtime.sakuraV2ProductPool = previous; });
  const first = await readPublicEntityPreview("playlist", collectionId);
  assert.deepEqual(first, { title, artists: [], artwork: art, collage: [art], detail: undefined });
  assert.doesNotMatch(JSON.stringify(first), /private/);
  assert.doesNotMatch(queries[0].text, /c\.account_id|c\.description|audio_url|playback/i);
  title = "Renamed collection";
  assert.equal((await readPublicEntityPreview("playlist", collectionId))?.title, title);
  assert.equal((await readPublicEntityPreview("mix", collectionId))?.title, title);
  present = false;
  assert.equal(await readPublicEntityPreview("playlist", collectionId), undefined);
});

test("rendering coalesces identical work, bounds concurrent jobs, and keys cached images by current content", async () => {
  let finish!: (value: Uint8Array) => void;
  let calls = 0;
  const render = createOgRenderer(async () => { calls++; return new Promise<Uint8Array>(resolve => { finish = resolve; }); }, { maxConcurrent: 1 });
  const page = staticOgData("playlist");
  const first = render(page, "jpeg");
  const joined = render(page, "jpeg");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(await render({ ...page, title: "Another collection" }, "jpeg"), undefined);
  finish(bytes("real image"));
  assert.deepEqual(await first, await joined);
  assert.deepEqual((await render(page, "jpeg"))?.bytes, bytes("real image"));
  assert.equal(calls, 1);
  const changed = render({ ...page, title: "Renamed" }, "jpeg");
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(bytes("renamed image"));
  assert.deepEqual((await changed)?.bytes, bytes("renamed image"));
});

test("render byte retention respects the cache budget", async () => {
  let calls = 0;
  const render = createOgRenderer(async () => { calls++; return bytes("oversized"); }, { maxBytes: 3 });
  await render(staticOgData("track"), "jpeg");
  await render(staticOgData("track"), "jpeg");
  assert.equal(calls, 2);
});

test("failed artwork is not cached, and a recovered portrait can replace the incomplete image", async () => {
  let calls = 0;
  const render = createOgRenderer(async () => { calls++; return { bytes: bytes(calls === 1 ? "Portrait waiting" : "Portrait ready"), artworkComplete: calls > 1 }; });
  const handler = createPublicOgHandler({ entity: async () => ({ title: "Public artist", artists: [], artwork: art }), render, fallback: async () => bytes("Fallback") });
  const first = await handler(request(), "artist", "deezer:110");
  assert.equal(first.headers.get("cache-control"), "no-store");
  const ready = await handler(request("", { "If-None-Match": first.headers.get("etag")! }), "artist", "deezer:110");
  assert.equal(ready.status, 200);
  assert.equal(await ready.text(), "Portrait ready");
  assert.equal(ready.headers.get("cache-control"), "public, max-age=300, s-maxage=300");
  await handler(request(), "artist", "deezer:110");
  assert.equal(calls, 2);
});

const shareFixture: PublicShare = {
  slug: "PreviewFixture01", kind: "lyric", payload: { recordingId: collectionId, title: "Real shared song", artists: ["Real artist"], albumTitle: "Real album", durationMs: 123000, coverUrl: art, reference: null, references: [], colorMode: "light", lines: [{ text: "A real lyric moment", start: 10, end: 14 }] },
};

test("a revoked share cannot return previously rendered lyrics or a stale 304", async () => {
  let share: PublicShare | undefined = shareFixture;
  let reads = 0;
  const handler = createPublicOgHandler({
    share: async () => { reads++; return share; }, render: createOgRenderer(async page => bytes(page.title)), fallback: async () => bytes("Sakura fallback"),
  });
  const first = await handler(request(), "share", shareFixture.slug);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(await first.text(), "A real lyric moment");
  share = undefined;
  const removed = await handler(request("", { "If-None-Match": first.headers.get("etag")! }), "share", shareFixture.slug);
  assert.equal(removed.status, 404);
  assert.equal(await removed.text(), "Sakura fallback");
  assert.equal(reads, 2);
});

test("playlist and mix names refresh publicly while missing records use only generic brand images", async () => {
  let title: string | undefined = "Current public name";
  const handler = createPublicOgHandler({ entity: async () => title ? { title, artists: [], artwork: art } : undefined, render: createOgRenderer(async page => bytes(page.title)), fallback: async () => bytes("Generic Sakura") });
  for (const kind of ["playlist", "mix"]) {
    const first = await handler(request(), kind, collectionId);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(await first.text(), title);
  }
  title = "Changed public name";
  const changed = await handler(request("?format=webp"), "playlist", collectionId);
  assert.equal(changed.headers.get("content-type"), "image/webp");
  assert.equal(await changed.text(), title);
  title = undefined;
  assert.equal(await (await handler(request(), "mix", collectionId)).text(), "Generic Sakura");
});

test("invalid image routes never read data and temporary share failures return safe, noncached images", async () => {
  let reads = 0;
  const handler = createPublicOgHandler({ share: async () => { reads++; throw new Error("Unavailable"); }, entity: async () => { reads++; return undefined; }, fallback: async () => bytes("Generic Sakura") });
  for (const [kind, id, query, status] of [["artist", "../private", "", 404], ["profile", collectionId, "", 404], ["share", "invalid", "", 404], ["share", shareFixture.slug, "?format=png", 400]] as const) assert.equal((await handler(request(query), kind, id)).status, status);
  assert.equal(reads, 0);
  const unavailable = await handler(request(), "share", shareFixture.slug);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(await unavailable.text(), "Generic Sakura");
});

test("native-language titles render with local fonts and failed artwork keeps a complete branded card", async t => {
  const networkCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (/^https?:/.test(url)) { networkCalls.push(url); throw new Error("Fonts must be local"); }
    return originalFetch(input, init);
  });
  const output = resolve(".local/og-preview/native");
  await mkdir(output, { recursive: true });
  for (const [id, title, subtitle] of [["japanese", "夜に駆ける", "YOASOBI · THE BOOK"], ["chinese", "李荣浩 · 特别的人", "陈奕迅 · 张学友"], ["korean", "봄날", "방탄소년단"], ["cyrillic", "Любимая музыка", "Μουσική · Café"], ["arabic", "مرحبا بالموسيقى", "أغنية جميلة"]]) {
    const page = { ...staticOgData("track"), title, subtitle, artwork: "https://invalid.example/artwork.jpg" };
    const image = await renderOgImage(page, "c");
    const jpeg = await encodeOgImage(new Uint8Array(await image.arrayBuffer()), "jpeg");
    const metadata = await sharp(jpeg).metadata();
    assert.equal(metadata.width, OG_SIZE.width);
    assert.equal(metadata.height, OG_SIZE.height);
    await writeFile(resolve(output, id + ".jpg"), jpeg);
  }
  assert.deepEqual(networkCalls, []);
});
