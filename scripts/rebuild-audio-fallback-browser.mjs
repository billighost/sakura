/** Inject only a failed direct connection; actual fallback audio remains live and verified. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {chromium,expect} from "@playwright/test";

const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3003";
if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("Fallback QA requires isolated localhost ports3002/3003.");
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const stall=process.env.SAKURA_TEST_FAULT==="stall";const held=new Map();
const recordingId="978daa16-2cda-4525-b784-9503cd2743fb",assetId="55cffcf1-c8e6-5d52-8454-99834d231981",sha256="c39fec009224ce6f42fb43fc8f6290d75ff19d0d9cf432348a941785760c29aa";
const browser=await chromium.launch({channel:"chrome",headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await context.addCookies(fixture.cookie.split("; ").map(part=>{const i=part.indexOf("=");return{name:part.slice(0,i),value:part.slice(i+1),url:base};}));
await context.addInitScript(()=>{const AudioBase=window.Audio;window.__fallbackEvents=[];window.Audio=function(...args){const audio=new AudioBase(...args);window.__fallbackAudio=audio;audio.addEventListener("playing",()=>window.__fallbackEvents.push({at:Date.now(),path:new URL(audio.currentSrc||audio.src,location.origin).pathname}));return audio;};window.Audio.prototype=AudioBase.prototype;sessionStorage.setItem("sakura-ink-opening","1");});
const report={checkedAt:new Date().toISOString(),origin:base,account:"existing synthetic fixture only",recordingId,assetId,fault:stall?"Browser direct CDN connection held for45s; authenticated gateway serves real upstream bytes":"Browser direct CDN connection aborted; authenticated gateway serves real upstream bytes",deniedDirectRequests:0,gatewayResponses:[],pageErrors:[],checks:[]};
await context.route(url=>url.hostname==="res.cloudinary.com"&&url.pathname.includes(`/sakura/v2/audio/${recordingId}/${sha256}.`),async route=>{report.deniedDirectRequests++;if(stall)await new Promise(resolve=>{const timer=setTimeout(()=>{held.delete(timer);resolve();},45000);held.set(timer,resolve);});await route.abort("connectionfailed").catch(()=>{});});
const page=await context.newPage();
page.on("pageerror",error=>report.pageErrors.push(error.message));
page.on("response",response=>{const url=new URL(response.url());if(url.origin===base&&url.pathname===`/api/v2/recordings/${recordingId}/audio`)report.gatewayResponses.push({status:response.status(),assetId:url.searchParams.get("assetId")});});
try{
 const profileResponse=await context.request.get(base+"/api/v2/profile");assert.equal(profileResponse.status(),200);const profile=await profileResponse.json();assert.equal(profile.profile.id,fixture.accountId,"Refuse playback or device writes for any personal account");
 await page.goto(base+"/track/"+recordingId,{waitUntil:"domcontentloaded",timeout:90000});
 const started=Date.now();await page.getByRole("button",{name:"Play song",exact:true}).click();
 await page.waitForFunction(()=>window.__fallbackAudio&&!window.__fallbackAudio.paused&&window.__fallbackAudio.currentTime>1,undefined,{timeout:60000});
 report.playback=await page.evaluate(()=>{const audio=window.__fallbackAudio,url=new URL(audio.currentSrc||audio.src,location.origin);return{time:audio.currentTime,duration:audio.duration,readyState:audio.readyState,error:audio.error?.code||null,origin:url.origin,path:url.pathname,assetId:url.searchParams.get("assetId"),playingEvent:window.__fallbackEvents.at(-1)};});
 assert.equal(report.playback.origin,base);assert.equal(report.playback.path,`/api/v2/recordings/${recordingId}/audio`);assert.equal(report.playback.assetId,assetId);assert.ok(Math.abs(report.playback.duration-191)<.1);assert.equal(report.playback.error,null);assert.ok(report.playback.playingEvent);report.playingMs=report.playback.playingEvent.at-started;if(stall)assert.ok(report.playingMs<30000,"A silent45s connection must recover before a browser network error occurs");
 const time=report.playback.time;await page.waitForFunction(start=>window.__fallbackAudio.currentTime>start+1,time,{timeout:10000});report.checks.push("failed direct playback retries the same CDN asset through authenticated gateway; real media plays and advances");
 await page.getByRole("button",{name:"Save on this device",exact:true}).click();
 async function saved(){return page.evaluate(async({accountId,recordingId})=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("sakura-ink-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const value=await new Promise((resolve,reject)=>{const request=db.transaction("entries","readonly").objectStore("entries").get(`account:${accountId}:audio:${recordingId}`);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return value?{id:value.track.id,sha256:value.sha256,sizeBytes:value.sizeBytes,blobBytes:value.blob.size}:null;},{accountId:fixture.accountId,recordingId});}
 await expect.poll(saved,{timeout:90000,intervals:[500,1000,2000]}).not.toBeNull();report.artifact=await saved();assert.equal(report.artifact.id,recordingId);assert.equal(report.artifact.sha256,sha256);assert.equal(report.artifact.sizeBytes,7802010);assert.equal(report.artifact.blobBytes,7802010);report.checks.push("failed direct saving retries same-asset gateway and commits full source SHA-256");
 assert.ok(report.deniedDirectRequests>=2);assert.ok(report.gatewayResponses.length>=2);assert.ok(report.gatewayResponses.every(response=>[200,206].includes(response.status)&&response.assetId===assetId));assert.deepEqual(report.pageErrors,[]);report.status="passed";
}catch(error){report.status="failed";report.failure=error.message;process.exitCode=1;await page.screenshot({path:".local/rebuild-audio-fallback-failure.png"}).catch(()=>{});}
finally{for(const [timer,release]of held){clearTimeout(timer);release();}held.clear();await fs.writeFile(stall?".local/rebuild-audio-stall-browser-report.json":".local/rebuild-audio-fallback-browser-report.json",JSON.stringify(report,null,2)+"\n");await browser.close();console.log(JSON.stringify(report));}
