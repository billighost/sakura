import assert from "node:assert/strict";
import {test} from "node:test";
import {bloomAssetManifest,prepareBloomAssets,type BloomPreparationOptions} from "../src/rebuild/bloom/preparation";
import type {BloomPreparedStory,BloomRecap} from "../src/rebuild/bloom/uiTypes";
import {BloomPreparationIdentity,bloomPreparationScope,requireBloomOpening} from "../src/rebuild/bloom/preparationIdentity";
import {BloomWarmupWindow,BloomSpeculationPool,BLOOM_SPECULATIVE_LIMITS} from "../src/rebuild/bloom/speculation";
import {allowSpeculativePrefetch} from "../src/rebuild/app/prefetchPolicy";

function fixture():BloomPreparedStory {
 const recording=(id:string)=>({id,title:id,coverUrl:`https://fixture.invalid/${id}.jpg`});
 const chapters=[
  {id:"song",title:"A song",prompt:"",stat:{label:"Song",value:1,unit:""},relatedRecording:recording("one")},
  {id:"artists",title:"An artist",prompt:"",stat:{label:"Artists",value:1,unit:""},relatedRecording:recording("one"),recordings:[{rank:1,audibleMs:1000,plays:1,recording:recording("two")}],artists:[{key:"artist",name:"Artist",artistId:null,imageUrl:"https://fixture.invalid/artist.jpg",audibleMs:1000,recordings:[{rank:1,audibleMs:1000,plays:1,recording:recording("three")}]}]},
 ];
 const story:BloomRecap={id:"monthly-2026-10",period:"monthly",periodStart:"2026-09-30T23:00:00Z",periodEnd:"2026-10-31T23:00:00Z",publishAt:"2026-10-31T23:00:00Z",expiresAt:"2026-11-23T23:00:00Z",timeZone:"Africa/Lagos",status:"available",version:4,worldId:"sakura",snapshotCreatedAt:"2026-11-01T00:00:00Z",chapterCount:chapters.length,summary:{audibleMs:3000,playCount:3,recordingCount:3,activeDays:1},chapters:chapters.map(chapter=>({...chapter,stat:null,relatedRecording:null,recordings:undefined,artists:undefined,revealed:false}))};
 return {story,chapters};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve};}
function options(overrides:Partial<BloomPreparationOptions>={}):BloomPreparationOptions{return {signal:new AbortController().signal,loadStory:async()=>fixture(),prepareAudio:async()=>({release:()=>{}}),prepareArtwork:async()=>{},preloadWorld:async()=>{},...overrides};}

test("Bloom manifest includes every distinct chapter, artist and finale recording and artwork",()=>{
 const prepared=fixture(),manifest=bloomAssetManifest(prepared);
 assert.deepEqual(manifest.recordings.map(recording=>recording.id),["one","two","three"]);
 assert.equal(manifest.artwork.length,4);assert.ok(manifest.artwork.includes("https://fixture.invalid/artist.jpg"));
 assert.ok(prepared.story.chapters.every(chapter=>chapter.stat===null&&!chapter.revealed));
});

test("Bloom readiness waits for the last complete song and retains all capabilities until release",async()=>{
 const gate=deferred<void>(),started=deferred<void>(),released:string[]=[],progress:unknown[]=[];let resolved=false;
 const task=prepareBloomAssets(options({prepareAudio:async recording=>{if(recording.id==="three"){started.resolve();await gate.promise;}return {release:()=>released.push(String(recording.id))};},onProgress:value=>progress.push(value)})).then(result=>{resolved=true;return result;});
 await started.promise;await Promise.resolve();assert.equal(resolved,false);assert.deepEqual(released,[]);
 gate.resolve();const assets=await task;assert.equal(resolved,true);assert.deepEqual(released,[]);
 assert.deepEqual(progress.at(-1),{phase:"ready",completed:8,total:8,songsReady:3,songCount:3});
 assert.ok(assets.prepared.story.chapters.every(chapter=>!chapter.revealed&&chapter.stat===null));
 assert.ok(assets.audioFor({id:"three"}));assets.release();assets.release();assert.equal(assets.audioFor({id:"three"}),undefined);assert.deepEqual(released.sort(),["one","three","two"]);
});

test("failed artwork or full audio never publishes ready and releases partial successes",async()=>{
 let released=0;const progress:string[]=[];
 await assert.rejects(prepareBloomAssets(options({prepareAudio:async recording=>{if(recording.id==="three")throw new Error("Storage quota exceeded");return {release:()=>released++};},onProgress:value=>progress.push(value.phase)})),/Storage quota exceeded/);
 assert.equal(released,2);assert.equal(progress.includes("ready"),false);
 await assert.rejects(prepareBloomAssets(options({prepareArtwork:async()=>{throw new Error("Artwork unavailable");}})),/Artwork unavailable/);
});

test("cancellation rejects late full files, releases leases and stops publishing readiness",async()=>{
 const controller=new AbortController(),started=deferred<void>(),gate=deferred<void>(),progress:string[]=[];let released=0;
 const task=prepareBloomAssets(options({signal:controller.signal,prepareAudio:async()=>{started.resolve();await gate.promise;return {release:()=>released++};},onProgress:value=>progress.push(value.phase)}));
 await started.promise;controller.abort(new DOMException("Account changed","AbortError"));gate.resolve();
 await assert.rejects(task,{name:"AbortError"});assert.ok(released>0);assert.equal(progress.includes("ready"),false);
});

