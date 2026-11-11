import assert from "node:assert/strict";
import test from "node:test";
import { alignWhisperLyrics, LyricAlignmentError, type RecognizedWord } from "../src/rebuild/lyrics/whisperSync";

const words:RecognizedWord[]=[
  {text:"Hello",start:2,end:2.5,probability:.98},{text:"world",start:2.6,end:3,probability:.97},
  {text:"We",start:7,end:7.2,probability:.99},{text:"are",start:7.3,end:7.5,probability:.97},{text:"here",start:7.6,end:8,probability:.98},
  {text:"Hello",start:12,end:12.5,probability:.99},{text:"world",start:12.6,end:13,probability:.98},
];
test("Whisper sequence alignment uses actual vocal times, repeated choruses and source punctuation",()=>{
  const source=[{text:"Hello, world!",start:0},{text:"",start:0},{text:"We are here.",start:0},{text:"Hello, world!",start:0}];
  const result=alignWhisperLyrics(source,words,30);
  assert.deepEqual(result.lines.map(line=>line.text),source.map(line=>line.text));
  assert.deepEqual(result.lines.map(line=>line.start),[2,3,7,12]);
  assert.deepEqual(result.lines.map(line=>line.end),[3,7,8,13]);
  assert.equal(result.lines[0].words!.map(word=>word.text).join(""),"Hello, world!");
  assert.equal(result.recognizedWordCoverage,1);
  assert.ok(result.confidence>.95);
});
test("A missing first or last word refuses the whole lyric result",()=>{
  assert.throws(()=>alignWhisperLyrics([{text:"We are here now",start:0}],words,30),LyricAlignmentError);
  assert.throws(()=>alignWhisperLyrics([{text:"Now we are here",start:0}],words,30),LyricAlignmentError);
});
test("Wrong recording words, silence, uncertain vocals and out-of-order timestamps are rejected",()=>{
  assert.throws(()=>alignWhisperLyrics([{text:"Different lyrics",start:0}],words,30),LyricAlignmentError);
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],[],30),LyricAlignmentError);
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],words.map(word=>({...word,probability:.1})),30),LyricAlignmentError);
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],[words[1],words[0]],30),/invalid/);
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],words,1),/invalid/);
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],words.map(word=>({...word,probability:undefined})),30),/confidence/);
});
test("Zero-duration uncertain words cannot anchor a line",()=>{
  assert.throws(()=>alignWhisperLyrics([{text:"Hello world",start:0}],[{text:"Hello",start:0,end:0},words[1]],30),LyricAlignmentError);
});
test("Known alternate apostrophes match without replacing provider words",()=>{
  const line={text:"I’m here.",start:0};
  const result=alignWhisperLyrics([line],[{text:"I'm",start:1,end:1.2,probability:.99},{text:"here",start:1.3,end:2,probability:.99}],4);
  assert.equal(result.lines[0].text,line.text);
  assert.equal(result.lines[0].words!.map(word=>word.text).join(""),line.text);
});
test("Multilingual text is not passed to an English model",()=>{
  assert.throws(()=>alignWhisperLyrics([{text:"你好世界",start:0}],words,30),/English/);
  assert.throws(()=>alignWhisperLyrics([{text:"안녕하세요",start:0}],words,30),/English/);
});
