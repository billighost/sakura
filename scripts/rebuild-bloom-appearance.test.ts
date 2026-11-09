import assert from "node:assert/strict";
import {test} from "node:test";
import {bloomSceneListening} from "../src/rebuild/bloom/appearance";
import {createBloomExperience} from "../src/rebuild/bloom/experience";
import type {BloomRecap} from "../src/rebuild/bloom/uiTypes";

const profile={timeZone:"Africa/Lagos",audibleMs:120000,recordingCount:3,peakHour:22,hourBands:[{id:"night" as const,audibleMs:120000,share:1}]};
const recap={experience:createBloomExperience("listener|monthly-2026-10","sakura"),listening:profile,chapters:[{id:"listening-time",kind:"time",revealed:true},{id:"song-count",kind:"breadth",revealed:true},{id:"listening-hours",kind:"pattern",revealed:true}]} as BloomRecap;

test("completed replay paints each earlier chapter with its first-view measurements",()=>{
 const firstView={...recap,listening:{timeZone:profile.timeZone,audibleMs:profile.audibleMs},chapters:recap.chapters.map((chapter,index)=>({...chapter,revealed:index===0}))};
 assert.deepEqual(bloomSceneListening(recap,0,true,false),bloomSceneListening(firstView,0,true,false));
 assert.equal(bloomSceneListening(recap,0,true,false)?.peakHour,undefined);
 assert.equal(bloomSceneListening(recap,1,true,false)?.recordingCount,3);
 assert.equal(bloomSceneListening(recap,2,true,false)?.peakHour,22);
});

test("opening keeps later measurements out while finale and legacy artwork retain their profile",()=>{
 assert.equal(bloomSceneListening(recap,0,false,false),undefined);
 assert.equal(bloomSceneListening(recap,2,true,true),profile);
 assert.equal(bloomSceneListening({...recap,experience:undefined},0,false,false),profile);
});
