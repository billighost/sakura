/** Real Next entrance with generated full audio, delayed last bytes, offline
 * replay and intercepted synthetic account APIs. No database/account writes. */
import "dotenv/config";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {encode} from "next-auth/jwt";
import {chromium,expect as baseExpect} from "@playwright/test";
import {waveAudio} from "./fixtures/audio.ts";
import {discloseBloomChapter} from "../src/rebuild/bloom/snapshot.ts";
import {bloomDisclosureReply} from "../src/rebuild/bloom/receipts.ts";

const base=process.env.SAKURA_TEST_URL||"http://localhost:3090",expect=baseExpect.configure({timeout:30000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,"Synthetic session signing configuration is required");
const account={id:"90000000-0000-4000-8000-000000000493",username:"Prepared Bloom",email:"bloom-readiness@example.invalid"};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:"authjs.session-token"});
const audio=waveAudio(40000),sha256=createHash("sha256").update(audio).digest("hex");
const songs=[1,2].map(index=>({id:`80000000-0000-4000-8000-${String(493+index).padStart(12,"0")}`,recordingId:`80000000-0000-4000-8000-${String(493+index).padStart(12,"0")}`,title:`Prepared song ${index}`,artists:["Fixture artist"],coverUrl:`https://cdn-images.dzcdn.net/images/cover/${String(493+index).padStart(32,"0")}/1000x1000-000000-80-0-0.jpg`,durationMs:40000,metadata:{title:`Prepared song ${index}`,artists:["Fixture artist"],durationMs:40000},reference:{provider:"deezer",id:String(493+index)},references:[{provider:"deezer",id:String(493+index)}]}));
const chapters=songs.map((recording,index)=>({id:`song-${index}`,kind:"songs",title:`A prepared chapter ${index+1}`,prompt:"",stat:{label:"Song",value:recording.title,unit:""},relatedRecording:recording,recordings:[{rank:index+1,audibleMs:40000,plays:1,recording}]}));
const skeleton={id:"monthly-2026-10",period:"monthly",periodStart:"2020-01-01T00:00:00Z",periodEnd:"2020-02-01T00:00:00Z",publishAt:"2020-02-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",timeZone:"Africa/Lagos",status:"available",version:4,worldId:"sakura",snapshotCreatedAt:"2026-11-11T08:00:00Z",chapterCount:chapters.length,summary:{audibleMs:80000,playCount:2,recordingCount:2,activeDays:1}};
const browser=await chromium.launch({headless:true});
const report={scope:"Real Next Bloom entrance, generated WAV and signed synthetic account; product APIs intercepted",checks:[],ranges:[],timings:{},errors:[]};
let debugPage;
 let releaseFinal;const finalGate=new Promise(resolve=>releaseFinal=resolve);let finalRequested=false,preparedRequests=0,detailRequests=0,listeningSession=null;const revealed=new Set(),imageRequests=[],listeningSessionWrites=[],unexpected=[];