test("preparation refuses a changed snapshot or incomplete chapter data before downloading",async()=>{
 let requests=0;const expected=fixture().story;expected.snapshotCreatedAt="2026-11-02T00:00:00Z";
 await assert.rejects(prepareBloomAssets(options({expected,prepareAudio:async()=>{requests++;return {release:()=>{}};}})),/has changed/);assert.equal(requests,0);
 const incomplete=fixture();incomplete.chapters[1].stat=null;
 await assert.rejects(prepareBloomAssets(options({loadStory:async()=>incomplete})),/not finished preparing/);
});

test("an aborted stalled artwork callback cannot keep preparation or its retry waiting",async()=>{
 const controller=new AbortController(),started=deferred<void>();
 const task=prepareBloomAssets(options({signal:controller.signal,prepareArtwork:()=>{started.resolve();return new Promise(()=>{});}}));
 await started.promise;controller.abort(new DOMException("Viewing closed","AbortError"));
 await assert.rejects(task,{name:"AbortError"});
 const retry=await prepareBloomAssets(options());retry.release();
});

test("a detail binds the expected identity while a shelf JSON request is still in flight",async()=>{
 const identity=new BloomPreparationIdentity(),gate=deferred<BloomPreparedStory>(),incoming=fixture(),newer=structuredClone(incoming.story);newer.snapshotCreatedAt="2026-11-02T00:00:00Z";
 let requests=0;const task=prepareBloomAssets(options({loadStory:()=>gate.promise,validateStory:story=>identity.accept(story),prepareAudio:async()=>{requests++;return {release:()=>{}};}}));
 identity.expect(newer);gate.resolve(incoming);
 await assert.rejects(task,/has changed/);assert.equal(requests,0);
});

test("a snapshot replacement during asset preparation cannot publish a stale ready state",async()=>{
 const identity=new BloomPreparationIdentity(fixture().story),gate=deferred<void>(),started=deferred<void>(),phases:string[]=[];let released=0,expected=fixture().story;
 const task=prepareBloomAssets(options({loadStory:async()=>{const prepared=fixture();identity.accept(prepared.story);return prepared;},validateStory:story=>identity.check(story,expected),prepareAudio:async()=>{started.resolve();await gate.promise;return {release:()=>released++};},onProgress:value=>phases.push(value.phase)}));
 await started.promise;expected={...expected,snapshotCreatedAt:"2026-11-02T00:00:00Z"};assert.throws(()=>identity.expect(expected),/has changed/);gate.resolve();await assert.rejects(task,/has changed/);assert.equal(phases.includes("ready"),false);assert.equal(released,3);
 const changedZone={...fixture().story,timeZone:"Pacific/Honolulu"};assert.notEqual(bloomPreparationScope(changedZone),bloomPreparationScope(fixture().story));
});

test("opening dates are rechecked after assets have prepared",()=>{
 const story=fixture().story;requireBloomOpening(story,Date.parse(story.publishAt));assert.throws(()=>requireBloomOpening(story,Date.parse(story.expiresAt)),/opening dates/);
});

test("speculative preparation refuses oversized manifests and releases excess verified bytes",async()=>{
 let requests=0,released=0;
 await assert.rejects(prepareBloomAssets(options({limits:()=>({...BLOOM_SPECULATIVE_LIMITS,maxRecordings:2}),prepareAudio:async()=>{requests++;return {release:()=>{}};}})),/welcome screen/);assert.equal(requests,0);
 await assert.rejects(prepareBloomAssets(options({limits:()=>({...BLOOM_SPECULATIVE_LIMITS,maxAudioBytes:20}),prepareAudio:async()=>({sizeBytes:15,release:()=>released++})})),/welcome screen/);assert.equal(released,3);
 const explicit=await prepareBloomAssets(options({prepareAudio:async()=>({sizeBytes:80*1024*1024,release:()=>{}})}));explicit.release();
});

test("speculative viewport leases end on exit, policy suspension and a finite visible lifetime",async()=>{
 const changes:boolean[]=[],window=new BloomWarmupWindow(active=>changes.push(active),15);
 window.policy(true);window.viewport(true);assert.deepEqual(changes,[true]);window.viewport(false);assert.deepEqual(changes,[true,false]);
 window.viewport(true);window.policy(false);assert.equal(changes.at(-1),false);window.policy(true);assert.equal(changes.at(-1),true);
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(changes.at(-1),false);window.intent("pointer",true);assert.equal(changes.at(-1),true);window.viewport(false);window.intent("pointer",false);assert.equal(changes.at(-1),false);window.dispose();
 for(const condition of [{online:false},{visible:false},{playback:"resolving"},{playback:"buffering"},{connection:{saveData:true}},{connection:{effectiveType:"2g"}}])assert.equal(allowSpeculativePrefetch({online:true,visible:true,playback:"playing",...condition}),false);
});

test("one speculative story is owned and explicit details preempt other soundtracks",()=>{
 const pool=new BloomSpeculationPool(),states=new Map<string,boolean>();
 const a=pool.request("weekly",0,value=>states.set("weekly",value)),b=pool.request("monthly",0,value=>states.set("monthly",value));assert.equal(states.get("weekly"),true);assert.equal(states.get("monthly"),false);
 const intent=pool.request("monthly",1,value=>states.set("intent",value));assert.equal(states.get("weekly"),false);assert.equal(states.get("monthly"),true);
 const detail=pool.detail("yearly");assert.equal(states.get("monthly"),false);assert.equal(pool.allows("monthly"),false);
 detail();assert.equal(states.get("monthly"),true);intent();b();assert.equal(states.get("weekly"),true);a();assert.equal(pool.allows("weekly"),false);
});
