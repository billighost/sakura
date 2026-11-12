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

const base=process.env.SAKURA_TEST_URL||"http://localhost:3090",expect=baseExpect.configure({timeout:30000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,"Synthetic session signing configuration is required");
const account={id:"90000000-0000-4000-8000-000000000493",username:"Prepared Bloom",email:"bloom-readiness@example.invalid"};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:"authjs.session-token"});
const audio=waveAudio(40000),sha256=createHash("sha256").update(audio).digest("hex");
const songs=[1,2].map(index=>({id:`80000000-0000-4000-8000-${String(493+index).padStart(12,"0")}`,recordingId:`80000000-0000-4000-8000-${String(493+index).padStart(12,"0")}`,title:`Prepared song ${index}`,artists:["Fixture artist"],coverUrl:`https://bloom-readiness.invalid/${index}.svg`,durationMs:40000,metadata:{title:`Prepared song ${index}`,artists:["Fixture artist"],durationMs:40000},reference:{provider:"deezer",id:String(493+index)},references:[{provider:"deezer",id:String(493+index)}]}));
const chapters=songs.map((recording,index)=>({id:`song-${index}`,kind:"songs",title:`A prepared chapter ${index+1}`,prompt:"",stat:{label:"Song",value:recording.title,unit:""},relatedRecording:recording,recordings:[{rank:index+1,audibleMs:40000,plays:1,recording}]}));
const skeleton={id:"monthly-2026-10",period:"monthly",periodStart:"2020-01-01T00:00:00Z",periodEnd:"2020-02-01T00:00:00Z",publishAt:"2020-02-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",timeZone:"Africa/Lagos",status:"available",version:4,worldId:"sakura",snapshotCreatedAt:"2026-11-11T08:00:00Z",chapterCount:chapters.length,summary:{audibleMs:80000,playCount:2,recordingCount:2,activeDays:1}};
const browser=await chromium.launch({headless:true});
const report={scope:"Real Next Bloom entrance, generated WAV and signed synthetic account; product APIs intercepted",checks:[],ranges:[],timings:{},errors:[]};
let releaseFinal;const finalGate=new Promise(resolve=>releaseFinal=resolve);let finalRequested=false,preparedRequests=0;const revealed=new Set();
const recap=()=>({...skeleton,chapters:chapters.map(chapter=>discloseBloomChapter(chapter,revealed.has(chapter.id)))});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce",serviceWorkers:"block"});
 await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem("sakura-ink-opening","1"));
 const page=await context.newPage();page.on("pageerror",error=>report.errors.push(error.message));
 const preparationPins=()=>page.evaluate(async accountId=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const prefix=`account:${accountId}:audio-pin:`,request=db.transaction("entries").objectStore("entries").count(IDBKeyRange.bound(prefix,prefix+"\uffff"));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
 },account.id);
 await context.route("**/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==="/api/auth/session")return route.fulfill({json:{user:account}});
  if(path==="/api/v2/bootstrap"||path==="/api/v2/profile")return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==="/api/v2/library/state")return route.fulfill({json:{favoriteIds:[],favoriteStates:[],recordings:[]}});
  if(path==="/api/v2/settings")return route.fulfill({json:{theme:"light",privateSession:true,reducedMotion:true,bloomPerformance:"1",onboarded:true,openingAnimation:0}});
  if(path==="/api/v2/image")return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#8ca295"/></svg>'});
  if(path.endsWith("/prepare")){preparedRequests++;return route.fulfill({json:{story:recap(),chapters}});}
  if(path.endsWith("/reveal")){const id=request.postDataJSON().chapterId,index=chapters.findIndex(chapter=>chapter.id===id);assert.ok(index>=0);assert.ok(chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)));revealed.add(id);return route.fulfill({json:recap()});}
  if(path===`/api/v2/bloom/${skeleton.id}`)return route.fulfill({json:recap()});
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
  return route.fulfill({json:{items:[],recordings:[],session:null,serverTime:Date.now()}});
 });
 await page.goto(`${base}/bloom/${skeleton.id}`,{waitUntil:"domcontentloaded",timeout:120000});
 const dialog=page.locator("dialog[open]"),begin=dialog.locator('[data-bloom-action="begin"]');await begin.waitFor();
 await expect.poll(()=>finalRequested).toBe(true);await expect(begin).toBeDisabled();
 assert.equal(revealed.size,0);assert.equal(await dialog.locator('[aria-current="step"]').count(),0);
 report.checks.push("Enter remains disabled while the final complete audio range is delayed; private chapters and receipts remain concealed");
 releaseFinal();await expect(begin).toBeEnabled();await expect(dialog).toHaveAttribute("data-bloom-ready","true");
 const saved=await page.evaluate(async({accountId,ids})=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return Promise.all(ids.map(id=>new Promise(resolve=>{const request=db.transaction("entries").objectStore("entries").get(`account:${accountId}:audio:${id}`);request.onsuccess=()=>resolve({id,size:request.result?.blob?.size,sha:request.result?.sha256,requested:request.result?.requested});})));},{accountId:account.id,ids:songs.map(song=>song.id)});
 assert.ok(saved.every(song=>song.size===audio.length&&song.sha===sha256&&song.requested===false));
 assert.equal(await preparationPins(),songs.length,"Verified soundtrack files remain pinned while the story owns them");
 report.checks.push("Both soundtrack files are fully verified and stored before Enter becomes enabled");
 const enterMs=await begin.evaluate(button=>new Promise(resolve=>{const started=performance.now(),dialog=button.closest("dialog"),observer=new MutationObserver(()=>{if(dialog.querySelector('[aria-current="step"]')){observer.disconnect();resolve(performance.now()-started);}});observer.observe(dialog,{subtree:true,attributes:true});button.click();}));
 report.timings.preparedEnterMs=enterMs;await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute("aria-label",`Chapter 1: ${chapters[0].title}`);
 const rangesBefore=report.ranges.length,requestsBefore=preparedRequests;
 await dialog.getByRole("button",{name:"Close Sakura Bloom",exact:true}).click();
 const revisit=page.getByRole("link",{name:"Open this Bloom",exact:false});await revisit.waitFor();
 await context.setOffline(true);
 await expect.poll(preparationPins).toBe(0);
 report.checks.push("Closing the story and suspending speculation releases every preparation pin before offline recovery");
 await revisit.click();await expect(page.locator('dialog[open] [data-bloom-action="begin"]')).toBeEnabled();
 assert.equal(report.ranges.length,rangesBefore);assert.equal(preparedRequests,requestsBefore);
 assert.equal(await preparationPins(),songs.length);
 report.checks.push("After retained capabilities are released, the story reopens offline from saved data and verified full audio without provider requests");
 await page.evaluate(accountId=>window.dispatchEvent(new CustomEvent("sakura-listening-erased",{detail:{accountId,scope:"history"}})),account.id);
 await expect(page.locator("dialog[open]")).toHaveCount(0);await expect.poll(preparationPins).toBe(0);
 const erased=await page.evaluate(async({accountId,id})=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const request=db.transaction("entries").objectStore("entries").get(`account:${accountId}:bloom-prepared:${id}`);request.onsuccess=()=>resolve(request.result===undefined);request.onerror=()=>reject(request.error);});}finally{db.close();}
 },{accountId:account.id,id:skeleton.id});
 assert.equal(erased,true);report.checks.push("Listening erasure closes the ready story, releases its pins and deletes its saved preparation");
 assert.deepEqual(report.errors,[]);await mkdir(".local/bloom-readiness",{recursive:true});await writeFile(".local/bloom-readiness/report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
 await context.close();
}finally{releaseFinal();await browser.close();}
