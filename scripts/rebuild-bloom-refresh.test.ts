import assert from "node:assert/strict";
import {test} from "node:test";
import {sameBloomStory,mergeBloomRefresh,bloomProgressRecord,restoredBloomIndex} from "../src/rebuild/bloom/refresh";
import {createBloomExperience} from "../src/rebuild/bloom/experience";
import type {BloomPreparedStory,BloomRecap} from "../src/rebuild/bloom/uiTypes";
import {BloomDirectorStaging} from "../src/rebuild/bloom/directorStaging";

function story():BloomRecap{return {id:"monthly-2026-10",version:3,worldId:"sakura",timeZone:"Africa/Lagos",period:"monthly",periodStart:"2026-09-30T23:00:00Z",periodEnd:"2026-10-31T23:00:00Z",publishAt:"2026-10-31T23:00:00Z",expiresAt:"2026-11-23T23:00:00Z",snapshotCreatedAt:"2026-11-08T10:00:00Z",status:"available",chapterCount:2,summary:{audibleMs:60000,playCount:1,recordingCount:1,activeDays:1},chapters:[{id:"time",kind:"time",title:"Listening",prompt:"",revealed:false,stat:null,relatedRecording:null},{id:"songs",kind:"songs",title:"Songs",prompt:"",revealed:false,stat:null,relatedRecording:null}]};}

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function preparedStory(value=story()):BloomPreparedStory{return {story:structuredClone(value),chapters:value.chapters.map(chapter=>({...chapter,stat:{label:chapter.id,value:chapter.id==="time"?"1 minute":1,unit:""}})),listening:{timeZone:value.timeZone,audibleMs:60000,recordingCount:1,peakHour:20}};}

test("preparation is deduplicated and never reveals future chapters or their measurements",async()=>{
 const initial=story(),gate=deferred<BloomPreparedStory>();let calls=0,writes=0;
 const staging=new BloomDirectorStaging(initial,{prepare:()=>{calls++;return gate.promise;},reveal:async()=>{writes++;return initial;},complete:async()=>initial});
 const first=staging.prepare(),second=staging.prepare();assert.equal(first,second);assert.equal(calls,1);
 gate.resolve(preparedStory(initial));await first;
 assert.equal(writes,0);assert.deepEqual(staging.confirmed.chapters,initial.chapters);assert.equal(Boolean(staging.confirmed.completed),false);assert.equal(staging.confirmed.listening,undefined);
 assert.equal(staging.scene(initial,1),null,"a prepared payload cannot skip the reveal frontier");
 const visible=staging.scene(initial,0)!;
 assert.equal(visible.chapters[0].stat?.value,"1 minute");assert.equal(visible.chapters[1].stat,null);assert.equal(visible.chapters[1].revealed,false);
 assert.equal(visible.listening?.audibleMs,60000);assert.equal(visible.listening?.recordingCount,undefined);assert.equal(visible.listening?.peakHour,undefined);
});

test("rapid staged navigation is instant while real delayed reveal receipts stay sequential and deduplicated",async()=>{
 const initial=story(),gate=deferred<void>(),started=deferred<void>(),calls:string[]=[];let saved=structuredClone(initial);
 const prepared=preparedStory(initial);
 const staging=new BloomDirectorStaging(initial,{prepare:async()=>prepared,reveal:async id=>{calls.push(id);if(id==="time"){started.resolve();await gate.promise;}const index=saved.chapters.findIndex(chapter=>chapter.id===id);assert.ok(saved.chapters.slice(0,index).every(chapter=>chapter.revealed));saved={...saved,chapters:saved.chapters.map((chapter,at)=>at===index?{...prepared.chapters[at],revealed:true}:chapter)};return saved;},complete:async()=>({...saved,completed:true})});
 await staging.prepare();let visible=staging.scene(initial,0)!;
 const first=staging.commitThrough(0),both=staging.commitThrough(1);assert.equal(first,both);
 await started.promise;
 visible=staging.scene(visible,1)!;
 assert.ok(visible.chapters.every(chapter=>chapter.revealed));assert.deepEqual(calls,["time"]);assert.ok(staging.confirmed.chapters.every(chapter=>!chapter.revealed));
 gate.resolve();await both;
 assert.deepEqual(calls,["time","songs"]);assert.ok(staging.confirmed.chapters.every(chapter=>chapter.revealed));
});

