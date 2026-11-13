import assert from "node:assert/strict";
import {test} from "node:test";
import {bloomDisplayArtwork,bloomPreparedArtwork} from "../src/rebuild/bloom/artwork";
import {bloomAssetManifest,prepareBloomAssets} from "../src/rebuild/bloom/preparation";
import {bloomArtworkWarmUrls} from "../src/rebuild/bloom/artworkWarmup";
import {applyBloomDisclosureReply,bloomDisclosureReply,type BloomDisclosureReceipt} from "../src/rebuild/bloom/receipts";
import {bloomPreparationScope} from "../src/rebuild/bloom/preparationIdentity";
import type {BloomPreparedStory} from "../src/rebuild/bloom/uiTypes";

const raw="https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/1000x1000-000000-80-0-0.jpg";
const proxy=(width:number)=>`/api/v2/image?url=${encodeURIComponent(raw.replace("1000x1000",`${width}x${width}`))}`;
function fixture():BloomPreparedStory{
 const recordings=Array.from({length:4},(_,index)=>({id:`song-${index}`,title:`Song ${index}`,coverUrl:index?`https://fixture.invalid/${index}.jpg`:raw}));
 const chapters=recordings.map((recording,index)=>({id:`chapter-${index}`,kind:"songs" as const,title:`Chapter ${index}`,prompt:"",stat:{label:"Song",value:index,unit:""},relatedRecording:recording}));
 return {story:{id:"monthly-2026-10",period:"monthly",periodStart:"2026-10-01T00:00:00Z",periodEnd:"2026-11-01T00:00:00Z",publishAt:"2026-11-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",timeZone:"UTC",worldId:"sakura",version:4,status:"available",chapterCount:chapters.length,snapshotCreatedAt:"2026-11-01T00:00:00Z",summary:{audibleMs:1000,playCount:4,recordingCount:4,activeDays:1},chapters:chapters.map(chapter=>({...chapter,stat:null,relatedRecording:null,revealed:false}))},chapters};
}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>resolve=yes);return {promise,resolve};}

test("prepared native display identity matches phone DPR and preserves a saved offline source",()=>{
 assert.equal(bloomDisplayArtwork(raw,390,2),proxy(640));
 assert.equal(bloomDisplayArtwork(raw,390,3),proxy(1000));
 assert.equal(bloomDisplayArtwork(raw,1280,1),proxy(640));
 assert.equal(bloomDisplayArtwork(raw,390,3,proxy(640)),proxy(640));
 assert.equal(bloomDisplayArtwork(raw,390,2,"https://untrusted.invalid/source"),proxy(640));
 const signed=raw+"?signature=preserve";assert.equal(bloomDisplayArtwork(signed),`/api/v2/image?url=${encodeURIComponent(signed)}`);
});

test("offline preparation and warmups reuse the exact saved display source after DPR changes",()=>{
 const prepared=fixture();prepared.artwork=bloomPreparedArtwork(prepared,bloomAssetManifest(prepared).artwork,{viewportWidth:390,pixelRatio:2});
 const offline=bloomPreparedArtwork(prepared,bloomAssetManifest(prepared).artwork,{viewportWidth:390,pixelRatio:3,offline:true});
 assert.equal(offline[raw],proxy(640));
 assert.ok(bloomArtworkWarmUrls({...prepared,artwork:offline},0).includes(proxy(640)));
 assert.equal(bloomArtworkWarmUrls({...prepared,artwork:offline},0).includes(proxy(1000)),false);
});

