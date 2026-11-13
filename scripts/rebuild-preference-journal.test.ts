import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {AUDIO_TECHNOLOGIES} from "../src/rebuild/audio/presets";
import {validTimeZone} from "../src/rebuild/bloom/calendar";
import {FEED_NUMERIC_FIELDS,FEED_BOOLEAN_FIELDS} from "../src/rebuild/app/feedPreferences";
import {initialTasteSignature,normalizeInitialTasteProfile} from "../src/rebuild/recommendations/initialTaste";
import {DEFAULT_SETTINGS} from "../src/rebuild/data/validation";
import type {PreferenceSyncMetadata} from "../src/rebuild/app/preferences";
import type {UserSettings} from "../src/rebuild/app/types";

const compiled=ts.transpileModule(readFileSync("src/rebuild/app/preferences.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const settings={...DEFAULT_SETTINGS,theme:"light",discovery:.4,seedArtists:[],seedGenres:[],seedArtistSelections:[],onboarded:true} as UserSettings;
const metadata:PreferenceSyncMetadata={serverRevision:5,serverSettings:settings,baseSettings:{theme:"light",discovery:.4,volume:.8},baseFieldRevisions:{theme:2,discovery:3,volume:4},serverFieldRevisions:{theme:2,discovery:3,volume:4}};
function fixture(){
 const disk=new Map<string,unknown>(),mirror=new Map<string,string>();let visits=0,stamp=1000,blockedDisk=false,blockedMirror=false,failedTransaction=false,holdRevision:number|undefined,held:Promise<void>|undefined,release:()=>void=()=>{},transactionTail:Promise<void>=Promise.resolve();
 function tab(){
  const exports:Record<string,unknown>={};
  vm.runInNewContext(compiled,{exports,Date:{now:()=>stamp},crypto:{randomUUID},localStorage:{get length(){return mirror.size;},key:(index:number)=>[...mirror.keys()][index]||null,getItem:(key:string)=>mirror.get(key)||null,setItem:(key:string,value:string)=>{if(blockedMirror)throw new Error("Mirror unavailable");mirror.set(key,value);},removeItem:(key:string)=>{if(blockedMirror)throw new Error("Mirror unavailable");mirror.delete(key);}},require:(name:string)=>name==="./offline"?{
   offlineDatabase:async()=>{if(blockedDisk)throw new Error("Disk unavailable");return {transaction(){if(failedTransaction){const error=new Error("Transaction request unavailable");return {store:{get:()=>Promise.reject(error)},done:Promise.reject(error)};}const ready=transactionTail;let complete:()=>void=()=>{};const done=new Promise<void>(resolve=>{complete=resolve;});transactionTail=done;return {store:{get:async(key:string)=>{await ready;return plain(disk.get(key.replace(/^account:/,""))??null);},put:async(value:unknown,key:string)=>{await ready;disk.set(key.replace(/^account:/,""),plain(value));}},get done(){complete();return done;}};}};},
   localRead:async(account:string,key:string)=>plain(disk.get(account+":"+key)??null),
   localWrite:async(account:string,key:string,value:unknown)=>{if(blockedDisk)throw new Error("Disk unavailable");if(holdRevision!==undefined&&key.startsWith("preference-intent:")&&(value as {baseRevision?:number}).baseRevision===holdRevision){holdRevision=undefined;await held;}disk.set(account+":"+key,plain(value));},
   localDelete:async(account:string,key:string)=>{if(blockedDisk)throw new Error("Disk unavailable");disk.delete(account+":"+key);},
   localEntries:async(account:string,prefix:string)=>[...disk].filter(([key])=>key.startsWith(account+":"+prefix)).map(([key,value])=>{visits++;return {name:key.slice(account.length+1),value:plain(value)};}),
  }:name==="../audio/presets"?{AUDIO_TECHNOLOGIES}:name==="../bloom/calendar"?{validTimeZone}:name==="./feedPreferences"?{FEED_NUMERIC_FIELDS,FEED_BOOLEAN_FIELDS}:name==="../recommendations/initialTaste"?{initialTasteSignature,normalizeInitialTasteProfile}:{} });
  return exports as unknown as typeof import("../src/rebuild/app/preferences");
 }
 return {disk,mirror,tab,visits:()=>visits,resetVisits:()=>{visits=0;},now:(value:number)=>{stamp=value;},blockDisk:(value=true)=>{blockedDisk=value;},blockMirror:(value=true)=>{blockedMirror=value;},failTransaction:(value=true)=>{failedTransaction=value;},holdVersion:(revision:number)=>{holdRevision=revision;held=new Promise<void>(resolve=>{release=resolve;});},release:()=>release()};
}

test("100,000 reserved orders are point-read and do not enter preference hydration",async()=>{
 const f=fixture(),tab=f.tab(),operations=await stage(tab,{volume:.3});await tab.acknowledgePreferenceIntents("owner",operations);
 for(let i=0;i<100000;i++)f.disk.set("owner:preference-order:historic-"+i,{operationId:"historic-"+i,createdAt:i});f.resetVisits();assert.deepEqual(plain((await tab.readPreferenceDraft("owner"))?.pendingPatch),{});assert.ok(f.visits()<=4,String(f.visits()));
});
test("a durable current server checkpoint repairs missing complete preference snapshots",async()=>{
 const f=fixture(),tab=f.tab(),current={...settings,volume:.3};await tab.writePreferenceDraft("owner",current,false,{}, {...metadata,serverRevision:6,serverSettings:current,pendingOperations:{}});f.disk.delete("owner:preference-draft");f.disk.delete("owner:settings");f.mirror.delete("sakura-v2-preferences:owner");assert.equal((await f.tab().readPreferenceDraft("owner"))?.settings.volume,.3);assert.equal(f.tab().cachedPreferences("owner").volume,.3);
});
test("legacy acknowledgment history compacts by field without reviving an older writer",async()=>{
 const f=fixture(),tab=f.tab(),old=await stage(tab,{volume:.2});f.now(10000);const current=await stage(tab,{volume:.3});await tab.acknowledgePreferenceIntents("owner",current);
 for(let i=0;i<1000;i++){const ack={...old.volume,operationId:"historic-"+i,createdAt:i};f.disk.set("owner:preference-ack:"+ack.operationId,ack);f.mirror.set("sakura-v2-preference-ack:owner:"+ack.operationId,JSON.stringify(ack));}
 await tab.readPreferenceDraft("owner");for(let i=0;i<100&&[...f.disk.keys()].filter(key=>key.startsWith("owner:preference-ack:")).length>1;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal([...f.disk.keys()].filter(key=>key.startsWith("owner:preference-ack:")).length,1);assert.equal([...f.mirror.keys()].filter(key=>key.startsWith("sakura-v2-preference-ack:owner:")).length,1);
 await tab.writePreferenceDraft("owner",{...settings,volume:.2},true,{volume:.2},{...metadata,pendingOperations:old});assert.deepEqual(plain((await f.tab().readPreferenceDraft("owner"))?.pendingPatch),{});
});
async function stage(tab:ReturnType<ReturnType<typeof fixture>["tab"]>,patch:Partial<UserSettings>,meta=metadata){
 const operations=tab.createPreferenceIntents("owner",patch,meta);await tab.writePreferenceDraft("owner",{...settings,...patch},true,patch,{...meta,pendingOperations:operations});return operations;
}

test("offline tabs retain unrelated preference edits with each original server baseline",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab();await stage(a,{theme:"dark"});await stage(b,{discovery:.7});
 const reopened=await f.tab().readPreferenceDraft("owner");assert.deepEqual(plain(reopened?.pendingPatch),{theme:"dark",discovery:.7});assert.deepEqual(plain(reopened?.baseSettings),{theme:"light",discovery:.4});assert.deepEqual(plain(reopened?.baseFieldRevisions),{theme:2,discovery:3});
 assert.equal(f.tab().cachedPreferences("owner").theme,"dark");assert.equal(f.tab().cachedPreferences("owner").discovery,.7);
});

test("a stale whole draft cannot replace a newer same-field operation",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=await stage(a,{volume:.2}),latest=await stage(b,{volume:.3});
 await a.writePreferenceDraft("owner",{...settings,volume:.2},true,{volume:.2},{...metadata,pendingOperations:first});
 const reopened=await b.readPreferenceDraft("owner");assert.equal(reopened?.pendingOperations?.volume.operationId,latest.volume.operationId);assert.equal(reopened?.pendingPatch?.volume,.3);
});

test("an older in-flight acknowledgment preserves newer same-field and unrelated edits",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=await stage(a,{volume:.2}),later=await stage(b,{volume:.3,theme:"dark"});
 await a.acknowledgePreferenceIntents("owner",first);const reopened=await f.tab().readPreferenceDraft("owner");assert.deepEqual(plain(reopened?.pendingPatch),{volume:.3,theme:"dark"});assert.equal(reopened?.pendingOperations?.volume.operationId,later.volume.operationId);
});

