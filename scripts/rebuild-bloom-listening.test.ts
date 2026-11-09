import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomWindow,bloomWindows} from "../src/rebuild/bloom/calendar";
import {buildBloomListening,discloseBloomListening} from "../src/rebuild/bloom/listening";
import {buildBloomSnapshot} from "../src/rebuild/bloom/snapshot";
import {bloomChapterTitle,bloomWorldVoice} from "../src/rebuild/bloom/story";
import {BLOOM_WORLDS} from "../src/rebuild/bloom/worlds/registry";
import type {RecordingCard} from "../src/rebuild/data/catalog";

const item=bloomWindow("monthly-2026-10",new Date("2026-11-07T12:00:00Z"));
const song=(id:string,artistId:string|null,genres:string[]=[]):RecordingCard=>({id,recordingId:id,title:`Song ${id}`,artists:[`Artist ${artistId}`],
 durationMs:300000,metadata:{},coverUrl:null,artistImageUrl:null,artistId,albumId:null,albumTitle:null,reference:{provider:"deezer",id},references:[],genres,popularity:0,playability:"resolvable",artistCredits:[{name:`Artist ${artistId}`,artistId,role:"primary"}]});
const heard=(id:string,audible_ms:number,plays=1,first_ever:string|null="2026-10-05T12:00:00Z")=>({id,audible_ms,plays,first_ever});

