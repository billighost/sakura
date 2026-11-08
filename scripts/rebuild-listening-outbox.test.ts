import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {listeningTimeFallsInPeriod} from "../src/rebuild/app/listeningEvidence";
import type {ListenChunk} from "../src/rebuild/app/offline";

const compiled=ts.transpileModule(readFileSync("src/rebuild/app/offline.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const cutoff=Date.UTC(2026,10,8);
const chunk=(id:string,occurredAt="2026-11-07T00:00:00Z"):ListenChunk=>({eventId:id,recordingId:"recording",sequence:0,msPlayed:1000,positionMs:1000,completed:false,context:"home",occurredAt});

function fixture(options:{status?:number}={}){
 const disk=new Map<string,unknown>(),mirror=new Map<string,string>(),requests:Array<{chunk:ListenChunk;signal:AbortSignal}>=[];let holdWrite:Promise<void>|null=null;
 const entries={
  async get(_store:string,key:string){return disk.get(key);},
  async put(_store:string,value:unknown,key:string){if(holdWrite&&key.includes(":listen:"))await holdWrite;disk.set(key,value);},
  async delete(_store:string,key:string){disk.delete(key);},
  transaction(){return {done:Promise.resolve(),store:{async openCursor(range?:{lower:string;upper:string}){
   const keys=[...disk.keys()].sort().filter(key=>!range||key>=range.lower&&key<=range.upper);
   function cursor(index:number):unknown{const key=keys[index];return key===undefined?null:{key,value:disk.get(key),async delete(){disk.delete(key);},async continue(){return cursor(index+1);}};}
   return cursor(0);
  }}};},
 };
 const exports:Record<string,unknown>={};
 const storage={get length(){return mirror.size;},key:(index:number)=>[...mirror.keys()][index]||null,getItem:(key:string)=>mirror.get(key)||null,setItem:(key:string,value:string)=>mirror.set(key,value),removeItem:(key:string)=>mirror.delete(key)};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>name==="idb"?{openDB:async()=>entries}:name==="./listeningEvidence"?{listeningTimeFallsInPeriod}:{},localStorage:storage,IDBKeyRange:{bound:(lower:string,upper:string)=>({lower,upper})},AbortController,DOMException,Blob,performance,Date,setTimeout,clearTimeout,fetch:async(_url:string,init:{body:string;signal:AbortSignal})=>{requests.push({chunk:JSON.parse(init.body),signal:init.signal});if(options.status)return {ok:options.status>=200&&options.status<300,status:options.status};return new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new DOMException("Canceled","AbortError")),{once:true}));}});
 return {disk,mirror,requests,api:exports as unknown as {deliverListen:(accountId:string,chunk:ListenChunk)=>Promise<boolean>;drainListen:(accountId:string)=>Promise<void>;clearListeningOutbox:(accountId:string,period:"week"|"month"|"all",cutoffMs:number)=>Promise<void>},hold(promise:Promise<void>){holdWrite=promise;}};
}

test("clearing a week cancels its current delivery and retains older and other-account evidence",async()=>{
 const f=fixture(),recent=chunk("recent"),older=chunk("older","2026-10-20T00:00:00Z"),other=chunk("other");
 f.disk.set("account:a:listen:older:0",older);f.mirror.set("sakura-v2-outbox:a:older:0",JSON.stringify(older));f.disk.set("account:b:listen:other:0",other);f.mirror.set("sakura-v2-outbox:b:other:0",JSON.stringify(other));
 const delivery=f.api.deliverListen("a",recent);await tick();assert.equal(f.requests.length,1);await f.api.clearListeningOutbox("a","week",cutoff);assert.equal(await delivery,false);assert.equal(f.requests[0].signal.aborted,true);
 assert.equal(f.disk.has("account:a:listen:recent:0"),false);assert.equal(f.mirror.has("sakura-v2-outbox:a:recent:0"),false);assert.equal(f.disk.has("account:a:listen:older:0"),true);assert.equal(f.mirror.has("sakura-v2-outbox:a:older:0"),true);assert.equal(f.disk.has("account:b:listen:other:0"),true);
});
test("a delayed storage write cannot recreate cleared listening or begin an HTTP upload",async()=>{
 const f=fixture();let release:()=>void=()=>{};f.hold(new Promise<void>(resolve=>{release=resolve;}));const delivery=f.api.deliverListen("a",chunk("delayed"));await tick();const cleared=f.api.clearListeningOutbox("a","all",cutoff);await tick();release();await cleared;assert.equal(await delivery,false);assert.equal(f.requests.length,0);assert.equal(f.disk.size,0);assert.equal(f.mirror.size,0);
});


test("a delayed outbox reader cannot submit a chunk erased before delivery began",async()=>{
 const f=fixture();await f.api.clearListeningOutbox("a","week",cutoff);assert.equal(await f.api.deliverListen("a",chunk("stale-read")),false);assert.equal(f.requests.length,0);assert.equal(f.disk.size,0);assert.equal(f.mirror.size,0);
});

test("all-time clearing retains a new listen that happened after the deletion receipt",async()=>{
 const f=fixture(),fresh=chunk("fresh","2026-11-09T00:00:00Z");const delivery=f.api.deliverListen("a",fresh);await tick();await f.api.clearListeningOutbox("a","all",cutoff);assert.equal(f.requests[0].signal.aborted,false);assert.equal(f.disk.has("account:a:listen:fresh:0"),true);await f.api.clearListeningOutbox("a","all",cutoff+2*86400000);assert.equal(await delivery,false);
});


test("corrupt outbox entries are removed without preventing healthy listening from syncing",async()=>{
 const f=fixture({status:200});f.disk.set("account:a:listen:broken:0",{eventId:null});f.mirror.set("sakura-v2-outbox:a:broken-json:0","{");f.mirror.set("sakura-v2-outbox:a:good:0",JSON.stringify(chunk("good")));f.disk.set("account:b:listen:broken:0",{eventId:null});await f.api.drainListen("a");assert.equal(f.requests.length,1);assert.equal(f.requests[0].chunk.eventId,"good");assert.equal(f.mirror.size,0);assert.equal(f.disk.has("account:a:listen:broken:0"),false);assert.equal(f.disk.has("account:b:listen:broken:0"),true);
});

for(const status of [400,404,409,410])test(`a permanently rejected ${status} listening chunk does not block later delivery`,async()=>{
 const f=fixture({status});for(const id of ["first","second"]){f.disk.set(`account:a:listen:${id}:0`,chunk(id));f.mirror.set(`sakura-v2-outbox:a:${id}:0`,JSON.stringify(chunk(id)));}await f.api.drainListen("a");assert.equal(f.requests.length,2);assert.equal(f.disk.size,0);assert.equal(f.mirror.size,0);
});

test("a session error keeps listening pending for the account's next sign-in",async()=>{
 const f=fixture({status:401});f.disk.set("account:a:listen:first:0",chunk("first"));await f.api.drainListen("a");assert.equal(f.requests.length,1);assert.equal(f.disk.has("account:a:listen:first:0"),true);assert.equal(f.mirror.size,1);
});