test("acknowledging a newer operation prevents stale older intent resurrection",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=await stage(a,{volume:.2}),latest=await stage(b,{volume:.3});await b.acknowledgePreferenceIntents("owner",latest);
 await a.writePreferenceDraft("owner",{...settings,volume:.2},true,{volume:.2},{...metadata,pendingOperations:first});const reopened=await b.readPreferenceDraft("owner");assert.deepEqual(plain(reopened?.pendingPatch),{});assert.equal(reopened?.pending,false);
});

for(const diskOnly of [false,true])test(`a stale tab cannot revert an acknowledged newer server snapshot${diskOnly?" when only IndexedDB works":""}`,async()=>{
 const f=fixture();if(diskOnly)f.blockMirror();const a=f.tab(),b=f.tab(),first=await stage(a,{volume:.2}),latest=await stage(b,{volume:.3});await b.acknowledgePreferenceIntents("owner",latest);
 const current={...settings,volume:.3};await b.writePreferenceDraft("owner",current,false,{}, {...metadata,serverRevision:6,serverSettings:current,pendingOperations:{}});
 await a.writePreferenceDraft("owner",{...settings,volume:.2},true,{volume:.2},{...metadata,pendingOperations:first});const reopened=await f.tab().readPreferenceDraft("owner");assert.deepEqual(plain(reopened?.pendingPatch),{});assert.equal(reopened?.settings.volume,.3);assert.equal(reopened?.serverRevision,6);if(!diskOnly)assert.equal(f.tab().cachedPreferences("owner").volume,.3);
});

