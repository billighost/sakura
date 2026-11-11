import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {DurableDownloadManager,type DownloadSource,type DownloadStorage,type PartialDownloadRecord} from "../src/rebuild/app/downloadEngine";
import {readAudioRange} from "../src/rebuild/app/downloadRange";
import {UserFacingError,userIssue} from "../src/rebuild/app/errors";
import type {DownloadChunk} from "../src/rebuild/app/downloadTypes";
import type {DownloadEntry,MusicTrack} from "../src/rebuild/app/types";
import type {OfflineAudio} from "../src/rebuild/app/offline";

const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const track=(id:string):MusicTrack=>({id,title:id,artists:["Test artist"],artistId:null,albumId:null,albumTitle:null,durationMs:240000,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id:id.replace(/\D/g,"")||"1"},references:[]});
const bytes=(length=32*1024)=>Uint8Array.from({length},(_,i)=>i%239);
class MemoryStorage implements DownloadStorage {
 records=new Map<string,PartialDownloadRecord>();parts=new Map<string,Map<number,DownloadChunk>>();audio=new Map<string,OfflineAudio>();leases=new Map<string,{owner:string;expiresAt:number}>();
 async list(){return [...this.records.values()].map(row=>structuredClone(row));}async read(id:string){const row=this.records.get(id);return row&&structuredClone(row);}async save(record:PartialDownloadRecord){this.records.set(record.recordingId,structuredClone(record));}
 async chunks(id:string){return [...this.parts.get(id)?.values()||[]];}async putChunk(id:string,chunk:DownloadChunk){const rows=this.parts.get(id)||new Map();rows.set(chunk.offset,chunk);this.parts.set(id,rows);}
 async ready(id:string){return this.audio.get(id);}async allReady(){return [...this.audio.values()];}async finalize(id:string,audio:OfflineAudio){this.audio.set(id,audio);this.records.delete(id);this.parts.delete(id);}
 async promoteRequested(id:string){const audio=this.audio.get(id);if(!audio)return;const requested={...audio,requested:true};await this.finalize(id,requested);return requested;}
 async clear(id:string,includeReady=false){this.records.delete(id);this.parts.delete(id);if(includeReady)this.audio.delete(id);}
 async clearAutomatic(id:string){if(this.records.get(id)?.requested||this.audio.get(id)?.requested!==false&&this.audio.has(id))return false;await this.clear(id,true);return true;}
 async lease(id:string,owner:string,expiresAt:number){const old=this.leases.get(id);if(old&&old.owner!==owner&&old.expiresAt>Date.now())return false;this.leases.set(id,{owner,expiresAt});return true;}
 async release(id:string,owner:string){if(this.leases.get(id)?.owner===owner)this.leases.delete(id);}
}
function setup(options:{data?:Uint8Array;storage?:MemoryStorage;delay?:number;limit?:number;mutate?:(start:number,data:Uint8Array)=>Uint8Array;onFetch?:(url:string,start:number)=>void;onAbort?:(url:string,start:number)=>void;resolve?:(track:MusicTrack,signal:AbortSignal)=>Promise<DownloadSource>}={}){
 const data=options.data||bytes(),storage=options.storage||new MemoryStorage();let snapshot:Record<string,DownloadEntry>={},requests=0,active=0,maxActive=0;
 const rangeStarts:number[]=[];const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxConcurrentChunks:options.limit??4,onChange:value=>{snapshot=value;},resolve:options.resolve|| (async value=>({track:value,url:"https://cdn.example/"+value.id,assetId:"asset-"+value.id,sizeBytes:data.length,sha256:sha(data)})),
 fetcher:async(input,init)=>{requests++;active++;maxActive=Math.max(maxActive,active);const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!;const start=Number(range[1]),end=Number(range[2]),url=String(input);rangeStarts.push(start);options.onFetch?.(url,start);
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,options.delay??0);init?.signal?.addEventListener("abort",()=>{clearTimeout(timer);active--;options.onAbort?.(url,start);reject(new DOMException("Canceled","AbortError"));},{once:true});});active--;
  const payload=options.mutate?.(start,data.slice(start,end+1))||data.slice(start,end+1);return new Response(new Uint8Array(payload),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(payload.length),"Content-Range":`bytes ${start}-${end}/${data.length}`}});
 }});
 return {manager,storage,get snapshot(){return snapshot;},get requests(){return requests;},get maxActive(){return maxActive;},rangeStarts,data};
}
async function until(condition:()=>boolean,timeout=2000){const end=Date.now()+timeout;while(!condition()){if(Date.now()>end)throw new Error("Condition did not become true");await new Promise(resolve=>setTimeout(resolve,5));}}
async function withoutWebLocks(operation:()=>Promise<void>){const descriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator");Object.defineProperty(globalThis,"navigator",{value:{onLine:true},configurable:true});try{await operation();}finally{if(descriptor)Object.defineProperty(globalThis,"navigator",descriptor);else Reflect.deleteProperty(globalThis,"navigator");}}

test("the first verified playback chunk has a persisted audio format before its reader wakes",async()=>{
 class PlaybackStorage extends MemoryStorage {
  formats:Array<string|undefined>=[];
  async putChunk(id:string,chunk:DownloadChunk){this.formats.push(this.records.get(id)?.mimeType);await super.putChunk(id,chunk);}
 }
 const storage=new PlaybackStorage(),f=setup({storage,delay:20});
 try{
  void f.manager.enqueue(track("1"),{mode:"playback",requested:false}).catch(()=>{});
  const chunk=await f.manager.ensureChunk("1",0);
  assert.equal(chunk?.blob.type,"audio/mpeg");assert.equal(storage.formats[0],"audio/mpeg");
  assert.equal((await storage.read("1"))?.mimeType,"audio/mpeg");assert.equal(storage.audio.has("1"),false);
 }finally{f.manager.dispose();}
});

test("joining playback cannot demote an explicit full download or leave it prepared",async()=>{
 const f=setup({delay:30,data:bytes(4096*12)});
 try{
  const download=f.manager.enqueue(track("1"));
  await f.manager.ensureChunk("1",0);
  void f.manager.enqueue(track("1"),{mode:"playback",requested:false}).catch(()=>{});
  assert.equal(f.snapshot["1"].mode,"full");
  await download;
  assert.equal(f.snapshot["1"].status,"ready");assert.equal(f.storage.audio.get("1")?.blob.size,f.data.length);
 }finally{f.manager.dispose();}
});

test("reopening exposes the saved exact asset for playback independently of resolver availability",async()=>{
 const recordingId="80000000-0000-4000-8000-000000000081",assetId="81000000-0000-4000-8000-000000000081",song=track(recordingId),storage=new MemoryStorage();
 const fingerprint={assetId,sizeBytes:4096*12,sha256:sha(bytes(4096*12))};
 storage.records.set(recordingId,{version:1,recordingId,track:song,status:"paused",mode:"full",requested:true,priority:0,chunkBytes:4096,createdAt:Date.now(),updatedAt:Date.now(),fingerprint,mimeType:"audio/mpeg"});
 const chunk=bytes(4096);await storage.putChunk(recordingId,{offset:0,blob:new Blob([chunk],{type:"audio/mpeg"}),sha256:sha(chunk)});
 let lookups=0;const f=setup({storage,resolve:async()=>{lookups++;throw new Error("Network unavailable");}});
 try{
  await f.manager.hydrate();const source=f.manager.playbackSourceFor(recordingId)!;
  assert.deepEqual({assetId:source.assetId,sizeBytes:source.sizeBytes,sha256:source.sha256},fingerprint);
  assert.equal(source.url,`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`);assert.equal(source.track.id,recordingId);assert.equal(source.mimeType,"audio/mpeg");
  assert.equal((await f.manager.ensureChunk(recordingId,0))?.blob.size,4096);assert.equal(lookups,0);
  storage.records.get(recordingId)!.fingerprint!.assetId="../wrong-asset";
 }finally{f.manager.dispose();}
 const invalid=setup({storage});try{await invalid.manager.hydrate();assert.equal(invalid.manager.playbackSourceFor(recordingId),undefined);}finally{invalid.manager.dispose();}
});

test("range reader rejects shifted/unknown totals and HTML, accepts whole200 only at zero",async()=>{
 const signal=new AbortController().signal,data=bytes(4),headers={"Content-Type":"audio/mpeg","Content-Range":"bytes 0-3/4","Content-Length":"4"};
 const good=await readAudioRange(new Response(data,{status:206,headers}),0,3,4,signal);assert.equal(good.whole,false);
 await assert.rejects(readAudioRange(new Response(data,{status:206,headers:{...headers,"Content-Range":"bytes 1-4/5"}}),0,3,4,signal),/different part/);
 await assert.rejects(readAudioRange(new Response(data,{headers:{"Content-Type":"text/html"}}),0,3,4,signal),/audio file/);
 await assert.rejects(readAudioRange(new Response(data,{headers:{"Content-Type":"audio/mpeg"}}),1,3,4,signal),/cannot resume/);
 assert.equal((await readAudioRange(new Response(data,{headers:{"Content-Type":"audio/mpeg"}}),0,1,4,signal)).whole,true);
});

test("audio error responses preserve source availability, session and retry instructions",async()=>{
 for(const [status,reason,kind]of [[502,"audio-source-unavailable","missing"],[401,"account-mismatch","session"],[429,"backend-unavailable","busy"],[409,"asset-mismatch","version"]] as const){
  await assert.rejects(readAudioRange(Response.json({status:"unavailable",reason,error:"secret upstream details"},{status}),0,3,4,new AbortController().signal),(error:unknown)=>{
   assert.ok(error instanceof UserFacingError);assert.equal(userIssue(error,"download").kind,kind);assert.doesNotMatch(error.message,/secret|upstream/);return true;
  });
 }
});

test("audio error parsing joins fragmented JSON and rejects malformed or oversized error details",async()=>{
 const encoder=new TextEncoder(),json=JSON.stringify({reason:"audio-source-unavailable"});
 const fragmented=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(json.slice(0,12)));controller.enqueue(encoder.encode(json.slice(12)));controller.close();}}),{status:502,headers:{"Content-Type":"application/json; charset=utf-8"}});
 await assert.rejects(readAudioRange(fragmented,0,3,4,new AbortController().signal),(error:unknown)=>error instanceof UserFacingError&&error.issue.kind==="missing");
 for(const body of ["{broken secret json",JSON.stringify({reason:"audio-source-unavailable",error:"secret".repeat(1000)})]){
  let canceled=false;const response=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(body));if(body.length<4096)controller.close();},cancel(){canceled=true;}}),{status:502,headers:{"Content-Type":"application/json"}});
  await assert.rejects(readAudioRange(response,0,3,4,new AbortController().signal),(error:unknown)=>error instanceof UserFacingError&&error.issue.kind==="connection"&&!/secret/.test(error.message));
  if(body.length>4096)await until(()=>canceled);
 }
});

