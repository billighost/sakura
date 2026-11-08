import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import test from "node:test";
import ts from "typescript";
import type {MusicState} from "../src/rebuild/app/MusicContext";
import type {MusicTrack} from "../src/rebuild/app/types";
import {readyPlaybackFor} from "../src/rebuild/app/playbackSource";

const accountId="90000000-0000-4000-8000-000000000001";
const code=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/MusicContext.tsx",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let attempt=0;attempt<30;attempt++){if(check())return;await tick();}assert.fail("The player did not reach the expected state.");}
function song(index=1):MusicTrack{
 const id="80000000-0000-4000-8000-"+String(index).padStart(12,"0"),assetId="81000000-0000-4000-8000-"+String(index).padStart(12,"0"),sha256="a".repeat(64);
 return {id,title:"Generated test song "+index,artists:["Local fixture"],artistsComplete:true,artistId:null,albumId:null,albumTitle:null,coverUrl:null,versionLabel:"Original recording",durationMs:180000,reference:{provider:"deezer",id:String(index)},references:[{provider:"deezer",id:String(index)}],readyPlayback:{kind:"stream",delivery:"cdn",assetId,sha256,sizeBytes:900000,mimeType:"audio/mpeg",durationMs:180000,url:`https://res.cloudinary.com/sakura/video/upload/v123/sakura/v2/audio/${id}/${sha256}.mp3`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
}

/** Runs the real provider with deterministic media, storage and React host adapters. */
async function player(options:{rejectPlay?:boolean;deferRegistration?:boolean;failFallbackBeforeMetadata?:boolean}={}){
 const effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[],states:unknown[]=[],requests:string[]=[],saved=new Map<string,unknown>();
 let media:FixtureAudio|undefined,register:((url:string|undefined)=>void)|undefined,revocations=0;
 const prepares:string[]=[],enqueues:Array<{id:string;requested:boolean}>=[];
 const entries:Record<string,{recordingId:string;requested:boolean;status:string;track:MusicTrack}>={};
 function captureMedia(audio:FixtureAudio){media=audio;}
 class FixtureAudio {
  src="";preload="";volume=.8;paused=true;currentTime=0;duration=Number.NaN;
  listeners=new Map<string,Set<()=>void>>();
  constructor(){captureMedia(this);}
  addEventListener(name:string,listener:()=>void){const group=this.listeners.get(name)||new Set();group.add(listener);this.listeners.set(name,group);}
  removeEventListener(name:string,listener:()=>void){this.listeners.get(name)?.delete(listener);}
  emit(name:string){for(const listener of this.listeners.get(name)||[])listener();}
  pause(){this.paused=true;}
  removeAttribute(name:string){if(name==="src")this.src="";}
  load(){this.currentTime=0;this.duration=Number.NaN;if(!this.src||options.failFallbackBeforeMetadata&&this.src.includes("/api/v2/recordings/"))return;queueMicrotask(()=>{this.duration=180;this.emit("loadedmetadata");});}
  async play(){if(options.rejectPlay||options.failFallbackBeforeMetadata&&this.src.includes("/api/v2/recordings/"))throw new Error("The generated media source cannot start.");this.paused=false;this.emit("playing");}
 }
 class Manager {
  constructor(private options:{onChange:(value:unknown)=>void}){}
  async hydrate(){this.options.onChange({...entries});}
  setPriorities(){}
  enqueue(track:MusicTrack,{requested}:{requested:boolean}){enqueues.push({id:track.id,requested});entries[track.id]={recordingId:track.id,requested:entries[track.id]?.requested||requested,status:"downloading",track};this.options.onChange({...entries});return Promise.resolve();}
  async prepare(id:string){if(!entries[id]?.requested){prepares.push(id);if(entries[id])entries[id].status="prepared";this.options.onChange({...entries});}}
  ensureChunk(){return Promise.resolve();}
  dispose(){}
 }
 const noop=()=>{},asyncNoop=async()=>{},exports:Record<string,unknown>={};
 const react={createContext:()=>({Provider:noop}),useState(initial:unknown){const slot=states.length;states.push(initial);return [initial,(value:unknown)=>{states[slot]=typeof value==="function"?(value as (previous:unknown)=>unknown)(states[slot]):value;}];},useRef:(current:unknown)=>({current}),useEffect:(effect:()=>void|(()=>void))=>effects.push(effect)};
 const modules:Record<string,unknown>={
  react,"react/jsx-runtime":{jsx:(_type:unknown,props:unknown)=>props},"next-auth/react":{signOut:asyncNoop},
  "./types":{musicTrack:(value:unknown)=>value},
  "./errors":{requestJson:async(path:string)=>{requests.push(path);if(path==="/api/v2/profile")return {profile:{id:accountId}};if(path==="/api/v2/library?kind=liked")return {recordings:[]};if(path==="/api/v2/settings")return {settings:{}};throw new Error("Unexpected request "+path);},userIssue:()=>({kind:"connection"}),userMessage:(error:Error)=>error.message,UserFacingError:Error,responseIssue:()=>({kind:"connection"})},
  "./preferences":{cachedPreferences:()=>({privateSession:true}),settingsFields:(value:unknown)=>value,readPreferenceDraft:asyncNoop,writePreferenceDraft:asyncNoop,unacknowledgedPreferences:()=>({})},
  "./favorites":{readFavoriteDraft:asyncNoop,writeFavoriteDraft:asyncNoop,favoriteOverlay:(ids:string[])=>new Set(ids)},
  "./downloadEngine":{DurableDownloadManager:Manager},"./sharedFlight":{SharedFlight:class{clear(){}run(_key:string,_signal:unknown,operation:(signal:AbortSignal)=>unknown){return operation(new AbortController().signal);}}},
  "./partialPlayback":{partialPlaybackUrl:async()=>options.deferRegistration?new Promise<string|undefined>(resolve=>{register=resolve;}):"https://sakura.example/_sakura/audio/fixture",revokePartialPlayback:()=>{revocations++;}},
  "./listeningSync":{ListeningSync:class{},deviceIdentity:()=>"fixture"},"./sessionState":{sessionState:()=>({})},
  "../audio/engine":{MediaAudioEngine:class{initialized=false;requiresVolumeGraph=false;setVolume(){}setMode(){return Promise.resolve();}dispose(){}}},"../audio/presets":{audioTechnology:()=>"none"},
  "./playbackSource":{readyPlaybackFor},"./recordingJob":{},"./resources":{clearResources:noop,invalidateResources:noop},
  "./listeningQueue":{upcomingQueue:(queue:Array<{entryId:string}>,id:string)=>queue.slice(queue.findIndex(entry=>entry.entryId===id)+1)},
  "./offline":{localRead:async(_owner:string,key:string)=>saved.get(key),localWrite:async(_owner:string,key:string,value:unknown)=>{saved.set(key,value);},rememberAccount:asyncNoop,lastAccount:asyncNoop,forgetActiveAccount:asyncNoop,drainListen:asyncNoop,validOfflineAudio:()=>false},
 };
 const timers=new Set<ReturnType<typeof setTimeout>>();
 const context=vm.createContext({exports,module:{exports},require:(name:string)=>{assert.ok(name in modules,"Unexpected player dependency "+name);return modules[name];},Audio:FixtureAudio,navigator:{onLine:true},location:{origin:"https://sakura.example",href:"https://sakura.example/library",pathname:"/library"},window:{addEventListener:noop,removeEventListener:noop},URL,AbortController,DOMException,crypto:webcrypto,performance,queueMicrotask,Map,Set,setInterval:()=>0,clearInterval:noop,setTimeout:(callback:()=>void,delay:number)=>{const timer=setTimeout(callback,delay);timers.add(timer);return timer;},clearTimeout});
 vm.runInContext(code,context);
 const value=(exports.MusicProvider as (props:unknown)=>{value:MusicState})({children:null}).value;
 for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
 await until(()=>states[1]===false);
 return {value,states,requests,media:media!,prepares,enqueues,entries,saved,get revocations(){return revocations;},get registrationPending(){return !!register;},register(url:string|undefined){register?.(url);},close(){for(const cleanup of cleanups.reverse())cleanup();for(const timer of timers)clearTimeout(timer);}};
}

test("terminal media failures stop automatic full-file work but preserve explicit downloads",async()=>{
 const p=await player();try{
  const track=song();p.value.play(track);await until(()=>p.states[5]==="playing");
  assert.equal(p.enqueues.at(-1)?.requested,false);
  p.media.emit("error"); // The first error changes to the same-asset gateway.
  await tick();p.media.emit("error");
  await until(()=>p.states[5]==="error");
  assert.deepEqual(p.prepares,[track.id]);
  assert.ok(p.revocations>2,"The failed progressive capability must be revoked.");
  p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);
  p.value.play(track);await until(()=>p.states[5]==="playing");p.media.emit("error");await tick();p.media.emit("error");await until(()=>p.states[5]==="error");
  assert.deepEqual(p.prepares,[track.id],"A user download must continue after playback stops.");
 }finally{p.close();}
});

test("a source that cannot start relinquishes automatic transfer work",async()=>{
 const p=await player({rejectPlay:true});try{const track=song();p.value.play(track);await until(()=>p.states[5]==="error");assert.deepEqual(p.prepares,[track.id]);assert.ok(p.revocations>2);}finally{p.close();}
});

test("pausing during bridge registration revokes the pending grant without starting transfers",async()=>{
 const p=await player({deferRegistration:true});try{const before=p.revocations;p.value.play(song());await until(()=>p.registrationPending);p.value.pause();assert.ok(p.revocations>=before+2);p.register("https://sakura.example/_sakura/audio/old");await tick();assert.equal(p.states[5],"paused");assert.equal(p.media.src,"");assert.deepEqual(p.enqueues,[]);}finally{p.close();}
});

test("progressive pause and resume keep the saved position and do not fetch another recording",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.states[5]==="playing");p.media.currentTime=34.5;p.value.pause();assert.equal(p.media.src,"");assert.equal(p.states[7],34500);p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,34.5);assert.ok(p.enqueues.every(entry=>entry.id===track.id));assert.equal(p.requests.filter(path=>path.includes("recordings/resolve")).length,0);}finally{p.close();}
});

test("fallback failure before metadata preserves the position for another play attempt",async()=>{
 const p=await player({failFallbackBeforeMetadata:true});try{p.value.play(song());await until(()=>p.states[5]==="playing");p.media.currentTime=42.4;p.media.emit("error");await until(()=>p.states[5]==="error");assert.equal(p.states[7],42400);p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,42.4);}finally{p.close();}
});
