import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {DurableDownloadManager} from "../src/rebuild/app/downloadEngine";
import {fetchAudioRange,OPENING_AUDIO_BYTES,readAudioRange} from "../src/rebuild/app/downloadRange";
import type {DownloadChunk,DownloadStorage,PartialDownloadRecord} from "../src/rebuild/app/downloadTypes";
import type {DownloadEntry,MusicTrack} from "../src/rebuild/app/types";
import type {OfflineAudio} from "../src/rebuild/app/offline";

const digest=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const openingEnd=(audioStart:number)=>Math.ceil((audioStart+OPENING_AUDIO_BYTES)/262144)*262144;
const song:MusicTrack={id:"80000000-0000-4000-8000-000000000077",title:"Progressive song",artists:["Fixture"],artistId:null,albumId:null,albumTitle:null,durationMs:240000,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id:"77"},references:[]};
class OpeningStorage implements DownloadStorage {
 records=new Map<string,PartialDownloadRecord>();parts=new Map<string,Map<number,DownloadChunk>>();openings=new Map<string,Map<number,DownloadChunk>>();audio=new Map<string,OfflineAudio>();
 async list(){return [...this.records.values()];}async read(id:string){return this.records.get(id);}async save(record:PartialDownloadRecord){this.records.set(record.recordingId,structuredClone(record));}
 async chunks(id:string){return [...this.parts.get(id)?.values()??[]];}async chunk(id:string,offset:number){return this.parts.get(id)?.get(offset);}async putChunk(id:string,chunk:DownloadChunk){const parts=this.parts.get(id)??new Map();parts.set(chunk.offset,chunk);this.parts.set(id,parts);}
 async openingChunk(id:string,offset=0){return this.openings.get(id)?.get(offset);}async putOpeningChunk(id:string,chunk:DownloadChunk){const parts=this.openings.get(id)??new Map();parts.set(chunk.offset,chunk);this.openings.set(id,parts);}
 async ready(id:string){return this.audio.get(id);}async allReady(){return [...this.audio.values()];}async finalize(id:string,audio:OfflineAudio){await this.clear(id);this.audio.set(id,audio);}async promoteRequested(id:string){const audio=this.audio.get(id);if(!audio)return;const promoted={...audio,requested:true};this.audio.set(id,promoted);return promoted;}
 async clear(id:string,includeReady=false){this.records.delete(id);this.parts.delete(id);this.openings.delete(id);if(includeReady)this.audio.delete(id);}async clearAutomatic(id:string){if(this.records.get(id)?.requested||this.audio.get(id)?.requested)return false;await this.clear(id,true);return true;}
 async lease(){return true;}async release(){}
}
function fixture(options:{audioStart?:number;invalidFrame?:boolean;shiftedSparse?:boolean;holdOpening?:boolean;holdBulk?:boolean;holdSparse?:boolean;failSparseAfterFirst?:boolean;delayMs?:number;chunkBytes?:number}={}){
 const chunkBytes=options.chunkBytes??262144,data=Uint8Array.from({length:chunkBytes*8},(_,i)=>i%239),audioStart=options.audioStart??0;
 if(audioStart){data.set([0x49,0x44,0x33,3,0,0],0);let payload=audioStart-10;for(let index=9;index>=6;index--){data[index]=payload&127;payload=Math.floor(payload/128);}}
 data.set(options.invalidFrame?[0,0,0,0]:[0xff,0xfb,0x90,0x40],audioStart);
 const storage=new OpeningStorage(),requests:Array<{start:number;end:number}>=[],aborts:number[]=[],bulkReleases=new Map<number,()=>void>();let released=false,release:()=>void=()=>{},releaseOpeningPart:()=>void=()=>{},releaseSparse:()=>void=()=>{},snapshot:Record<string,DownloadEntry>={},active=0,maxActive=0;
 const manager=new DurableDownloadManager({accountId:"90000000-0000-4000-8000-000000000077",storage,chunkBytes,maxConcurrentChunks:2,onChange:next=>{snapshot=next;},resolve:async()=>({track:song,url:"https://cdn.example/song",assetId:"81000000-0000-4000-8000-000000000077",sizeBytes:data.length,sha256:digest(data)}),fetcher:async(_input,init)=>{
  const match=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")||"")!,start=Number(match[1]),end=Number(match[2]);requests.push({start,end});active++;maxActive=Math.max(active,maxActive);
  const headers={"Content-Type":"audio/mpeg","Content-Length":String(end-start+1),"Content-Range":`bytes ${options.shiftedSparse&&start===audioStart&&start!==0?start+1:start}-${end}/${data.length}`};
  if(options.holdOpening&&start===0&&end>OPENING_AUDIO_BYTES){return new Response(new ReadableStream<Uint8Array>({start(controller){let position=OPENING_AUDIO_BYTES;controller.enqueue(data.slice(0,position));release=()=>{if(released)return;released=true;active--;controller.enqueue(data.slice(position,end+1));controller.close();};releaseOpeningPart=()=>{if(released)return;const next=Math.min(end+1,position+OPENING_AUDIO_BYTES);controller.enqueue(data.slice(position,next));position=next;if(position>end){released=true;active--;controller.close();}};init?.signal?.addEventListener("abort",()=>{if(released)return;released=true;active--;aborts.push(start);controller.error(init.signal?.reason);},{once:true});},cancel(){if(!released){released=true;active--;}}}),{status:206,headers});}
  if(options.holdBulk&&start>0&&end-start+1===chunkBytes){return new Response(new ReadableStream<Uint8Array>({start(controller){let position=start+OPENING_AUDIO_BYTES,done=false;controller.enqueue(data.slice(start,position));bulkReleases.set(start,()=>{if(done)return;const next=Math.min(end+1,position+OPENING_AUDIO_BYTES);controller.enqueue(data.slice(position,next));position=next;if(position>end){done=true;active--;controller.close();}});init?.signal?.addEventListener("abort",()=>{if(done)return;done=true;active--;aborts.push(start);controller.error(init.signal?.reason);},{once:true});}}),{status:206,headers});}
  if(options.holdSparse&&start===audioStart&&start>0){return new Response(new ReadableStream<Uint8Array>({start(controller){let position=start+OPENING_AUDIO_BYTES,done=false;controller.enqueue(data.slice(start,position));releaseSparse=()=>{if(done)return;const next=Math.min(end+1,position+OPENING_AUDIO_BYTES);controller.enqueue(data.slice(position,next));position=next;if(position>end){done=true;active--;controller.close();}};init?.signal?.addEventListener("abort",()=>{if(done)return;done=true;active--;controller.error(init.signal?.reason);},{once:true});}}),{status:206,headers});}
  if(options.failSparseAfterFirst&&start===audioStart&&start>0){return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(data.slice(start,start+OPENING_AUDIO_BYTES));setTimeout(()=>{active--;controller.error(new Error("The network connection ended during the sparse opening."));},20);}}),{status:206,headers});}
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,options.delayMs??0);init?.signal?.addEventListener("abort",()=>{clearTimeout(timer);aborts.push(start);active--;reject(init.signal?.reason);},{once:true});});active--;
  return new Response(data.slice(start,end+1),{status:206,headers});
 }});
 return {manager,storage,requests,aborts,data,release:()=>release(),releaseOpeningPart:()=>releaseOpeningPart(),releaseBulk:(offset:number)=>bulkReleases.get(offset)?.(),releaseSparse:()=>releaseSparse(),get snapshot(){return snapshot;},get maxActive(){return maxActive;}};
}
async function until(condition:()=>boolean){const deadline=Date.now()+2000;while(!condition()){if(Date.now()>deadline)throw new Error("The expected media work did not start.");await new Promise(resolve=>setTimeout(resolve,5));}}