test("equal milliseconds and a backward device clock keep later edits later across tabs",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=await stage(a,{volume:.2});f.now(1);const latest=await stage(b,{volume:.3});assert.ok(latest.volume.createdAt>first.volume.createdAt);
 await a.writePreferenceDraft("owner",{...settings,volume:.2},true,{volume:.2},{...metadata,pendingOperations:first});assert.equal((await f.tab().readPreferenceDraft("owner"))?.pendingPatch?.volume,.3);
});

test("a stale copy of one operation cannot downgrade its acknowledged rebased baseline",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),operations=await stage(a,{volume:.3});
 const rebased={volume:{...operations.volume,baseValue:.2,baseRevision:8}};await b.writePreferenceDraft("owner",{...settings,volume:.3},true,{volume:.3},{...metadata,pendingOperations:rebased});
 await a.writePreferenceDraft("owner",{...settings,volume:.3},true,{volume:.3},{...metadata,pendingOperations:operations});const reopened=await b.readPreferenceDraft("owner");assert.equal(reopened?.baseSettings?.volume,.2);assert.equal(reopened?.baseFieldRevisions?.volume,8);
});

test("a delayed old-baseline disk write cannot replace a concurrent newer baseline version",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),operations=await stage(a,{volume:.3});f.holdVersion(4);
 const stale=a.writePreferenceDraft("owner",{...settings,volume:.3},true,{volume:.3},{...metadata,pendingOperations:operations});await new Promise(resolve=>setImmediate(resolve));
 const rebased={volume:{...operations.volume,baseValue:.2,baseRevision:8}};await b.writePreferenceDraft("owner",{...settings,volume:.3},true,{volume:.3},{...metadata,pendingOperations:rebased});f.release();await stale;
 const reopened=await f.tab().readPreferenceDraft("owner");assert.equal(reopened?.baseSettings?.volume,.2);assert.equal(reopened?.baseFieldRevisions?.volume,8);
});

