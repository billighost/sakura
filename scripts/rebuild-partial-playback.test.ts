import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {MessageChannel} from "node:worker_threads";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const accountId="90000000-0000-4000-8000-000000000001",recordingId="80000000-0000-4000-8000-000000000001",assetId="81000000-0000-4000-8000-000000000001",token="82000000-0000-4000-8000-000000000001";
const source=readFileSync(new URL("../public/sw.js",import.meta.url),"utf8");
async function hash(bytes:Uint8Array){return Buffer.from(await webcrypto.subtle.digest("SHA-256",bytes)).toString("hex");}
async function fixture(options:{ready?:boolean;manager?:boolean}={}){
 const bytes=Uint8Array.from({length:590001},(_,index)=>(index*17+index%29)%256),sha256=await hash(bytes),entries=new Map<string,unknown>(),network:Array<{start:number;end:number}>=[],joined:number[]=[];
 const prefix=`account:${accountId}:`,fingerprint={assetId,sizeBytes:bytes.length,sha256};
 const bridge={accountId,recordingId,...fingerprint,fallbackUrl:`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`,mimeType:"audio/mpeg"};
 const record={version:1,recordingId,track:{id:recordingId},chunkBytes:262144,mimeType:"audio/mpeg",fingerprint};
 entries.set(prefix+"download:"+recordingId,record);
 async function save(offset:number){const data=bytes.slice(offset,offset+262144);entries.set(prefix+"chunk:"+recordingId+":"+offset,{offset,blob:new Blob([data],{type:"audio/mpeg"}),sha256:await hash(data)});}
 await save(0);
 if(options.ready)entries.set(prefix+"audio:"+recordingId,{track:{id:recordingId},blob:new Blob([bytes],{type:"audio/mpeg"}),sizeBytes:bytes.length,sha256});
 const client={postMessage(data:{type:string;offset:number},ports:MessagePort[]){if(data.type!=="sakura-audio-chunk")return;void(async()=>{if(options.manager){joined.push(data.offset);await save(data.offset);ports[0].postMessage({status:"ready"});}else ports[0].postMessage({status:"unavailable"});ports[0].close();})();}};
 const handlers=new Map<string,(event:unknown)=>void>();
 const context=vm.createContext({self:{location:{origin:"https://sakura.example"},clients:{get:async()=>client},addEventListener(name:string,handler:(event:unknown)=>void){handlers.set(name,handler);},skipWaiting(){},},indexedDB:{},crypto:webcrypto,Blob,Uint8Array,Response,Request,Headers,ReadableStream,AbortController,DOMException,MessageChannel,setTimeout,clearTimeout,URL,
  async fetch(_url:URL,init:RequestInit){const range=/^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get("Range")||"")!;const start=Number(range[1]),end=Number(range[2]);network.push({start,end});return new Response(bytes.slice(start,end+1),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${bytes.length}`}});},
 });
 vm.runInContext(source,context);
 context.readFixtureEntry=async(key:string)=>entries.get(key);
 vm.runInContext("audioEntry=readFixtureEntry",context);
 const api=vm.runInContext("({parseAudioRange,validAudioBridge,audioFingerprintMatches,verifiedAudioChunk,serveDeviceAudio,revokeAudioCapability,audioCapabilities})",context);
 api.audioCapabilities.set(token,{...bridge,clientId:"owner-tab",expiresAt:Date.now()+60000});
 return {...api,context,handlers,bytes,entries,network,joined,bridge,prefix,save,async serve(range?:string,clientId="owner-tab",signal?:AbortSignal){return api.serveDeviceAudio(new Request(`https://sakura.example/_sakura/audio/${token}`,{headers:range?{Range:range}:{},signal}),clientId,token) as Promise<Response>;}};
}

test("progressive audio serves persisted prefix and fetches only missing aligned intervals",async()=>{
 const f=await fixture(),response=await f.serve("bytes=120-580000");
 assert.equal(response.status,206);assert.equal(response.headers.get("Content-Range"),`bytes 120-580000/${f.bytes.length}`);assert.equal(response.headers.get("Cache-Control"),"private, no-store");
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes.slice(120,580001));
 assert.deepEqual(f.network,[{start:262144,end:524287},{start:524288,end:590000}]);
});

test("progressive playback joins manager chunk flights rather than creating duplicate fetches",async()=>{
 const f=await fixture({manager:true}),response=await f.serve();
 assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);assert.deepEqual(f.joined,[262144,524288]);assert.deepEqual(f.network,[]);
});

test("client capabilities cannot expose another tab or expired account source",async()=>{
 const f=await fixture();assert.equal((await f.serve("bytes=0-20","another-tab")).status,404);
 f.audioCapabilities.get(token).expiresAt=Date.now()-1;assert.equal((await f.serve()).status,404);assert.deepEqual(f.network,[]);
});

test("saved full audio can serve a suffix offline after partial manifest deletion",async()=>{
 const f=await fixture({ready:true});f.entries.delete(f.prefix+"download:"+recordingId);f.entries.delete(f.prefix+"chunk:"+recordingId+":0");
 const response=await f.serve("bytes=-301");assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes.slice(-301));assert.deepEqual(f.network,[]);
});

