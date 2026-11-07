/** Real search, canonical likes, audio playback and device artifacts on an isolated dev origin. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {chromium,expect} from "@playwright/test";

const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3002";
if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("This acceptance check is restricted to isolated localhost ports3002/3003.");
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const targets=[
 {name:"finesse-original",query:"Finesse Bruno Mars",provider:"deezer",externalId:"136336124",canonicalId:"978daa16-2cda-4525-b784-9503cd2743fb",duration:191,sha256:"c39fec009224ce6f42fb43fc8f6290d75ff19d0d9cf432348a941785760c29aa",artists:["Bruno Mars"]},
 {name:"finesse-cardi-b-remix",query:"Finesse Bruno Mars",provider:"deezer",externalId:"444333332",canonicalId:"b5314d9d-c917-441a-bb3b-1b4a792c2148",duration:217,sha256:"466a5e9e3d4c7fc414ef40240c83dcd8a473c00973f954c2bb2c2983e8fd774b",artists:["Bruno Mars","Cardi B"]},
 {name:"inertia-sawano-rei",query:"INERTIA Sawano",provider:"deezer",externalId:"3284976751",canonicalId:"a1642bbc-bd43-44ff-972a-f4732dd8d3bc",duration:199,sha256:"ab6be93def6032314b73b743dfa0c07da9885745c555c5c202a802ba2fc69a9f",artists:["SawanoHiroyuki[nZk]","REI"]},
 {name:"ye-burna-boy",query:"Ye Burna Boy",provider:"spotify",externalId:"2lEl1iNGpz9r2B7R5BqXSD",canonicalId:"aaa1b85f-d1bc-495d-8377-02b20b888929",duration:231.618,sha256:"40b45a7f60fa5866e9ca08914722f1d1830377849d73397bf48ceb61acbac62e",artists:["Burna Boy"]},
];
const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await context.addCookies(fixture.cookie.split("; ").map(part=>{const i=part.indexOf("=");return{name:part.slice(0,i),value:part.slice(i+1),url:base};}));
await context.addInitScript(()=>{const AudioBase=window.Audio;window.__recordingEvents=[];window.Audio=function(...args){const audio=new AudioBase(...args);window.__recordingAudio=audio;for(const type of ["playing","loadedmetadata","waiting","error"])audio.addEventListener(type,()=>{window.__recordingEvents.push({type,at:Date.now(),path:new URL(audio.currentSrc||audio.src,location.origin).pathname});});return audio;};window.Audio.prototype=AudioBase.prototype;sessionStorage.setItem("sakura-ink-opening","1");});
const page=await context.newPage();page.setDefaultTimeout(30000);
const report={checkedAt:new Date().toISOString(),origin:base,account:"existing synthetic fixture only",catalogAndMedia:"real providers; no mocked catalog or audio",tracks:[],pageErrors:[],failedApiResponses:[],aliasChecks:[],artistNavigation:[],checks:[]};
page.on("pageerror",error=>report.pageErrors.push(error.message));
page.on("response",response=>{const url=new URL(response.url());if(url.origin===base&&url.pathname.startsWith("/api/v2/")&&response.status()>=400)report.failedApiResponses.push({path:url.pathname,status:response.status()});});
const api=async(path,method="GET",body)=>{
 const response=await context.request.fetch(base+path,{method,headers:{Origin:base,"Content-Type":"application/json"},...(body===undefined?{}:{data:body}),timeout:60000});
 let data;try{data=await response.json();}catch{throw new Error(`${method} ${path} returned ${response.status()} with ${response.headers()["content-type"]||"no content type"}`);}assert.ok(response.ok(),`${method} ${path} returned${response.status()}`);return data;
};
async function audioState(){return page.evaluate(()=>{const a=window.__recordingAudio;if(!a)return null;const url=new URL(a.currentSrc||a.src,location.origin);return{time:a.currentTime,duration:a.duration,paused:a.paused,readyState:a.readyState,errorCode:a.error?.code||null,sourceKind:url.protocol==="blob:"?"offline-blob":url.origin===location.origin?"authenticated-gateway":url.hostname==="res.cloudinary.com"?"immutable-cdn":"external-audio",sourcePath:url.pathname};});}
async function artifacts(){return page.evaluate(async accountId=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open("sakura-ink-v1",1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});const tx=db.transaction("entries","readonly"),store=tx.objectStore("entries");const keys=await new Promise((resolve,reject)=>{const req=store.getAllKeys();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});const values=await new Promise((resolve,reject)=>{const req=store.getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();return keys.flatMap((key,index)=>String(key).startsWith("account:"+accountId+":audio:")?[{id:values[index].track.id,title:values[index].track.title,artists:values[index].track.artists,sha256:values[index].sha256,bytes:values[index].sizeBytes,blobBytes:values[index].blob.size}]:[]);},fixture.accountId);}
async function navigate(path){await page.goto(base+path,{waitUntil:"domcontentloaded",timeout:90000});await page.locator("#music-main h1").filter({visible:true}).first().waitFor({timeout:60000});}
async function creditLinks(scope){return scope.locator("[data-artist-credits] a").filter({visible:true}).evaluateAll(links=>links.map(a=>({name:a.textContent,href:a.getAttribute("href")})));}
let initialLikes=null;
try{
 const profile=await api("/api/v2/profile");assert.equal(profile.profile?.id,fixture.accountId,"Refuse to mutate any account except the synthetic fixture");
 initialLikes=new Set();let cursor=null;do{const liked=await api("/api/v2/library?kind=liked"+(cursor?"&cursor="+encodeURIComponent(cursor):""));for(const t of liked.recordings||[])initialLikes.add(t.id||t.recordingId);cursor=liked.nextCursor||null;}while(cursor);
 for(const target of targets)await api("/api/v2/library","POST",{recordingId:target.canonicalId,liked:false});
 for(const target of targets){
  const result={target:target.name,reference:{provider:target.provider,id:target.externalId},canonicalId:target.canonicalId,checks:[]};
  report.tracks.push(result);
  try{
   await navigate("/search?q="+encodeURIComponent(target.query));
   const external=target.provider+":"+target.externalId;
   let row=page.locator(`[data-song-id="${external}"]`);
   await row.waitFor({timeout:60000});
   result.searchCredits=await creditLinks(row);
   const mutation=page.waitForResponse(response=>response.url().endsWith("/api/v2/library")&&response.request().method()==="POST",{timeout:65000});
   await row.getByRole("button",{name:/^Like /}).click();
   const likedResponse=await mutation;assert.equal(likedResponse.status(),200);
   assert.equal(likedResponse.request().postDataJSON().recordingId,target.canonicalId);
   row=page.locator(`[data-song-id="${target.canonicalId}"]`);await row.getByRole("button",{name:/^Unlike /}).waitFor();
   result.checks.push("live search like writes expected canonical UUID");
   await row.locator(`a[href="/track/${target.canonicalId}"]`).click();
   await page.getByRole("button",{name:"Play song",exact:true}).waitFor({timeout:60000});
   result.detailCredits=await creditLinks(page.locator("#music-main"));
   assert.deepEqual(result.detailCredits.map(credit=>credit.name.toLowerCase()),target.artists.map(name=>name.toLowerCase()));
   assert.equal(new Set(result.detailCredits.map(credit=>credit.href)).size,target.artists.length);
   result.checks.push("canonical detail retains individual credited artist links");
   const resolutions=[];const playStarted=Date.now();
   const observeResolution=response=>{if(response.url().endsWith("/api/v2/recordings/resolve")&&response.request().method()==="POST")resolutions.push({response,elapsedMs:Date.now()-playStarted});};
   page.on("response",observeResolution);
   await page.getByRole("button",{name:"Play song",exact:true}).click();
   try{await page.waitForFunction(()=>window.__recordingAudio&&!window.__recordingAudio.paused&&window.__recordingAudio.currentTime>1,undefined,{timeout:60000});}finally{page.off("response",observeResolution);}
   for(const {response,elapsedMs} of resolutions){const resolvedData=await response.json();assert.ok([200,202].includes(response.status()));assert.ok(["resolved","pending"].includes(resolvedData.status));assert.equal(resolvedData.recording.recordingId,target.canonicalId);result.resolveResponseMs=elapsedMs;}
   result.resolveRequestCount=resolutions.length;
   result.playback=await audioState();result.startToOneSecondMs=Date.now()-playStarted;
   const playingEvent=await page.evaluate(start=>(window.__recordingEvents||[]).find(event=>event.type==="playing"&&event.at>=start),playStarted);assert.ok(playingEvent,"Actual browser playing event must confirm playback");result.playingEventMs=playingEvent.at-playStarted;
   assert.ok(Math.abs(result.playback.duration-target.duration)<1);assert.notEqual(result.playback.sourceKind,"offline-blob");
   if(!resolutions.length){assert.equal(result.playback.sourceKind,"immutable-cdn");assert.ok(result.playback.sourcePath.includes(`/sakura/v2/audio/${target.canonicalId}/${target.sha256}.`));result.checks.push("verified ready card begins exact CDN playback without resolver roundtrip");}
   const startTime=result.playback.time;await page.waitForFunction(time=>window.__recordingAudio.currentTime>time+1,startTime,{timeout:10000});
   result.playbackTimeAdvancedTo=(await audioState()).time;result.playerCredits=await creditLinks(page.locator("footer").filter({has:page.getByRole("button",{name:"Open now playing",exact:true})}));
   assert.deepEqual(result.playerCredits.map(credit=>credit.name.toLowerCase()),target.artists.map(name=>name.toLowerCase()));
   result.checks.push("actual full browser audio plays and time advances with exact canonical credits");
   const saveStarted=Date.now();await page.getByRole("button",{name:"Save on this device",exact:true}).click();
   await expect.poll(async()=> (await artifacts()).filter(item=>item.id===target.canonicalId&&item.bytes===item.blobBytes).length,{timeout:120000,intervals:[500,1000,2000],message:"Complete canonical audio artifact must be committed before checking its checksum"}).toBe(1);
   const saved=(await artifacts()).filter(item=>item.id===target.canonicalId);assert.equal(saved.length,1);assert.equal(saved[0].sha256,target.sha256);assert.equal(saved[0].bytes,saved[0].blobBytes);result.artifact=saved[0];result.saveCompleteMs=Date.now()-saveStarted;
   result.checks.push("browser saves complete exact SHA256 file once under canonical UUID");
   await page.getByRole("button",{name:"Pause",exact:true}).filter({visible:true}).first().click();
   await navigate("/track/"+encodeURIComponent(external));await page.getByRole("button",{name:"Save on this device",exact:true}).click();
   await page.getByText("This recording is already saved on your device.",{exact:true}).waitFor();
   assert.equal((await artifacts()).filter(item=>item.id===target.canonicalId).length,1);
   report.aliasChecks.push({target:target.name,providerCard:external,canonicalCard:target.canonicalId,artifactCount:1});
   result.checks.push("provider-reference route reuses canonical download without creating another entry");
   result.status="passed";
  }catch(error){result.status="failed";result.failure=error.message;result.failureAudio=await audioState().catch(()=>null);result.failureEvents=await page.evaluate(()=>(window.__recordingEvents||[]).slice(-8)).catch(()=>[]);await page.screenshot({path:`.local/rebuild-recording-${target.name}-failure.png`}).catch(()=>{});}
  await fs.writeFile(".local/rebuild-recording-browser-report.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify({target:target.name,status:result.status,checks:result.checks,...(result.failure?{failure:result.failure}:{})}));
 }
 await navigate("/library/downloaded");const saved=await artifacts();assert.equal(saved.length,4);assert.equal(new Set(saved.map(t=>t.id)).size,4);
 const rows=await page.locator("[data-song-id]").filter({visible:true}).count();assert.equal(rows,4);report.checks.push("four distinct recordings display as exactly four device download rows");
 await page.locator(`[data-song-id="${targets[0].canonicalId}"]`).getByRole("button",{name:"Play Finesse",exact:true}).click();
 await page.waitForFunction(()=>window.__recordingAudio?.src.startsWith("blob:")&&window.__recordingAudio.currentTime>.5,undefined,{timeout:15000});
 assert.equal(await page.locator("[data-song-id]").filter({visible:true}).evaluateAll(elements=>elements.filter(e=>e.className.includes("playingRow")).length),1);report.checks.push("only one distinct download row shows the playing state");
 await context.setOffline(true);const time=(await audioState()).time;await page.waitForFunction(start=>window.__recordingAudio.currentTime>start+1,time,{timeout:10000});await context.setOffline(false);report.checks.push("verified device blob advances with network disabled");
 // Individual collaboration links must navigate to the named artist's actual page.
 for(const target of targets.filter(t=>t.artists.length>1)){
  await navigate("/track/"+target.canonicalId);
  const credit=page.locator("#music-main [data-artist-credits] a").filter({hasText:target.artists[1],visible:true});
  await credit.click();await page.waitForURL(/\/artist\//,{timeout:20000});await page.locator("#music-main h1").filter({visible:true}).first().waitFor({timeout:60000});
  const title=await page.locator("#music-main h1").filter({visible:true}).first().textContent();assert.equal(title?.toLowerCase(),target.artists[1].toLowerCase());
  report.artistNavigation.push({from:target.name,artist:target.artists[1],path:new URL(page.url()).pathname,title});
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.failedApiResponses,[]);assert.ok(report.tracks.every(t=>t.status==="passed"));report.status="passed";
}catch(error){report.status="failed";report.failure=error.message;process.exitCode=1;}
finally{
 await context.setOffline(false).catch(()=>{});
 if(initialLikes)for(const target of targets)await api("/api/v2/library","POST",{recordingId:target.canonicalId,liked:initialLikes.has(target.canonicalId)}).catch(()=>{});
 await fs.writeFile(".local/rebuild-recording-browser-report.json",JSON.stringify(report,null,2));
 await browser.close();console.log(JSON.stringify({status:report.status,tracks:report.tracks.map(t=>({target:t.target,status:t.status,checks:t.checks.length})),checks:report.checks,artistNavigation:report.artistNavigation,...(report.failure?{failure:report.failure}:{})}));
}
