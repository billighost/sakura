import test from "node:test";
import assert from "node:assert/strict";
import { lyricReadingLanguage, readingEngine } from "../src/rebuild/lyrics/language";
import { romanizeJapanese } from "../src/rebuild/lyrics/japanese";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";

test("automatic reading language follows source evidence and predominant script", () => {
  assert.equal(lyricReadingLanguage("Hello world", "ja"), null);
  assert.equal(lyricReadingLanguage("Olá, ça va?", "zh"), null);
  assert.equal(lyricReadingLanguage("こんにちは", "en"), "ja");
  assert.equal(lyricReadingLanguage("東京へ行く", "zh"), "ja");
  assert.equal(lyricReadingLanguage("今日", "ja-JP"), "ja");
  assert.equal(lyricReadingLanguage("中國音樂", "en"), "zh");
  assert.equal(lyricReadingLanguage("보고 싶다 너무나 기다리는 나의 마음 あ 東京", "ja"), "ko");
  assert.equal(lyricReadingLanguage("世界這麼大還是遇見你 ありがとう", "zh"), "zh");
  assert.equal(lyricReadingLanguage("Обійми мене", "ru"), "uk");
  assert.equal(lyricReadingLanguage("Червона рута", "uk-UA"), "uk");
});

test("traditional Mandarin phrases preserve lexical and grammatical polyphones", async () => {
  const lines = [
    { text:"樂器快樂音樂", start:1, end:3, words:[{text:"音樂", start:2}] },
    { text:"長大後重逢", start:3, end:5, words:[] },
    { text:"看著你難過，著名作者寫著作", start:5, end:8, words:[] },
    { text:"你笑得甜蜜蜜，跑得很快，值得得到獎勵", start:8, end:11, words:[] },
    { text:"", start:11, end:15, words:[] },
  ];
  const result = await romanizeLyricLines(lines, "zh");
  assert.equal(result[0].romanized, "yuè qì kuài lè yīn yuè");
  assert.equal(result[1].romanized, "zhǎng dà hòu chóng féng");
  assert.equal(result[2].romanized, "kàn zhe nǐ nán guò，zhù míng zuò zhě xiě zhù zuò");
  assert.match(result[3].romanized, /xiào de tián mì mì，pǎo de hěn kuài，zhí dé dé dào/);
  assert.equal(result[4].romanized, "");
  assert.deepEqual(result.map(({text,start,end,words}) => ({text,start,end,words})), lines);
});

test("mixed scripts in one lyric line each get a reading with clear word boundaries", async () => {
  const text = "你好Hello보고 싶다東京へ行くПривет 🌸";
  const result = (await romanizeLyricLines([{text,start:1,end:5}], "zh"))[0];
  assert.equal(result.romanized, "nǐ hǎo Hello bogo sipda toukyou e iku Privet 🌸");
  assert.equal(result.text, text);
  assert.equal(result.readingEngine, readingEngine("zh"));
});

test("Japanese volitional auxiliaries preserve the complete long vowel and source ranges", async () => {
  for (const [text, expected] of [["でしょう", "deshou"], ["行こうよ", "ikou yo"], ["そうだろう", "sou darou"], ["待とう", "matou"], ["行っとこう", "ittokou"]]) {
    const reading = await romanizeJapanese(text);
    assert.equal(reading.romanized, expected);
    assert.equal(reading.tokens.map(token => token.surface).join(""), text);
    for (const token of reading.tokens) assert.equal(text.slice(token.start, token.end), token.surface);
  }
});

test("reading requests retain unknown characters and honor cancellation and input limits", async () => {
  const result = (await romanizeLyricLines([{text:"𠮷𰻞"}], "ja"))[0];
  assert.equal(result.romanized, "𠮷𰻞");
  assert.equal(result.readingReviewNeeded, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(romanizeLyricLines([{text:"你好"}], "zh", controller.signal), {name:"AbortError"});
  await assert.rejects(romanizeLyricLines(Array.from({length:401}, () => ({text:""})), "zh"), RangeError);
  await assert.rejects(romanizeLyricLines([{text:"あ".repeat(20_001)}], "ja"), RangeError);
});
