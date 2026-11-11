/** Built production pages, a real service worker and browser offline mode.
 * The local proxy owns every API call; this never mutates a real account. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import fs from "node:fs/promises";
import {chromium,expect} from "@playwright/test";
import {encode} from "next-auth/jwt";
import {VERIFIED_LYRICS_VERSION} from "../src/rebuild/lyrics/versions.ts";
import "dotenv/config";

const upstream=new URL(process.env.SAKURA_TEST_URL||"http://localhost:3024");
assert.ok(["localhost","127.0.0.1","[::1]"].includes(upstream.hostname),"Use a local production server");
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,"Local authentication signing configuration is required");
const account={id:"90000000-0000-4000-8000-000000000091",username:"Offline garden",email:"pwa-fixture@example.invalid"};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:"authjs.session-token"});
const settings={theme:"light",audioTechnology:"none",audioQuality:"data-saver",privateSession:false,reducedMotion:true,openingAnimation:0,onboarded:true,discovery:.4,volume:.2,shuffle:false,repeat:"off",seedArtists:[],seedGenres:[]};
const rate=8000,samples=rate*90,wav=Buffer.alloc(44+samples*2);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*1000),44+i*2);
const sha256=createHash("sha256").update(wav).digest("hex");
const coverUrl="https://e-cdns-images.dzcdn.net/images/cover/pwa-fixture/500x500-000000-80-0-0.jpg",artworkPath="/api/v2/image?url="+encodeURIComponent(coverUrl),pixel=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEuoAAAAASUVORK5CYII=","base64");
const track={id:"80000000-0000-4000-8000-000000000091",recordingId:"80000000-0000-4000-8000-000000000091",title:"A saved garden",artists:["The Garden Ensemble"],artistsComplete:true,artistId:"42",albumId:"42",albumTitle:"Garden Studies",durationMs:90000,coverUrl,versionLabel:"Original recording",reference:{provider:"deezer",id:"91"},references:[{provider:"deezer",id:"91"}]};
const mixId="90000000-0000-4000-8000-000000000392";
const report={scope:"Real production route components, local synthetic account APIs, verified generated WAV, actual browser offline mode and service-worker storage",checks:[],pageErrors:[],apiRequests:[],blockedWrites:[],listeningReceipts:[],status:"running"};
report.warmedModules={};report.offlineChunkResponses=[];
report.consoleErrors=[];report.failedRequests=[];report.neutralAssets=[];report.downloadsModulePaths=[];
let networkAvailable=true,base,session=null;const flights=new Set();
function json(response,value,status=200){response.writeHead(status,{"Content-Type":"application/json"});response.end(JSON.stringify(value));}
const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,base||upstream),method=request.method||"GET";let path=url.pathname;for(let i=0;i<3;i++){const next=decodeURIComponent(path);if(next===path)break;path=next;}
  if(!networkAvailable){response.destroy();return;}
  if(/^\/api(?:\/|$)/.test(path)){
   report.apiRequests.push({path,method});let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>1024*1024){response.writeHead(413);response.end();return;}chunks.push(chunk);}const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};
   if(path==="/api/v2/profile")return json(response,{profile:account,stats:{},topArtists:[]});
   if(path==="/api/v2/image"){response.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=31536000"});response.end(pixel);return;}
   if(path==="/api/v2/settings"){if(method==="PATCH")Object.assign(settings,body);return json(response,settings);}
   if(path==="/api/v2/listening-session"){if(method==="PUT"){if((session?.revision||0)!==body.revision)return json(response,{accepted:false,session,serverTime:Date.now()});session={state:body.state,revision:body.revision+1,deviceId:body.deviceId,updatedAt:Date.now()};}return json(response,{accepted:true,session,serverTime:Date.now()});}
   if(path==="/api/v2/history"){if(!report.listeningReceipts.some(chunk=>chunk.eventId===body.eventId&&chunk.sequence===body.sequence))report.listeningReceipts.push(body);return json(response,{accepted:true,eventId:body.eventId,sequence:body.sequence});}
   if(path==="/api/v2/mixes/"+mixId)return json(response,{id:mixId,name:"Loading performance mix",recordings:[track],tracks:[track],playability:"ready"});
   if(path==="/api/v2/playlists"&&method==="POST")return json(response,{id:"90000000-0000-4000-8000-000000000393",name:body.name,trackCount:body.recordingIds.length});
   if(path==="/api/v2/library")return json(response,method==="POST"?{...body,accepted:true}:{recordings:url.searchParams.get("kind")==="liked"?[]:[track],playlists:[]});
   if(path==="/api/v2/search")return json(response,{tracks:[track],artists:[{id:"42",name:"The Garden Ensemble"}],albums:[{id:"42",title:"Garden Studies"}],nextCursors:{},totals:{tracks:1,artists:1,albums:1}});
   if(path==="/api/v2/artists/42")return json(response,{name:"The Garden Ensemble",recordings:[track],albums:[{id:"42",title:"Garden Studies"}]});
   if(path==="/api/v2/albums/42")return json(response,{title:"Garden Studies",recordings:[track]});
   if(path==="/api/v2/feed")return json(response,{items:[{track,reason:"Saved for this visit",lane:"familiar"}],sections:[],personalized:true,nextCursor:null,totalCandidates:1,generatedAt:new Date().toISOString()});
   if(path==="/api/v2/lyrics")return json(response,{lines:[{start:0,end:90,text:"Music for the offline hours"}],timing:"synced",provider:"pwa-fixture",providerTrackId:91,schemaVersion:VERIFIED_LYRICS_VERSION});
   if(path==="/api/v2/recordings/"+track.id)return json(response,{recording:track});
   if(path==="/api/v2/collection-view")return json(response,{room:url.searchParams.get("room"),preference:null});
   if(path==="/api/auth/session")return json(response,{user:account});
   return json(response,{accepted:true,items:[],recordings:[],mixes:[],feedback:[],tasteEvidence:[],schedule:{timeZone:"Africa/Lagos"}});
  }
  if(!["GET","HEAD"].includes(method)){report.blockedWrites.push(path);return json(response,{error:"Only local synthetic APIs accept fixture writes"},405);}
  const controller=new AbortController();flights.add(controller);response.on("close",()=>{if(!response.writableEnded)controller.abort();});
  try{
   const headers=new Headers();for(const[name,value]of Object.entries(request.headers))if(value!==undefined&&!["host","connection","content-length","accept-encoding","transfer-encoding"].includes(name))headers.set(name,Array.isArray(value)?value.join(", "):value);headers.set("accept-encoding","identity");
   const result=await fetch(new URL(url.pathname+url.search,upstream),{method,headers,redirect:"manual",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
   const forwarded={};result.headers.forEach((value,name)=>{if(!["content-encoding","content-length","transfer-encoding","connection","set-cookie"].includes(name))forwarded[name]=value;});if(forwarded.location){const redirect=new URL(forwarded.location,upstream);assert.equal(redirect.origin,upstream.origin);forwarded.location=new URL(redirect.pathname+redirect.search,base).href;}
   response.writeHead(result.status,forwarded);const responseBytes=method==="HEAD"?undefined:Buffer.from(await result.arrayBuffer());
   if(path.startsWith("/_next/static/")&&path.endsWith(".js")){const text=responseBytes.toString("utf8");for(const[name,marker]of [["FullPlayer","Room for your music."],["LyricsView","A little closer to the words."],["QueueDialog","Your next songs."]])if(text.includes(marker))report.warmedModules[name]=path;if(text.includes("Your pocket of quiet"))report.downloadsModulePaths.push(path);}
   if(path==="/offline")report.neutralAssets=[...new Set(responseBytes.toString("utf8").match(/\/_next\/static\/[^"\s<>\\]+\.(?:js|css)/g)||[])];
   response.end(responseBytes);
  }finally{flights.delete(controller);}
 }catch(error){if(!response.headersSent)json(response,{error:"Local fixture request failed"},502);else response.destroy(error);}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch({channel:"chrome",headless:true});let context,page;
async function check(name){report.checks.push(name);console.log(name);}
async function goto(path){await page.goto(base+path,{waitUntil:"domcontentloaded",timeout:90000});await expect(page.locator("#music-main")).toBeVisible();}
async function heading(title){await expect(page.locator("#music-main h1").filter({hasText:title}).first()).toBeVisible({timeout:30000});}
async function clickPath(path){await page.locator('a[href="'+path+'"]').filter({visible:true}).first().click();await expect.poll(()=>new URL(page.url()).pathname).toBe(path);}
async function waitWorker(){await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));});await expect.poll(()=>page.evaluate(async()=>{const names=await caches.keys();for(const name of names){if(name.includes("shell-v4")&&await (await caches.open(name)).match("/offline"))return true;}return false;}),{timeout:30000}).toBe(true);}
function observePage(target){target.on("pageerror",error=>report.pageErrors.push(error.message));target.on("console",message=>{if(message.type()==="error")report.consoleErrors.push(message.text().slice(0,1200));});target.on("requestfailed",request=>{const path=new URL(request.url()).pathname;if(path.startsWith("/_next/static/"))report.failedRequests.push({path,error:request.failure()?.errorText});});}
try{
 context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:"allow"});
 await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
 await context.addInitScript(()=>{sessionStorage.setItem("sakura-ink-opening","1");const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.pwaTestAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
 page=await context.newPage();page.setDefaultTimeout(30000);observePage(page);
 await goto("/mix/"+mixId);await heading("Loading performance mix");await waitWorker();
 await expect(page.locator("[data-track-layout]")).toHaveCount(1);
 assert.ok(report.neutralAssets.some(path=>report.downloadsModulePaths.includes(path)),"The neutral offline HTML names its Downloads client module");
 await page.getByRole("button",{name:"Make a playlist from Loading performance mix",exact:true}).click();
 await page.locator("dialog[open]").getByRole("textbox",{name:"Playlist name",exact:true}).fill("A mix worth keeping");
 await page.locator("dialog[open]").getByRole("button",{name:"Create playlist",exact:true}).click();
 await page.locator("dialog[open]").getByRole("button",{name:"Keep listening",exact:true}).click();
 await page.getByRole("button",{name:"Cards layout",exact:true}).click();
 for(let pass=0;pass<3;pass++){
  await page.reload({waitUntil:"domcontentloaded"});await heading("Loading performance mix");
  await expect(page.locator("[data-track-layout]")).toHaveAttribute("data-track-layout","cards");
  await expect(page.getByRole("button",{name:"Play "+track.title,exact:true}).first()).toBeVisible();
 }
 await check("Production mix creation and three cold reloads retain the collection and chosen layout.");

 await page.evaluate(async input=>{
  const bytes=Uint8Array.from(atob(input.base64),char=>char.charCodeAt(0));
  const database=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("entries"))request.result.createObjectStore("entries");};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=database.transaction("entries","readwrite");tx.objectStore("entries").put({track:input.track,blob:new Blob([bytes],{type:"audio/wav"}),sha256:input.sha256,sizeBytes:bytes.length,requested:true,savedAt:Date.now()},"account:"+input.accountId+":audio:"+input.track.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});database.close();
 },{accountId:account.id,track,sha256,base64:wav.toString("base64")});
 await page.reload({waitUntil:"domcontentloaded"});await heading("Loading performance mix");
 await page.getByRole("button",{name:"Play mix",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.pwaTestAudio?.currentTime>1&&!window.pwaTestAudio.paused),{timeout:30000}).toBe(true);
 await expect(page.locator("[data-mini-lyric]")).toContainText("Music for the offline hours");
 await page.getByRole("button",{name:"Pause",exact:true}).first().click();
 await expect.poll(()=>Object.keys(report.warmedModules).sort(),{timeout:45000}).toEqual(["FullPlayer","LyricsView","QueueDialog"]);
 await expect.poll(()=>page.evaluate(async paths=>{
  const names=await caches.keys();const assets=await caches.open(names.find(name=>name.includes("assets")));
  return (await Promise.all(paths.map(async path=>!!await assets.match(new URL(path,location.origin),{ignoreSearch:true})))).every(Boolean);
 },[...new Set([...report.neutralAssets,...Object.values(report.warmedModules)])]),{timeout:15000}).toBe(true);
 await check("Idle warming durably caches FullPlayer, LyricsView and Queue before any modal is opened.");

 const beforeOffline=report.apiRequests.length;networkAvailable=false;await context.setOffline(true);await page.close();
 page=await context.newPage();page.setDefaultTimeout(30000);observePage(page);
 page.on("response",response=>{if(response.url().includes("/_next/static/")&&response.fromServiceWorker())report.offlineChunkResponses.push(new URL(response.url()).pathname);});
 await goto("/library/downloaded");await heading("Your pocket of quiet");
 await expect(page.getByRole("button",{name:"Play "+track.title,exact:true}).first()).toBeVisible();
 await page.getByRole("button",{name:"Play "+track.title,exact:true}).first().click();
 await expect.poll(()=>page.evaluate(()=>window.pwaTestAudio?.currentTime>1&&!window.pwaTestAudio.paused),{timeout:30000}).toBe(true);
 await check("A new offline tab opens an unvisited Downloads URL through the neutral shell and plays verified saved audio.");

 await page.getByRole("button",{name:"Open now playing",exact:true}).click();
 const player=page.getByRole("dialog",{name:"Room for your music.",exact:true});await expect(player).toBeVisible();
 await player.getByRole("button",{name:"Lyrics",exact:true}).click();
 const lyrics=page.getByRole("dialog",{name:"A little closer to the words.",exact:true});await expect(lyrics).toBeVisible();
 await expect(lyrics.getByText("Music for the offline hours",{exact:true})).toBeVisible();
 await page.keyboard.press("Escape");await expect(lyrics).toBeHidden();await expect(player).toBeVisible();
 await player.getByRole("button",{name:"Up next",exact:true}).click();
 const queue=page.getByRole("dialog",{name:"Your next songs.",exact:true});await expect(queue).toBeVisible();
 await expect(queue.getByText(track.title,{exact:true}).first()).toBeVisible();
 await page.keyboard.press("Escape");await expect(queue).toBeHidden();await expect(player).toBeVisible();await page.keyboard.press("Escape");
 await expect(page.locator("dialog[open]")).toHaveCount(0);
 await check("First-use FullPlayer, cached lyrics and Queue open and close entirely offline while playback continues.");
 assert.equal(report.apiRequests.length,beforeOffline,"Offline checks reach no remote APIs");
 assert.ok(report.offlineChunkResponses.length>0,"The real service worker supplies offline JavaScript");
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.blockedWrites,[]);report.status="passed";
}catch(error){report.status="failed";report.error=error.stack||String(error);await fs.mkdir(".local/loading-offline",{recursive:true});if(page&&!page.isClosed()){report.pageState={url:page.url(),text:await page.locator("body").innerText().catch(()=>"unavailable")};await page.screenshot({path:".local/loading-offline/failure.png",fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{await browser.close();for(const flight of flights)flight.abort();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.mkdir(".local/loading-offline",{recursive:true});await fs.writeFile(".local/loading-offline/report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({status:report.status,checks:report.checks,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors,failedRequests:report.failedRequests,error:report.error,pageState:report.pageState}));}