test("corrupt chunks and changed asset fingerprints are never used for playback",async()=>{
 const f=await fixture();const key=f.prefix+"chunk:"+recordingId+":0",chunk=f.entries.get(key) as {blob:Blob};chunk.blob=new Blob([new Uint8Array(262144)]);
 let response=await f.serve("bytes=0-99");assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes.slice(0,100));assert.equal(f.network.length,1);
 await f.save(0);const record=f.entries.get(f.prefix+"download:"+recordingId) as {fingerprint:{assetId:string}};record.fingerprint.assetId="81000000-0000-4000-8000-000000000099";
 response=await f.serve("bytes=0-99");assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes.slice(0,100));assert.equal(f.network.length,2);
});

test("invalid ranges are rejected and bridges accept only the canonical same-origin gateway",async()=>{
 const f=await fixture();for(const range of ["bytes=9999999999-","bytes=20-10","bytes=0-1,3-4","bytes=-0","items=0-20"]){const response=await f.serve(range);assert.equal(response.status,416);assert.equal(response.headers.get("Content-Range"),`bytes */${f.bytes.length}`);}
 assert.equal(f.validAudioBridge(f.bridge),true);assert.equal(f.validAudioBridge({...f.bridge,fallbackUrl:"https://other.example/audio"}),false);assert.equal(f.validAudioBridge({...f.bridge,fallbackUrl:`/api/v2/recordings/${recordingId}/audio?assetId=wrong`}),false);assert.deepEqual(f.network,[]);
});

test("request cancellation stops progressive preparation without dropping saved chunks",async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort();const response=await f.serve("bytes=0-99","owner-tab",controller.signal);assert.equal(response.status,499);assert.ok(f.entries.has(f.prefix+"chunk:"+recordingId+":0"));assert.deepEqual(f.network,[]);
});

test("revoking an account aborts its already-open audio streams",async()=>{
 const f=await fixture(),response=await f.serve();f.revokeAudioCapability(token);await assert.rejects(response.arrayBuffer(),/expired|Abort/i);assert.equal((await f.serve()).status,404);
});

