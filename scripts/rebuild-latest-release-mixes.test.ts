import assert from "node:assert/strict";
import {test} from "node:test";
import {planMixes,type Candidate,type ListeningContext} from "../src/rebuild/recommendations/planner";
import {SITUATIONAL_MIXES,planOfflineMixes} from "../src/rebuild/recommendations/situations";

const now=Date.parse("2026-11-14T12:00:00Z"),latest=SITUATIONAL_MIXES.find(spec=>spec.id==="latest-releases")!;
const context:ListeningContext={seed:"latest-fixture",nowMs:now,heardRecordings:new Set(),familiarArtists:new Set(["same-name"]),blockedRecordings:new Set(),blockedArtists:new Set(),snoozedUntil:new Map(),recentPlays:new Map(),recentWindowMs:3600000};
const song=(id:string,releaseDate:string,familiarArtist=true,artistId="chosen"):Candidate=>({recordingId:id,artistId,genres:[],affinity:1,durationMs:180000,releaseDate,familiarArtist});

test("a lone recently played single remains ready even when already present in the daily mix",()=>{
 const single=song("single","2026-11-13"),daily={...latest,id:"daily-fixture",selection:undefined,kind:"repeat" as const};
 const played={...context,heardRecordings:new Set([single.recordingId]),recentPlays:new Map([[single.recordingId,now-1000]])};
 const planned=planMixes([daily,latest],[single],played);
 assert.deepEqual(planned.map(mix=>mix.recordingIds),[["single"],["single"]]);assert.equal(planned[1].status,"ready");assert.equal(planned[1].uniqueArtists,1);
});

test("fresh mixes keep newest publication order across several songs by one artist",()=>{
 const tracks=[song("older","2026-11-01"),song("newest","2026-11-13"),song("middle","2026-11-12",true,"other")];
 const planned=planMixes([latest],tracks,context)[0];
 assert.equal(planned.status,"ready");assert.deepEqual(planned.recordingIds,["newest","middle","older"]);
 assert.deepEqual(planMixes([latest],[...tracks].reverse(),context)[0].recordingIds,planned.recordingIds);
});

test("unpublished, unknown, invalid, old-original and unrelated same-name artist recordings never fill the fresh mix",()=>{
 const tracks=[song("valid","2026-11-13"),song("future","2026-12-01"),song("unknown",""),song("invalid","2026-02-30"),song("reissue","2001-01-01"),song("same-name","2026-11-13",false,"same-name"),song("blocked","2026-11-13")];
 const planned=planMixes([latest],tracks,{...context,blockedRecordings:new Set(["blocked"])});
 assert.deepEqual(planned[0].recordingIds,["valid"]);
 assert.equal(planMixes([latest],tracks.slice(1),{...context,blockedRecordings:new Set(["blocked"])} )[0].status,"insufficient-candidates");
});

test("the latest-release mix is available on Home and Discover and cannot claim to be an offline download mix",()=>{
 assert.deepEqual(latest.surfaces,["home","discover"]);assert.equal(latest.minimum,1);
 assert.equal(planOfflineMixes([{id:"one",artists:["Artist"],genres:[],durationMs:180000}]).some(mix=>mix.slot==="latest-releases"),false);
});
