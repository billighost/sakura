import assert from "node:assert/strict";
import {test} from "node:test";
import {chooseReadingLanguage,rememberReadingGuides} from "../src/rebuild/player/readingCache";
import {readingEngine} from "../src/rebuild/lyrics/language";
import type {PlayerLyrics} from "../src/rebuild/player/useLyrics";
import {LYRIC_WEEK_MS,lyricCacheFresh,lyricProviderCheckedAt} from "../src/rebuild/player/lyricCachePolicy";

test("synced lyrics remain permanent while plain and missing lookups check weekly without deleting content",()=>{
 const checkedAt=1700000000000;
 for(const timing of ["plain","missing"] as const){
  assert.equal(lyricCacheFresh(timing,checkedAt,checkedAt+LYRIC_WEEK_MS-1),true);
  assert.equal(lyricCacheFresh(timing,checkedAt,checkedAt+LYRIC_WEEK_MS),false);
  assert.equal(lyricCacheFresh(timing,checkedAt,checkedAt+180*86400000),false);
 }
 assert.equal(lyricCacheFresh("synced",checkedAt,checkedAt+365*86400000),true);
});

test("reading saves preserve the provider check timestamp and successful provider refresh replaces it",()=>{
 const previous={savedAt:1700000000000,checkedAt:1699900000000},savedAt=1800000000000;
 assert.equal(lyricProviderCheckedAt({savedAt},previous),previous.checkedAt);
 assert.equal(lyricProviderCheckedAt({savedAt,checkedAt:savedAt},previous),savedAt);
 assert.equal(lyricProviderCheckedAt({savedAt},{savedAt:previous.savedAt}),previous.savedAt,"Legacy caches keep their original provider date");
});

const source:PlayerLyrics={schemaVersion:"verified-lyrics-v3",lines:[{text:"君の声",start:0,end:10}],timing:"plain",provider:"fixture",providerTrackId:1,hasJapanese:true,readingLanguage:"ja"};

test("changing reading language and auto-sync timing reuses each completed guide",()=>{
 const japanese={...source,lines:source.lines.map(line=>({...line,romanized:"kimi no koe",readingEngine:readingEngine("ja")}))};
 let guides=rememberReadingGuides(undefined,japanese);
 const chinese=chooseReadingLanguage(japanese,"zh",guides);assert.equal(chinese.lines[0].romanized,undefined);
 guides=rememberReadingGuides(guides,{...chinese,lines:chinese.lines.map(line=>({...line,romanized:"jūn de shēng",readingEngine:readingEngine("zh")}))});
 const synced={...source,timing:"synced" as const,lines:[{text:"君の声",start:3,end:9}]};
 const restored=chooseReadingLanguage(synced,"ja",guides);
 assert.equal(restored.lines[0].romanized,"kimi no koe");assert.equal(restored.lines[0].start,3);assert.equal(restored.lines[0].end,9);
 assert.equal(chooseReadingLanguage(restored,"zh",guides).lines[0].romanized,"jūn de shēng");
});

test("provider edits and obsolete engines cannot borrow a cached pronunciation",()=>{
 const japanese={...source,lines:source.lines.map(line=>({...line,romanized:"kimi no koe",readingEngine:readingEngine("ja")}))};
 const guides=rememberReadingGuides(undefined,japanese);
 const edited={...source,lines:[{text:"未来の光",start:0,end:10}]};
 assert.equal(chooseReadingLanguage(edited,"ja",guides).lines[0].romanized,undefined);
 assert.deepEqual(rememberReadingGuides(guides,edited),{});
 assert.equal(chooseReadingLanguage(source,"ja",{ja:{...guides.ja!,engine:"obsolete-engine"}}).lines[0].romanized,undefined);
});
