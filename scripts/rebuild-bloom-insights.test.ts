import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomWindow} from "../src/rebuild/bloom/calendar";
import {buildBloomListening,discloseBloomListening,normaliseBloomRows} from "../src/rebuild/bloom/listening";
import {buildBloomSnapshot,discloseBloomChapter} from "../src/rebuild/bloom/snapshot";
import type {RecordingCard} from "../src/rebuild/data/catalog";

const month=bloomWindow("monthly-2026-10",new Date("2026-11-07T12:00:00Z"));
const song=(id:string,artistId="artist-a"):RecordingCard=>({id,recordingId:id,title:`Song ${id}`,artists:[artistId],durationMs:180000,
 metadata:{},coverUrl:null,artistImageUrl:null,artistId,albumId:null,albumTitle:null,reference:{provider:"deezer",id},references:[],
 genres:["Jazz","Soul"],popularity:0,playability:"resolvable",artistCredits:[{name:artistId,artistId,role:"primary"}]});
const heard=(id:string,audible_ms:number,plays=1,first_ever:string|null="2026-10-05T12:00:00Z")=>({id,audible_ms,plays,first_ever});

describe("Bloom insight accuracy and period depth",()=>{
 it("counts every leading-artist song while displaying only the top three",()=>{
  const cards=Array.from({length:6},(_,i)=>song(`song-${i}`)),rows=cards.map((card,i)=>heard(card.id,60000*(i+1)));
  const snapshot=buildBloomSnapshot(rows,cards,3,month),chapter=snapshot.chapters.find(value=>value.id==="artist-songs")!;
  assert.equal(chapter.stat.value,6);assert.equal(chapter.artists?.[0].recordingCount,6);assert.equal(chapter.recordings?.length,3);
  assert.match(chapter.detail!,/6 songs/);assert.deepEqual(chapter.recordings?.map(value=>value.recording.id),["song-5","song-4","song-3"]);
 });
 it("normalises duplicate aggregates and excludes invalid time and play counts",()=>{
  const rows=[heard("a",60000,2),heard("a",30000,Number.NaN),heard("b",20000,-9),heard("bad",Infinity,5),heard("negative",-20,3)];
  const clean=normaliseBloomRows(rows);assert.equal(clean.length,2);assert.equal(clean[0].audible_ms,90000);assert.equal(clean[0].plays,2);
  const snapshot=buildBloomSnapshot(rows,[song("a"),song("b")],NaN,month);
  assert.deepEqual(snapshot.summary,{audibleMs:110000,playCount:2,recordingCount:2,activeDays:0});
  assert.ok(snapshot.chapters.every(chapter=>typeof chapter.stat.value!=="number"||Number.isFinite(chapter.stat.value)));
 });
 it("does not promote a known song when the actual replay winner lacks metadata",()=>{
  const snapshot=buildBloomSnapshot([heard("missing",60000,9),heard("known",120000,3)],[song("known")],1,month);
  assert.ok(!snapshot.chapters.some(chapter=>chapter.id==="most-replayed"));
 });
 it("measures first-recorded and multi-play song shares by time rather than play count",()=>{
  const rows=[heard("old",180000,2,"2026-09-01"),heard("new",60000,7)];
  const profile=buildBloomListening(rows,[song("old"),song("new")],2,month).profile;
  assert.equal(profile.repeatListeningShare,1);assert.equal(profile.discoveryListeningShare,.25);assert.equal(profile.averageActiveDayMs,120000);
  const unknown=buildBloomListening(rows,[song("old"),song("new")],2,month,{discoveryHistoryIncomplete:true}).profile;
  assert.equal(unknown.discoveryListeningShare,undefined);assert.notEqual(unknown.listeningIdentity?.name,"The new-song explorer");
 });
 it("uses local calendar dates for streaks across a daylight-saving transition",()=>{
  const march=bloomWindow("monthly-2026-03",new Date("2026-04-10T12:00:00Z"),"America/New_York");
  const profile=buildBloomListening([heard("a",240000,2,"2026-03-07")],[song("a")],4,march,
   {days:[{date:"2026-03-07",audibleMs:60000},{date:"2026-03-08",audibleMs:60000},{date:"2026-03-09",audibleMs:60000},{date:"2026-03-11",audibleMs:60000}]}).profile;
  assert.deepEqual(profile.longestStreak,{days:3,startDate:"2026-03-07",endDate:"2026-03-09"});
  assert.deepEqual(profile.peakDay,{date:"2026-03-07",audibleMs:60000});assert.equal(profile.weekendListeningShare,.5);
  assert.deepEqual(profile.months,[{month:"2026-03",audibleMs:240000}]);
 });
 it("ignores impossible and out-of-period calendar data instead of inventing milestones",()=>{
  const profile=buildBloomListening([heard("a",60000)],[song("a")],1,month,
   {days:[{date:"2026-02-30",audibleMs:60000},{date:"2026-09-30",audibleMs:60000},{date:"2026-10-02",audibleMs:NaN}]}).profile;
  assert.equal(profile.peakDay,undefined);assert.equal(profile.longestStreak,undefined);assert.equal(profile.months,undefined);
 });
 it("withholds whole-period milestones when local-date coverage is incomplete",()=>{
  const profile=buildBloomListening([heard("a",180000)],[song("a")],3,month,
   {days:[{date:"2026-10-10",audibleMs:60000},{date:"2026-10-11",audibleMs:60000}]}).profile;
  assert.equal(profile.peakDay,undefined);assert.equal(profile.longestStreak,undefined);assert.equal(profile.months,undefined);assert.equal(profile.weekendListeningShare,undefined);
  const snapshot=buildBloomSnapshot([heard("a",180000)],[song("a")],3,month,
   {days:[{date:"2026-10-10",audibleMs:60000},{date:"2026-10-11",audibleMs:60000}]});
  assert.ok(!snapshot.chapters.some(chapter=>["peak-day","listening-streak","weekend-rhythm","active-months"].includes(chapter.id)));
 });
 it("keeps new milestones private until their individual reveal",()=>{
  const profile=buildBloomListening([heard("a",120000,2)],[song("a")],2,month,
   {days:[{date:"2026-10-10",audibleMs:60000},{date:"2026-10-11",audibleMs:60000}],hours:[{hour:23,audibleMs:120000}]}).profile;
  const pattern=discloseBloomListening(profile,new Set(["pattern"]));
  assert.equal(pattern?.peakHour,23);assert.equal(pattern?.peakDay,undefined);assert.equal(pattern?.longestStreak,undefined);assert.equal(pattern?.listeningIdentity,undefined);
  const peak=discloseBloomListening(profile,new Set(["peak-day"]));assert.deepEqual(peak?.peakDay,profile.peakDay);assert.equal(peak?.months,undefined);
  assert.equal(discloseBloomListening(profile,new Set(["active-months"]))?.months,undefined);
  assert.equal(discloseBloomListening(profile,new Set(["listening-character"]))?.listeningIdentity,profile.listeningIdentity);
 });
 it("gives monthly stories more insight chapters and yearly stories a longer measured journey",()=>{
  const cards=Array.from({length:8},(_,i)=>song(`song-${i}`,`artist-${i%3}`));
  const rows=cards.map((card,i)=>heard(card.id,300000*(i+1),i%2?1:3,i%3?"2026-10-05":"2025-12-01"));
  const total=rows.reduce((sum,row)=>sum+row.audible_ms,0);
  const monthly=buildBloomSnapshot(rows,cards,3,month,{hours:[{hour:8,audibleMs:total}],days:[{date:"2026-10-05",audibleMs:total/3},{date:"2026-10-06",audibleMs:total/3},{date:"2026-10-10",audibleMs:total/3}]});
  const week=bloomWindow("weekly-2026-10-05",new Date("2026-10-12T12:00:00Z"));
  const weekly=buildBloomSnapshot(rows,cards,3,week,{hours:[{hour:8,audibleMs:total}]});
  const year=bloomWindow("yearly-2026",new Date("2027-01-10T12:00:00Z"));
  const yearly=buildBloomSnapshot(rows,cards,6,year,{hours:[{hour:8,audibleMs:total}],days:["01","03","06","07","10","12"].map((m)=>({date:`2026-${m}-05`,audibleMs:total/6}))});
  assert.ok(monthly.chapters.length>=weekly.chapters.length+6);assert.ok(yearly.chapters.length>=monthly.chapters.length+5);
  for(const id of ["active-months","peak-month","year-opening","year-closing","season-spotlight","half-year-shift","weekend-rhythm"])assert.ok(yearly.chapters.some(chapter=>chapter.id===id),id);
  assert.equal(new Set(yearly.chapters.map(chapter=>chapter.id)).size,yearly.chapters.length);
  for(const chapter of yearly.chapters){const hidden=discloseBloomChapter(chapter,false);assert.equal(hidden.stat,null);assert.equal(hidden.detail,null);assert.equal(hidden.comparison,null);}
 });
});