test("a prepared finale is available before saving and only a valid completion receipt changes completed state",async()=>{
 const initial=story(),gate=deferred<BloomRecap>(),started=deferred<void>(),prepared=preparedStory(initial);let saved=initial;
 const staging=new BloomDirectorStaging(initial,{prepare:async()=>prepared,reveal:async id=>{const index=saved.chapters.findIndex(chapter=>chapter.id===id);saved={...saved,chapters:saved.chapters.map((chapter,at)=>at===index?{...prepared.chapters[at],revealed:true}:chapter)};return saved;},complete:()=>{started.resolve();return gate.promise;}});
 await staging.prepare();const first=staging.scene(initial,0)!,last=staging.scene(first,1)!;
 const finale=staging.finale(last);assert.equal(finale.completed,undefined);assert.equal(finale.listening?.peakHour,20);
 const completion=staging.complete(),repeat=staging.complete();assert.equal(completion,repeat);await started.promise;
 assert.equal(Boolean(staging.confirmed.completed),false);
 gate.resolve({...saved,completed:true,completedAt:"2026-11-08T10:05:00Z"});const result=await completion;
 assert.equal(result.completed,true);assert.equal(result.completedAt,"2026-11-08T10:05:00Z");
});

test("failed preparation and reveal writes can retry without invented facts or skipped prerequisites",async()=>{
 const initial=story(),prepared=preparedStory(initial);let prepares=0,reveals=0;
 const staging=new BloomDirectorStaging(initial,{prepare:async()=>{if(++prepares===1)throw new Error("offline");return prepared;},reveal:async()=>{if(++reveals===1)throw new Error("offline");return {...initial,chapters:[{...prepared.chapters[0],revealed:true},initial.chapters[1]]};},complete:async()=>initial});
 await assert.rejects(staging.prepare(),/offline/);assert.equal(staging.scene(initial,0),null);
 await staging.prepare();await assert.rejects(staging.commitThrough(0),/offline/);
 assert.equal(staging.confirmed.chapters[0].revealed,false);
 await staging.commitThrough(0);assert.equal(staging.confirmed.chapters[0].revealed,true);assert.equal(prepares,2);assert.equal(reveals,2);
});

test("a hidden or replaced viewing stops later queued writes and rejects late staged payloads",async()=>{
 const initial=story(),gate=deferred<BloomRecap>(),started=deferred<void>(),calls:string[]=[];
 const staging=new BloomDirectorStaging(initial,{reveal:id=>{calls.push(id);started.resolve();return gate.promise;},complete:async()=>initial});
 const work=staging.commitThrough(1);await started.promise;staging.cancel();
 gate.resolve({...initial,chapters:[{...preparedStory(initial).chapters[0],revealed:true},initial.chapters[1]]});
 await assert.rejects(work,/closed/);assert.deepEqual(calls,["time"]);assert.equal(staging.confirmed.chapters[0].revealed,true);
 const pending=deferred<BloomPreparedStory>(),other=new BloomDirectorStaging(initial,{prepare:()=>pending.promise,reveal:async()=>initial,complete:async()=>initial});
 const preparation=other.prepare();other.cancel();pending.resolve(preparedStory(initial));await assert.rejects(preparation,/closed/);
});

test("preparation rejects a rebuilt snapshot and completion rejects an incomplete receipt",async()=>{
 const initial=story(),changed=preparedStory({...initial,snapshotCreatedAt:"2026-11-08T11:00:00Z"});
 const wrong=new BloomDirectorStaging(initial,{prepare:async()=>changed,reveal:async()=>initial,complete:async()=>initial});
 await assert.rejects(wrong.prepare(),/changed/);assert.equal(wrong.scene(initial,0),null);
 const opened={...initial,chapters:preparedStory(initial).chapters.map(chapter=>({...chapter,revealed:true}))};
 const incomplete=new BloomDirectorStaging(opened,{reveal:async()=>opened,complete:async()=>({...opened,completed:false})});
 await assert.rejects(incomplete.complete(),/could not be finished/);assert.equal(incomplete.confirmed.completed,undefined);
});

test("an unchanged background refresh preserves opened chapters and disclosed artwork",()=>{
 const current=story(),incoming=story();current.chapters[0]={...current.chapters[0],revealed:true,stat:{label:"listened",value:"1 minute",unit:""}};current.listening={timeZone:current.timeZone,audibleMs:60000};
 assert.equal(sameBloomStory(current,incoming),true);
 const merged=mergeBloomRefresh(current,incoming);assert.equal(merged.chapters[0].revealed,true);assert.deepEqual(merged.chapters[0].stat,current.chapters[0].stat);assert.equal(merged.listening?.audibleMs,60000);
});

