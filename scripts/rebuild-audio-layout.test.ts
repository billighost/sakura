import assert from "node:assert/strict";
import test from "node:test";
import { id3v2TagBytes, isMpegAudioFrameHeader, originalAudioRange } from "../src/rebuild/core/audioLayout";
import { parseByteRange } from "../src/rebuild/core/streaming";

function id3(payload: number, version = 3, flags = 0): Uint8Array {
  return Uint8Array.of(0x49, 0x44, 0x33, version, 0, flags,
    payload >> 21 & 0x7f, payload >> 14 & 0x7f, payload >> 7 & 0x7f, payload & 0x7f);
}

test("leading ID3 artwork is skipped by its declared size without reading or changing the artwork", () => {
  for (const offset of [159628, 334168, 75074]) {
    const header = id3(offset - 10), before = header.slice();
    assert.equal(id3v2TagBytes(header, offset + 500000), offset);
    assert.deepEqual(header, before);
  }
  assert.equal(id3v2TagBytes(Uint8Array.of(0xff, 0xfb, 0xe0, 0x64, 0, 0, 0, 0, 0, 0), 9000), 0);
});

test("each ID3 version handles its documented flags and only v2.4 includes a footer", () => {
  assert.equal(id3v2TagBytes(id3(128, 2, 0xc0), 1000), 138);
  assert.equal(id3v2TagBytes(id3(128, 3, 0xe0), 1000), 138);
  assert.equal(id3v2TagBytes(id3(128, 4, 0xe0), 1000), 138);
  assert.equal(id3v2TagBytes(id3(128, 4, 0xf0), 1000), 148);
  assert.equal(id3v2TagBytes(id3(0, 4, 0x10), 1000), 20);
});

test("invalid, truncated, unsupported and out-of-file ID3 metadata cannot invent an audio boundary", () => {
  for (let length = 0; length < 10; length++) assert.equal(id3v2TagBytes(id3(128).slice(0, length), 1000), undefined);
  for (const version of [0, 1, 5, 0xff]) assert.equal(id3v2TagBytes(id3(128, version), 1000), undefined);
  for (const version of [2, 3, 4]) {
    const badRevision = id3(128, version); badRevision[4] = 0xff;
    assert.equal(id3v2TagBytes(badRevision, 1000), undefined);
    for (let reserved = 1; reserved < (version === 2 ? 0x40 : version === 3 ? 0x20 : 0x10); reserved *= 2)
      assert.equal(id3v2TagBytes(id3(128, version, reserved), 1000), undefined);
  }
  for (let index = 6; index < 10; index++) {
    const unsynchsafe = id3(128); unsynchsafe[index] |= 0x80;
    assert.equal(id3v2TagBytes(unsynchsafe, 1000), undefined);
  }
  assert.equal(id3v2TagBytes(id3(990), 1000), undefined);
  assert.equal(id3v2TagBytes(id3(980, 4, 0x10), 1000), undefined);
  assert.equal(id3v2TagBytes(id3(100), Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(id3v2TagBytes(id3(100), -1), undefined);
});

test("a tag's declared boundary must actually contain a legal MPEG audio header", () => {
  for (const header of [[0xff, 0xfb, 0xe0, 0x64], [0xff, 0xfb, 0xe0, 0], [0xff, 0xfb, 0xe0, 0x44],
    [0xff, 0xf3, 0x90, 0], [0xff, 0xe3, 0x90, 0], [0xff, 0xfb, 0, 0]])
    assert.equal(isMpegAudioFrameHeader(Uint8Array.from(header)), true);
  for (const header of [[], [0xff, 0xfb, 0xe0], [0x49, 0x44, 0x33, 3], [0xff, 0xeb, 0xe0, 0],
    [0xff, 0xf9, 0xe0, 0], [0xff, 0xfb, 0xf0, 0], [0xff, 0xfb, 0xec, 0], [0xff, 0xfb, 0xe0, 2]])
    assert.equal(isMpegAudioFrameHeader(Uint8Array.from(header)), false);
});

test("virtual open, bounded and suffix ranges select exactly the original audio bytes", () => {
  const offset = 334168, original = Uint8Array.from({ length: offset + 700000 }, (_, index) => index % 251);
  const size = original.length - offset, audio = original.slice(offset);
  for (const header of ["bytes=0-", "bytes=0-32767", "bytes=32768-262143", "bytes=262144-", "bytes=-1000"]) {
    const range = parseByteRange(header, size); assert.equal(range.status, "range");
    if (range.status !== "range") throw new Error("Expected a bounded range");
    const physical = originalAudioRange(range.start, range.end, original.length, offset)!;
    assert.equal(physical.size, size);
    assert.deepEqual(original.slice(physical.start, physical.end + 1), audio.slice(range.start, range.end + 1));
  }
  assert.deepEqual(originalAudioRange(0, 9, 100, 0), { start: 0, end: 9, size: 100 });
  for (const args of [[-1, 9, 100, 10], [0, 90, 100, 10], [1, 0, 100, 10], [0, 9, 100, -1], [0, 9, 100, 100], [0.5, 9, 100, 10]])
    assert.equal(originalAudioRange(...args as [number, number, number, number]), undefined);
});