test("stalled audio error bodies stop promptly and caller cancellation stays cancelable",async()=>{
 for(const cancel of [false,true]){
  let canceled=false;const controller=new AbortController(),response=new Response(new ReadableStream<Uint8Array>({cancel(){canceled=true;}}),{status:502,headers:{"Content-Type":"application/json"}});
  const waiting=readAudioRange(response,0,3,4,controller.signal,()=>{},10);if(cancel)controller.abort();
  await assert.rejects(waiting,(error:unknown)=>cancel?error instanceof DOMException&&error.name==="AbortError":error instanceof UserFacingError&&error.issue.kind==="connection");await until(()=>canceled);
 }
});

test("a structured direct-source failure retries the same verified range through the app fallback",async()=>{
 const data=bytes(4096),storage=new MemoryStorage(),requests:string[]=[];let snapshot:Record<string,DownloadEntry>={};
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,onChange:rows=>{snapshot=rows;},resolve:async value=>({track:value,url:"https://cdn.example/1",fallbackUrl:"/api/v2/recordings/1/audio?assetId=asset-1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async(input,init)=>{
  requests.push(String(input));assert.equal(new Headers(init?.headers).get("Range"),"bytes=0-4095");if(requests.length===1)return Response.json({status:"unavailable",reason:"audio-source-unavailable"},{status:502});
  return new Response(data,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(data.length),"Content-Range":`bytes 0-4095/${data.length}`}});
 }});
 try{await manager.enqueue(track("1"));assert.deepEqual(requests,["https://cdn.example/1","/api/v2/recordings/1/audio?assetId=asset-1"]);assert.equal(snapshot["1"].status,"ready");assert.equal(storage.audio.get("1")?.sha256,sha(data));}finally{manager.dispose();}
});