test("32 KiB becomes usable while the same first 256 KiB range remains incomplete",async()=>{
 const f=fixture({holdOpening:true});try{const saved=f.manager.enqueue(song),opening=await f.manager.ensurePlaybackOpening(song.id);assert.equal(opening?.blob.size,OPENING_AUDIO_BYTES);assert.equal(opening?.offset,0);assert.ok(!f.storage.parts.get(song.id)?.has(0));assert.equal(f.storage.audio.size,0);assert.equal(f.requests.filter(request=>request.start===0).length,1);assert.ok(f.maxActive<=2);f.release();await saved;assert.equal(f.storage.audio.get(song.id)?.sha256,digest(f.data));assert.equal(f.storage.openings.size,0);}finally{f.release();f.manager.dispose();}
});

for(const audioStart of [159628,334168,75074])test(`the actual ${audioStart}-byte tag geometry skips artwork before downloading the opening chunk`,async()=>{
 const f=fixture({audioStart,holdOpening:true});try{const saved=f.manager.enqueue(song),[first,second]=await Promise.all([f.manager.ensurePlaybackOpening(song.id),f.manager.ensurePlaybackOpening(song.id)]);assert.equal(first?.offset,audioStart);assert.equal(second?.offset,audioStart);assert.equal(first?.blob.size,OPENING_AUDIO_BYTES);assert.deepEqual(new Uint8Array(await first!.blob.arrayBuffer()),f.data.slice(audioStart,audioStart+OPENING_AUDIO_BYTES));assert.equal(f.storage.records.get(song.id)?.audioStartBytes,audioStart);assert.equal(f.requests.filter(request=>request.start===audioStart&&request.end===openingEnd(audioStart)-1).length,1);assert.ok(!f.storage.parts.get(song.id)?.has(0));assert.ok(f.maxActive<=2);f.release();await saved;assert.deepEqual(new Uint8Array(await f.storage.audio.get(song.id)!.blob.arrayBuffer()),f.data);assert.equal(f.storage.openings.size,0);}finally{f.release();f.manager.dispose();}
});

