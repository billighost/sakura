import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import {webcrypto} from "node:crypto";
import ts from "typescript";
import {DownloadSnapshots} from "../src/rebuild/app/downloadSnapshots";
import type {DownloadEntry,MusicTrack} from "../src/rebuild/app/types";

const track=(id:string):MusicTrack=>({id,title:id,artists:["Artist"],artistId:null,albumId:null,albumTitle:null,durationMs:10000,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id},references:[]});
const entry=(id:string):DownloadEntry=>({recordingId:id,track:track(id),status:"downloading",downloadedBytes:1,totalBytes:100,operationId:id,requested:true,updatedAt:1});
test("download byte progress preserves unrelated entries and membership identities",()=>{
 const store=new DownloadSnapshots(),a=entry("a"),b=entry("b");store.publish({a,b});const first=store.getSnapshot(),membership=store.getMembershipSnapshot();let aCalls=0,bCalls=0,allCalls=0,membershipCalls=0;
 store.subscribeEntry("a",()=>aCalls++);store.subscribeEntry("b",()=>bCalls++);store.subscribe(()=>allCalls++);store.subscribeMembership(()=>membershipCalls++);
 store.publish({a:{...a,downloadedBytes:50,updatedAt:2},b:{...b}});
 assert.equal(store.getEntry("b"),first.b);assert.notEqual(store.getEntry("a"),first.a);assert.equal(store.getMembershipSnapshot(),membership);assert.deepEqual([aCalls,bCalls,allCalls,membershipCalls],[1,0,1,0]);
 const current=store.getEntry("a")!;store.publish({a:{...current,status:"ready",downloadedBytes:100,updatedAt:3},b});assert.equal(store.getMembershipSnapshot().a.downloadedBytes,100);assert.equal(store.getMembershipSnapshot().a.updatedAt,3);assert.equal(membershipCalls,1);
 store.clear();assert.equal(store.getEntry("a"),undefined);assert.equal(store.getEntry("b"),undefined);assert.deepEqual([aCalls,bCalls,membershipCalls],[3,1,2]);assert.equal(store.getServerSnapshot(),store.getServerSnapshot());
});
test("identical download publications notify nobody and do not retain caller mutation",()=>{
 const store=new DownloadSnapshots(),a=entry("a");store.publish({a});let calls=0;store.subscribe(()=>calls++);const initial=store.getSnapshot();store.publish({a:{...a}});assert.equal(calls,0);assert.equal(store.getSnapshot(),initial);a.downloadedBytes=77;assert.equal(store.getEntry("a")!.downloadedBytes,1);
});