for(const reopen of [false,true])test(`successful direct ranges avoid the Vercel proxy ${reopen?"after reopening a partial download":"for a fresh download"}`,async()=>{
 const data=bytes(4096*4),storage=new MemoryStorage(),requests:Array<{url:string;start:number}>=[];
 if(reopen){
  storage.records.set("1",{version:1,recordingId:"1",track:track("1"),status:"queued",mode:"full",requested:true,priority:0,chunkBytes:4096,createdAt:Date.now(),updatedAt:Date.now(),fingerprint:{assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}});
  const chunk=data.slice(0,4096);await storage.putChunk("1",{offset:0,blob:new Blob([chunk],{type:"audio/mpeg"}),sha256:sha(chunk)});
 }
 const f=setup({data,storage,onFetch:(url,start)=>requests.push({url,start}),resolve:async value=>({track:value,url:"https://cdn.example/1",fallbackUrl:"/api/v2/recordings/1/audio?assetId=asset-1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)})});
 try{
  if(reopen){await f.manager.hydrate();await until(()=>f.snapshot["1"]?.status==="ready");}else await f.manager.enqueue(track("1"));
  assert.ok(requests.length>0);assert.ok(requests.every(request=>request.url==="https://cdn.example/1"));
  assert.deepEqual(requests.map(request=>request.start).sort((a,b)=>a-b),reopen?[4096,8192,12288]:[0,4096,8192,12288]);
  assert.equal(storage.audio.get("1")?.sha256,sha(data));
 }finally{f.manager.dispose();}
});

for(const reload of [false,true])for(const changed of [false,true])test(`failed download retry refreshes its source ${reload?"after reopening":"in the same session"} and ${changed?"replaces changed bytes":"retains matching chunks"}`,async()=>{
 const original=bytes(12288),replacement=changed?original.map(value=>value^64):original,storage=new MemoryStorage(),requests:Array<{url:string;start:number}>=[],resolutions:boolean[]=[];let snapshot:Record<string,DownloadEntry>={};
 const make=()=>new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,maxRecoveryAttempts:0,onChange:rows=>{snapshot=rows;},resolve:async(value,_signal,options)=>{const refresh=options?.refresh===true;resolutions.push(refresh);return {track:value,url:refresh?"https://cdn.example/fresh":"https://cdn.example/stale",assetId:refresh?"asset-new":"asset-old",sizeBytes:original.length,sha256:sha(refresh?replacement:original)};},fetcher:async(input,init)=>{
  const url=String(input),range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);requests.push({url,start});if(url.endsWith("stale")&&start>0)return Response.json({status:"unavailable",reason:"audio-source-unavailable"},{status:502});
  const payload=(url.endsWith("fresh")?replacement:original).slice(start,end+1);return new Response(payload,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(payload.length),"Content-Range":`bytes ${start}-${end}/${original.length}`}});
 }});
 let manager=make();try{
  await assert.rejects(manager.enqueue(track("1")),(error:unknown)=>error instanceof UserFacingError&&error.issue.kind==="missing");await until(()=>storage.records.get("1")?.refreshSource===true);assert.deepEqual([...storage.parts.get("1")!.keys()],[0]);assert.deepEqual(resolutions,[false]);
  if(reload){manager.dispose();manager=make();await manager.hydrate();}
  const before=requests.length,retry=manager.resume("1"),joined=manager.enqueue(track("1"));assert.equal(retry,joined);await retry;
  assert.deepEqual(resolutions,[false,true]);assert.deepEqual(requests.slice(before).map(request=>request.url),Array(changed?3:2).fill("https://cdn.example/fresh"));assert.deepEqual(requests.slice(before).map(request=>request.start),changed?[0,4096,8192]:[4096,8192]);assert.equal(snapshot["1"].status,"ready");assert.equal(storage.audio.get("1")?.sha256,sha(replacement));
 }finally{manager.dispose();}
});
test("duplicate clicks join one recording job; chunks run concurrently and publish only matching complete audio",async()=>{
 const s=setup({delay:5});try{const a=s.manager.enqueue(track("1")),b=s.manager.enqueue(track("1"));assert.equal(a,b);await a;assert.equal(s.requests,8);assert.equal(s.maxActive,2);assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.storage.records.size,0);assert.equal(s.storage.parts.size,0);assert.equal(sha(new Uint8Array(await s.storage.audio.get("1")!.blob.arrayBuffer())),sha(s.data));}finally{s.manager.dispose();}
});
test("multiple songs keep their requests and global bound, and queue priority takes effect between chunks",async()=>{
 const seen:string[]=[];const s=setup({delay:12,limit:2,onFetch:(url,start)=>seen.push(url.split("/").pop()+":"+start)});try{
  const a=s.manager.enqueue(track("1")),b=s.manager.enqueue(track("2")),c=s.manager.enqueue(track("3"));await until(()=>s.requests>=2);s.manager.setPriorities(["3","2"],"3");await Promise.all([a,b,c]);assert.equal(s.maxActive,2);assert.equal(s.requests,24);assert.equal(Object.keys(s.snapshot).length,3);const next=seen.slice(2,5);assert.ok(next.some(row=>row.startsWith("3:")),next.join(","));
 }finally{s.manager.dispose();}
});
test("prepared prefix persists through restart, stays outside explicit downloads, and full upgrade fetches only missing chunks",async()=>{
 const s=setup({delay:2});await s.manager.enqueue(track("1"),{mode:"prefix",requested:false});assert.equal(s.snapshot["1"].status,"prepared");assert.equal(s.snapshot["1"].requested,false);assert.equal(s.storage.audio.size,0);const prefix=await s.manager.getPartial("1");assert.equal(prefix?.blob.size,4096);assert.equal(s.requests,1);s.manager.dispose();
 const next=setup({storage:s.storage,delay:2});try{await next.manager.hydrate();assert.equal(next.snapshot["1"].status,"prepared");await next.manager.enqueue(track("1"));assert.equal(next.requests,7);assert.ok(!next.rangeStarts.includes(0));assert.equal(next.snapshot["1"].status,"ready");}finally{next.manager.dispose();}
});
test("closing during a download preserves completed chunks and restores automatically",async()=>{
 const s=setup({delay:15});const pending=s.manager.enqueue(track("1"));await until(()=>!!s.storage.parts.get("1")?.size);const existing=[...s.storage.parts.get("1")!.keys()];s.manager.dispose();await assert.rejects(pending,{name:"AbortError"});
 const next=setup({storage:s.storage,delay:2});try{await next.manager.hydrate();await until(()=>next.snapshot["1"]?.status==="ready");for(const offset of existing)assert.ok(!next.rangeStarts.includes(offset));}finally{next.manager.dispose();}
});
test("paused jobs remain paused after reload until resume, without discarding committed bytes",async()=>{
 const s=setup({delay:15});const pending=s.manager.enqueue(track("1"));await until(()=>!!s.storage.parts.get("1")?.size);await s.manager.pause("1");await pending;s.manager.dispose();
 const next=setup({storage:s.storage});try{await next.manager.hydrate();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(next.requests,0);assert.equal(next.snapshot["1"].status,"paused");await next.manager.resume("1");assert.equal(next.snapshot["1"].status,"ready");assert.ok(!next.rangeStarts.includes(0));}finally{next.manager.dispose();}
});
test("the wrong complete fingerprint never becomes ready and clears corrupt partials for a clean retry",async()=>{
 const s=setup({mutate:(start,data)=>{if(start===4096)data[0]^=255;return data;}});try{await assert.rejects(s.manager.enqueue(track("1")),/verified recording/);await until(()=>!s.storage.parts.has("1"));assert.equal(s.storage.audio.size,0);assert.equal(s.snapshot["1"].status,"failed");assert.equal(s.snapshot["1"].downloadedBytes,0);}finally{s.manager.dispose();}
});
test("two managers share an expiring recording lease so another tab does not download the same bytes",async()=>{
 const storage=new MemoryStorage(),a=setup({storage,delay:10}),b=setup({storage,delay:10});try{await Promise.all([a.manager.enqueue(track("1")),b.manager.enqueue(track("1"))]);assert.equal(a.requests+b.requests,8);assert.equal(a.snapshot["1"].status,"ready");assert.equal(b.snapshot["1"].status,"ready");}finally{a.manager.dispose();b.manager.dispose();}
});
test("playback joins an active chunk and aborting a playback waiter keeps the song download alive",async()=>{
 const s=setup({delay:15});try{const full=s.manager.enqueue(track("1"));await until(()=>s.rangeStarts.includes(0));const shared=s.manager.ensureChunk("1",0);const controller=new AbortController(),aborted=s.manager.ensureChunk("1",4096,controller.signal);controller.abort();await assert.rejects(aborted,{name:"AbortError"});assert.equal((await shared)?.offset,0);await full;assert.equal(s.requests,8);assert.equal(s.snapshot["1"].status,"ready");}finally{s.manager.dispose();}
});
test("playback mode caches only the requested range, survives reopening, and an explicit save reconstructs missing holes",async()=>{
 const storage=new MemoryStorage(),first=setup({storage,delay:3});try{
  const prepared=first.manager.enqueue(track("1"),{mode:"playback",requested:false}),wanted=first.manager.ensureChunk("1",16384);assert.equal((await wanted)?.offset,16384);await prepared;
  assert.deepEqual(first.rangeStarts,[16384,20480,24576]);assert.equal(first.snapshot["1"].status,"prepared");assert.equal(first.snapshot["1"].mode,"playback");assert.equal(storage.records.get("1")?.playbackOffset,16384);assert.equal(storage.audio.size,0);
 }finally{first.manager.dispose();}
 const restored=setup({storage,delay:2});try{await restored.manager.hydrate();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(restored.requests,0);assert.equal(restored.snapshot["1"].status,"prepared");assert.equal(restored.snapshot["1"].mode,"playback");await restored.manager.enqueue(track("1"));assert.deepEqual(restored.rangeStarts.sort((a,b)=>a-b),[0,4096,8192,12288,28672]);assert.equal(restored.snapshot["1"].status,"ready");assert.equal(restored.snapshot["1"].mode,"full");assert.equal(sha(new Uint8Array(await storage.audio.get("1")!.blob.arrayBuffer())),sha(restored.data));}finally{restored.manager.dispose();}
});
test("a playback seek preempts stale read-ahead so the requested chunk starts next",async()=>{
 const s=setup({delay:80,limit:2});try{const prepared=s.manager.enqueue(track("1"),{mode:"playback",requested:false}),opening=s.manager.ensureChunk("1",0);await opening;await until(()=>s.rangeStarts.includes(4096)&&s.rangeStarts.includes(8192));const marker=s.rangeStarts.length,seek=s.manager.ensureChunk("1",24576);assert.equal((await seek)?.offset,24576);assert.equal(s.rangeStarts[marker],24576);await prepared;assert.equal(s.snapshot["1"].status,"prepared");assert.equal(s.storage.records.get("1")?.playbackOffset,24576);assert.ok(!s.rangeStarts.slice(marker).includes(12288));}finally{s.manager.dispose();}
});
test("a seek into an existing chunk moves read-ahead, resumes prepared playback and preempts stale work",async()=>{
 const data=bytes(),storage=new MemoryStorage(),now=Date.now(),parts=new Map<number,DownloadChunk>();for(const offset of [0,16384]){const blob=new Blob([data.slice(offset,offset+4096)],{type:"audio/mpeg"});parts.set(offset,{offset,blob,sha256:sha(new Uint8Array(await blob.arrayBuffer()))});}storage.parts.set("1",parts);storage.records.set("1",{version:1,recordingId:"1",track:track("1"),status:"prepared",mode:"playback",requested:false,priority:0,chunkBytes:4096,createdAt:now,updatedAt:now,playbackOffset:0,fingerprint:{assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)},mimeType:"audio/mpeg"});
 const aborted:string[]=[],s=setup({data,storage,delay:80,limit:2,onAbort:(url,start)=>aborted.push(url.split("/").pop()+":"+start)});try{await s.manager.hydrate();const resumed=s.manager.resume("1");await until(()=>s.rangeStarts.includes(4096));const marker=s.rangeStarts.length,cached=await s.manager.ensureChunk("1",16384);assert.equal(cached?.offset,16384);await until(()=>s.rangeStarts.length>marker);assert.equal(s.rangeStarts[marker],20480);await resumed;assert.ok(aborted.includes("1:4096"));assert.equal(s.snapshot["1"].status,"prepared");assert.equal(s.snapshot["1"].mode,"playback");assert.equal(storage.records.get("1")?.playbackOffset,16384);assert.ok(s.rangeStarts.includes(24576));assert.ok(!s.rangeStarts.slice(marker).includes(8192));}finally{s.manager.dispose();}
});
test("an urgent current playback waiter preempts automatic background work but not an explicit download",async()=>{
 const started:string[]=[],aborted:string[]=[],s=setup({delay:120,limit:2,onFetch:(url,start)=>started.push(url.split("/").pop()+":"+start),onAbort:(url,start)=>aborted.push(url.split("/").pop()+":"+start)});try{s.manager.setPriorities([],"3");const explicit=s.manager.enqueue(track("1")),background=s.manager.enqueue(track("2"),{mode:"prefix",requested:false});await until(()=>started.includes("1:0")&&started.includes("2:0"));const current=s.manager.enqueue(track("3"),{mode:"playback",requested:false}),urgent=s.manager.ensureChunk("3",0);assert.equal((await urgent)?.offset,0);await Promise.all([explicit,background,current]);assert.ok(aborted.includes("2:0"),aborted.join(","));assert.equal(aborted.some(value=>value.startsWith("1:")),false);assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.snapshot["2"].status,"prepared");assert.equal(s.snapshot["3"].status,"prepared");}finally{s.manager.dispose();}
});
test("hydrate durably parks an interrupted playback transfer as prepared",async()=>{
 const data=bytes(),storage=new MemoryStorage(),now=Date.now(),blob=new Blob([data.slice(16384,20480)],{type:"audio/mpeg"});storage.parts.set("1",new Map([[16384,{offset:16384,blob,sha256:sha(new Uint8Array(await blob.arrayBuffer()))}]]));storage.records.set("1",{version:1,recordingId:"1",track:track("1"),status:"downloading",mode:"playback",requested:false,priority:0,chunkBytes:4096,createdAt:now,updatedAt:now,playbackOffset:16384,fingerprint:{assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)},mimeType:"audio/mpeg"});
 const s=setup({data,storage});try{await s.manager.hydrate();assert.equal(s.requests,0);assert.equal(s.snapshot["1"].status,"prepared");assert.equal(storage.records.get("1")?.status,"prepared");assert.equal(storage.records.get("1")?.playbackOffset,16384);}finally{s.manager.dispose();}
});
test("playback-driven full fetch becomes a durable Saved download across restart",async()=>{
 const s=setup();await s.manager.enqueue(track("1"),{requested:false});assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.snapshot["1"].requested,true);assert.equal(s.storage.audio.get("1")?.requested,true);s.manager.dispose();
 const next=setup({storage:s.storage});try{await next.manager.hydrate();assert.equal(next.snapshot["1"].requested,true);await next.manager.enqueue(track("1"));assert.equal(next.requests,0);assert.equal(next.storage.audio.get("1")?.requested,true);}finally{next.manager.dispose();}
});
test("cancel waits for an in-progress storage write before deletion, so stale chunks cannot resurrect the song",async()=>{
 const storage=new MemoryStorage();let release:()=>void=()=>{},entered=false;const original=storage.putChunk.bind(storage);storage.putChunk=async(id,chunk)=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});await original(id,chunk);};const s=setup({storage});try{const pending=s.manager.enqueue(track("1"));await until(()=>entered);const removed=s.manager.cancel("1");release();await removed;await assert.rejects(pending,{name:"AbortError"});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(storage.parts.size,0);assert.equal(storage.records.size,0);assert.equal(storage.audio.size,0);assert.equal(s.snapshot["1"],undefined);}finally{s.manager.dispose();}
});
test("provider aliases resolving together claim one canonical job before any asynchronous storage work",async()=>{
 const data=bytes(),storage=new MemoryStorage(),base=setup({storage,delay:3});let requests=0,snapshot:Record<string,DownloadEntry>={};const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,onChange:value=>{snapshot=value;},resolve:async()=>({track:track("42"),url:"https://cdn.example/42",assetId:"asset-42",sizeBytes:data.length,sha256:sha(data)}),fetcher:async(_input,init)=>{requests++;const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);await new Promise(resolve=>setTimeout(resolve,3));return new Response(data.slice(start,end+1),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${data.length}`}});}});base.manager.dispose();
 try{await Promise.all([manager.enqueue(track("1")),manager.enqueue(track("2"))]);assert.equal(requests,8);assert.deepEqual(Object.keys(snapshot),["42"]);assert.equal(storage.audio.size,1);}finally{manager.dispose();}
});
test("old playback boosts cannot outrank the new current song after skipping",async()=>{
 const requests:string[]=[];const s=setup({delay:20,limit:1,onFetch:(url,start)=>requests.push(url.split("/").pop()+":"+start)});try{const a=s.manager.enqueue(track("1"),{priority:10000,requested:false}),b=s.manager.enqueue(track("2"),{requested:false});await until(()=>requests.length===1);const urgent=s.manager.ensureChunk("1",4096);s.manager.setPriorities([],"2");const marker=requests.length;await Promise.all([a,b,urgent]);assert.ok(requests.slice(marker,marker+2).some(value=>value.startsWith("2:")),requests.join(","));}finally{s.manager.dispose();}
});
test("a second tab promotes completed automatic audio durably and never hides an explicit download",async()=>{
 const storage=new MemoryStorage(),data=bytes();storage.audio.set("1",{track:track("1"),blob:new Blob([data],{type:"audio/mpeg"}),sizeBytes:data.length,sha256:sha(data),savedAt:Date.now(),requested:false});
 const explicit=setup({storage});try{await explicit.manager.enqueue(track("1"));assert.equal(explicit.requests,0);assert.equal(explicit.snapshot["1"].requested,true);assert.equal(storage.audio.get("1")?.requested,true);}finally{explicit.manager.dispose();}
 const automatic=setup({storage});try{await automatic.manager.enqueue(track("1"),{mode:"prefix",requested:false});assert.equal(automatic.snapshot["1"].requested,true);assert.equal(storage.audio.get("1")?.requested,true);}finally{automatic.manager.dispose();}
});
test("cancel while reading another tab's completed artifact cannot publish a stale ready row",async()=>{
 const storage=new MemoryStorage(),data=bytes();storage.audio.set("1",{track:track("1"),blob:new Blob([data],{type:"audio/mpeg"}),sizeBytes:data.length,sha256:sha(data),savedAt:Date.now()});let release:()=>void=()=>{},entered=false;storage.ready=async(id)=>{const captured=storage.audio.get(id);entered=true;await new Promise<void>(resolve=>{release=resolve;});return captured;};const s=setup({storage});try{const pending=s.manager.enqueue(track("1"));await until(()=>entered);await s.manager.cancel("1");release();await assert.rejects(pending,{name:"AbortError"});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(s.snapshot["1"],undefined);assert.equal(storage.audio.size,0);assert.equal(storage.records.size,0);}finally{s.manager.dispose();}
});
test("many automatic prefixes are bounded and old ones expire while current, next three and explicit paused jobs survive",async()=>{
 const s=setup();try{s.manager.setPriorities(["2","3","4"],"1");const requested=s.manager.enqueue(track("999"));await s.manager.pause("999");await requested;for(let index=1;index<=18;index++)await s.manager.enqueue(track(String(index)),{mode:"prefix",requested:false});await until(()=>s.storage.records.size<=13);assert.equal([...s.storage.records.values()].filter(row=>!row.requested).length,12);for(const recordingId of ["1","2","3","4","999"])assert.ok(s.storage.records.has(recordingId));assert.equal(s.storage.records.get("999")?.status,"paused");assert.equal(s.storage.records.get("999")?.requested,true);for(const row of s.storage.records.values())row.updatedAt=Date.now()-8*24*60*60*1000;s.manager.dispose();
  const restored=setup({storage:s.storage});try{restored.manager.setPriorities(["2","3","4"],"1");await restored.manager.hydrate();await until(()=>restored.storage.records.size===5);for(const recordingId of ["1","2","3","4","999"])assert.ok(restored.storage.records.has(recordingId));assert.equal(restored.storage.audio.size,0);}finally{restored.manager.dispose();}
 }finally{s.manager.dispose();}
});
test("queue prefetch preserves a user's paused request and canceled transfers never retry using a replacement controller",async()=>{
 const s=setup({delay:100});try{const pending=s.manager.enqueue(track("1"));await until(()=>s.requests===1);await s.manager.pause("1");await pending;await s.manager.enqueue(track("1"),{mode:"prefix",requested:false});s.manager.setPriorities(["1"]);await new Promise(resolve=>setTimeout(resolve,600));assert.equal(s.requests,1);assert.equal(s.snapshot["1"].status,"paused");assert.equal(s.storage.records.get("1")?.status,"paused");}finally{s.manager.dispose();}
});
test("a higher queued song starts first while its lease reads are briefly slower than lower songs",async()=>{
 const seen:string[]=[];const s=setup({delay:3,onFetch:url=>seen.push(url.split("/").pop()!)});try{await s.manager.enqueue(track("1"),{mode:"prefix",requested:false});await s.manager.enqueue(track("2"),{mode:"prefix",requested:false});const read=s.storage.ready.bind(s.storage);s.storage.ready=async id=>{if(id==="2")await new Promise(resolve=>setTimeout(resolve,80));return read(id);};s.manager.setPriorities(["2","1"]);const marker=seen.length;await Promise.all([s.manager.enqueue(track("1")),s.manager.enqueue(track("2"))]);assert.equal(seen[marker],"2");}finally{s.manager.dispose();}
});
test("automatic eviction checks stored requested flags atomically when another tab promotes a prefix",async()=>{
 const storage=new MemoryStorage(),s=setup({storage});let protect:string|undefined;const clear=storage.clearAutomatic.bind(storage);storage.clearAutomatic=async id=>{if(!protect){protect=id;const row=storage.records.get(id)!;storage.records.set(id,{...row,requested:true,mode:"full"});}return clear(id);};try{for(let index=1;index<=14;index++)await s.manager.enqueue(track(String(index)),{mode:"prefix",requested:false});await until(()=>!!protect&&storage.records.size<=13);assert.ok(storage.records.has(protect!));assert.equal(storage.records.get(protect!)?.requested,true);assert.ok((await storage.chunks(protect!)).length>0);}finally{s.manager.dispose();}
});
test("pausing an automatic playing song retains its prepared prefix and finishes only after playing again",async()=>{
 const s=setup({delay:50});try{const playing=s.manager.enqueue(track("1"),{requested:false});await until(()=>!!s.storage.parts.get("1")?.size);await s.manager.prepare("1");await playing;const count=s.requests;await new Promise(resolve=>setTimeout(resolve,350));assert.equal(s.requests,count);assert.equal(s.snapshot["1"].status,"prepared");assert.equal(s.storage.audio.size,0);assert.ok(s.snapshot["1"].downloadedBytes>=4096);assert.equal(s.storage.records.get("1")?.mode,"prefix");const retained=[...s.storage.parts.get("1")!.keys()];const marker=s.rangeStarts.length;await s.manager.enqueue(track("1"),{mode:"full",requested:false});assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.snapshot["1"].requested,true);assert.equal(s.storage.audio.get("1")?.requested,true);for(const offset of retained)assert.ok(!s.rangeStarts.slice(marker).includes(offset));}finally{s.manager.dispose();}
});
test("background prefix requests demote noncurrent automatic full work while explicit downloads keep finishing",async()=>{
 const s=setup({delay:35});try{s.manager.setPriorities([],"2");const auto=s.manager.enqueue(track("1"),{requested:false}),explicit=s.manager.enqueue(track("2"));await until(()=>!!s.storage.parts.get("1")?.size);await s.manager.enqueue(track("1"),{mode:"prefix",requested:false});await auto;await explicit;assert.equal(s.snapshot["1"].status,"prepared");assert.equal(s.storage.records.get("1")?.mode,"prefix");assert.equal(s.snapshot["2"].status,"ready");assert.equal(s.storage.audio.has("1"),false);}finally{s.manager.dispose();}
});
test("explicit save joining automatic finalization waits for durable requested promotion and survives reopening",async()=>{
 const storage=new MemoryStorage(),s=setup({storage}),finalize=storage.finalize.bind(storage);let release:()=>void=()=>{},entered=false;storage.finalize=async(id,audio)=>{if(!entered){entered=true;await new Promise<void>(resolve=>{release=resolve;});}await finalize(id,audio);};try{const automatic=s.manager.enqueue(track("1"),{requested:false});await until(()=>entered);let saved=false;const explicit=s.manager.enqueue(track("1")).then(()=>{saved=true;});await Promise.resolve();assert.equal(saved,false);assert.equal(s.snapshot["1"].requested,true);assert.equal(s.snapshot["1"].status,"downloading");release();await Promise.all([automatic,explicit]);assert.equal(s.requests,8);assert.equal(storage.audio.get("1")?.requested,true);assert.equal(storage.records.size,0);assert.equal(storage.parts.size,0);assert.equal(s.snapshot["1"].status,"ready");s.manager.dispose();const restored=setup({storage});try{await restored.manager.hydrate();assert.equal(restored.snapshot["1"].status,"ready");assert.equal(restored.snapshot["1"].requested,true);}finally{restored.manager.dispose();}}finally{release();s.manager.dispose();}
});
test("completed-cache promotion remains visible in activity until commit and failed storage never claims Saved",async()=>{
 const storage=new MemoryStorage(),data=bytes();storage.audio.set("1",{track:track("1"),blob:new Blob([data],{type:"audio/mpeg"}),sizeBytes:data.length,sha256:sha(data),savedAt:Date.now(),requested:false});const s=setup({storage});await s.manager.hydrate();const promote=storage.promoteRequested.bind(storage);let fail=true;storage.promoteRequested=async id=>{await new Promise(resolve=>setTimeout(resolve,10));if(fail)throw new DOMException("Device storage is full","QuotaExceededError");return promote(id);};try{const first=s.manager.enqueue(track("1"));assert.equal(s.snapshot["1"].requested,true);assert.equal(s.snapshot["1"].status,"queued");await assert.rejects(first,{name:"QuotaExceededError"});assert.equal(s.snapshot["1"].status,"failed");assert.equal(s.snapshot["1"].requested,true);assert.equal(storage.audio.get("1")?.requested,false);fail=false;await s.manager.enqueue(track("1"));assert.equal(s.snapshot["1"].status,"ready");assert.equal(storage.audio.get("1")?.requested,true);assert.equal(s.requests,0);}finally{s.manager.dispose();}
});
test("reopen repairs a requested manifest left beside an automatic completed artifact without fetching audio",async()=>{
 const storage=new MemoryStorage(),data=bytes();storage.audio.set("1",{track:track("1"),blob:new Blob([data],{type:"audio/mpeg"}),sizeBytes:data.length,sha256:sha(data),savedAt:Date.now(),requested:false});storage.records.set("1",{version:1,recordingId:"1",track:track("1"),status:"downloading",mode:"full",requested:true,priority:0,chunkBytes:4096,createdAt:Date.now(),updatedAt:Date.now()});const s=setup({storage});try{await s.manager.hydrate();assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.snapshot["1"].requested,true);assert.equal(storage.audio.get("1")?.requested,true);assert.equal(storage.records.size,0);assert.equal(s.requests,0);}finally{s.manager.dispose();}
});
test("reopen retains interrupted playback chunks without completing an automatic full download",async()=>{
 const storage=new MemoryStorage(),first=setup({storage,delay:30});const playing=first.manager.enqueue(track("1"),{requested:false}).catch(()=>{});await until(()=>!!storage.parts.get("1")?.size);first.manager.dispose();await playing;assert.equal(storage.records.get("1")?.mode,"full");const retained=[...storage.parts.get("1")!.keys()],restored=setup({storage});try{restored.manager.setPriorities([],"1");await restored.manager.hydrate();await until(()=>restored.snapshot["1"]?.status==="prepared");await new Promise(resolve=>setTimeout(resolve,60));assert.equal(restored.requests,0);assert.equal(storage.audio.size,0);assert.equal(storage.records.get("1")?.mode,"prefix");assert.equal(restored.snapshot["1"].requested,false);await restored.manager.enqueue(track("1"),{requested:false});assert.equal(restored.snapshot["1"].status,"ready");for(const offset of retained)assert.ok(!restored.rangeStarts.includes(offset));}finally{restored.manager.dispose();}
});
test("reopen prepares only the missing prefix while explicit full downloads still finish",async()=>{
 const storage=new MemoryStorage(),now=Date.now();for(const recordingId of ["1","2"])storage.records.set(recordingId,{version:1,recordingId,track:track(recordingId),status:"downloading",mode:"full",requested:recordingId==="2",priority:0,chunkBytes:4096,createdAt:now,updatedAt:now});const fetched:string[]=[],s=setup({storage,onFetch:(url,start)=>fetched.push(url.split("/").pop()+":"+start)});try{await s.manager.hydrate();await until(()=>s.snapshot["1"]?.status==="prepared"&&s.snapshot["2"]?.status==="ready");assert.deepEqual(fetched.filter(row=>row.startsWith("1:")),["1:0"]);assert.equal(storage.records.get("1")?.mode,"prefix");assert.equal(storage.audio.has("1"),false);assert.equal(storage.audio.get("2")?.requested,true);assert.equal(fetched.filter(row=>row.startsWith("2:")).length,8);}finally{s.manager.dispose();}
});
test("fallback IndexedDB leases deduplicate tabs when Web Locks are unavailable",async()=>withoutWebLocks(async()=>{
 const storage=new MemoryStorage(),a=setup({storage,delay:10}),b=setup({storage,delay:10});try{await Promise.all([a.manager.enqueue(track("1")),b.manager.enqueue(track("1"))]);assert.equal(a.requests+b.requests,8);assert.equal(a.snapshot["1"].status,"ready");assert.equal(b.snapshot["1"].status,"ready");}finally{a.manager.dispose();b.manager.dispose();}
}));
test("late fallback lease rejection cannot fail a paused and resumed download",async()=>withoutWebLocks(async()=>{
 const storage=new MemoryStorage(),lease=storage.lease.bind(storage);let first=true,entered=false,rejectStale:(error:unknown)=>void=()=>{};storage.lease=async(id,owner,expiresAt)=>{if(first){first=false;entered=true;return new Promise<boolean>((_resolve,reject)=>{rejectStale=reject;});}return lease(id,owner,expiresAt);};const s=setup({storage,delay:15});try{const initial=s.manager.enqueue(track("1"));await until(()=>entered);await s.manager.pause("1");await initial;const resumed=s.manager.resume("1");await until(()=>s.requests>0);rejectStale(new Error("An old lease transaction failed"));await resumed;assert.equal(s.snapshot["1"].status,"ready");assert.equal(storage.audio.size,1);}finally{s.manager.dispose();}
}));
test("late fallback artifact read releases only its own lease after pause and resume",async()=>withoutWebLocks(async()=>{
 const storage=new MemoryStorage(),read=storage.ready.bind(storage);let reads=0,releaseOld:()=>void=()=>{},releaseCurrent:()=>void=()=>{};storage.ready=async id=>{reads++;if(reads===1)await new Promise<void>(resolve=>{releaseOld=resolve;});else if(reads===2)await new Promise<void>(resolve=>{releaseCurrent=resolve;});return read(id);};const s=setup({storage,delay:5});try{const initial=s.manager.enqueue(track("1"));await until(()=>reads===1);await s.manager.pause("1");await initial;const resumed=s.manager.resume("1");await until(()=>reads===2);const currentOwner=storage.leases.get("1")?.owner;assert.ok(currentOwner);releaseOld();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(storage.leases.get("1")?.owner,currentOwner);releaseCurrent();await resumed;assert.equal(s.requests,8);assert.equal(s.snapshot["1"].status,"ready");}finally{releaseOld();releaseCurrent();s.manager.dispose();}
}));
test("an old manifest write rejection cannot fail a paused and resumed download",async()=>{
 const storage=new MemoryStorage(),save=storage.save.bind(storage);let entered=false,rejectOld:(error:unknown)=>void=()=>{};storage.save=async record=>{if(!entered){entered=true;await new Promise<void>((_resolve,reject)=>{rejectOld=reject;});}await save(record);};const s=setup({storage});try{const first=s.manager.enqueue(track("1"));await until(()=>entered);const paused=s.manager.pause("1"),resumed=s.manager.resume("1");rejectOld(new DOMException("The old transaction failed","QuotaExceededError"));await Promise.all([first,paused,resumed]);assert.equal(s.snapshot["1"].status,"ready");assert.equal(storage.audio.size,1);}finally{s.manager.dispose();}
});
test("retry discards the old format after an inconsistent source is rejected",async()=>{
 const storage=new MemoryStorage(),data=bytes();let retry=false,requests=0,snapshot:Record<string,DownloadEntry>={};const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,onChange:rows=>{snapshot=rows;},resolve:async value=>({track:value,url:"https://cdn.example/"+value.id,assetId:"asset-"+value.id,sizeBytes:data.length,sha256:sha(data)}),fetcher:async(_input,init)=>{requests++;const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]),payload=data.slice(start,end+1);return new Response(payload,{status:206,headers:{"Content-Type":!retry&&start===0?"audio/mpeg":"audio/ogg","Content-Length":String(payload.length),"Content-Range":`bytes ${start}-${end}/${data.length}`}});}});try{await assert.rejects(manager.enqueue(track("1")),/changed audio format/);retry=true;await manager.resume("1");assert.equal(snapshot["1"].status,"ready");assert.equal(storage.audio.get("1")?.blob.type,"audio/ogg");assert.ok(requests>=9);}finally{manager.dispose();}
});
test("removing a completed song fences a new download until deletion commits",async()=>{
 const s=setup();await s.manager.enqueue(track("1"));const clear=s.storage.clear.bind(s.storage);let entered=false,release:()=>void=()=>{};s.storage.clear=async(id,includeReady)=>{if(includeReady&&!entered){entered=true;await new Promise<void>(resolve=>{release=resolve;});}await clear(id,includeReady);};try{const removed=s.manager.remove("1");await until(()=>entered);const replacement=s.manager.enqueue(track("1"));await new Promise(resolve=>setTimeout(resolve,40));assert.equal(s.requests,8);release();await Promise.all([removed,replacement]);assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.storage.audio.size,1);assert.equal(s.requests,16);}finally{release();s.manager.dispose();}
});
test("prefix preparation cancels a source that ignores ranges instead of consuming a full file",async()=>{
 const data=bytes();let canceled=false,snapshot:Record<string,DownloadEntry>={},progressBytes=0;const manager=new DurableDownloadManager({accountId:"account-a",storage:new MemoryStorage(),chunkBytes:4096,idleTimeoutMs:10,onChange:rows=>{snapshot=rows;progressBytes=Math.max(progressBytes,rows["1"]?.downloadedBytes||0);},resolve:async value=>({track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(data);},cancel(){canceled=true;}}),{headers:{"Content-Type":"audio/mpeg","Content-Length":String(data.length)}})});try{await assert.rejects(manager.enqueue(track("1"),{mode:"prefix",requested:false}),/cannot prepare/);assert.equal(snapshot["1"].status,"failed");await until(()=>canceled);assert.equal(progressBytes,0);}finally{manager.dispose();}
});
test("completed playback chunks reject invalid offsets without returning unrelated bytes",async()=>{
 const s=setup();try{await s.manager.enqueue(track("1"));for(const offset of [-4096,0.5,NaN,Infinity,1])await assert.rejects(s.manager.ensureChunk("1",offset),/does not belong/);const chunk=await s.manager.ensureChunk("1",4096);assert.equal(chunk?.offset,4096);assert.equal(chunk?.blob.size,4096);}finally{s.manager.dispose();}
});
test("upgrading a prefix during its final save obtains a fresh fallback lease",async()=>withoutWebLocks(async()=>{
 const storage=new MemoryStorage(),save=storage.save.bind(storage),lease=storage.lease.bind(storage);let entered=false,release:()=>void=()=>{};const owners=new Set<string>();storage.lease=async(id,owner,expiresAt)=>{owners.add(owner);return lease(id,owner,expiresAt);};storage.save=async record=>{if(record.status==="prepared"&&!entered){entered=true;await new Promise<void>(resolve=>{release=resolve;});}await save(record);};const s=setup({storage});try{const prefix=s.manager.enqueue(track("1"),{mode:"prefix",requested:false});await until(()=>entered);const full=s.manager.enqueue(track("1"));release();await Promise.all([prefix,full]);assert.equal(s.snapshot["1"].status,"ready");assert.equal(owners.size,2);assert.equal(s.requests,8);}finally{release();s.manager.dispose();}
}));
test("canceling a range read before consumption closes its response body",async()=>{
 let canceled=false;const response=new Response(new ReadableStream<Uint8Array>({cancel(){canceled=true;}}),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":"bytes 0-3/4","Content-Length":"4"}}),controller=new AbortController();controller.abort();await assert.rejects(readAudioRange(response,0,3,4,controller.signal),{name:"AbortError"});await until(()=>canceled,50);
});
test("a quota failure at final publication keeps exact chunks for a retry without refetch",async()=>{
 const storage=new MemoryStorage(),finalize=storage.finalize.bind(storage);let blocked=true;storage.finalize=async(id,audio)=>{if(blocked)throw new DOMException("Device storage is full","QuotaExceededError");await finalize(id,audio);};const s=setup({storage});try{await assert.rejects(s.manager.enqueue(track("1")),{name:"QuotaExceededError"});assert.equal(s.snapshot["1"].status,"failed");assert.equal(storage.audio.size,0);assert.equal((await storage.chunks("1")).length,8);blocked=false;await s.manager.resume("1");assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.requests,8);assert.equal(storage.audio.get("1")?.sha256,sha(s.data));}finally{s.manager.dispose();}
});
test("corrupt persisted prefix chunks are replaced before playback and full publication",async()=>{
 const first=setup();await first.manager.enqueue(track("1"),{mode:"prefix",requested:false});first.manager.dispose();const original=first.storage.parts.get("1")!.get(0)!,changed=new Uint8Array(await original.blob.arrayBuffer());changed[0]^=255;first.storage.parts.get("1")!.set(0,{...original,blob:new Blob([changed],{type:original.blob.type})});const restored=setup({storage:first.storage});try{await restored.manager.hydrate();assert.equal(await restored.manager.getPartial("1"),undefined);const chunk=await restored.manager.ensureChunk("1",0);assert.equal(chunk?.sha256,sha(restored.data.slice(0,4096)));await restored.manager.enqueue(track("1"));assert.equal(restored.requests,8);assert.equal(restored.snapshot["1"].status,"ready");assert.equal(restored.storage.audio.get("1")?.sha256,sha(restored.data));}finally{restored.manager.dispose();}
});
test("failed persistence after fallback lease loss reports a failed job without an unhandled rejection",async()=>withoutWebLocks(async()=>{
 const interval=globalThis.setInterval;globalThis.setInterval=((callback:()=>void)=>interval(callback,10)) as typeof setInterval;const storage=new MemoryStorage(),save=storage.save.bind(storage),lease=storage.lease.bind(storage);let calls=0;storage.lease=async(id,owner,expiresAt)=>++calls===1?lease(id,owner,expiresAt):false;storage.save=async record=>{if(record.status==="paused")throw new DOMException("Cannot persist the pause","QuotaExceededError");await save(record);};const s=setup({storage,delay:50});try{const pending=s.manager.enqueue(track("1")).catch(()=>{});await until(()=>s.snapshot["1"]?.status==="failed");await pending;assert.match(s.snapshot["1"].error||"",/Cannot persist/);assert.equal(storage.audio.size,0);}finally{s.manager.dispose();globalThis.setInterval=interval;}
}));
test("one failed partial-storage read does not block other restored downloads or its own retry",async()=>{
 const storage=new MemoryStorage(),now=Date.now();for(const recordingId of ["1","2"])storage.records.set(recordingId,{version:1,recordingId,track:track(recordingId),status:"downloading",mode:"full",requested:true,priority:0,chunkBytes:4096,createdAt:now,updatedAt:now});const chunks=storage.chunks.bind(storage);let blocked=true;storage.chunks=async id=>{if(id==="1"&&blocked){blocked=false;throw new Error("A partial file could not be read");}return chunks(id);};const s=setup({storage});try{await s.manager.hydrate();await until(()=>s.snapshot["2"]?.status==="ready");assert.equal(s.snapshot["1"]?.status,"failed");assert.match(s.snapshot["1"].error||"",/partial file/);await s.manager.resume("1");assert.equal(s.snapshot["1"].status,"ready");assert.equal(storage.audio.size,2);}finally{s.manager.dispose();}
});
test("demoting failed automatic playback does not restart source discovery before an explicit replay",async()=>{
 const data=bytes();let blocked=true,resolves=0;const s=setup({data,resolve:async value=>{resolves++;if(blocked)throw new Error("This recording is unavailable");return {track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};}});try{await assert.rejects(s.manager.enqueue(track("1"),{requested:false}),/unavailable/);await s.manager.prepare("1");await new Promise(resolve=>setTimeout(resolve,40));assert.equal(resolves,1);assert.equal(s.requests,0);assert.equal(s.snapshot["1"].status,"failed");assert.equal(s.storage.records.get("1")?.mode,"prefix");blocked=false;await s.manager.enqueue(track("1"),{requested:false});assert.equal(s.snapshot["1"].status,"ready");assert.equal(resolves,2);}finally{s.manager.dispose();}
});
test("offline events stop in-flight retries and reconnect resumes only unfinished active downloads",async()=>{
 const windowDescriptor=Object.getOwnPropertyDescriptor(globalThis,"window"),navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator"),events=new EventTarget(),connection={onLine:true};Object.defineProperty(globalThis,"window",{value:events,configurable:true});Object.defineProperty(globalThis,"navigator",{value:connection,configurable:true});const requests:{id:string;offset:number;online:boolean}[]=[],s=setup({delay:40,mutate:(_start,data)=>{if(!connection.onLine)throw new TypeError("Network offline");return data;},onFetch:(url,offset)=>requests.push({id:url.split("/").pop()!,offset,online:connection.onLine})});try{const active=s.manager.enqueue(track("1")),paused=s.manager.enqueue(track("2"));await until(()=>!!s.storage.parts.get("1")?.size);await s.manager.pause("2");await paused;const retained=[...s.storage.parts.get("1")!.keys()];connection.onLine=false;events.dispatchEvent(new Event("offline"));const marker=requests.length;await new Promise(resolve=>setTimeout(resolve,350));assert.equal(requests.length,marker);assert.equal(s.snapshot["1"].status,"queued");assert.equal(s.snapshot["2"].status,"paused");assert.equal(s.snapshot["1"].downloadedBytes,[...s.storage.parts.get("1")!.values()].reduce((sum,chunk)=>sum+chunk.blob.size,0));connection.onLine=true;events.dispatchEvent(new Event("online"));await active;assert.equal(s.snapshot["1"].status,"ready");assert.equal(s.snapshot["2"].status,"paused");assert.ok(requests.every(request=>request.online));for(const offset of retained)assert.ok(!requests.slice(marker).some(request=>request.id==="1"&&request.offset===offset));}finally{s.manager.dispose();if(windowDescriptor)Object.defineProperty(globalThis,"window",windowDescriptor);else Reflect.deleteProperty(globalThis,"window");if(navigatorDescriptor)Object.defineProperty(globalThis,"navigator",navigatorDescriptor);else Reflect.deleteProperty(globalThis,"navigator");}
});
test("a held whole-file response releases its trapped opening chunk while the download continues",async()=>{
 const data=bytes(),storage=new MemoryStorage();let snapshot:Record<string,DownloadEntry>={},requests=0,released=false,release:()=>void=()=>{};const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,onChange:value=>{snapshot=value;},resolve:async value=>({track:value,url:"https://cdn.example/whole",assetId:"asset-whole",sizeBytes:data.length,sha256:sha(data)}),fetcher:async()=>{requests++;return new Response(new ReadableStream<Uint8Array>({start(controller){const split=Math.ceil(data.length*.85);controller.enqueue(data.slice(0,split));release=()=>{if(released)return;released=true;controller.enqueue(data.slice(split));controller.close();};}}),{headers:{"Content-Type":"audio/mpeg","Content-Length":String(data.length)}});}});try{const pending=manager.enqueue(track("1"));await until(()=>(snapshot["1"]?.downloadedBytes||0)>data.length*.8);assert.equal(storage.audio.size,0);const opening=await Promise.race([manager.ensureChunk("1",0),new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error("opening chunk stayed trapped")),100))]);assert.equal(opening,undefined);assert.equal(snapshot["1"].status,"downloading");assert.equal(requests,1);release();await pending;assert.equal(snapshot["1"].status,"ready");assert.equal(requests,1);}finally{release();manager.dispose();}
});
test("restored chunks do not prove range support and cannot start duplicate whole-file responses",async()=>{
 const first=setup();await first.manager.enqueue(track("1"),{mode:"prefix",requested:false});first.manager.dispose();const starts:number[]=[];let snapshot:Record<string,DownloadEntry>={};const manager=new DurableDownloadManager({accountId:"account-a",storage:first.storage,chunkBytes:4096,maxConcurrentChunks:4,maxChunksPerSong:2,onChange:value=>{snapshot=value;},resolve:async value=>({track:value,url:"https://cdn.example/whole",assetId:"asset-1",sizeBytes:first.data.length,sha256:sha(first.data)}),fetcher:async(_input,init)=>{const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!;starts.push(Number(range[1]));return new Response(new Uint8Array(first.data),{headers:{"Content-Type":"audio/mpeg","Content-Length":String(first.data.length)}});}});try{await manager.hydrate();await manager.enqueue(track("1"));assert.equal(snapshot["1"].status,"ready");assert.deepEqual(starts,[4096,0]);assert.equal(starts.filter(offset=>offset===0).length,1);}finally{manager.dispose();}
});
test("a structurally invalid primary endpoint falls back to a valid alternate",async()=>{
 const data=bytes(4096),storage=new MemoryStorage(),urls:string[]=[];let snapshot:Record<string,DownloadEntry>={};const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,onChange:value=>{snapshot=value;},resolve:async value=>({track:value,url:"https://primary.example/audio",fallbackUrl:"https://alternate.example/audio",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async(input,init)=>{const url=String(input);urls.push(url);if(url.includes("primary"))return new Response("<html>",{headers:{"Content-Type":"text/html"}});const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]),payload=data.slice(start,end+1);return new Response(payload,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(payload.length),"Content-Range":`bytes ${start}-${end}/${data.length}`}});}});try{await manager.enqueue(track("1"));assert.equal(snapshot["1"].status,"ready");assert.deepEqual(urls,["https://primary.example/audio","https://alternate.example/audio"]);}finally{manager.dispose();}
});
test("offline missing chunks reject immediately instead of occupying the service-worker deadline",async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator");Object.defineProperty(globalThis,"navigator",{value:{onLine:false},configurable:true});const s=setup();try{void s.manager.enqueue(track("1")).catch(()=>{});await assert.rejects(Promise.race([s.manager.ensureChunk("1",0),new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error("offline chunk request waited")),100))]),/offline/);assert.equal(s.requests,0);}finally{s.manager.dispose();if(descriptor)Object.defineProperty(globalThis,"navigator",descriptor);else Reflect.deleteProperty(globalThis,"navigator");}
});
test("pausing during final publication reconciles the committed audio instead of leaving a phantom pause",async()=>{
 const storage=new MemoryStorage(),finalize=storage.finalize.bind(storage);let entered=false,release:()=>void=()=>{};storage.finalize=async(id,audio)=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});await finalize(id,audio);};const s=setup({storage});try{const pending=s.manager.enqueue(track("1"));await until(()=>entered);const paused=s.manager.pause("1");release();await Promise.all([pending,paused]);assert.equal(s.snapshot["1"].status,"ready");assert.equal(storage.audio.get("1")?.requested,true);assert.equal(storage.records.has("1"),false);s.manager.dispose();const restored=setup({storage});try{await restored.manager.hydrate();assert.equal(restored.snapshot["1"].status,"ready");assert.equal(restored.requests,0);}finally{restored.manager.dispose();}}finally{release();s.manager.dispose();}
});
test("fallback destructive cancellation waits for another tab's writer and cannot be resurrected",async()=>withoutWebLocks(async()=>{
 const storage=new MemoryStorage(),put=storage.putChunk.bind(storage);let entered=false,releaseWrite:()=>void=()=>{};storage.putChunk=async(id,chunk)=>{if(!entered){entered=true;await new Promise<void>(resolve=>{releaseWrite=resolve;});}await put(id,chunk);};const writer=setup({storage}),remover=setup({storage});try{const writing=writer.manager.enqueue(track("1"));await until(()=>entered);const waiting=remover.manager.enqueue(track("1"));void waiting.catch(()=>{});let cleared=false;const canceling=remover.manager.cancel("1").then(()=>{cleared=true;});await new Promise(resolve=>setTimeout(resolve,80));assert.equal(cleared,false);assert.equal(storage.audio.size,0);releaseWrite();await writing;await canceling;await assert.rejects(waiting,{name:"AbortError"});await new Promise(resolve=>setTimeout(resolve,60));assert.equal(storage.records.size,0);assert.equal(storage.parts.size,0);assert.equal(storage.audio.size,0);assert.equal(storage.leases.size,0);}finally{releaseWrite();writer.manager.dispose();remover.manager.dispose();}
}));

test("eight consecutive interrupted ranges recover automatically while playback keeps waiting and verified prefix stays saved",async()=>{
 const data=bytes(12288),storage=new MemoryStorage(),starts:number[]=[],refreshes:boolean[]=[],states:string[]=[],errors:unknown[]=[];let drops=0,snapshot:Record<string,DownloadEntry>={};
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,recoveryDelayMs:1,onChange:rows=>{snapshot=rows;if(rows["1"])states.push(rows["1"].status);},onError:error=>errors.push(error),resolve:async(value,_signal,options)=>{refreshes.push(options?.refresh===true);return {track:value,url:"https://cdn.example/audio",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};},fetcher:async(_input,init)=>{
  const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);starts.push(start);const payload=data.slice(start,end+1),fail=start>0&&drops++<8;
  return new Response(fail?new ReadableStream<Uint8Array>({start(controller){controller.enqueue(payload.slice(0,100));controller.close();}}):payload,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(payload.length),"Content-Range":`bytes ${start}-${end}/${data.length}`}});
 }});
 try{const pending=manager.enqueue(track("1"));await until(()=>storage.parts.get("1")?.has(0)===true);const shared=manager.ensureChunk("1",4096);assert.equal((await shared)?.offset,4096);await pending;assert.equal(snapshot["1"].status,"ready");assert.equal(starts.filter(start=>start===0).length,1);assert.deepEqual(refreshes,[false,true,true]);assert.equal(states.includes("failed"),false);assert.equal(errors.length,0);assert.equal(storage.audio.get("1")?.sha256,sha(data));}finally{manager.dispose();}
});

for(const changed of [false,true])test(`expired source refreshes automatically and ${changed?"replaces changed bytes":"retains verified chunks"}`,async()=>{
 const original=bytes(12288),replacement=changed?original.map(value=>value^64):original,storage=new MemoryStorage(),requests:Array<{url:string;start:number}>=[],refreshes:boolean[]=[];
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,recoveryDelayMs:1,onChange:()=>{},resolve:async(value,_signal,options)=>{const refresh=options?.refresh===true;refreshes.push(refresh);return {track:value,url:refresh?"https://cdn.example/fresh":"https://cdn.example/stale",assetId:refresh?"asset-new":"asset-old",sizeBytes:original.length,sha256:sha(refresh?replacement:original)};},fetcher:async(input,init)=>{
  const url=String(input),range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);requests.push({url,start});if(url.endsWith("stale")&&start>0)return Response.json({reason:"audio-source-unavailable"},{status:502});const payload=(url.endsWith("fresh")?replacement:original).slice(start,end+1);return new Response(payload,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${original.length}`}});
 }});
 try{await manager.enqueue(track("1"));assert.deepEqual(refreshes,[false,true]);assert.deepEqual(requests.filter(request=>request.url.endsWith("fresh")).map(request=>request.start),changed?[0,4096,8192]:[4096,8192]);assert.equal(storage.audio.get("1")?.sha256,sha(replacement));}finally{manager.dispose();}
});

