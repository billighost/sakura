import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomWindow} from "../src/rebuild/bloom/calendar";
import {buildBloomListening} from "../src/rebuild/bloom/listening";
import {buildBloomSnapshot} from "../src/rebuild/bloom/snapshot";

const item=bloomWindow("monthly-2026-10",new Date("2026-11-07T12:00:00Z"));
const rows=[{id:"song",audible_ms:120000,plays:1,first_ever:"2026-10-10T12:00:00Z"}];

describe("Bloom recorded listening sources",()=>{
 it("uses only known source values and treats missing, custom and incomplete origins as unknown",()=>{
  const sources=[{context:"home-feed",audibleMs:30000},{context:"home",audibleMs:10000},{context:"manual-queue",audibleMs:20000},{context:"smart-all",audibleMs:10000},{context:null,audibleMs:10000},{context:"smart-invented",audibleMs:10000},{context:"custom-context",audibleMs:10000}];
  const profile=buildBloomListening(rows,[],1,item,{sources}).profile;
  assert.deepEqual(profile.sources,[{id:"home",name:"Home",audibleMs:40000,share:1/3},{id:"queue",name:"Your queue",audibleMs:30000,share:.25}]);
  assert.equal(profile.unknownSourceMs,50000);
  assert.equal(profile.sources!.reduce((sum,row)=>sum+row.audibleMs,0)+profile.unknownSourceMs!,120000);
 });
 it("omits unsupported source data and avoids inventing an origin chapter when all origins are unknown",()=>{
  assert.equal(buildBloomListening(rows,[],1,item).profile.sources,undefined);
  assert.equal(buildBloomListening(rows,[],1,item,{sources:[{context:"playlist",audibleMs:240000}]}).profile.sources,undefined);
  const snapshot=buildBloomSnapshot(rows,[],1,item,{sources:[{context:null,audibleMs:120000}]});
  assert.equal(snapshot.listening?.unknownSourceMs,120000);assert.deepEqual(snapshot.listening?.sources,[]);
  assert.ok(!snapshot.chapters.some(chapter=>chapter.id==="listening-source"));
 });
});
