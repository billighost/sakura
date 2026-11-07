import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { bloomWindow,bloomWindows,currentBloomId,validTimeZone } from "../src/rebuild/bloom/calendar";
import { bloomDesignForMonth } from "../src/rebuild/bloom/design";
import { groupArtistCards } from "../src/rebuild/data/artistSelection";
import { preferencesPatch } from "../src/rebuild/data/validation";
import { eligibleSituations,planOfflineMixes,SITUATIONAL_MIXES } from "../src/rebuild/recommendations/situations";
import { planMixes } from "../src/rebuild/recommendations/planner";
describe("Bloom calendar and truthful discovery rules",()=>{
  it("uses every Bloom design in a stable monthly rotation without consecutive repeats",()=>{
    const months=Array.from({length:15},(_,index)=>new Date(Date.UTC(2026,index,15)));
    const selected=months.map(date=>bloomDesignForMonth(date,"Africa/Lagos"));
    assert.deepEqual(selected.slice(0,3).sort(),["herbarium","nocturne","risograph"]);
    for(let index=1;index<selected.length;index++)assert.notEqual(selected[index],selected[index-1]);
    for(let index=0;index<12;index+=3)assert.deepEqual(selected.slice(index,index+3).sort(),["herbarium","nocturne","risograph"]);
    assert.equal(bloomDesignForMonth("2026-11-01T00:30:00+01:00","Africa/Lagos"),bloomDesignForMonth("2026-11-01T00:30:00+01:00","Africa/Lagos"));
    assert.notEqual(bloomDesignForMonth("2026-10-31T23:30:00Z","Africa/Lagos"),bloomDesignForMonth("2026-10-31T23:30:00Z","America/New_York"));
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