test("a transient source lookup retries automatically but missing recordings and expired sessions stop promptly",async()=>{
 const data=bytes(4096);let calls=0;const recovery=setup({data,resolve:async value=>{if(++calls===1)throw new UserFacingError({...userIssue(new Error("connection"),"download"),kind:"connection"});return {track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};}});
 try{await recovery.manager.enqueue(track("1"));assert.equal(calls,2);assert.equal(recovery.snapshot["1"].status,"ready");}finally{recovery.manager.dispose();}
 for(const kind of ["missing","session"] as const){let lookups=0;const unavailable=setup({resolve:async()=>{lookups++;throw new UserFacingError({...userIssue(new Error("connection"),"download"),kind});}});try{await assert.rejects(unavailable.manager.enqueue(track("1")),(error:unknown)=>error instanceof UserFacingError&&error.issue.kind===kind);assert.equal(lookups,1);}finally{unavailable.manager.dispose();}}
});

test("recovery exhaustion reports one error, retains committed chunks and still permits an explicit retry",async()=>{
 const data=bytes(8192),storage=new MemoryStorage(),errors:unknown[]=[],starts:number[]=[],refreshes:boolean[]=[];let blocked=true,snapshot:Record<string,DownloadEntry>={};
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,maxRecoveryAttempts:1,recoveryDelayMs:1,onChange:rows=>{snapshot=rows;},onError:error=>errors.push(error),resolve:async(value,_signal,options)=>{refreshes.push(options?.refresh===true);return {track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};},fetcher:async(_input,init)=>{const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);starts.push(start);if(start>0&&blocked)throw new TypeError("Network connection interrupted");return new Response(data.slice(start,end+1),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${data.length}`}});}});
 try{const pending=manager.enqueue(track("1"));await until(()=>storage.parts.get("1")?.has(0)===true);const waiter=manager.ensureChunk("1",4096);await assert.rejects(pending,/Network connection/);await assert.rejects(waiter,/Network connection/);assert.equal(snapshot["1"].status,"failed");assert.equal(errors.length,1);assert.equal(starts.filter(start=>start===4096).length,6);assert.deepEqual([...storage.parts.get("1")!.keys()],[0]);blocked=false;await manager.resume("1");assert.equal(snapshot["1"].status,"ready");assert.equal(starts.filter(start=>start===0).length,1);assert.deepEqual(refreshes,[false,true,true]);}finally{manager.dispose();}
});

for(const action of ["pause","cancel","dispose"] as const)test(`${action} during recovery backoff prevents any later automatic restart`,async()=>{
 const data=bytes(4096),storage=new MemoryStorage();let requests=0;
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,recoveryDelayMs:150,onChange:()=>{},resolve:async value=>({track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async()=>{requests++;throw new TypeError("Network connection interrupted");}});
 try{const pending=manager.enqueue(track("1"));void pending.catch(()=>{});await until(()=>storage.records.get("1")?.refreshSource===true);assert.equal(requests,3);if(action==="dispose")manager.dispose();else await manager[action]("1");if(action==="pause")await pending;else await assert.rejects(pending,{name:"AbortError"});await new Promise(resolve=>setTimeout(resolve,200));assert.equal(requests,3);if(action==="pause")assert.equal(storage.records.get("1")?.status,"paused");if(action==="cancel")assert.equal(storage.records.has("1"),false);}finally{manager.dispose();}
});

test("closing during recovery backoff leaves queued verified bytes that reopen and finish automatically",async()=>{
 const data=bytes(8192),storage=new MemoryStorage(),starts:number[]=[],refreshes:boolean[]=[];let blocked=true;
 const make=()=>new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,recoveryDelayMs:150,onChange:()=>{},resolve:async(value,_signal,options)=>{refreshes.push(options?.refresh===true);return {track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};},fetcher:async(_input,init)=>{const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]);starts.push(start);if(start>0&&blocked)throw new TypeError("Network connection interrupted");return new Response(data.slice(start,end+1),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${data.length}`}});}});
 let manager=make();try{const pending=manager.enqueue(track("1"));await until(()=>storage.records.get("1")?.refreshSource===true);manager.dispose();await assert.rejects(pending,{name:"AbortError"});assert.equal(storage.records.get("1")?.status,"queued");blocked=false;manager=make();await manager.hydrate();await until(()=>storage.audio.has("1"));assert.deepEqual(refreshes,[false,true]);assert.equal(starts.filter(start=>start===0).length,1);assert.equal(storage.audio.get("1")?.sha256,sha(data));}finally{manager.dispose();}
});

