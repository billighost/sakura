/** Built production pages, a real service worker and browser offline mode.
 * The local proxy owns every API call; this never mutates a real account. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import fs from "node:fs/promises";
import {chromium,expect as baseExpect} from "@playwright/test";
import {encode} from "next-auth/jwt";
import "dotenv/config";
const expect=baseExpect.configure({timeout:30000});

const upstream=new URL(process.env.SAKURA_TEST_URL||"http://localhost:3024");
assert.ok(["localhost","127.0.0.1","[::1]"].includes(upstream.hostname),"Use a local production server");
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,"Local authentication signing configuration is required");
const account={id:"90000000-0000-4000-8000-000000000091",username:"Offline garden",email:"pwa-fixture@example.invalid"};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:"authjs.session-token"});
const settings={theme:"light",audioTechnology:"none",audioQuality:"data-saver",privateSession:false,reducedMotion:true,openingAnimation:0,onboarded:true,discovery:.4,volume:.2,shuffle:false,repeat:"off",seedArtists:[],seedGenres:[]};
let settingsRevision=0;const settingsFieldRevisions=Object.fromEntries(Object.keys(settings).map(key=>[key,0]));
const rate=8000,samples=rate*90,wav=Buffer.alloc(44+samples*2);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*1000),44+i*2);
const sha256=createHash("sha256").update(wav).digest("hex");
const coverUrl="https://e-cdns-images.dzcdn.net/images/cover/pwa-fixture/500x500-000000-80-0-0.jpg",artworkPath="/api/v2/image?url="+encodeURIComponent(coverUrl),pixel=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEuoAAAAASUVORK5CYII=","base64");
const track={id:"80000000-0000-4000-8000-000000000091",recordingId:"80000000-0000-4000-8000-000000000091",title:"A saved garden",artists:["The Garden Ensemble"],artistsComplete:true,artistId:"42",albumId:"42",albumTitle:"Garden Studies",durationMs:90000,coverUrl,versionLabel:"Original recording",reference:{provider:"deezer",id:"91"},references:[{provider:"deezer",id:"91"}]};
const report={scope:"Real production route components, local synthetic account APIs, verified generated WAV, actual browser offline mode and service-worker storage",checks:[],pageErrors:[],apiRequests:[],blockedWrites:[],listeningReceipts:[],status:"running"};
let networkAvailable=true,base,session=null,holdBootProfile=false;const flights=new Set(),heldProfiles=new Set();
function json(response,value,status=200){response.writeHead(status,{"Content-Type":"application/json"});response.end(JSON.stringify(value));}
const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,base||upstream),method=request.method||"GET";let path=url.pathname;for(let i=0;i<3;i++){const next=decodeURIComponent(path);if(next===path)break;path=next;}
  if(!networkAvailable){response.destroy();return;}
  if(/^\/api(?:\/|$)/.test(path)){
   report.apiRequests.push({path,method});let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>1024*1024){response.writeHead(413);response.end();return;}chunks.push(chunk);}const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};
   if(path==="/api/v2/profile"){if(holdBootProfile){heldProfiles.add(response);response.on("close",()=>heldProfiles.delete(response));return;}return json(response,{profile:account,stats:{},topArtists:[]});}
   if(path==="/api/v2/image"){response.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=31536000"});response.end(pixel);return;}
   if(path==="/api/v2/settings"){
    if(method==="PATCH"){
     const {expectedRevision,...patch}=body;
     if(expectedRevision!==undefined&&expectedRevision!==settingsRevision)return json(response,{error:"Your settings changed on another device."},409);
     Object.assign(settings,patch);settingsRevision++;for(const key of Object.keys(patch))settingsFieldRevisions[key]=settingsRevision;
    }
    return json(response,{...settings,revision:settingsRevision,fieldRevisions:settingsFieldRevisions});
   }
   if(path==="/api/v2/listening-session"){if(method==="PUT"){if((session?.revision||0)!==body.revision)return json(response,{accepted:false,session,serverTime:Date.now()});session={state:body.state,revision:body.revision+1,deviceId:body.deviceId,updatedAt:Date.now()};}return json(response,{accepted:true,session,serverTime:Date.now()});}
   if(path==="/api/v2/history"){if(!report.listeningReceipts.some(chunk=>chunk.eventId===body.eventId&&chunk.sequence===body.sequence))report.listeningReceipts.push(body);return json(response,{accepted:true,eventId:body.eventId,sequence:body.sequence});}
   if(path==="/api/v2/library")return json(response,method==="POST"?{...body,accepted:true}:{recordings:url.searchParams.get("kind")==="liked"?[]:[track],playlists:[]});
   if(path==="/api/v2/search")return json(response,{tracks:[track],artists:[{id:"42",name:"The Garden Ensemble"}],albums:[{id:"42",title:"Garden Studies"}],nextCursors:{},totals:{tracks:1,artists:1,albums:1}});
   if(path==="/api/v2/artists/42")return json(response,{name:"The Garden Ensemble",recordings:[track],albums:[{id:"42",title:"Garden Studies"}]});
   if(path==="/api/v2/albums/42")return json(response,{title:"Garden Studies",recordings:[track]});
   if(path==="/api/v2/feed")return json(response,{items:[{track,reason:"Saved for this visit",lane:"familiar"}],sections:[],personalized:true,nextCursor:null,totalCandidates:1,generatedAt:new Date().toISOString()});
   if(path==="/api/v2/lyrics")return json(response,{lines:[{start:0,end:90,text:"Music for the offline hours"}],timing:"synced",provider:"pwa-fixture",providerTrackId:"91",schemaVersion:"pwa-fixture"});
   if(path==="/api/v2/recordings/"+track.id)return json(response,{recording:track});
   if(path==="/api/v2/collection-view")return json(response,{room:url.searchParams.get("room"),preference:null});
   if(path==="/api/auth/session")return json(response,{user:account});
   return json(response,{accepted:true,items:[],recordings:[],mixes:[],feedback:[],tasteEvidence:[],schedule:{timeZone:"Africa/Lagos"}});
  }
  if(!["GET","HEAD"].includes(method)){report.blockedWrites.push(path);return json(response,{error:"Only local synthetic APIs accept fixture writes"},405);}
  if(holdBootProfile&&path==="/library/downloaded"&&request.headers.rsc){response.destroy();return;}
  const controller=new AbortController();flights.add(controller);response.on("close",()=>{if(!response.writableEnded)controller.abort();});
  try{
   const headers=new Headers();for(const[name,value]of Object.entries(request.headers))if(value!==undefined&&!["host","connection","content-length","accept-encoding","transfer-encoding"].includes(name))headers.set(name,Array.isArray(value)?value.join(", "):value);headers.set("accept-encoding","identity");
   const result=await fetch(new URL(url.pathname+url.search,upstream),{method,headers,redirect:"manual",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
   const forwarded={};result.headers.forEach((value,name)=>{if(!["content-encoding","content-length","transfer-encoding","connection","set-cookie"].includes(name))forwarded[name]=value;});if(forwarded.location){const redirect=new URL(forwarded.location,upstream);assert.equal(redirect.origin,upstream.origin);forwarded.location=new URL(redirect.pathname+redirect.search,base).href;}
   response.writeHead(result.status,forwarded);response.end(method==="HEAD"?undefined:Buffer.from(await result.arrayBuffer()));
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
try{
 context=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true,serviceWorkers:"allow"});await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
 await context.addInitScript(()=>{try{sessionStorage.setItem("sakura-ink-opening","1");}catch{}const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.pwaTestAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
 page=await context.newPage();page.on("pageerror",error=>report.pageErrors.push(error.message));page.setDefaultTimeout(30000);
 await goto("/home");await waitWorker();await page.evaluate(async path=>{await Promise.all(Array.from({length:12},()=>fetch(path).then(response=>response.arrayBuffer())));},artworkPath);
 await page.evaluate(async input=>{const bytes=Uint8Array.from(atob(input.base64),char=>char.charCodeAt(0));const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("entries"))request.result.createObjectStore("entries");};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({track:input.track,blob:new Blob([bytes],{type:"audio/wav"}),sha256:input.sha256,sizeBytes:bytes.length,requested:true,savedAt:Date.now()},"account:"+input.accountId+":audio:"+input.track.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},{accountId:account.id,track,sha256,base64:wav.toString("base64")});
 for(const [path,title]of [["/library","Your little music world"],["/discover",null],["/search?q=garden","What’s on your mind"],["/artist/42","The Garden Ensemble"],["/album/42","Garden Studies"]]){await goto(path);if(title)await heading(title);else await expect(page.locator("#music-main h1").first()).toBeVisible();await expect(page.getByRole("button",{name:"Play "+track.title,exact:true}).first()).toBeVisible();}
 for(const [path,title]of [["/about","Music, with room to breathe."],["/privacy","Your music. Your space."],["/terms","A little care for the music."]]){
  await page.goto(base+path,{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(async path=>{for(const name of await caches.keys()){if(name.includes("shell-v4")&&await (await caches.open(name)).match(path))return true;}return false;},path),{timeout:30000}).toBe(true);
 }
 await goto("/home");await expect(page.locator("#music-main h1").first()).toBeVisible();await waitWorker();
 networkAvailable=false;await context.setOffline(true);await page.reload({waitUntil:"domcontentloaded"});await expect(page.locator("#music-main h1").first()).toBeVisible();await expect(page.getByRole("button",{name:"Play "+track.title,exact:true}).first()).toBeVisible();assert.equal(await page.evaluate(async path=>(await (await fetch(path)).arrayBuffer()).byteLength,artworkPath),pixel.length);await check("Cold offline Home reopens with its saved feed, account data and artwork bytes");
 await clickPath("/library/downloaded");await heading("Your pocket of quiet");await page.getByRole("button",{name:"Play "+track.title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.pwaTestAudio?.currentTime>1&&!window.pwaTestAudio.paused)).toBe(true);const before=await page.evaluate(()=>window.pwaTestAudio.currentTime);await check("A regular Downloads click works offline and plays the verified saved song");
 await clickPath("/artist/42");await heading("The Garden Ensemble");await clickPath("/album/42");await heading("Garden Studies");assert.ok(await page.evaluate(()=>window.pwaTestAudio.currentTime)>before);await check("Offline artist and album clicks reuse saved pages while playback continues");
 await page.evaluate(()=>history.back());await expect.poll(()=>new URL(page.url()).pathname).toBe("/artist/42");await heading("The Garden Ensemble");await page.evaluate(()=>history.forward());await expect.poll(()=>new URL(page.url()).pathname).toBe("/album/42");await heading("Garden Studies");await check("Back and Forward keep offline URL, page content and player state aligned");
 const albumHistory=await page.evaluate(()=>history.length);await page.getByRole("button",{name:"Open now playing",exact:true}).click();
 const fullPlayer=page.getByRole("dialog",{name:"Room for your music."});await expect(fullPlayer).toBeVisible();await fullPlayer.locator("[data-album-link]").click();await expect(fullPlayer).not.toBeVisible();
 assert.equal(new URL(page.url()).pathname,"/album/42");assert.equal(await page.evaluate(()=>history.length),albumHistory);await check("Offline same-album links run the modal close handler without adding duplicate history");
 await page.getByRole("button",{name:"Find music",exact:true}).click();await heading("What’s on your mind");await page.getByRole("searchbox",{name:"Search music",exact:true}).fill("garden");await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("garden");await expect(page.locator("#music-main").getByRole("link",{name:track.title,exact:true})).toBeVisible();await page.getByRole("button",{name:"Artists",exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get("tab")).toBe("Artists");await expect(page.locator("#music-main").getByRole("heading",{name:"The Garden Ensemble",exact:true})).toBeVisible();await check("Offline header Search, cached queries and artist tabs update without an RSC request");
 const artistCard=page.locator('[data-collection-id="artist:42"]').filter({visible:true}).first(),artistLink=artistCard.locator('a[href="/artist/42"]').first();
 await artistLink.scrollIntoViewIfNeeded();const touchBox=await artistLink.boundingBox();assert.ok(touchBox);const touch=await context.newCDPSession(page);
 await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:touchBox.x+touchBox.width/2,y:touchBox.y+touchBox.height/2}]});
 const artistMenu=page.getByRole("menu",{name:"The Garden Ensemble",exact:true});await expect(artistMenu).toBeVisible();await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await touch.detach();
 assert.equal(new URL(page.url()).pathname,"/search");await expect(artistMenu).toBeVisible();await page.keyboard.press("Escape");await expect(artistMenu).not.toBeVisible();await check("A real touch long press and release keeps the offline collection menu open without navigating");
 const artistRequests=report.apiRequests.filter(request=>request.path==="/api/v2/artists/42").length;
 for(let attempt=0;attempt<2;attempt++){await artistCard.getByRole("button",{name:"More options for The Garden Ensemble",exact:true}).click();await artistMenu.getByRole("menuitem",{name:"Add songs to queue",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"1 songs added to your queue."})).toBeVisible();}
 assert.equal(report.apiRequests.filter(request=>request.path==="/api/v2/artists/42").length,artistRequests);await check("Repeated offline collection actions reuse saved tracks and perform no collection API fetch");
 await page.close();page=await context.newPage();page.on("pageerror",error=>report.pageErrors.push(error.message));await goto("/album/42");await heading("Garden Studies");assert.equal(new URL(page.url()).pathname,"/album/42");await expect(page.getByRole("button",{name:"Open now playing",exact:true})).toContainText(track.title);await goto("/artist/42");await heading("The Garden Ensemble");await goto("/discover");await expect(page.locator("#music-main").getByText(track.title,{exact:true}).first()).toBeVisible();await goto("/search?q=garden&tab=Artists");await heading("What’s on your mind");await expect(page.locator("#music-main").getByRole("heading",{name:"The Garden Ensemble",exact:true})).toBeVisible();await check("New offline tabs restore playback state, album, artist, Discover and queried Search without redirects");
 const offlineNotice=page.getByRole("alert").filter({hasText:"Your saved music is ready on this device."});await expect(offlineNotice).toBeVisible();await offlineNotice.getByRole("button",{name:"Dismiss notice",exact:true}).click();await expect(offlineNotice).not.toBeVisible();
 await page.locator('a[href="/about"]').filter({visible:true}).first().click();await expect(page.getByRole("heading",{name:"Music, with room to breathe.",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Privacy",exact:true}).click();await expect(page.getByRole("heading",{name:"Your music. Your space.",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Terms",exact:true}).click();await expect(page.getByRole("heading",{name:"A little care for the music.",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Back to music",exact:true}).click();await expect(page.locator("#music-main h1").first()).toBeVisible();await check("Visited About, Privacy and Terms links work offline and return to the saved music app");
 networkAvailable=true;await context.setOffline(false);await clickPath("/library");await heading("Your little music world");await expect.poll(()=>page.locator('[class*="offlineBanner"]').count()).toBe(0);await expect.poll(()=>report.listeningReceipts.length).toBeGreaterThan(0);assert.ok(report.listeningReceipts.some(chunk=>chunk.msPlayed>0));await check("Reconnection uploads buffered listening with matching receipts and resumes regular browsing");
 holdBootProfile=true;await page.goto(base+"/home",{waitUntil:"domcontentloaded"});await expect.poll(()=>heldProfiles.size).toBeGreaterThan(0);await expect(page.getByText("Loading your music…",{exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Downloads",exact:true}).filter({visible:true}).first().click();networkAvailable=false;await context.setOffline(true);holdBootProfile=false;for(const response of heldProfiles)response.destroy();
 await expect.poll(()=>new URL(page.url()).pathname).toBe("/library/downloaded");await heading("Your pocket of quiet");await check("Downloads remains navigable during stalled account startup and restores from the saved device after a connectivity drop");
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.blockedWrites,[]);report.status="passed";
}catch(error){report.status="failed";report.error=error.stack||String(error);await fs.mkdir(".local",{recursive:true});if(page&&!page.isClosed())await page.screenshot({path:".local/pwa-offline-browser-failure.png",fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();for(const flight of flights)flight.abort();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.mkdir(".local",{recursive:true});await fs.writeFile(".local/pwa-offline-browser-report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({status:report.status,checks:report.checks,pageErrors:report.pageErrors}));}
