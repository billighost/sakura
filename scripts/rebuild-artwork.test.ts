import assert from "node:assert/strict";
import { test } from "node:test";
import { responsiveArtworkSources, sameOriginArtworkUrl } from "../src/rebuild/player/imageUrl";

const cover = "https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/1000x1000-000000-80-0-0.jpg";

test("catalog thumbnails can select small native files while a large sleeve retains full resolution", () => {
  const sources = responsiveArtworkSources(cover);
  assert.ok(sources.src?.endsWith("/320x320-000000-80-0-0.jpg"));
  assert.ok(sources.srcSet?.includes("/96x96-000000-80-0-0.jpg 96w"));
  assert.ok(sources.srcSet?.includes("/192x192-000000-80-0-0.jpg 192w"));
  assert.ok(sources.srcSet?.includes(cover + " 1000w"));
  assert.equal(sameOriginArtworkUrl(cover), `/api/v2/image?url=${encodeURIComponent(cover)}`, "Share/export retains the original artwork");
});

test("small catalog originals are never upscaled and proxied variants keep the offline image endpoint", () => {
  const small = cover.replace("1000x1000", "250x250");
  const sources = responsiveArtworkSources(small, true);
  assert.equal(sources.src, sameOriginArtworkUrl(small));
  assert.ok(sources.srcSet?.includes(`${sameOriginArtworkUrl(small)} 250w`));
  assert.ok(!sources.srcSet?.includes("320w"));
  assert.ok(sources.srcSet?.split(", ").every(source => source.startsWith("/api/v2/image?url=")));
});

test("unrecognized providers, signed URLs and local image capabilities retain their exact source", () => {
  for (const raw of ["/bloom/covers/sakura-light-480.webp", "blob:https://sakura.example/fixture", "https://i.scdn.co/image/fixture", "https://res.cloudinary.com/example/image/upload/v1/cover.jpg", cover + "?signature=exact", cover + "#unchanged", cover.replace("cdn-images.dzcdn.net", "dzcdn.net.attacker.invalid"), cover.replace("https://", "https://user:password@"), cover.replace("https://", "http://"), "//cdn-images.dzcdn.net/cover.jpg", "not a URL"]) {
    assert.deepEqual(responsiveArtworkSources(raw), {src:raw, srcSet:undefined}, raw);
  }
  assert.deepEqual(responsiveArtworkSources(null), {src:null, srcSet:undefined});
});
