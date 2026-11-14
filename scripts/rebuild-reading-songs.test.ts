import assert from 'node:assert/strict';
import test from 'node:test';
import { lyricReadingLanguage, readingEngine } from '../src/rebuild/lyrics/language';
import { romanizeLyricLines } from '../src/rebuild/lyrics/readings';
import { READING_SONG_EXCERPTS, pronunciationLetters } from './fixtures/reading-song-excerpts';

for (const song of READING_SONG_EXCERPTS) {
 test(`real song excerpt: ${song.title} (${song.language}, ${song.mode})`, async () => {
  const detected = lyricReadingLanguage(song.text, song.hintRequired ? song.language : undefined);
  assert.equal(detected,song.language,'detect script/language from original lyric text');
  const original = {text:song.text,start:12500,end:19000,words:[{text:song.text,start:12500,end:19000}]};
  const [line] = await romanizeLyricLines([original],song.language);
  assert.equal(line.text,original.text);
  assert.equal(line.start,original.start);
  assert.equal(line.end,original.end);
  assert.deepEqual(line.words,original.words);
  assert.equal(line.readingEngine,readingEngine(song.language));
  if (song.mode === 'pinyin' || song.mode === 'script') assert.equal(line.romanized.normalize('NFC'),song.expected.normalize('NFC'),'match independent tones, vowel length, nasalization and established written romanization');
  else assert.equal(pronunciationLetters(line.romanized),pronunciationLetters(song.expected),'match independently chosen sound/letter reading');
  if (song.id === 'lemon') assert.doesNotMatch(line.romanized,/\bdesho\s+u\b/,'keep the long vowel together in deshou');
 });
}

test('Arabic excerpts check written script, without inventing missing sung vowels',async()=>{
 const [line]=await romanizeLyricLines([{text:'تملي معاك (Tamally Maak)'}],'ar');
 assert.match(line.romanized,/\(Tamally Maak\)$/,'original Latin lyric fragments keep spelling and punctuation');
 assert.doesNotMatch(line.romanized,/\p{Script=Arabic}/u);
});