test("incorrect upstream byte intervals are refused before they reach the player",async()=>{
 const f=await fixture();f.context.fetch=async()=>new Response(new Uint8Array(262144),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes 0-262143/${f.bytes.length}`}});
 const response=await f.serve("bytes=262144-262999");assert.equal(response.status,503);
});

test("a worker restart restores only the same client's unexpired persisted capability",async()=>{
 const f=await fixture();f.entries.set("audio-bridge:"+token,{...f.bridge,clientId:"owner-tab",expiresAt:Date.now()+60000});f.audioCapabilities.clear();
 assert.equal((await f.serve("bytes=0-99","another-tab")).status,404);
 const response=await f.serve("bytes=0-99");assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes.slice(0,100));assert.deepEqual(f.network,[]);
});

test("an in-flight worker registration cannot restore a capability after account revocation",async()=>{
 const f=await fixture();f.audioCapabilities.clear();let startSave:()=>void=()=>{},releaseSave:()=>void=()=>{};
 const started=new Promise<void>(resolve=>{startSave=resolve;}),deferred=new Promise<void>(resolve=>{releaseSave=resolve;});
 f.context.saveFixtureCapability=async(key:string,capability:Record<string,unknown>)=>{startSave();await deferred;f.entries.set("audio-bridge:"+key,capability);};
 f.context.deleteFixtureCapability=async(key:string)=>{f.entries.delete("audio-bridge:"+key);};
 f.context.pruneFixtureCapabilities=async(clientId?:string)=>{for(const [key,value]of f.entries)if(key.startsWith("audio-bridge:")&&(value as {clientId:string}).clientId===clientId)f.entries.delete(key);};
 vm.runInContext("saveAudioCapability=saveFixtureCapability;deleteAudioCapability=deleteFixtureCapability;pruneAudioCapabilities=pruneFixtureCapabilities",f.context);
 const work:Promise<unknown>[]=[],replies:string[]=[],message=f.handlers.get("message")!;
 message({origin:"https://sakura.example",source:{id:"owner-tab"},data:{type:"sakura-audio-register",token,bridge:f.bridge},ports:[{postMessage(data:{status:string}){replies.push(data.status);},close(){}}],waitUntil(promise:Promise<unknown>){work.push(promise);}});
 await started;
 message({origin:"https://sakura.example",source:{id:"owner-tab"},data:{type:"sakura-audio-revoke"},ports:[],waitUntil(promise:Promise<unknown>){work.push(promise);}});
 releaseSave();await Promise.all(work);assert.deepEqual(replies,["unavailable"]);assert.equal(f.audioCapabilities.has(token),false);assert.equal(f.entries.has("audio-bridge:"+token),false);assert.equal((await f.serve("bytes=0-99")).status,404);
});

test("a late helper registration acknowledgement cannot recreate a revoked account lease",async()=>{
 const pending:Array<{data:{type:string};port:MessagePort}>=[],exports:Record<string,unknown>={};
 const controller={postMessage(data:{type:string},ports?:MessagePort[]){if(data.type==="sakura-audio-register")pending.push({data,port:ports![0]});}};
 const context=vm.createContext({exports,module:{exports},navigator:{serviceWorker:{controller,addEventListener(){}}},location:{origin:"https://sakura.example"},crypto:webcrypto,MessageChannel,setTimeout,clearTimeout,URL,AbortController});
 const js=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/partialPlayback.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInContext(js,context);
 const partial=exports.partialPlaybackUrl as (id:string,source:unknown)=>Promise<string|undefined>,revoke=exports.revokePartialPlayback as ()=>void;
 const input={track:{id:recordingId},assetId,sizeBytes:10,sha256:"a".repeat(64),url:"/source",fallbackUrl:`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`};
 const old=partial(accountId,input);assert.equal(pending.length,1);revoke();pending[0].port.postMessage({status:"ready",version:1});pending[0].port.close();assert.equal(await old,undefined);
 const fresh=partial(accountId,input);assert.equal(pending.length,2,"A fresh request must register again rather than reuse the revoked lease");pending[1].port.postMessage({status:"ready",version:1});pending[1].port.close();assert.match((await fresh)!,/^\/_sakura\/audio\//);revoke();
});

test("the page bridge reports an unavailable manager chunk instead of claiming it is ready",async()=>{
 const pending:Array<{data:{type:string;token:string};port:MessagePort}>=[],listeners=new Map<string,(event:{data:{type:string;token:string;requestId:string;offset:number};ports:Array<{postMessage:(value:{status:string})=>void;close:()=>void}>})=>void>(),exports:Record<string,unknown>={};
 const controller={postMessage(data:{type:string;token:string},ports?:MessagePort[]){if(data.type==="sakura-audio-register")pending.push({data,port:ports![0]});}};
 const serviceWorker={controller,addEventListener(name:string,listener:(event:{data:{type:string;token:string;requestId:string;offset:number};ports:Array<{postMessage:(value:{status:string})=>void;close:()=>void}>})=>void){listeners.set(name,listener);}};
 const context=vm.createContext({exports,module:{exports},navigator:{serviceWorker},location:{origin:"https://sakura.example"},crypto:webcrypto,MessageChannel,setTimeout,clearTimeout,URL,AbortController});
 const js=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/partialPlayback.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInContext(js,context);
 const partial=exports.partialPlaybackUrl as (id:string,source:unknown,ensure:(offset:number,signal:AbortSignal)=>Promise<unknown>)=>Promise<string|undefined>,revoke=exports.revokePartialPlayback as ()=>void;
 const input={track:{id:recordingId},assetId,sizeBytes:10,sha256:"a".repeat(64),url:"/source",fallbackUrl:`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`};
 const registration=partial(accountId,input,async()=>undefined);pending[0].port.postMessage({status:"ready",version:1});pending[0].port.close();const address=await registration,registeredToken=address!.split("/").at(-1)!;
 const replies:string[]=[];listeners.get("message")!({data:{type:"sakura-audio-chunk",token:registeredToken,requestId:"range-1",offset:0},ports:[{postMessage(value){replies.push(value.status);},close(){}}]});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(replies,["unavailable"]);revoke();
});