test("successful chunks renew the recovery budget across repeated separate interruptions in a long download",async()=>{
 const data=bytes(5*4096),storage=new MemoryStorage(),attempts=new Map<number,number>();let refreshes=0;
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,maxChunksPerSong:1,recoveryDelayMs:1,maxRecoveryAttempts:1,onChange:()=>{},resolve:async value=>{refreshes++;return {track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)};},fetcher:async(_input,init)=>{const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(range[1]),end=Number(range[2]),attempt=(attempts.get(start)||0)+1;attempts.set(start,attempt);if(start>0&&attempt<=3)throw new TypeError("Network connection interrupted");return new Response(data.slice(start,end+1),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes ${start}-${end}/${data.length}`}});}});
 try{await manager.enqueue(track("1"));assert.equal(refreshes,5);assert.equal(storage.audio.get("1")?.sha256,sha(data));assert.equal(attempts.get(0),1);}finally{manager.dispose();}
});

for(const failure of ["stalled body","network body error","busy response"] as const)test(`a ${failure} recovers without settling the download or publishing incomplete audio`,async()=>{
 const data=bytes(4096),storage=new MemoryStorage();let requests=0,canceled=0;
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,idleTimeoutMs:10,recoveryDelayMs:1,onChange:()=>{},resolve:async value=>({track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async()=>{requests++;if(requests<=3){if(failure==="busy response")return Response.json({reason:"backend-unavailable"},{status:429});return new Response(new ReadableStream<Uint8Array>({start(controller){if(failure==="network body error")controller.error(new TypeError("Load failed"));},cancel(){canceled++;}}),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":String(data.length),"Content-Range":`bytes 0-${data.length-1}/${data.length}`}});}return new Response(data,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes 0-${data.length-1}/${data.length}`}});}});
 try{await manager.enqueue(track("1"));assert.equal(requests,4);assert.equal(storage.audio.get("1")?.sha256,sha(data));if(failure==="stalled body")assert.equal(canceled,3);}finally{manager.dispose();}
});