const recap=()=>({...skeleton,chapters:chapters.map(chapter=>discloseBloomChapter(chapter,revealed.has(chapter.id)))});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:"reduce",serviceWorkers:"allow"});
 await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem("sakura-ink-opening","1"));
 const page=await context.newPage();debugPage=page;page.on("pageerror",error=>report.errors.push(error.message));
 page.on("console",message=>(report.console??=[]).push({type:message.type(),text:message.text()}));
 page.on("requestfailed",request=>(report.failedRequests??=[]).push({url:request.url(),resourceType:request.resourceType(),failure:request.failure()}));
 const preparationPins=()=>page.evaluate(async accountId=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const prefix=`account:${accountId}:audio-pin:`,request=db.transaction("entries").objectStore("entries").count(IDBKeyRange.bound(prefix,prefix+"\uffff"));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
 },account.id);
 await context.route("**/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  if(request.headers()["x-sakura-account"]&&request.headers()["x-sakura-account"]!==account.id)throw new Error("Wrong account in Bloom fixture");
  if(path==="/api/auth/session")return route.fulfill({json:{user:account}});
  if(path==="/api/v2/bootstrap"||path==="/api/v2/profile")return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==="/api/v2/library/state")return route.fulfill({json:{favoriteIds:[],favoriteStates:[],recordings:[]}});
  if(path==="/api/v2/settings"){const settings={theme:"light",privateSession:true,learnFromListening:false,reducedMotion:true,bloomPerformance:"1",onboarded:true,openingAnimation:0,audioTechnology:"none",volume:0,timeZone:"Africa/Lagos",seedArtists:[],seedGenres:[]};return route.fulfill({json:{...settings,revision:0,fieldRevisions:Object.fromEntries(Object.keys(settings).map(key=>[key,0]))}});}
  if(path==="/api/v2/image"){imageRequests.push(url.searchParams.get("url"));return route.fulfill({headers:{"Cache-Control":"public, max-age=3600"},contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#8ca295"/></svg>'});}
  if(path.endsWith("/prepare")){preparedRequests++;return route.fulfill({json:{story:recap(),chapters}});}
  if(path.endsWith("/reveal")){const body=request.postDataJSON(),id=body.chapterId,index=chapters.findIndex(chapter=>chapter.id===id);assert.ok(index>=0);assert.ok(chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)));revealed.add(id);return route.fulfill({json:bloomDisclosureReply(recap(),body.scope)});}
  if(path===`/api/v2/bloom/${skeleton.id}`){detailRequests++;return route.fulfill({json:url.searchParams.get("prepare")==="1"?{story:recap(),chapters}:recap()});}
  if(path==="/api/v2/bloom")return route.fulfill({json:{items:[skeleton],schedule:{timeZone:"Africa/Lagos"}}});
  if(path==="/api/v2/recordings/resolve"){
   const reference=request.postDataJSON().reference,recording=songs.find(song=>song.reference.id===reference.id);assert.ok(recording);
   const assetId=`81000000-0000-4000-8000-${recording.id.slice(-12)}`,address=`/api/v2/recordings/${recording.id}/audio?assetId=${assetId}`;
   return route.fulfill({json:{status:"resolved",recording,playback:{url:address,fallbackUrl:address,assetId,sizeBytes:audio.length,sha256,mimeType:"audio/wav"}}});
  }
  if(path.endsWith("/audio")){
   const range=/bytes=(\d+)-(\d+)/.exec(request.headers().range||"");assert.ok(range,"Preparation requests bounded audio ranges");
   const start=Number(range[1]),end=Math.min(Number(range[2]),audio.length-1);report.ranges.push({recordingId:path.split("/").at(-2),start,end});
   if(path.includes(songs[1].id)&&end===audio.length-1){finalRequested=true;await finalGate;}
   return route.fulfill({status:206,headers:{"Content-Type":"audio/wav","Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${audio.length}`,"Accept-Ranges":"bytes"},body:audio.subarray(start,end+1)});
  }
  if(path==="/api/v2/taste"&&method==="GET")return route.fulfill({json:{feedback:[],tasteEvidence:[],historyClearedAt:null}});
   if(path==="/api/v2/listening-session"){
    if(method==="GET")return route.fulfill({json:{session:listeningSession,serverTime:Date.now(),protocol:1}});
    if(method==="PUT"){
     const body=request.postDataJSON(),revision=listeningSession?.revision||0;assert.ok(body?.state&&Array.isArray(body.state.queue)&&body.state.queue.length<=80);assert.equal(body.revision,revision);assert.equal(typeof body.deviceId,"string");assert.ok(body.deviceId);
     const now=Date.now();listeningSession={state:body.state,revision:revision+1,deviceId:body.deviceId,updatedAt:now,choiceAt:Number.isFinite(body.intentAt)?body.intentAt:now};listeningSessionWrites.push({revision:listeningSession.revision,queueLength:body.state.queue.length,currentEntryId:body.state.currentEntryId,positionMs:body.state.positionMs});
     return route.fulfill({json:{accepted:true,session:listeningSession,serverTime:now,protocol:1}});
    }
   }
  if(path==="/api/v2/library"&&method==="GET")return route.fulfill({json:{recordings:[],playlists:[],favoriteStates:{},nextCursor:null}});
  if(path==="/api/v2/mixes"&&method==="GET")return route.fulfill({json:{mixes:[],items:[],nextCursor:null}});
  if(path==="/api/v2/bloom/shelf"&&method==="GET")return route.fulfill({json:{items:[]}});
  if(path==="/api/v2/feed"&&method==="GET")return route.fulfill({json:{items:[],sections:[],nextCursor:null,personalized:true,totalCandidates:0}});
  if(path==="/api/v2/feed/hero"&&method==="GET")return route.fulfill({json:{item:null,refreshAt:Date.now()+600000}});
  if(path==="/api/v2/home"&&method==="GET")return route.fulfill({json:{featured:[],mixes:[],recent:[],needsOnboarding:false}});
  unexpected.push({path,method});return route.fulfill({status:503,json:{error:"Unexpected fixture request"}});
 });
 await page.goto(`${base}/home`,{waitUntil:"domcontentloaded",timeout:120000});
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),{timeout:30000}).toBe(true);
 await page.goto(`${base}/bloom/${skeleton.id}`,{waitUntil:"domcontentloaded",timeout:120000});
 const dialog=page.locator("dialog[open]"),begin=dialog.locator('[data-bloom-action="begin"]');await begin.waitFor();
 await expect.poll(()=>finalRequested).toBe(true);await expect(begin).toBeDisabled();
 assert.equal(revealed.size,0);assert.equal(await dialog.locator('[aria-current="step"]').count(),0);
 report.checks.push("Enter remains disabled while the final complete audio range is delayed; private chapters and receipts remain concealed");
 releaseFinal();await expect(begin).toBeEnabled();await expect(dialog).toHaveAttribute("data-bloom-ready","true");
 assert.equal(detailRequests,1);assert.equal(preparedRequests,0,"Single authoritative detail envelope avoids another preparation POST");
 assert.deepEqual(imageRequests.sort(),songs.map(song=>song.coverUrl.replace("1000x1000","640x640")).sort());
 report.checks.push("One detail response prepares the exact native display variants without original-image requests");
 const saved=await page.evaluate(async({accountId,ids})=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return Promise.all(ids.map(id=>new Promise(resolve=>{const request=db.transaction("entries").objectStore("entries").get(`account:${accountId}:audio:${id}`);request.onsuccess=()=>resolve({id,size:request.result?.blob?.size,sha:request.result?.sha256,requested:request.result?.requested});})));},{accountId:account.id,ids:songs.map(song=>song.id)});
 assert.ok(saved.every(song=>song.size===audio.length&&song.sha===sha256&&song.requested===false));
 assert.equal(await preparationPins(),songs.length,"Verified soundtrack files remain pinned while the story owns them");
 report.checks.push("Both soundtrack files are fully verified and stored before Enter becomes enabled");
 const enterMs=await begin.evaluate(button=>new Promise(resolve=>{const started=performance.now(),dialog=button.closest("dialog"),observer=new MutationObserver(()=>{if(dialog.querySelector('[aria-current="step"]')){observer.disconnect();resolve(performance.now()-started);}});observer.observe(dialog,{subtree:true,attributes:true});button.click();}));
 report.timings.preparedEnterMs=enterMs;await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute("aria-label",`Chapter 1: ${chapters[0].title}`);
 const rangesBefore=report.ranges.length,requestsBefore=preparedRequests;
 await dialog.getByRole("button",{name:"Close Sakura Bloom",exact:true}).click();
 await expect(page).toHaveURL(`${base}/bloom`);
 const revisit=page.getByRole("link",{name:"Open this Bloom",exact:false});await revisit.waitFor();
 report.beforeOffline=await page.evaluate(()=>({url:location.href,route:document.querySelector('[data-route-path]')?.getAttribute('data-route-path'),links:[...document.querySelectorAll('a')].filter(node=>node.textContent.includes('Open this Bloom')).map(node=>({text:node.textContent,href:node.href}))}));
 await context.setOffline(true);
 for(const delay of [0,50,250,1000]){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));(report.offlineTransition??=[]).push(await page.evaluate(delay=>({delay,url:location.href,route:document.querySelector('[data-route-path]')?.getAttribute('data-route-path'),body:document.body.innerText.slice(0,400),links:[...document.querySelectorAll('a')].map(node=>node.textContent.trim()).filter(Boolean).slice(0,20)}),delay));}
 await expect.poll(preparationPins).toBe(0);
 report.checks.push("Closing the story and suspending speculation releases every preparation pin before offline recovery");
 await revisit.click();await expect(page.locator('dialog[open] [data-bloom-action="begin"]')).toBeEnabled();
 assert.equal(report.ranges.length,rangesBefore);assert.equal(preparedRequests,requestsBefore);
 assert.equal(await preparationPins(),songs.length);
 report.checks.push("After retained capabilities are released, the story reopens offline from saved data and verified full audio without provider requests");
 const imagesBefore=imageRequests.length;await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 const offlineDialog=page.locator("dialog[open]");await expect(offlineDialog.locator('[data-bloom-action="begin"]')).toBeEnabled();
 await offlineDialog.locator('[data-bloom-action="begin"]').click();await expect(offlineDialog.locator('[aria-current="step"]')).toHaveAttribute("aria-label",/^Chapter 1:/);
 await offlineDialog.locator('[data-bloom-action="next"]').click();await expect(offlineDialog.locator('[aria-current="step"]')).toHaveAttribute("aria-label",/^Chapter 2:/);
 await expect.poll(()=>offlineDialog.locator('img[alt*="Prepared song 2"]').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
 assert.equal(imageRequests.length,imagesBefore,"An unseen chapter recovers its prepared display variant from persistent SW cache after reload");
 report.checks.push("Offline reload renders unseen next-chapter artwork from the exact saved display source without network");
 await page.evaluate(accountId=>window.dispatchEvent(new CustomEvent("sakura-listening-erased",{detail:{accountId,scope:"history"}})),account.id);
 await expect(page.locator("dialog[open]")).toHaveCount(0);await expect.poll(preparationPins).toBe(0);
 const erased=await page.evaluate(async({accountId,id})=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const request=db.transaction("entries").objectStore("entries").get(`account:${accountId}:bloom-prepared:${id}`);request.onsuccess=()=>resolve(request.result===undefined);request.onerror=()=>reject(request.error);});}finally{db.close();}
 },{accountId:account.id,id:skeleton.id});
  assert.equal(erased,true);report.checks.push("Listening erasure closes the ready story, releases its pins and deletes its saved preparation");report.listeningSessionWrites=listeningSessionWrites;
 assert.deepEqual(unexpected,[]);assert.deepEqual(report.errors,[]);await mkdir(".local/bloom-readiness",{recursive:true});await writeFile(".local/bloom-readiness/report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
 await context.close();
}catch(error){
 report.errors.push(error.message);
 if(debugPage&&!debugPage.isClosed()){
  report.failure=await debugPage.evaluate(()=>({url:location.href,online:navigator.onLine,route:document.querySelector('[data-route-path]')?.getAttribute('data-route-path'),body:document.body.innerText.slice(-10000),links:[...document.querySelectorAll('a')].filter(node=>node.textContent.includes('Bloom')).map(node=>({text:node.textContent,href:node.href})),controller:!!navigator.serviceWorker.controller})).catch(()=>null);
  await debugPage.screenshot({path:'.local/bloom-readiness-failure.png'}).catch(()=>{});
 }
 await mkdir('.local/bloom-readiness',{recursive:true});await writeFile('.local/bloom-readiness/failure-report.json',JSON.stringify(report,null,2)+'\n');
 throw error;
}finally{releaseFinal();await browser.close();}