test("an invalid proposed MPEG boundary retains the original file representation",async()=>{
 const f=fixture({audioStart:75074,invalidFrame:true,holdOpening:true});try{const saved=f.manager.enqueue(song),opening=await f.manager.ensurePlaybackOpening(song.id);assert.equal(opening?.offset,0);assert.equal(f.storage.records.get(song.id)?.audioStartBytes,undefined);f.release();await saved;}finally{f.release();f.manager.dispose();}
});

test("a shifted sparse audio response clears its prefix and fails instead of publishing a false layout",async()=>{
 const f=fixture({audioStart:75074,shiftedSparse:true,holdOpening:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});await assert.rejects(f.manager.ensurePlaybackOpening(song.id),/different part/);await assert.rejects(saved,/different part/);await until(()=>f.storage.openings.size===0);assert.equal(f.snapshot[song.id].status,"failed");assert.equal(f.storage.audio.size,0);}finally{f.release();f.manager.dispose();}
});

test("canceling one opening reader preserves a concurrent reader and the manual download",async()=>{
 const f=fixture({audioStart:75074,holdOpening:true,delayMs:60}),canceled=new AbortController();try{const saved=f.manager.enqueue(song),first=f.manager.ensurePlaybackOpening(song.id,canceled.signal),second=f.manager.ensurePlaybackOpening(song.id);await until(()=>f.requests.some(request=>request.start===75074));canceled.abort();await assert.rejects(first,{name:"AbortError"});assert.equal((await second)?.offset,75074);assert.equal(f.snapshot[song.id].requested,true);assert.ok(!f.aborts.includes(75074));f.release();await saved;}finally{f.release();f.manager.dispose();}
});

test("sequential playback keeps the already fetching next chunk instead of canceling it on each read",async()=>{
 const f=fixture({chunkBytes:4096,delayMs:60});try{const prepared=f.manager.enqueue(song,{mode:"playback",requested:false});await f.manager.ensureChunk(song.id,0);await until(()=>f.requests.some(request=>request.start===4096)&&f.requests.some(request=>request.start===8192));await f.manager.ensureChunk(song.id,4096);await f.manager.ensureChunk(song.id,8192);assert.ok(!f.aborts.includes(8192));assert.equal(f.requests.filter(request=>request.start===8192).length,1);await prepared;}finally{f.manager.dispose();}
});