describe("Bloom's richer retained listening measurements",()=>{
 it("divides time across unique published genres and keeps untagged time unknown",()=>{
  const result=buildBloomListening([heard("a",120000),heard("b",60000),heard("missing",30000)],
   [song("a","artist-a",[" Jazz ","jazz","Soul"]),song("b","artist-b")],1,item).profile;
  assert.equal(result.audibleMs,210000);assert.equal(result.genreCount,2);assert.equal(result.unknownGenreMs,90000);
  assert.deepEqual(result.genres?.map(row=>[row.name,row.audibleMs]),[["Jazz",60000],["Soul",60000]]);
  assert.equal(result.genres!.reduce((sum,row)=>sum+row.audibleMs,0)+result.unknownGenreMs!,result.audibleMs);
  assert.ok(result.genres!.reduce((sum,row)=>sum+row.share,0)<1);
 });
 it("distinguishes repeat sessions, earlier songs, new songs by familiar artists, and undated imports",()=>{
  const rows=[heard("old",60000,1,"2026-09-01"),heard("fresh-familiar",60000),heard("new",60000),heard("unknown",60000,2),heard("no-date",30000,1,null)];
  const cards=[song("old","a"),song("fresh-familiar","a"),song("new","b"),song("unknown","c"),song("no-date","d")];
  const result=buildBloomListening(rows,cards,2,item,{discoveryUnknownIds:["unknown"]});
  assert.equal(result.profile.returningRecordingCount,2);assert.equal(result.profile.returningArtistCount,1);
  assert.deepEqual([...result.discoveredIds], ["fresh-familiar","new"]);
  assert.equal(result.profile.discoveredArtistCount,1);assert.equal(result.profile.artistCount,4);
 });
 it("uses prior artist identity without treating names or selected preferences as listening",()=>{
  const cards=[song("new-song","known-artist"),song("other-song","different-artist")];
  cards[1].artists=cards[0].artists;
  const result=buildBloomListening([heard("new-song",60000),heard("other-song",60000)],cards,1,item,{knownBeforeArtistKeys:["known-artist"]});
  assert.equal(result.profile.returningArtistCount,1);assert.equal(result.profile.discoveredArtistCount,1);
  assert.equal(result.profile.discoveredRecordingCount,2);
  const featuredOnly=song("unlinked","featured");
  featuredOnly.artistCredits=[{name:"Unlinked main artist",artistId:null,role:"primary"},{name:"Featured artist",artistId:"featured",role:"featured"}];
  const unknownArtist=buildBloomListening([heard("unlinked",60000)],[featuredOnly],1,item);
  assert.equal(unknownArtist.profile.artistCount,0);assert.equal(unknownArtist.profile.discoveredArtistCount,0);
  const snapshot=buildBloomSnapshot([heard("unlinked",60000)],[featuredOnly],1,item);
  assert.ok(!snapshot.chapters.some(chapter=>chapter.id==="top-artist"));
 });
 it("does not call an imported artist a discovery through a newly recorded song",()=>{
  const profile=buildBloomListening([heard("new",60000)],[song("new","a")],1,item,{discoveryUnknownArtistKeys:["a"]}).profile;
  assert.equal(profile.discoveredRecordingCount,1);assert.equal(profile.discoveredArtistCount,0);
  const incomplete=buildBloomListening([heard("new",60000)],[song("new","a")],1,item,{discoveryHistoryIncomplete:true});
  assert.equal(incomplete.profile.discoveredRecordingCount,undefined);assert.equal(incomplete.profile.discoveredArtistCount,undefined);assert.equal(incomplete.discoveredIds.size,0);
 });
 it("does not give a primary artist the first linked featured artist's portrait",()=>{
  const referenceOnly=song("ref-primary","featured");referenceOnly.artistImageUrl="https://example.invalid/featured-portrait.jpg";
  referenceOnly.artistCredits=[{name:"Main artist",artistId:null,role:"primary",reference:{provider:"deezer",id:"verified-primary-reference"}},{name:"Featured artist",artistId:"featured",role:"featured"}];
  const primary=buildBloomSnapshot([heard("ref-primary",60000)],[referenceOnly],1,item).chapters.find(chapter=>chapter.id==="top-artist")?.artists?.[0];
  assert.equal(primary?.name,"Main artist");assert.equal(primary?.key,"deezer:verified-primary-reference");assert.equal(primary?.artistId,null);assert.equal(primary?.imageUrl,null);
  const matching=song("matching-primary","main");matching.artistImageUrl="https://example.invalid/main-portrait.jpg";
  const safe=buildBloomSnapshot([heard("matching-primary",60000)],[matching],1,item).chapters.find(chapter=>chapter.id==="top-artist")?.artists?.[0];
  assert.equal(safe?.imageUrl,matching.artistImageUrl);
 });
 it("keeps missing hours unknown and maps measured hours without counting plays as time",()=>{
  const rows=[heard("a",60000,99)],cards=[song("a","a")];
  assert.equal(buildBloomListening(rows,cards,1,item).profile.peakHour,null);
  const profile=buildBloomListening(rows,cards,1,item,{hours:[{hour:23,audibleMs:45000},{hour:8,audibleMs:15000}]}).profile;
  assert.equal(profile.peakHour,23);assert.equal(profile.hourBands?.find(band=>band.id==="night")?.share,.75);
  assert.equal(profile.hourBands?.reduce((sum,band)=>sum+band.audibleMs,0),60000);
 });
 it("compares adjacent full calendar periods with canonical song and artist overlap",()=>{
  const cards=[song("shared","a"),song("new-song","a")],previousCards=[song("shared","a"),song("prior-only","b")];
  const profile=buildBloomListening([heard("shared",120000),heard("new-song",60000)],cards,1,item,
   {previous:{periodLabel:"Previous month",rows:[heard("shared",30000),heard("prior-only",30000)],cards:previousCards}}).profile;
  assert.deepEqual(profile.comparison,{periodLabel:"Previous month",audibleMs:60000,changeMs:120000,sharedRecordingCount:1,sharedArtistCount:1});
  const absent=buildBloomListening([heard("a",60000)],[song("a","a")],1,item,{previous:{periodLabel:"Previous month",rows:[],cards:[]}}).profile;
  assert.equal(absent.comparison,null);
  const dst=bloomWindow("weekly-2026-03-02",new Date("2026-03-09T12:00:00Z"),"America/New_York");
  const previous=bloomWindows(dst.period,new Date(dst.periodStart),dst.timeZone)[0];
  assert.equal(previous.periodEnd,dst.periodStart);assert.equal(Date.parse(dst.periodEnd)-Date.parse(dst.periodStart),167*3600000);
 });
 it("withholds every new measurement until its own chapter reveals",()=>{
  const profile=buildBloomListening([heard("a",60000,2)],[song("a","a",["Jazz"])],1,item,{hours:[{hour:8,audibleMs:60000}]}).profile;
  assert.equal(discloseBloomListening(profile,new Set()),undefined);
  assert.deepEqual(discloseBloomListening(profile,new Set(["time"])),{timeZone:item.timeZone,audibleMs:60000});
  const genres=discloseBloomListening(profile,new Set(["genres"]));
  assert.equal(genres?.genreCount,1);assert.equal(genres?.returningRecordingCount,undefined);assert.equal(genres?.peakHour,undefined);
  assert.equal(discloseBloomListening(profile,new Set(["artists"]))?.returningArtistCount,undefined);
  assert.equal(discloseBloomListening(profile,new Set(["pattern"]))?.peakHour,8);
  assert.equal(discloseBloomListening(profile,new Set(),true),profile);assert.equal(discloseBloomListening(undefined,new Set(),true),undefined);
 });
 it("keeps sparse snapshots honest and does not double up time comparisons",()=>{
  const data=buildBloomSnapshot([heard("a",60000)],[song("a","a",["Jazz","Soul"])],1,item,
   {hours:[{hour:8,audibleMs:60000}],previous:{periodLabel:"Previous month",rows:[heard("a",30000)],cards:[song("a","a")]}});
  assert.equal(data.version,4);assert.equal(data.listening?.genreCount,2);assert.ok(data.chapters.some(chapter=>chapter.id==="period-comparison"));
  assert.ok(!data.chapters.some(chapter=>chapter.id==="time-comparison"));assert.ok(!data.chapters.some(chapter=>chapter.id==="listening-moments"));
  assert.equal(buildBloomSnapshot([],[],0,item).listening,undefined);
  const unknown=buildBloomSnapshot([heard("a",60000,1,null)],[song("a","a")],1,item);
  assert.ok(!unknown.chapters.some(chapter=>chapter.id==="discoveries"));
 });
 it("gives all ten worlds distinct introductions, reveals and final scenes",()=>{
  for(const kind of ["genres","returns","pattern","finale"] as const){const titles=BLOOM_WORLDS.map(world=>bloomChapterTitle(world.id,kind));assert.equal(new Set(titles).size,10);}
  assert.equal(new Set(BLOOM_WORLDS.map(world=>bloomWorldVoice(world.id).opening)).size,10);
  assert.equal(new Set(BLOOM_WORLDS.map(world=>bloomWorldVoice(world.id).closing)).size,10);
 });
});
