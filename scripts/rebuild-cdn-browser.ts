/** Actual Chrome playback after immutable CDN preparation; no account writes. */
import "dotenv/config";
import {chromium} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {getRebuildServices} from "../src/rebuild/server/runtime";
import {getRebuildPool} from "../src/rebuild/data/db";
let phase="browser-start";let checkingReference:unknown;
async function main(){
 const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3003";
 if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("CDN playback QA requires isolated localhost ports3002/3003.");
 const browser=await chromium.launch({channel:"chrome",headless:true}),context=await browser.newContext(),page=await context.newPage(),results:Record<string,unknown>[]=[];
 try{phase="browser-document";await page.setContent('<button id="cdn-play-check">Start CDN playback check</button>');
  for(const reference of [{provider:"deezer" as const,id:"136336124"},{provider:"deezer" as const,id:"444333332"},{provider:"deezer" as const,id:"3284976751"},{provider:"spotify" as const,id:"2lEl1iNGpz9r2B7R5BqXSD"}]){
   checkingReference=reference;phase="recording-resolve";
   const resolved=await getRebuildServices().resolver.resolve({reference},randomUUID());if(resolved.status!=="resolved"||resolved.playback.delivery!=="cdn"||!resolved.playback.sha256){console.log(JSON.stringify({reference,status:resolved.status,...("reason" in resolved?{reason:resolved.reason}:{})}));throw new Error("Previously verified immutable CDN audio must resolve as ready");}
   await page.evaluate(url=>{const button=document.getElementById("cdn-play-check")!;button.onclick=()=>{const audio=new Audio();const state={audio,started:performance.now(),playingMs:null as number|null,error:null as string|null};(window as unknown as {__cdnCheck:typeof state}).__cdnCheck=state;audio.preload="metadata";audio.addEventListener("playing",()=>{state.playingMs=Math.round(performance.now()-state.started);},{once:true});audio.src=url;audio.load();void audio.play().catch(error=>{state.error=error.name;});};},resolved.playback.url);
   phase="browser-gesture";await page.locator("#cdn-play-check").click();phase="browser-playing";await page.waitForFunction(()=>{const state=(window as unknown as {__cdnCheck:{audio:HTMLAudioElement;playingMs:number|null}}).__cdnCheck;return state.playingMs!==null&&state.audio.currentTime>.5;},undefined,{timeout:20000});
   const state=await page.evaluate(()=>{const state=(window as unknown as {__cdnCheck:{audio:HTMLAudioElement;playingMs:number;error:string|null}}).__cdnCheck;return{playingMs:state.playingMs,time:state.audio.currentTime,duration:state.audio.duration,readyState:state.audio.readyState,error:state.error};});
   phase="browser-time-advancing";const startTime=state.time;await page.waitForFunction(time=>(window as unknown as {__cdnCheck:{audio:HTMLAudioElement}}).__cdnCheck.audio.currentTime>time+.5,startTime,{timeout:5000});
   const result={reference,recordingId:resolved.recording.recordingId,assetId:resolved.playback.assetId,sha256:resolved.playback.sha256,...state,actualTimeAdvanced:true};results.push(result);console.log(JSON.stringify(result));
   await page.evaluate(()=>{const audio=(window as unknown as {__cdnCheck:{audio:HTMLAudioElement}}).__cdnCheck.audio;audio.pause();audio.removeAttribute("src");audio.load();});
  }
  await writeFile("docs/rebuild/LIVE-CDN-BROWSER-CHECK.json",JSON.stringify({checkedAt:new Date().toISOString(),measurement:"Actual user-gesture Chrome playing event after immutable CDN audio is ready; excludes catalogue resolution and preparation. Fresh browser context with a standalone button, real CDN files, no mocked audio, application dependencies or account writes.",results},null,2)+"\n");
 }catch(error){try{const media=await page.evaluate(()=>{const state=(window as unknown as {__cdnCheck?:{audio:HTMLAudioElement;playingMs:number|null;error:string|null}}).__cdnCheck;return state?{time:state.audio.currentTime,duration:state.audio.duration,paused:state.audio.paused,readyState:state.audio.readyState,networkState:state.audio.networkState,errorCode:state.audio.error?.code??null,playPromiseError:state.error,playingMs:state.playingMs}:null;});console.log(JSON.stringify({phase,reference:checkingReference,media}));}catch{/* Preserve the original browser failure. */}throw error;}finally{await browser.close();await getRebuildPool().end();}
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",phase,reference:checkingReference,errorCategory:error instanceof Error?error.name:"unknown",errorHint:error instanceof Error?error.message.split("\n")[0].replace(/\b[a-z]+:\/\/[^\s'"\)]+/gi,"[address]").slice(0,240):undefined,deadline: error instanceof Error?/Timeout \d+ms/.exec(error.message)?.[0]:undefined}));process.exitCode=1;});
