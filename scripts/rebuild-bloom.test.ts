import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { describe,it } from "node:test";
import { bloomWindow,bloomWindows,currentBloomId,validTimeZone } from "../src/rebuild/bloom/calendar";
import { bloomDesignForMonth,bloomDesignForPeriod,legacyBloomDesignForMonth,bloomDesignForItem } from "../src/rebuild/bloom/design";
import { groupArtistCards } from "../src/rebuild/data/artistSelection";
import { preferencesPatch } from "../src/rebuild/data/validation";
import { eligibleSituations,planOfflineMixes,SITUATIONAL_MIXES } from "../src/rebuild/recommendations/situations";
import { planMixes } from "../src/rebuild/recommendations/planner";
import {buildBloomSnapshot,discloseBloomChapter} from "../src/rebuild/bloom/snapshot";
import {listeningComparison,listeningDuration} from "../src/rebuild/bloom/comparisons";
import {deviceBloomTier,selectedBloomTier} from "../src/rebuild/bloom/performance";
import {resumeBloomIndex} from "../src/rebuild/bloom/story";
import type {RecordingCard} from "../src/rebuild/data/catalog";
import type {BloomRecap} from "../src/rebuild/bloom/uiTypes";
describe("Bloom calendar and truthful discovery rules",()=>{
  it("uses every Bloom design in a stable monthly rotation without consecutive repeats",()=>{
    const months=Array.from({length:30},(_,index)=>new Date(Date.UTC(2025,index,15)));
    const selected=months.map(date=>bloomDesignForMonth(date,"Africa/Lagos"));
    const worlds=["sakura","jungle","disco","japan","china","korea","india","ocean","cosmos","glass"].sort();
    for(let index=1;index<selected.length;index++)assert.notEqual(selected[index],selected[index-1]);
    for(let index=0;index<30;index+=10)assert.deepEqual(selected.slice(index,index+10).sort(),worlds);
    assert.equal(bloomDesignForMonth("2026-11-01T00:30:00+01:00","Africa/Lagos"),bloomDesignForMonth("2026-11-01T00:30:00+01:00","Africa/Lagos"));
    assert.notEqual(bloomDesignForMonth("2026-10-31T23:30:00Z","Africa/Lagos"),bloomDesignForMonth("2026-10-31T23:30:00Z","America/New_York"));
  });
  it("advances weekly Bloom worlds across month and year boundaries without repeats",()=>{
    const mondays=Array.from({length:80},(_,index)=>new Date(Date.UTC(2025,9,27+index*7)));
    const selected=mondays.map(date=>bloomDesignForPeriod("weekly",date,"Africa/Lagos"));
    for(let index=1;index<selected.length;index++)assert.notEqual(selected[index],selected[index-1]);
    assert.equal(new Set(selected).size,10);
    assert.notEqual(bloomDesignForPeriod("weekly",new Date("2026-10-26T00:00:00Z")),bloomDesignForPeriod("weekly",new Date("2026-11-02T00:00:00Z")));
    assert.notEqual(bloomDesignForPeriod("weekly",new Date("2026-12-28T00:00:00Z")),bloomDesignForPeriod("weekly",new Date("2027-01-04T00:00:00Z")));
    assert.equal(bloomDesignForPeriod("weekly",new Date("2027-01-04T00:00:00Z")),bloomDesignForPeriod("weekly",new Date("2027-01-04T00:00:00Z")));
  });
  it("keeps the assigned world fixed and centers touch-safe header controls",()=>{
    const story=readFileSync("src/rebuild/bloom/CinematicBloomStory.tsx","utf8"),page=readFileSync("src/rebuild/bloom/CinematicBloomPage.tsx","utf8"),shelf=readFileSync("src/rebuild/bloom/BloomShelf.tsx","utf8"),css=readFileSync("src/rebuild/bloom/cinema.module.css","utf8");
    assert.doesNotMatch(story,/aria-label="Bloom world"/);assert.doesNotMatch(page,/Open in this world/);
    assert.match(page,/process\.env\.NODE_ENV!=="production"\?query\.get\("world"\):null/);
    assert.match(css,/\.story \.headerControls button\{display:inline-flex;align-items:center;justify-content:center;gap:7px/);
    assert.match(css,/min-width:44px;min-height:44px/);assert.match(css,/@media\(max-width:750px\)\{\.story \.headerControls \.controlLabel\{display:none\}/);
    assert.doesNotMatch(page,/BloomSurpriseCover/);assert.doesNotMatch(shelf,/BloomSurpriseCover/);
  });
  it("unlocks Monday locally and expires before Sunday starts",()=>{
    const id="weekly-2026-10-26";
    assert.equal(bloomWindow(id,new Date("2026-11-01T22:59:59Z")).status,"locked");
    assert.equal(bloomWindow(id,new Date("2026-11-01T23:00:00Z")).status,"available");
    assert.equal(bloomWindow(id,new Date("2026-11-07T22:59:59Z")).status,"available");
    assert.equal(bloomWindow(id,new Date("2026-11-07T23:00:00Z")).status,"expired");
    assert.equal(currentBloomId("weekly",new Date("2026-11-08T23:00:00Z")),"weekly-2026-11-09");
  });
  it("uses calendar month and leap-year boundaries",()=>{
    const item=bloomWindow("monthly-2028-02",new Date("2028-03-01T00:00:00Z"));
    assert.equal(item.periodStart,"2028-01-31T23:00:00.000Z");
    assert.equal(item.periodEnd,"2028-02-29T23:00:00.000Z");
    assert.equal(item.expiresAt,"2028-03-24T23:00:00.000Z");
    assert.equal(bloomWindow("yearly-2026",new Date("2027-06-01")).status,"available");
    assert.equal(bloomWindow("yearly-2026",new Date("2027-12-31T23:00:00Z")).status,"expired");
  });
  it("handles daylight saving changes and rejects malformed IDs",()=>{
    const item=bloomWindow("weekly-2026-03-02",new Date("2026-03-09T12:00:00Z"),"America/New_York");
    assert.equal(item.periodStart,"2026-03-02T05:00:00.000Z");
    assert.equal(item.publishAt,"2026-03-09T04:00:00.000Z");
    assert.equal(validTimeZone("Mars/Olympus"),false);
    for(const id of ["weekly-2026-11-03","monthly-2026-13","weekly-2026-02-30","yearly-2026-01","monthly-2026-11-02"])assert.throws(()=>bloomWindow(id));
    assert.equal(bloomWindows("monthly",new Date("2027-01-01T12:00:00Z"))[0].id,"monthly-2026-12");
  });
  it("groups display duplicates with separate provider identities retained",()=>{
    const choices=groupArtistCards([{id:"80224652",name:"YOASOBI",imageUrl:"https://example.invalid/a",albumCount:4},
      {id:"108153772",name:"YOASOBI",imageUrl:"https://example.invalid/b",albumCount:66},
      {id:"42",name:"Tyler, The Creator",albumCount:2}]);
    assert.equal(choices.length,2);assert.equal(choices[0].selectionKey,"artist:deezer:108153772");
    assert.equal(choices[0].alternativeReferences.length,2);assert.equal(choices[1].name,"Tyler, The Creator");
    const prefs=preferencesPatch({seedArtistSelections:[{name:"YOASOBI",reference:{provider:"deezer",id:"108153772"}}]});
    assert.deepEqual(prefs.seedArtists,["YOASOBI"]);assert.throws(()=>preferencesPatch({timeZone:"Mars/Olympus"}));
  });
  it("requires actual version and history evidence for special mixes",()=>{
    const now=Date.now(),recording={id:"one",artists:["Artist"],genres:["Jazz"],durationMs:180000,liked:true,metadata:{title:"Live and energetic"}};
    const eligible=eligibleSituations(recording,{},now);assert.ok(eligible.includes("jazz"));assert.ok(eligible.includes("favorites"));
    assert.ok(!eligible.includes("live"));assert.ok(!eligible.includes("late-night"));assert.ok(!eligible.includes("forgotten"));
    assert.ok(eligibleSituations({...recording,metadata:{version:{kinds:["live"]}}},{lateNight:true,lastPlayedAt:now-40*86400000},now).includes("forgotten"));
    assert.ok(eligibleSituations({...recording,version:{kinds:["live"]}}).includes("live"));
    assert.ok(SITUATIONAL_MIXES.length>=18);
  });
  it("offline plans are deduplicated device subsets with strict pair overlap",()=>{
    const cards=Array.from({length:160},(_,i)=>({id:`local-${i}`,artists:[`artist-${i%40}`],genres:[i%2?"jazz":"afrobeats"],durationMs:180000,metadata:{coverUrl:"https://example.invalid/cover"}}));
    const plans=planOfflineMixes([...cards,cards[0]],{nowMs:1000000000000}),ready=plans.filter(p=>p.status==="ready"),ids=new Set(cards.map(c=>c.id));
    assert.ok(ready.length>=3);
    for(const mix of ready){assert.equal(new Set(mix.recordingIds).size,mix.recordingIds.length);assert.ok(mix.recordingIds.every(id=>ids.has(id)));}
    for(let i=0;i<ready.length;i++)for(let j=i+1;j<ready.length;j++){
      const common=ready[i].recordingIds.filter(id=>ready[j].recordingIds.includes(id));
      assert.ok(common.length<=Math.floor(Math.min(ready[i].recordingIds.length,ready[j].recordingIds.length)*.2));
    }
    const short=ready.find(p=>p.slot==="short-break");if(short)assert.ok(short.recordingIds.length*180000<=1200000);
    assert.ok(plans.every(p=>p.surfaces.includes("downloads")));
    const explicit=planOfflineMixes(cards.map(c=>({...c,explicit:true})),{explicitContent:false});assert.ok(explicit.every(p=>p.recordingIds.length===0));
  });
  it("a time-boxed plan cannot silently include unknown durations",()=>{
    const context={seed:"x",nowMs:0,heardRecordings:new Set<string>(),familiarArtists:new Set<string>(),blockedRecordings:new Set<string>(),blockedArtists:new Set<string>(),snoozedUntil:new Map<string,number>(),recentPlays:new Map<string,number>(),recentWindowMs:0};
    const planned=planMixes([{id:"short",kind:"daily",genres:[],size:3,minimum:1,maxPerArtist:1,maximumOverlap:.2,maximumDurationMs:300000}],
      [{recordingId:"unknown",artistId:"a",genres:[],affinity:10},{recordingId:"known",artistId:"b",genres:[],affinity:1,durationMs:200000}],context);
    assert.deepEqual(planned[0].recordingIds,["known"]);
  });
});
describe("Cinematic Bloom snapshot and compatibility",()=>{
 const period=bloomWindow("monthly-2026-10",new Date("2026-11-07T12:00:00Z"));
 function recording(id:string,artistId:string|null,name="Same display name"):RecordingCard{
  return {id,recordingId:id,title:`Song ${id}`,artists:[name,"Featured Artist"],durationMs:300000,metadata:{},coverUrl:null,artistImageUrl:null,artistId,albumId:null,albumTitle:null,reference:{provider:"deezer",id},references:[],genres:["Jazz"],popularity:0,playability:"resolvable",artistCredits:[{name,role:"primary",artistId},{name:"Featured Artist",role:"featured",artistId:"featured"}]};
 }
 it("ranks actual audible time, keeps same-name artists distinct, and connects the artist's own songs",()=>{
  const cards=[recording("a","artist-a"),recording("b","artist-a"),recording("c","artist-b")];
  const data=buildBloomSnapshot([{id:"c",audible_ms:60000,plays:20,first_ever:"2026-09-01"},{id:"b",audible_ms:120000,plays:2,first_ever:"2026-10-02"},{id:"a",audible_ms:120000,plays:1,first_ever:"2026-10-01"}],cards,2,period);
  assert.equal(data.version,3);assert.equal(data.summary.audibleMs,300000);
  assert.equal(data.chapters.find(c=>c.id==="top-song")?.recordings?.[0].recording.id,"a");
  const winner=data.chapters.find(c=>c.id==="top-artist")!.artists![0];
  assert.equal(winner.key,"artist-a");assert.equal(winner.audibleMs,240000);
  assert.deepEqual(winner.recordings.map(c=>c.recording.id),["a","b"]);
  assert.equal(data.chapters.find(c=>c.id==="other-artists")?.artists?.[0].key,"artist-b");
  assert.ok(!data.chapters.some(c=>c.artists?.some(a=>a.key==="featured")));
  assert.equal(data.chapters.find(c=>c.id==="discoveries")?.stat.value,2);
 });
 it("does not promote a lower-ranked song when the true winner's metadata is missing",()=>{
  const data=buildBloomSnapshot([{id:"missing",audible_ms:500000,plays:2,first_ever:"2026-10-01"},{id:"b",audible_ms:60000,plays:1,first_ever:"2026-09-01"}],[recording("b",null)],1,period);
  assert.equal(data.summary.audibleMs,560000);assert.equal(data.summary.recordingCount,2);
  assert.ok(!data.chapters.some(c=>c.id==="top-song"));
  assert.equal(data.chapters.find(c=>c.id==="runner-up")?.recordings?.[0].rank,2);
  assert.ok(!data.chapters.some(c=>c.id==="top-artist"));
  assert.equal(buildBloomSnapshot([],[],0,period).chapters.length,0);
 });
 it("withholds every new music collection and comparison before reveal",()=>{
  const data=buildBloomSnapshot([{id:"a",audible_ms:216*60000,plays:2,first_ever:"2026-10-01"}],[recording("a","artist-a")],1,period);
  for(const chapter of data.chapters){const hidden=discloseBloomChapter(chapter,false);assert.equal(hidden.stat,null);assert.equal(hidden.relatedRecording,null);assert.equal(hidden.recordings,undefined);assert.equal(hidden.artists,undefined);assert.equal(hidden.comparison,null);assert.equal(hidden.detail,null);}
  assert.equal(discloseBloomChapter(data.chapters[0],true).stat!.value,"3 h 36 min");
 });
 it("preserves explicit and original saved theme choices across the ten-world rotation",()=>{
  const old=bloomDesignForItem({periodStart:period.periodStart,timeZone:period.timeZone,version:1});
  assert.equal(old,legacyBloomDesignForMonth(period.periodStart,period.timeZone));
  assert.ok(["herbarium","nocturne","risograph"].includes(old));
  assert.equal(bloomDesignForItem({periodStart:period.periodStart,timeZone:period.timeZone,version:2,worldId:"jungle"}),"jungle");
  assert.equal(bloomDesignForItem({...period,version:3,worldId:"cosmos"}),"cosmos");
 });
 it("uses explicit comparison arithmetic and preserves a manual device-tier choice",()=>{
  assert.equal(listeningDuration(0),"0 sec");assert.equal(listeningDuration(3.6*3600000),"3 h 36 min");
  assert.match(listeningComparison(216*60000).title,/double feature/);
  assert.match(listeningComparison(225*60000).detail,/9 minutes to spare/);
  assert.ok(!listeningComparison(180*60000).title.includes("film marathon"));
  assert.equal(deviceBloomTier({cores:16,memory:8}),5);assert.equal(deviceBloomTier({cores:16,memory:8,saveData:true}),2);
  assert.equal(selectedBloomTier("5",1),5);assert.equal(selectedBloomTier("auto",2),2);
 });
 it("resumes at most at the first undisclosed chapter",()=>{
  const recap={chapters:[{revealed:true},{revealed:false},{revealed:false}]} as BloomRecap;
  assert.equal(resumeBloomIndex(recap,99),1);assert.equal(resumeBloomIndex(recap,-1),0);assert.equal(resumeBloomIndex(recap,NaN),0);
  assert.equal(resumeBloomIndex({...recap,completed:true,chapters:recap.chapters.map(chapter=>({...chapter,revealed:true}))},2),0);
 });
});
