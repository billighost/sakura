import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {test} from "node:test";
import {DurableDownloadManager} from "../src/rebuild/app/downloadEngine";
import type {DownloadChunk,DownloadStorage,PartialDownloadRecord} from "../src/rebuild/app/downloadTypes";
import type {MusicTrack} from "../src/rebuild/app/types";
import type {OfflineAudio} from "../src/rebuild/app/offline";

class OpeningStorage implements DownloadStorage {
 records=new Map<string,PartialDownloadRecord>();chunksById=new Map<string,Map<number,DownloadChunk>>();fragments=new Map<string,Map<number,DownloadChunk>>();audio=new Map<string,OfflineAudio>();
 async list(){return [...this.records.values()];}async read(id:string){return this.records.get(id);}async save(record:PartialDownloadRecord){this.records.set(record.recordingId,structuredClone(record));}
 async chunks(id:string){return [...this.chunksById.get(id)?.values()??[]];}async chunk(id:string,offset:number){return this.chunksById.get(id)?.get(offset);}async putChunk(id:string,chunk:DownloadChunk){const rows=this.chunksById.get(id)??new Map();rows.set(chunk.offset,chunk);this.chunksById.set(id,rows);}
 async openingChunk(id:string,offset=0){return this.fragments.get(id)?.get(offset);}async putOpeningChunk(id:string,chunk:DownloadChunk){const rows=this.fragments.get(id)??new Map();rows.set(chunk.offset,chunk);this.fragments.set(id,rows);}
 async ready(id:string){return this.audio.get(id);}async allReady(){return [...this.audio.values()];}async finalize(id:string,audio:OfflineAudio){await this.clear(id);this.audio.set(id,audio);}async promoteRequested(id:string){return this.audio.get(id);}
 async clear(id:string,includeReady=false){this.records.delete(id);this.chunksById.delete(id);this.fragments.delete(id);if(includeReady)this.audio.delete(id);}async clearAutomatic(id:string){if(this.records.get(id)?.requested)return false;await this.clear(id,true);return true;}async lease(){return true;}async release(){}
}

test("a first audio range yields one read-ahead transfer when the provider has fewer slots than the manager",async()=>{
 const audioStart=334168,bytes=Uint8Array.from({length:1048576},(_,i)=>i%239),track:MusicTrack={id:"80000000-0000-4000-8000-000000000098",title:"Provider admission fixture",artists:["Fixture"],artistId:null,albumId:null,albumTitle:null,durationMs:240000,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id:"98"},references:[]};
 bytes.set([0x49,0x44,0x33,3,0,0]);let size=audioStart-10;for(let index=9;index>=6;index--){bytes[index]=size&127;size=Math.floor(size/128);}bytes.set([0xff,0xfb,0x90,0x40],audioStart);
 const requested:number[]=[],started:number[]=[],closed:number[]=[],queued:Array<()=>void>=[];let active=0,maxActive=0;
 const server=createServer((request,response)=>{
  const range=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range??"");if(!range){response.writeHead(400);response.end();return;}const start=Number(range[1]),end=Number(range[2]);requested.push(start);let admitted=false;
  const begin=()=>{if(response.destroyed)return;admitted=true;active++;maxActive=Math.max(maxActive,active);started.push(start);response.writeHead(206,{"Content-Type":"audio/mpeg","Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${bytes.length}`});
   if(end-start+1===262144||start===audioStart){response.write(bytes.slice(start,start+32768));/* Hold admitted transfers through the first audible fragment. */}
   else response.end(bytes.slice(start,end+1));
  };
  response.on("close",()=>{if(!admitted)return;active--;closed.push(start);while(active<2&&queued.length)queued.shift()!();});
  if(active<2)begin();else queued.push(begin);
 });
 let manager:DurableDownloadManager|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address==="object");const origin="http://127.0.0.1:"+address.port,storage=new OpeningStorage();
  manager=new DurableDownloadManager({accountId:"90000000-0000-4000-8000-000000000098",storage,maxConcurrentChunks:4,onChange:()=>{},resolve:async()=>({track,url:origin+"/song",assetId:"81000000-0000-4000-8000-000000000098",sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")})});
  const saved=manager.enqueue(track);void saved.catch(()=>{});
  const admittedDeadline=Date.now()+2000;while(!started.includes(262144)){if(Date.now()>admittedDeadline)throw new Error("The two provider slots did not fill before playback began.");await new Promise(resolve=>setTimeout(resolve,5));}
  const opening=await Promise.race([manager.ensurePlaybackOpening(track.id),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("The audio opening stayed queued behind the provider's two held bulk transfers.")),3000);})]);
  assert.equal(opening?.offset,audioStart);assert.equal(opening?.blob.size,32768);assert.ok(started.includes(0));assert.ok(started.includes(262144));assert.ok(started.includes(audioStart));assert.ok(closed.includes(262144),"Only nonurgent read-ahead yields the provider slot");assert.ok(!closed.includes(0),"The original header range keeps downloading");assert.ok(maxActive<=2);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(requested.filter(start=>start===262144).length,1,"Read-ahead stays suspended until the sparse opening body completes");assert.deepEqual(requested,[0,262144,audioStart]);assert.ok(!closed.includes(audioStart),"Playable audio keeps its provider slot while it streams");
 }finally{if(timer)clearTimeout(timer);manager?.dispose();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
});
