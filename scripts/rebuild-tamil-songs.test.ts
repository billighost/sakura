import assert from "node:assert/strict";
import test from "node:test";
import songs from "./fixtures/tamil-song-stress-excerpts.json";
import { READING_SONG_EXCERPTS } from "./fixtures/reading-song-excerpts";
import { lyricReadingLanguage, readingEngine } from "../src/rebuild/lyrics/language";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";

assert.equal(songs.length, 100, "Keep the hundred additional source-backed songs in the regression corpus");
assert.equal(new Set(songs.map(song => song.id)).size, 100);
const originalTamilIds = new Set(READING_SONG_EXCERPTS.filter(song => song.language === "ta").map(song => song.id));

for (const song of songs) {
  test(`additional Tamil song: ${song.title}`, async () => {
    assert.ok(!originalTamilIds.has(song.id), "This must be additional to the original fifteen songs");
    assert.equal(song.language, "ta");
    assert.ok(song.references.native.length && song.references.reading.length && song.references.sourceReading);
    assert.equal(lyricReadingLanguage(song.text, "Tamil"), "ta");
    const original = { text: song.text, start: 12, end: 19, words: [{ text: song.text, start: 12.2, end: 18.8 }] };
    const [line] = await romanizeLyricLines([original], "ta", undefined, "Tamil");
    assert.equal(line.romanized.normalize("NFC"), song.expected.normalize("NFC"), "Match the independently established guide without dropping vowel or consonant diacritics");
    assert.equal(line.readingEngine, readingEngine("ta"));
    assert.deepEqual({ text: line.text, start: line.start, end: line.end, words: line.words }, original);
  });
}