test("going offline during recovery backoff cancels timers and resumes the pending download after reconnection",async()=>{
 const windowDescriptor=Object.getOwnPropertyDescriptor(globalThis,"window"),navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator"),events=new EventTarget(),connection={onLine:true};Object.defineProperty(globalThis,"window",{value:events,configurable:true});Object.defineProperty(globalThis,"navigator",{value:connection,configurable:true});const data=bytes(4096),storage=new MemoryStorage();let requests=0,blocked=true;
 const manager=new DurableDownloadManager({accountId:"account-a",storage,chunkBytes:4096,recoveryDelayMs:150,onChange:()=>{},resolve:async value=>({track:value,url:"https://cdn.example/1",assetId:"asset-1",sizeBytes:data.length,sha256:sha(data)}),fetcher:async()=>{requests++;assert.equal(connection.onLine,true);if(blocked)throw new TypeError("Network connection interrupted");return new Response(data,{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":`bytes 0-${data.length-1}/${data.length}`}});}});
 try{const pending=manager.enqueue(track("1"));await until(()=>storage.records.get("1")?.refreshSource===true);connection.onLine=false;events.dispatchEvent(new Event("offline"));await new Promise(resolve=>setTimeout(resolve,200));assert.equal(requests,3);assert.equal(storage.records.get("1")?.status,"queued");blocked=false;connection.onLine=true;events.dispatchEvent(new Event("online"));await pending;assert.equal(requests,4);assert.equal(storage.audio.get("1")?.sha256,sha(data));}finally{manager.dispose();if(windowDescriptor)Object.defineProperty(globalThis,"window",windowDescriptor);else Reflect.deleteProperty(globalThis,"window");if(navigatorDescriptor)Object.defineProperty(globalThis,"navigator",navigatorDescriptor);else Reflect.deleteProperty(globalThis,"navigator");}
});