test("the sparse window supplies successive 32 KiB reads while both the window and original tag chunk are incomplete",async()=>{
 const audioStart=159628,f=fixture({audioStart,holdOpening:true,holdSparse:true});try{const saved=f.manager.enqueue(song),first=await f.manager.ensurePlaybackOpening(song.id);assert.equal(first?.offset,audioStart);assert.equal(f.storage.records.get(song.id)?.audioOpeningEndBytes,openingEnd(audioStart));let ready=false;const next=f.manager.ensureOpeningChunk(song.id,undefined,audioStart+32768).then(chunk=>{ready=true;return chunk;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ready,false);f.releaseSparse();assert.equal((await next)?.offset,audioStart+32768);assert.ok(!f.storage.parts.get(song.id)?.has(0));assert.equal(f.requests.filter(request=>request.start===audioStart).length,1);f.releaseSparse();f.releaseSparse();f.release();await saved;}finally{f.releaseSparse();f.releaseSparse();f.releaseSparse();f.release();f.manager.dispose();}
});

for(const [audioStart,lastOffset,lastSize]of [[159628,257932,4212],[334168,498008,26280],[75074,238914,23230]])test(`the ${audioStart}-byte startup publishes its short tail and continues at the next bulk boundary`,async()=>{
 const f=fixture({audioStart,holdOpening:true,holdSparse:true,holdBulk:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});const first=await f.manager.ensurePlaybackOpening(song.id),parts=[first!.blob];assert.equal(f.storage.records.get(song.id)?.audioOpeningEndBytes,openingEnd(audioStart));
  for(let offset=audioStart+OPENING_AUDIO_BYTES;offset<openingEnd(audioStart);offset+=OPENING_AUDIO_BYTES){const waiting=f.manager.ensureOpeningChunk(song.id,undefined,offset);f.releaseSparse();const fragment=await waiting;assert.equal(fragment?.offset,offset);assert.equal(fragment?.blob.size,Math.min(OPENING_AUDIO_BYTES,openingEnd(audioStart)-offset));parts.push(fragment!.blob);}
  assert.equal(f.storage.openings.get(song.id)?.get(lastOffset)?.blob.size,lastSize);const cachedTail=await f.manager.ensureOpeningChunk(song.id,undefined,lastOffset);assert.equal(cachedTail?.blob.size,lastSize);assert.equal(f.requests.filter(request=>request.start===lastOffset).length,0);
  const continuation=await f.manager.ensureOpeningChunk(song.id,undefined,openingEnd(audioStart));assert.equal(continuation?.blob.size,OPENING_AUDIO_BYTES);parts.push(continuation!.blob);assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()),f.data.slice(audioStart,openingEnd(audioStart)+OPENING_AUDIO_BYTES));assert.ok(!f.storage.parts.get(song.id)?.has(0));assert.ok(f.maxActive<=2);f.manager.dispose();await assert.rejects(saved,{name:"AbortError"});
 }finally{f.manager.dispose();}
});

test("an audio opening takes an occupied read-ahead slot while its original zero range keeps downloading",async()=>{
 const audioStart=75074,f=fixture({audioStart,holdOpening:true,delayMs:80});try{const saved=f.manager.enqueue(song),opening=f.manager.ensurePlaybackOpening(song.id);await until(()=>f.requests.some(request=>request.start===audioStart));assert.ok(f.aborts.includes(262144));assert.ok(!f.aborts.includes(0));assert.ok(f.maxActive<=2);assert.equal((await opening)?.offset,audioStart);f.release();await saved;}finally{f.release();f.manager.dispose();}
});

test("a failed sparse continuation can retry missing audio while retaining its already saved first fragment",async()=>{
 const audioStart=159628,f=fixture({audioStart,holdOpening:true,failSparseAfterFirst:true});try{const saved=f.manager.enqueue(song),first=await f.manager.ensurePlaybackOpening(song.id);assert.equal(first?.offset,audioStart);await assert.rejects(f.manager.ensureOpeningChunk(song.id,undefined,audioStart+32768),/network connection ended/);const next=await f.manager.ensureOpeningChunk(song.id,undefined,audioStart+32768);assert.equal(next?.offset,audioStart+32768);assert.equal(f.storage.openings.get(song.id)?.get(audioStart)?.sha256,first?.sha256);assert.equal(f.requests.filter(request=>request.start===audioStart).length,1);assert.equal(f.requests.filter(request=>request.start===audioStart+32768).length,1);f.release();await saved;assert.equal(f.storage.audio.get(song.id)?.sha256,digest(f.data));}finally{f.release();f.manager.dispose();}
});

test("untagged playback receives its next 32 KiB before the first 256 KiB range completes",async()=>{
 const f=fixture({holdOpening:true,holdBulk:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});await f.manager.ensurePlaybackOpening(song.id);const next=f.manager.ensureOpeningChunk(song.id,undefined,32768);f.releaseOpeningPart();assert.equal((await next)?.blob.size,32768);assert.ok(!f.storage.parts.get(song.id)?.has(0));assert.equal(f.requests.filter(request=>request.start===0).length,1);f.manager.dispose();await assert.rejects(saved,{name:"AbortError"});}finally{f.manager.dispose();}
});

test("later playback reads consume fragments from one existing bulk range rather than waiting for its completion",async()=>{
 const f=fixture({holdOpening:true,holdBulk:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});await f.manager.ensurePlaybackOpening(song.id);const first=await f.manager.ensureOpeningChunk(song.id,undefined,262144);assert.equal(first?.offset,262144);assert.ok(!f.storage.parts.get(song.id)?.has(262144));const next=f.manager.ensureOpeningChunk(song.id,undefined,294912);f.releaseBulk(262144);assert.equal((await next)?.offset,294912);assert.ok(!f.storage.parts.get(song.id)?.has(262144));assert.equal(f.requests.filter(request=>request.start===262144).length,1);assert.ok(f.maxActive<=2);f.manager.dispose();await assert.rejects(saved,{name:"AbortError"});}finally{f.manager.dispose();}
});