test("refresh can add another device's reveal without discarding the current journey",()=>{
 const current=story(),incoming=story();current.chapters[0].revealed=true;incoming.chapters[1].revealed=true;
 const merged=mergeBloomRefresh(current,incoming);assert.deepEqual(merged.chapters.map(chapter=>chapter.revealed),[true,true]);
});

test("a rebuilt period after erasure is a different story even with identical totals",()=>{
 const erased=story(),rebuilt=story();erased.chapters[0].revealed=true;rebuilt.snapshotCreatedAt="2026-11-08T10:01:00Z";
 assert.equal(sameBloomStory(erased,rebuilt),false);assert.equal(mergeBloomRefresh(erased,rebuilt).chapters[0].revealed,false);
});

test("legacy stories without a creation marker remain compatible with ordinary refresh",()=>{
 const current=story(),incoming=story();delete current.snapshotCreatedAt;delete incoming.snapshotCreatedAt;current.version=incoming.version=1;
 current.chapters[0].revealed=true;assert.equal(mergeBloomRefresh(current,incoming).chapters[0].revealed,true);
 incoming.timeZone="America/New_York";assert.equal(sameBloomStory(current,incoming),false);
});

test("saved experience changes replace the story rather than mixing revealed chapters",()=>{
 const current=story();current.version=4;current.experience=createBloomExperience("account|October","sakura");current.chapters[0].revealed=true;
 const incoming={...story(),version:4,experience:createBloomExperience("account|November","sakura")};
 assert.equal(sameBloomStory(current,incoming),false);assert.equal(mergeBloomRefresh(current,incoming),incoming);
 const edited={...current,experience:{...current.experience,opening:"A different saved opening."}};
 assert.equal(sameBloomStory(current,edited),false);
 assert.equal(sameBloomStory(current,{...current,experience:{...current.experience}}),true);
});

test("a background completion stays completed even when an earlier reveal response arrives",()=>{
 const current=story(),incoming=story();current.completed=true;current.completedAt="2026-11-08T10:05:00Z";
 current.chapters=current.chapters.map(chapter=>({...chapter,revealed:true}));incoming.chapters[0].revealed=true;
 const merged=mergeBloomRefresh(current,incoming);assert.equal(merged.completed,true);assert.equal(merged.completedAt,current.completedAt);assert.ok(merged.chapters.every(chapter=>chapter.revealed));
});

test("undefined old profile fields cannot hide measurements added by another device",()=>{
 const current=story(),incoming=story();current.listening={timeZone:current.timeZone,audibleMs:60000,peakHour:undefined};incoming.listening={timeZone:incoming.timeZone,peakHour:20};
 const merged=mergeBloomRefresh(current,incoming);assert.equal(merged.listening?.peakHour,20);assert.equal(merged.listening?.audibleMs,60000);
});

test("progress resumes only the same saved experience and creation",()=>{
 const recap=story();recap.version=4;recap.experience=createBloomExperience("account|October","sakura");recap.chapters[0].revealed=true;
 const record=bloomProgressRecord(recap,1);assert.equal(restoredBloomIndex(recap,record),1);
 assert.equal(restoredBloomIndex(recap,{...record,version:3}),0);
 assert.equal(restoredBloomIndex(recap,{...record,experienceSeed:recap.experience.seed+1}),0);
 assert.equal(restoredBloomIndex(recap,{...record,snapshotCreatedAt:"2026-11-08T11:00:00Z"}),0);
 assert.equal(restoredBloomIndex(recap,{index:1,version:4}),0);
 assert.equal(restoredBloomIndex({...recap,completed:true},record),0);
});

test("legacy progress is bounded by the reveal frontier and rejects invalid values",()=>{
 const recap=story();recap.chapters[0].revealed=true;
 assert.equal(restoredBloomIndex(recap,{index:99,version:3}),1);
 assert.equal(restoredBloomIndex(recap,{index:1}),1);
 assert.equal(restoredBloomIndex(recap,{index:"1",version:3}),0);
 assert.equal(restoredBloomIndex(recap,{index:1,version:2}),0);
 assert.equal(restoredBloomIndex(recap,null),0);
 assert.equal(restoredBloomIndex(recap,[]),0);
});