test("legacy metadata artwork is fully prepared and reused by unseen chapter warmups",async()=>{
 const prepared=fixture(),artwork=gate(),started=gate();
 prepared.chapters[0].relatedRecording={id:"current-song",coverUrl:"/current.jpg"};
 prepared.chapters[1].relatedRecording={id:"legacy-song",metadata:{coverUrl:raw}};
 const manifest=bloomAssetManifest(prepared);
 assert.ok(manifest.artwork.includes(raw));
 const selected=bloomPreparedArtwork(prepared,manifest.artwork,{viewportWidth:390,pixelRatio:2});
 prepared.artwork=selected;
 assert.ok(bloomArtworkWarmUrls(prepared,1).includes(proxy(640)));
 let ready=false;
 const task=prepareBloomAssets({signal:new AbortController().signal,loadStory:async()=>prepared,preloadWorld:async()=>{},prepareAudio:async()=>({release(){}}),prepareArtwork:async url=>{if(url===raw){started.resolve();await artwork.promise;}},onProgress:progress=>{if(progress.phase==="ready")ready=true;}});
 await started.promise;assert.equal(ready,false,"Displayed legacy artwork remains part of the readiness gate");
 artwork.resolve();const assets=await task;assert.equal(ready,true);assets.release();
});

test("stalled artwork does not prevent soundtrack admission and never unlocks incomplete readiness",async()=>{
 const artwork=gate(),audioStarted=gate(),prepared=fixture();let active=0,maximum=0,audioCalls=0,ready=false;
 const task=prepareBloomAssets({signal:new AbortController().signal,loadStory:async()=>prepared,preloadWorld:async()=>{},prepareArtwork:async()=>{active++;maximum=Math.max(maximum,active);await artwork.promise;active--;},prepareAudio:async()=>{active++;maximum=Math.max(maximum,active);audioCalls++;audioStarted.resolve();await Promise.resolve();active--;return {release(){}};},onProgress:progress=>{if(progress.phase==="ready")ready=true;}});
 await audioStarted.promise;assert.ok(audioCalls>0);assert.equal(ready,false);assert.ok(maximum<=3);
 artwork.resolve();const assets=await task;assert.equal(ready,true);assert.ok(maximum<=3);assets.release();
});

test("a compact disclosure reply reconstructs only the trusted confirmed prefix",()=>{
 const prepared=fixture(),scope=bloomPreparationScope(prepared.story);
 const full={...prepared.story,chapters:prepared.story.chapters.map((chapter,index)=>index<2?{...prepared.chapters[index],revealed:true}:chapter)};
 const reply=bloomDisclosureReply(full,scope);assert.ok("receipt" in reply);
 assert.deepEqual(applyBloomDisclosureReply(prepared,reply),{...full,completed:false,completedAt:undefined,listening:undefined});
 assert.equal(applyBloomDisclosureReply(prepared,reply).chapters[2].stat,null);
 assert.equal(applyBloomDisclosureReply(prepared,reply).chapters[2].relatedRecording,null);
 assert.equal(bloomDisclosureReply(full,"old-snapshot"),full);
 assert.equal(applyBloomDisclosureReply(prepared,full),full);
});

test("compact receipts reject changed identity, skipped or repeated chapters and premature completion",()=>{
 const prepared=fixture(),base:BloomDisclosureReceipt={receipt:"sakura-bloom-disclosure-v1",scope:bloomPreparationScope(prepared.story),revealedChapters:["chapter-0"],completed:false};
 for(const patch of [{scope:"different"},{revealedChapters:["chapter-1"]},{revealedChapters:["chapter-0","chapter-0"]},{completed:true},{completedAt:"invalid"}])assert.throws(()=>applyBloomDisclosureReply(prepared,{...base,...patch}));
 prepared.story.chapters[0]={...prepared.chapters[0],revealed:true};assert.throws(()=>applyBloomDisclosureReply(prepared,{...base,revealedChapters:[]}));
});

test("completed compact receipt retains all saved facts without retransmitting chapter cards",()=>{
 const prepared=fixture(),full={...prepared.story,chapters:prepared.chapters.map(chapter=>({...chapter,revealed:true})),completed:true,completedAt:"2026-11-12T00:00:00Z"};
 const reply=bloomDisclosureReply(full,bloomPreparationScope(full));assert.ok("receipt" in reply);
 assert.ok(JSON.stringify(reply).length<JSON.stringify(full).length);
 assert.deepEqual(applyBloomDisclosureReply(prepared,reply),{...full,listening:undefined});
});
