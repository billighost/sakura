import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShareInput, ShareInputError, verifyLyricSelection } from "../src/rebuild/player/shareInput";
import { sameOriginArtworkUrl } from "../src/rebuild/player/imageUrl";
import { approvedArtworkUrl } from "../src/rebuild/player/imagePolicy";
import {readyPlaybackFor} from "../src/rebuild/app/playbackSource";
import {musicTrack} from "../src/rebuild/app/types";
import {boundedSeekPosition} from "../src/rebuild/app/seekPosition";

const source = [{ text: "first words", start: 1, end: 3 }, { text: "second words", start: 3, end: 5 }, { text: "third words", start: 5, end: 8 }];
test("lyric seeking uses the loaded media when catalog duration is missing",()=>{
 assert.equal(boundedSeekPosition(60000,0,120000),60000);
 assert.equal(boundedSeekPosition(180000,0,120000),120000);
 assert.equal(boundedSeekPosition(-100,0,120000),0);
 assert.equal(boundedSeekPosition(Number.NaN,0,120000),0);
 assert.equal(boundedSeekPosition(60000,0,Number.NaN),0);
 assert.equal(boundedSeekPosition(60000,120000,10000),60000,"Known full-song duration remains available while progressive media loads");
});
test("ready CDN playback retains exact recording, checksum and same-origin recovery",()=>{
 const id="10000000-0000-4000-8000-000000000001",assetId="10000000-0000-4000-8000-000000000002",sha256="a".repeat(64);
 const ready={kind:"stream",delivery:"cdn",assetId,sha256,sizeBytes:5000,mimeType:"audio/mpeg",durationMs:1000,url:`https://res.cloudinary.com/sakura/video/upload/v123/sakura/v2/audio/${id}/${sha256}.mp3`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`} as const;
 const track=musicTrack({recordingId:id,reference:{provider:"deezer",id:"1"},metadata:{title:"Exact song",artists:["Artist"],durationMs:1000},readyPlayback:ready});
 assert.equal(readyPlaybackFor(track),ready);
 for(const patch of [{url:ready.url.replace(id,assetId)},{url:ready.url.replace(sha256,"b".repeat(64))},{url:ready.url.replace("res.cloudinary.com","cloudinary.com.attacker.invalid")},{url:ready.url+"?transform=preview"},{fallbackUrl:"https://attacker.invalid/audio"},{fallbackUrl:ready.fallbackUrl.replace(assetId,id)},{sizeBytes:0},{delivery:"worker"}])assert.equal(readyPlaybackFor({...track,readyPlayback:{...ready,...patch} as typeof ready}),undefined);
});
test("Lyric shares retain exact adjacent source lines and timing", () => {
  assert.equal(verifyLyricSelection(source.slice(0, 2), source), true);
  assert.equal(verifyLyricSelection([source[0], source[2]], source), false);
  assert.equal(verifyLyricSelection([{ ...source[0], text: "substituted quote" }], source), false);
  assert.equal(verifyLyricSelection([{ ...source[0], start: 2 }], source), false);
  assert.equal(verifyLyricSelection(source.slice(0, 2).reverse(), source), false);
});
test("Repeated unsynced lines can form a real adjacent selection", () => {
  const repeated = [{ text: "oh", start: 0 }, { text: "oh", start: 0 }, { text: "again", start: 0 }];
  assert.equal(verifyLyricSelection(repeated.slice(0, 2), repeated), true);
  assert.equal(verifyLyricSelection([{ text: "oh", start: 0 }, { text: "unrelated", start: 0 }], repeated), false);
});
test("Instrumental gaps do not break a neighbouring visible lyric selection", () => {
  const withGap = [source[0], { text: "", start: 2.5 }, source[1], source[2]];
  assert.equal(verifyLyricSelection([source[0], source[1]], withGap), true);
  assert.equal(verifyLyricSelection([source[0], source[2]], withGap), false);
});
test("Share requests reject missing identity, invalid kinds and oversized or empty quotes", () => {
  assert.throws(() => parseShareInput({ kind: "track" }), ShareInputError);
  assert.throws(() => parseShareInput({ recordingId: "test", kind: "video" }), ShareInputError);
  assert.throws(() => parseShareInput({ recordingId: "test", kind: "lyric", lines: [] }), ShareInputError);
  assert.throws(() => parseShareInput({ recordingId: "test", kind: "lyric", lines: Array.from({ length: 9 }, () => source[0]) }), ShareInputError);
  assert.throws(() => parseShareInput({ recordingId: "test", kind: "lyric", lines: [{ text: "first", start: Number.NaN }] }), ShareInputError);
  assert.throws(() => parseShareInput({ recordingId: "test", kind: "track", reference: { provider: "deezer", id: " " } }), ShareInputError);
});
test("Client metadata cannot become trusted share metadata", () => {
  const parsed = parseShareInput({ recordingId: "deezer:123", reference: { provider: "deezer", id: "123" }, kind: "lyric", lines: source.slice(0, 2), title: "injected title", coverUrl: "https://bad.invalid", colorMode: "dark" });
  assert.equal("title" in parsed, false);
  assert.equal("coverUrl" in parsed, false);
  assert.equal(parsed.colorMode, "dark");
  assert.deepEqual(parsed.lines, source.slice(0, 2));
});
test("Artwork fetching accepts only HTTPS catalog hosts including validated subdomains", () => {
  assert.equal(approvedArtworkUrl("https://e-cdns-images.dzcdn.net/images/cover/file.jpg").hostname, "e-cdns-images.dzcdn.net");
  for (const url of ["http://127.0.0.1/a.png", "https://localhost/a.png", "https://dzcdn.net.attacker.invalid/a.png", "https://res.cloudinary.com:8443/a.png", "https://user:password@res.cloudinary.com/a.png", "file:///C:/secrets.png"]) assert.throws(() => approvedArtworkUrl(url));
});
test("Remote artwork is proxied without protocol-relative URL bypasses", () => {
  assert.equal(sameOriginArtworkUrl("/icons/icon.png"), "/icons/icon.png");
  assert.ok(sameOriginArtworkUrl("//attacker.invalid/a.png")?.startsWith("/api/v2/image?url="));
  assert.ok(sameOriginArtworkUrl("https://e-cdns-images.dzcdn.net/a.jpg")?.startsWith("/api/v2/image?url="));
  assert.equal(sameOriginArtworkUrl(null), null);
});
