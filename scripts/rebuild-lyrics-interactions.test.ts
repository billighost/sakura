import test from "node:test";
import assert from "node:assert/strict";
import { lyricTitleVariants, lyricEdition } from "../src/rebuild/lyrics/identity";
import { fetchLrcLibLyrics, selectLyricsCandidate, type LrcLibTrack } from "../src/rebuild/lyrics/provider";
import { fetchLyricsOvh, fetchVerifiedLyrics } from "../src/rebuild/lyrics/fallbacks";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import { lyricReadingLanguage, readingEngine } from "../src/rebuild/lyrics/language";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";
import { parseLyricSubmission, publishLyrics, solvePublishChallenge } from "../src/rebuild/lyrics/publish";
import { collectionTrackMatches } from "../src/rebuild/app/collectionSearch";
import { albumHref } from "../src/rebuild/app/AlbumLink";
import { musicTrack, type MusicTrack } from "../src/rebuild/app/types";
import { createHash } from "node:crypto";

const candidate:LrcLibTrack={id:100,trackName:"Song",artistName:"Artist",albumName:"Album",duration:180,plainLyrics:"Original words"};
test("catalogue annotations normalize while every significant edition stays distinct",()=>{
  assert.equal(selectLyricsCandidate({title:"Song - 2011 Remaster",artist:"Artist",durationSeconds:180},[candidate]).status,"matched");
  assert.equal(selectLyricsCandidate({title:"Song (feat. Friend)",artist:"Artist",durationSeconds:180},[candidate]).status,"matched");
  for(const edition of ["Live","Acoustic","Remix","Instrumental","Sped Up","Slowed","Radio Edit"]){
    assert.equal(selectLyricsCandidate({title:`Song (${edition})`,artist:"Artist",durationSeconds:180},[candidate]).status,"missing",edition);
    assert.equal(selectLyricsCandidate({title:"Song",artist:"Artist",durationSeconds:180},[{...candidate,trackName:`Song (${edition})`}]).status,"missing",edition);
  }
  assert.equal(selectLyricsCandidate({title:"Song",artist:"Artist",durationSeconds:180},[{...candidate,albumName:"Live 2003"}]).status,"missing");
  assert.deepEqual(lyricTitleVariants("Song (Part II)"),["Song (Part II)"]);
  assert.deepEqual(lyricTitleVariants('My Heart Will Go On (Love Theme from "Titanic")'),['My Heart Will Go On (Love Theme from "Titanic")','My Heart Will Go On']);
  assert.equal(selectLyricsCandidate({title:"Song",artist:"Artist",durationSeconds:180},[{...candidate,artistName:"Someone else"}]).status,"missing");
});
test("Chinese instrumental catalogue title cannot borrow vocal words, even if durations agree",()=>{
  const vocal="众里寻他千百度(电视剧《逐玉》爱情主题曲) (The Endless Quest (Love Theme Song from the TV Series ''Pursuit of Jade''))";
  const title=vocal+" (伴奏版)";
  assert.ok(lyricEdition(title).includes("instrumental"));
  assert.equal(selectLyricsCandidate({title,artist:"张碧晨",durationSeconds:180},[{...candidate,trackName:title,artistName:"张碧晨"}]).status,"missing");
  assert.equal(selectLyricsCandidate({title,artist:"张碧晨",durationSeconds:180},[{...candidate,trackName:title,artistName:"张碧晨",instrumental:true,plainLyrics:null}]).status,"matched");
});
test("search reaches individual credits and normalized title; it never needs a catalogue call",async()=>{
  const urls:string[]=[];
  const result=await fetchLrcLibLyrics({title:"Song - 2011 Remaster",artist:"First",artists:["First","Second","Third","Artist"],durationSeconds:180}, {fetch:async url=>{
    urls.push(String(url));const q=new URL(String(url));
    return q.pathname.endsWith("/search")&&q.searchParams.get("track_name")==="Song"&&q.searchParams.get("artist_name")==="Artist"?Response.json([candidate]):new Response(null,{status:404});
  }});
  assert.equal(result.status,"matched");assert.ok(urls.length<=24);
});
test("plain fallback refuses instrumental and distinct editions",async()=>{
  let requests=0;
  for(const title of ["Song (Instrumental)","Song (Remix)","Song (Live)"]){
    const result=await fetchLyricsOvh({title,artist:"Artist"},{fetch:async()=>{requests++;return Response.json({lyrics:"Vocal words"});}});
    assert.equal(result.status,"missing");
  }
  assert.equal(requests,0);
});
test("explicit lyric refresh bypasses a negative server cache",async()=>{
  let requests=0;
  const resolver=createLyricsResolver({load:async()=>++requests===1?{status:"missing",reason:"not yet indexed"}:{status:"matched",track:candidate,provider:"lrclib"}});
  const identity={title:"Song",artist:"Artist"};
  assert.equal((await resolver(identity)).status,"missing");
  assert.equal((await resolver(identity,true)).status,"matched");
});
test("plain results wait for another provider's verified timestamps",async()=>{
  const result=await fetchVerifiedLyrics({title:"Song",artist:"Artist"},{providers:[
    async()=>({status:"matched",provider:"lrclib",track:candidate}),
    async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {status:"matched",provider:"netease",track:{...candidate,syncedLyrics:"[00:01]Original words"}};},
  ]});
  assert.equal(result.status,"matched");if(result.status==="matched")assert.equal(result.provider,"netease");
});
test("synced LRCLIB search can improve an exact plain response",async()=>{
  const result=await fetchLrcLibLyrics({title:"Song",artist:"Artist",durationSeconds:180},{fetch:async url=>Response.json(new URL(String(url)).pathname.endsWith("/get")?candidate:[{...candidate,id:101,syncedLyrics:"[00:01]Original words"}])});
  assert.equal(result.status,"matched");if(result.status==="matched")assert.ok(result.track.syncedLyrics);
});
test("publishing replaces negative and pre-publication server flights",async()=>{
  let finish!:(value:import("../src/rebuild/lyrics/provider").LyricMatch)=>void;
  const resolver=createLyricsResolver({load:()=>new Promise(resolve=>{finish=resolve;})}),identity={title:"Song",artist:"Artist"};
  const old=resolver(identity);
  resolver.remember(identity,{status:"matched",provider:"lrclib",track:candidate});
  finish({status:"missing",reason:"old index"});
  assert.equal((await old).status,"matched");assert.equal((await resolver(identity)).status,"matched");
});
test("language detection separates Han, kana, Hangul and mixed lyric lines",()=>{
  assert.equal(lyricReadingLanguage("众里寻他千百度"),"zh");
  assert.equal(lyricReadingLanguage("夜に駆ける"),"ja");
  assert.equal(lyricReadingLanguage("보고 싶다"),"ko");
  assert.equal(lyricReadingLanguage("今日","ja"),"ja");
  assert.equal(lyricReadingLanguage("Hello"),null);
  assert.notEqual(readingEngine("zh"),readingEngine("ko"));
});
test("Chinese Pinyin, Korean sound rules and Japanese contextual readings preserve all source fields",async()=>{
  const line={text:"你好，中国！ Hello 🌸",start:2,end:5,words:[{text:"你好",start:2}]};
  const zh=(await romanizeLyricLines([line],"zh"))[0];
  assert.match(zh.romanized,/nǐ hǎo/);assert.match(zh.romanized,/zhōng guó/);assert.ok(zh.romanized.endsWith(" Hello 🌸"));
  assert.deepEqual({text:zh.text,start:zh.start,end:zh.end,words:zh.words},line);
  const ko=(await romanizeLyricLines([{text:"보고 싶다 한국어",start:1}],"ko"))[0];
  assert.match(ko.romanized,/bogo/);assert.match(ko.romanized,/hangugeo/);
  const ja=(await romanizeLyricLines([{text:"東京へ行く",start:1}],"ja"))[0];assert.match(ja.romanized,/toukyou e iku/);
  const mixed=await romanizeLyricLines([{text:"你好",start:1},{text:"보고 싶다",start:2},{text:"東京へ行く Hello",start:3}],"zh");
  assert.match(mixed[1].romanized,/bogo/);assert.match(mixed[2].romanized,/toukyou e iku Hello/);
  assert.equal((await romanizeLyricLines([{text:"Привет мир",start:0}],"ru"))[0].readingReviewNeeded,true);
});
test("official LRCLIB publishing uses a fresh challenge, decimal proof, then reads the submitted signature",async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const result=await publishLyrics({title:"Song",artist:"Artist",album:"Album",durationSeconds:180},{text:"Original words",format:"plain"},{fetch:async(url,init)=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith("request-challenge"))return Response.json({prefix:"test",target:"f".repeat(64)});
    if(String(url).endsWith("publish"))return new Response(null,{status:201});
    return Response.json(candidate);
  }});
  assert.equal(result.published,true);assert.equal(result.track?.id,100);assert.equal(calls.length,3);
  assert.equal((calls[1].init?.headers as Record<string,string>)["X-Publish-Token"],"test:0");
  assert.equal(JSON.parse(calls[1].init!.body as string).trackName,"Song");
  const token=await solvePublishChallenge("test","0"+"f".repeat(63),new AbortController().signal);
  assert.ok(createHash("sha256").update(token.replace(":","")).digest("hex")<="0"+"f".repeat(63));
});
test("successful publication with a delayed provider read never becomes a failed upload",async()=>{
  const result=await publishLyrics({title:"Song",artist:"Artist",album:"Album",durationSeconds:180},{text:"Words",format:"plain"},{fetch:async url=>String(url).endsWith("request-challenge")?Response.json({prefix:"test",target:"f".repeat(64)}):String(url).endsWith("publish")?new Response(null,{status:201}):new Response(null,{status:503})});
  assert.equal(result.published,true);assert.equal(result.track,undefined);
});
test("publish rejects wrong instrumental editions, missing metadata and malformed LRC before transport",()=>{
  const identity={title:"Song",artist:"Artist",album:"Album",durationSeconds:180};
  assert.throws(()=>parseLyricSubmission({text:"Vocal words",format:"plain"},{...identity,title:"Song (伴奏版)"}));
  assert.throws(()=>parseLyricSubmission({text:"[05:00]Too late",format:"lrc"},identity));
  assert.throws(()=>parseLyricSubmission({text:"[00:01]one\nunstamped words",format:"lrc"},identity));
  for(const text of ["[00:99]bad seconds","[00:01 incomplete","[00:01][00:72]bad second tag"])assert.throws(()=>parseLyricSubmission({text,format:"lrc"},identity));
  assert.throws(()=>parseLyricSubmission({text:"words",format:"plain"},{...identity,album:undefined}));
});
test("delayed publication reads retry without accepting stale lyric text",async()=>{
  let reads=0;
  const result=await publishLyrics({title:"Song",artist:"Artist",album:"Album",durationSeconds:180},{text:"Original words",format:"plain"},{fetch:async url=>String(url).endsWith("request-challenge")?Response.json({prefix:"test",target:"f".repeat(64)}):String(url).endsWith("publish")?new Response(null,{status:201}):Response.json(++reads===1?{...candidate,plainLyrics:"Older words"}:candidate)});
  assert.equal(reads,2);assert.equal(result.track?.plainLyrics,"Original words");
});
test("collection queries match every credit, albums, accents, non-Latin and words in any order",()=>{
  const track={title:"Étoile",artists:["Primary"],artistCredits:[{name:"Beyoncé",role:"featured"}],albumTitle:"蓝色 Album",versionLabel:"Acoustic",alternateTitles:["Star"]} as MusicTrack;
  for(const query of ["beyonce","蓝色","album Beyonce","etoile acoustic","star","  ALBUM    primary "])assert.equal(collectionTrackMatches(track,query),true,query);
  assert.equal(collectionTrackMatches(track,"someone else"),false);
});
test("album navigation uses identity and preserves hydrated provider references",()=>{
  assert.equal(albumHref({albumId:null,albumReference:{provider:"spotify",id:"known"}}),"/album/spotify%3Aknown");
  assert.equal(albumHref({albumId:null}),null);
  assert.equal(albumHref({albumId:"canonical"}),"/album/canonical");
  const track=musicTrack({recordingId:"recording",reference:{provider:"deezer",id:"1"},metadata:{title:"Song",artists:["Artist"],durationMs:180000,albumReference:{provider:"deezer",id:"2"}}});
  assert.equal(albumHref(track),"/album/deezer%3A2");
});