const compiled=ts.transpileModule(readFileSync("src/rebuild/app/offline.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function storageFixture(){
 const disk=new Map<string,unknown>(),reads:string[]=[],writes:string[]=[],visited:string[]=[],ranges:Array<{lower:string;upper:string}|undefined>=[];
 const matches=(key:string,range?:{lower:string;upper:string})=>!range||key>=range.lower&&key<=range.upper;
 const store={async get(name:string){reads.push(name);return disk.get(name);},async put(value:unknown,name:string){writes.push(name);disk.set(name,value);},async delete(name:string){disk.delete(name);},async openCursor(range?:{lower:string;upper:string}){ranges.push(range);const keys=[...disk.keys()].sort().filter(name=>matches(name,range));const cursor=(index:number):unknown=>{const name=keys[index];if(name===undefined)return null;visited.push(name);return {key:name,value:disk.get(name),delete:async()=>disk.delete(name),continue:async()=>cursor(index+1)};};return cursor(0);}};
 const database={get:async(_store:string,name:string)=>store.get(name),put:async(_store:string,value:unknown,name:string)=>store.put(value,name),delete:async(_store:string,name:string)=>store.delete(name),getAllKeys:async(_store:string,range?:{lower:string;upper:string})=>[...disk.keys()].sort().filter(name=>matches(name,range)),getAll:async(_store:string,range?:{lower:string;upper:string})=>[...disk].filter(([name])=>matches(name,range)).map(([,value])=>value),transaction:()=>({store,done:Promise.resolve()})};
 const exports:Record<string,unknown>={},mirror=new Map<string,string>();
 vm.runInNewContext(compiled,{exports,require:(name:string)=>name==="idb"?{openDB:async()=>database}:{listeningTimeFallsInPeriod:()=>false},Blob,AbortController,DOMException,Date,performance,setTimeout,clearTimeout,IDBKeyRange:{bound:(lower:string,upper:string)=>({lower,upper})},localStorage:{get length(){return mirror.size;},key:(i:number)=>[...mirror.keys()][i],getItem:(key:string)=>mirror.get(key)||null,setItem:(key:string,value:string)=>mirror.set(key,value),removeItem:(key:string)=>mirror.delete(key)},fetch:async()=>({ok:true,json:async()=>({accepted:true})})});
 return {disk,reads,writes,visited,ranges,api:exports as unknown as {savedAudioMetadata:(account:string)=>Promise<Array<{track:MusicTrack;requested?:boolean}>>;invalidateSavedAudioMetadata:(account:string)=>void;drainListen:(account:string,options?:{maxChunks?:number})=>Promise<void>;removeAccountCache:(account:string,options?:{includeDownloads?:boolean})=>Promise<void>}};
}
test("indexed ready metadata avoids Blob reads and shares a stable account projection",async()=>{
 const f=storageFixture();for(let i=0;i<1000;i++){const id=String(i),audio={track:track(id),blob:new Blob(["song"],{type:"audio/mpeg"}),sha256:"a".repeat(64),sizeBytes:4,savedAt:1,requested:true};f.disk.set("account:a:audio:"+id,audio);f.disk.set("account:a:audio-meta:"+id,{version:1,track:audio.track,sha256:audio.sha256,sizeBytes:4,savedAt:1,requested:true});}
 const first=await f.api.savedAudioMetadata("a"),second=await f.api.savedAudioMetadata("a");assert.equal(first.length,1000);assert.equal(second,first);assert.equal(f.reads.filter(key=>key.includes(":audio:")).length,0);assert.equal(f.writes.length,0);
 f.disk.delete("account:a:audio:0");f.api.invalidateSavedAudioMetadata("a");assert.equal((await f.api.savedAudioMetadata("a")).length,999);
});
test("legacy ready files backfill only their account and leave audio intact",async()=>{
 const f=storageFixture(),audio={track:track("one"),blob:new Blob(["song"],{type:"audio/mpeg"}),sha256:"b".repeat(64),sizeBytes:4,savedAt:1,requested:true};f.disk.set("account:a:audio:one",audio);f.disk.set("account:b:audio:one",audio);
 const first=await f.api.savedAudioMetadata("a");assert.equal(first.length,1);assert.ok(f.disk.has("account:a:audio-meta:one"));assert.ok(!f.disk.has("account:b:audio-meta:one"));assert.equal(f.disk.get("account:a:audio:one"),audio);const reads=f.reads.length;assert.equal(await f.api.savedAudioMetadata("a"),first);assert.equal(f.reads.length,reads);
 assert.equal(f.reads.filter(key=>key==="account:a:audio:one").length,1);
});
test("listening drain never visits unrelated account audio/chunks",async()=>{
 const f=storageFixture();for(let i=0;i<10000;i++)f.disk.set("account:b:chunk:"+i,{blob:new Blob(["x"])});f.disk.set("account:a:listen:event:0",{eventId:"event",recordingId:"song",sequence:0,msPlayed:1000,positionMs:1000,completed:false,context:"home"});await f.api.drainListen("a",{maxChunks:1});assert.deepEqual(f.visited,["account:a:listen:event:0"]);assert.ok(f.ranges.every(range=>range?.lower==="account:a:listen:"));
});
test("account cache erasure stays inside its range and preserves saved audio metadata",async()=>{
 const f=storageFixture();f.disk.set("account:a:resource:home",{});f.disk.set("account:a:audio:one",{});f.disk.set("account:a:audio-meta:one",{});f.disk.set("account:b:resource:home",{});await f.api.removeAccountCache("a");assert.ok(!f.disk.has("account:a:resource:home"));assert.ok(f.disk.has("account:a:audio:one"));assert.ok(f.disk.has("account:a:audio-meta:one"));assert.ok(f.disk.has("account:b:resource:home"));assert.equal(f.visited.length,3);
});

test("local partial playback reads its manifest and chunk in one coherent transaction and verifies replacement bytes",async()=>{
 const disk=new Map<string,unknown>(),gets:string[]=[],capability={accountId:"a",recordingId:"one",assetId:"asset",sizeBytes:4,sha256:"a".repeat(64)};let transactions=0,hashes=0;
 const data=new Uint8Array([1,2,3,4]),sha=Buffer.from(await webcrypto.subtle.digest("SHA-256",data)).toString("hex"),prefix="account:a:";
 disk.set(prefix+"download:one",{version:1,recordingId:"one",track:track("one"),fingerprint:{assetId:"asset",sizeBytes:4,sha256:capability.sha256},chunkBytes:262144,mimeType:"audio/mpeg"});disk.set(prefix+"chunk:one:0",{offset:0,blob:new Blob([data],{type:"audio/mpeg"}),sha256:sha});
 const database={transaction(){transactions++;let pending=0;const tx:{oncomplete?:()=>void;objectStore:()=>unknown}={objectStore:()=>({get(key:string){gets.push(key);pending++;const request:{result?:unknown;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=disk.get(key);request.onsuccess?.();if(--pending===0)queueMicrotask(()=>tx.oncomplete?.());});return request;}})};return tx;}};
 const context=vm.createContext({self:{location:{origin:"https://sakura.example"},addEventListener(){}},indexedDB:{open(){const request:{result?:unknown;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=database;request.onsuccess?.();});return request;}},Blob,Uint8Array,crypto:{subtle:{async digest(...args:Parameters<typeof webcrypto.subtle.digest>){hashes++;return webcrypto.subtle.digest(...args);}}}});
 vm.runInContext(readFileSync("public/sw.js","utf8"),context);const local=vm.runInContext("localAudioChunk",context);
 assert.deepEqual(Array.from((await local(capability,0,4)).bytes),[1,2,3,4]);assert.equal(transactions,1);assert.equal(gets.length,3);assert.equal(hashes,1);
 disk.set(prefix+"chunk:one:0",{offset:0,blob:new Blob([new Uint8Array([9,9,9,9])],{type:"audio/mpeg"}),sha256:sha});assert.equal(await local(capability,0,4),undefined);assert.equal(transactions,2);assert.equal(hashes,2);
 disk.set(prefix+"audio:one",{track:track("one"),blob:new Blob([data],{type:"audio/mpeg"}),sha256:capability.sha256,sizeBytes:4});const priorGets=gets.length;
 assert.deepEqual(Array.from((await local(capability,0,4)).bytes),[1,2,3,4]);assert.equal(transactions,3);assert.equal(gets.length-priorGets,1);assert.equal(hashes,2);
});