test("playing during a manual download backfills earlier bytes from the same incomplete bulk response",async()=>{
 const f=fixture({holdOpening:true,holdBulk:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});await until(()=>f.requests.some(request=>request.start===262144));assert.ok(!f.storage.openings.get(song.id)?.has(262144));await f.manager.ensurePlaybackOpening(song.id);const opening=f.manager.ensureOpeningChunk(song.id,undefined,262144);f.releaseBulk(262144);assert.equal((await opening)?.offset,262144);assert.ok(!f.storage.parts.get(song.id)?.has(262144));assert.equal(f.requests.filter(request=>request.start===262144).length,1);f.manager.dispose();await assert.rejects(saved,{name:"AbortError"});}finally{f.manager.dispose();}
});

test("resumed playback warms a 32 KiB fragment near its position before that bulk chunk completes",async()=>{
 const f=fixture({holdOpening:true,holdBulk:true}),controller=new AbortController();try{const prepared=f.manager.enqueue(song,{mode:"playback",requested:false});void prepared.catch(()=>{});await f.manager.ensurePlaybackOpening(song.id);const warm=f.manager.warmPlaybackPosition(song.id,100000,song.durationMs,controller.signal);await until(()=>f.requests.some(request=>request.start===786432));f.releaseBulk(786432);f.releaseBulk(786432);await warm;assert.ok(!f.storage.parts.get(song.id)?.has(786432));assert.equal(f.requests.filter(request=>request.start===786432).length,1);assert.equal(f.storage.openings.get(song.id)?.get(851968)?.blob.size,32768);f.manager.dispose();await assert.rejects(prepared,{name:"AbortError"});}finally{controller.abort();f.manager.dispose();}
});

test("a concurrent metadata range cannot cancel the bulk flight that still has an audible fragment reader",async()=>{
 const f=fixture({holdOpening:true,holdBulk:true});try{const saved=f.manager.enqueue(song);void saved.catch(()=>{});await f.manager.ensurePlaybackOpening(song.id);const audible=f.manager.ensureOpeningChunk(song.id,undefined,294912);await new Promise(resolve=>setTimeout(resolve,5));const metadata=await f.manager.ensureOpeningChunk(song.id,undefined,786432);assert.equal(metadata?.offset,786432);assert.ok(!f.aborts.includes(262144));f.releaseBulk(262144);assert.equal((await audible)?.offset,294912);assert.equal(f.requests.filter(request=>request.start===262144).length,1);f.manager.dispose();await assert.rejects(saved,{name:"AbortError"});}finally{f.manager.dispose();}
});

test("activating capture at EOF splits buffered data into bounded playback fragments",async()=>{
 const data=new Uint8Array(65536),start=262144,total=1048576,fragments:Array<{offset:number;bytes:number}>=[];let capture=false,reads=0;
 const response={ok:true,status:206,headers:new Headers({"Content-Type":"audio/mpeg","Content-Length":"65536","Content-Range":`bytes ${start}-${start+data.length-1}/${total}`}),body:{getReader(){return {async read(){if(reads++===0)return {value:data,done:false};capture=true;return {done:true};},async cancel(){},releaseLock(){}};}}} as unknown as Response;
 const result=await readAudioRange(response,start,start+data.length-1,total,new AbortController().signal,undefined,15000,true,undefined,undefined,(offset,blob)=>{fragments.push({offset,bytes:blob.size});},()=>capture);
 assert.equal(result.blob.size,65536);assert.deepEqual(fragments,[{offset:start,bytes:32768},{offset:start+32768,bytes:32768}]);
});

test("playback transport hints are limited to the authenticated gateway and signed worker routes",async()=>{
 const gateway=`/api/v2/recordings/${song.id}/audio?assetId=fixture`,worker="https://worker.example/v2/audio/fixture/123?exp=1&sig="+"a".repeat(64),cdn="https://cdn.example/song.mp3";
 for(const [url,playback,expected]of [[gateway,true,"1"],[worker,true,"1"],[cdn,true,null],[worker,false,null]] as const){let actual:string|null=null;await fetchAudioRange(url,0,3,4,new AbortController().signal,async(_input,init)=>{actual=new Headers(init?.headers).get("X-Sakura-Playback");return new Response(new Uint8Array(4),{status:206,headers:{"Content-Type":"audio/mpeg","Content-Length":"4","Content-Range":"bytes 0-3/4"}});},undefined,15000,true,undefined,undefined,undefined,undefined,playback);assert.equal(actual,expected);}
});