test("legacy preference drafts migrate without losing pending fields or their bases",async()=>{
 const f=fixture();f.mirror.set("sakura-v2-preferences:owner",JSON.stringify({settings:{...settings,theme:"dark"},pending:true,pendingPatch:{theme:"dark"},savedAt:900,...metadata}));
 const reopened=await f.tab().readPreferenceDraft("owner");assert.equal(reopened?.pendingPatch?.theme,"dark");assert.equal(reopened?.baseSettings?.theme,"light");assert.ok(reopened?.pendingOperations?.theme.operationId.startsWith("legacy:"));
});

test("a preference operation captures immutable array values before asynchronous storage",async()=>{
 const f=fixture(),a=f.tab(),artists=["First artist"],operations=a.createPreferenceIntents("owner",{seedArtists:artists},metadata);artists.push("Later mutation");
 await a.writePreferenceDraft("owner",{...settings,seedArtists:["First artist"]},true,{seedArtists:["First artist"]},{...metadata,pendingOperations:operations});assert.deepEqual(plain((await a.readPreferenceDraft("owner"))?.pendingPatch?.seedArtists),["First artist"]);
});

for(const disabled of ["mirror","disk"] as const)test(`the ${disabled} may fail while the other storage path retains every field`,async()=>{
 const f=fixture();if(disabled==="mirror")f.blockMirror();else f.blockDisk();const a=f.tab(),b=f.tab();await stage(a,{theme:"dark"});await stage(b,{discovery:.7});assert.deepEqual(plain((await f.tab().readPreferenceDraft("owner"))?.pendingPatch),{theme:"dark",discovery:.7});
});

test("complete preference storage failure rejects staging and acknowledgment",async()=>{
 const f=fixture(),a=f.tab(),operations=await stage(a,{theme:"dark"});f.blockDisk();f.blockMirror();await assert.rejects(stage(a,{discovery:.7}),/unavailable/);await assert.rejects(a.acknowledgePreferenceIntents("owner",operations),/unavailable/);f.blockDisk(false);f.blockMirror(false);assert.equal((await a.readPreferenceDraft("owner"))?.pendingPatch?.theme,"dark");
});

test("a failed IndexedDB request consumes transaction rejection and retains the mirror",async()=>{
 const f=fixture();f.failTransaction();await stage(f.tab(),{theme:"dark"});await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.tab().readPreferenceDraft("owner"))?.pendingPatch?.theme,"dark");
});

test("a failed IndexedDB request without a mirror rejects durable staging",async()=>{
 const f=fixture();f.failTransaction();f.blockMirror();await assert.rejects(stage(f.tab(),{theme:"dark"}),/Transaction request unavailable/);await new Promise(resolve=>setImmediate(resolve));assert.equal(await f.tab().readPreferenceDraft("owner"),undefined);
});

test("preference operation journals and acknowledgments remain account scoped",async()=>{
 const f=fixture(),a=f.tab(),operations=await stage(a,{theme:"dark"});await a.acknowledgePreferenceIntents("other",operations);assert.equal((await a.readPreferenceDraft("owner"))?.pendingPatch?.theme,"dark");assert.equal(await a.readPreferenceDraft("third"),undefined);
});

test("persisting server state does not implicitly acknowledge another tab's pending field",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab();await stage(a,{theme:"dark"});await b.writePreferenceDraft("owner",settings,false,{},metadata);assert.equal((await f.tab().readPreferenceDraft("owner"))?.pendingPatch?.theme,"dark");
});
