import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import test from "node:test";
import ts from "typescript";
import type {MusicState} from "../src/rebuild/app/MusicContext";
import type {MusicTrack} from "../src/rebuild/app/types";
import {readyPlaybackFor} from "../src/rebuild/app/playbackSource";
import * as queue from "../src/rebuild/app/listeningQueue";
import {SharedFlight} from "../src/rebuild/app/sharedFlight";
import {musicTrack} from "../src/rebuild/app/types";
import {validOfflineAudio} from "../src/rebuild/app/offline";
import {boundedSeekPosition} from "../src/rebuild/app/seekPosition";
import {userIssue,UserFacingError,responseIssue,type FailureKind} from "../src/rebuild/app/errors";

const accountId="90000000-0000-4000-8000-000000000001";
const code=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/MusicContext.tsx",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let attempt=0;attempt<30;attempt++){if(check())return;await tick();}assert.fail("The player did not reach the expected state.");}
function song(index=1):MusicTrack{
 const id="80000000-0000-4000-8000-"+String(index).padStart(12,"0"),assetId="81000000-0000-4000-8000-"+String(index).padStart(12,"0"),sha256="a".repeat(64);
 return {id,title:"Generated test song "+index,artists:["Local fixture"],artistsComplete:true,artistId:null,albumId:null,albumTitle:null,coverUrl:null,versionLabel:"Original recording",durationMs:180000,reference:{provider:"deezer",id:String(index)},references:[{provider:"deezer",id:String(index)}],readyPlayback:{kind:"stream",delivery:"cdn",assetId,sha256,sizeBytes:900000,mimeType:"audio/mpeg",durationMs:180000,url:`https://res.cloudinary.com/sakura/video/upload/v123/sakura/v2/audio/${id}/${sha256}.mp3`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
}

/** Runs the real provider with deterministic media, storage and React host adapters. */
async function player(options:{rejectPlay?:boolean;deferRegistration?:boolean;failFallbackBeforeMetadata?:boolean;bridge?:boolean;deferResolve?:boolean;offline?:boolean;deferMetadata?:boolean}={}){
 const states:unknown[]=[],refs:Array<{current:unknown}>=[],requests:string[]=[],requestOwners:Array<string|undefined>=[],saved=new Map<string,unknown>();
 const hooks:Array<{deps:unknown[]|undefined;cleanup?:()=>void}>=[],pendingEffects:Array<{slot:number;effect:()=>void|(()=>void)}>=[];
 const windowEvents=new Map<string,Set<()=>void>>(),documentEvents=new Map<string,Set<()=>void>>(),timers=new Set<ReturnType<typeof setTimeout>>(),timerCallbacks=new Map<ReturnType<typeof setTimeout>,{callback:()=>void;delay:number}>();
 const registrations:Array<{accountId:string;track:MusicTrack;ensure:(offset:number,signal:AbortSignal)=>Promise<unknown>;resolve?:(url:string|undefined)=>void}>=[],resolvers:Array<{track:MusicTrack;resolve:(result:unknown)=>void;reject:(error:unknown)=>void;signal:AbortSignal}>=[],ensured:Array<{id:string;offset:number;signal?:AbortSignal}>=[];
 const prepares:string[]=[],enqueues:Array<{id:string;requested:boolean}>=[],disposed:string[]=[],objectUrls:string[]=[],revokedUrls:string[]=[],partials=new Map<string,{fingerprint:{assetId:string;sizeBytes:number;sha256:string};blob:Blob;cachedSeconds:number}>();
 const downloadResolvers:Array<(track:MusicTrack,signal:AbortSignal,options?:{refresh?:boolean})=>Promise<{url:string}>>=[];
 const entries:Record<string,{recordingId:string;requested:boolean;status:string;track:MusicTrack}>={};
 const accountEntries=new Map([[accountId,entries]]),accountStorage=new Map([[accountId,saved]]);
 let media:FixtureAudio|undefined,revocations=0,closed=false,renderQueued=false,stateSlot=0,refSlot=0,effectSlot=0,profileId=accountId,loggedOut=false,value:MusicState;
 const navigator={onLine:!options.offline};
 const location={origin:"https://sakura.example",href:"https://sakura.example/library",pathname:"/library"};
 const noop=()=>{},asyncNoop=async()=>{},exports:Record<string,unknown>={};
 const events=(handlers:Map<string,Set<()=>void>>)=>({addEventListener(name:string,listener:()=>void){const group=handlers.get(name)||new Set();group.add(listener);handlers.set(name,group);},removeEventListener(name:string,listener:()=>void){handlers.get(name)?.delete(listener);}});
 function scheduleRender(){if(closed||renderQueued)return;renderQueued=true;queueMicrotask(()=>{renderQueued=false;if(!closed)render();});}
 const react={createContext:()=>({Provider:noop}),useState(initial:unknown){const slot=stateSlot++;if(slot>=states.length)states[slot]=initial;return [states[slot],(next:unknown)=>{states[slot]=typeof next==="function"?(next as (previous:unknown)=>unknown)(states[slot]):next;scheduleRender();}];},useRef(current:unknown){const slot=refSlot++;return refs[slot]||(refs[slot]={current});},useEffect(effect:()=>void|(()=>void),deps?:unknown[]){const slot=effectSlot++,previous=hooks[slot];if(!previous||!deps||deps.length!==previous.deps?.length||deps.some((dep,index)=>!Object.is(dep,previous.deps?.[index])))pendingEffects.push({slot,effect});hooks[slot]={deps,cleanup:previous?.cleanup};}};
 function captureMedia(audio:FixtureAudio){media=audio;}
 class FixtureAudio {
  private address="";preload="";volume=.8;paused=true;currentTime=0;duration=Number.NaN;rejectNextPlay=false;error:{code:number}|null=null;
  listeners=new Map<string,Set<{listener:()=>void;once:boolean}>>();
  constructor(){captureMedia(this);}
  get src(){return this.address;}set src(address:string){this.address=address?new URL(address,location.href).href:"";}
  addEventListener(name:string,listener:()=>void,options?:{once?:boolean}){const group=this.listeners.get(name)||new Set();group.add({listener,once:!!options?.once});this.listeners.set(name,group);}
  removeEventListener(name:string,listener:()=>void){for(const item of this.listeners.get(name)||[])if(item.listener===listener)this.listeners.get(name)?.delete(item);}
  emit(name:string){for(const item of [...this.listeners.get(name)||[]]){if(item.once)this.listeners.get(name)?.delete(item);item.listener();}}
  pause(){if(!this.paused)queueMicrotask(()=>this.emit("pause"));this.paused=true;}
  removeAttribute(name:string){if(name==="src")this.src="";}
  metadata(){this.duration=180;this.emit("loadedmetadata");}
  load(){this.error=null;this.currentTime=0;this.duration=Number.NaN;const address=this.src;if(!address||options.deferMetadata||options.failFallbackBeforeMetadata&&address.includes("/api/v2/recordings/"))return;queueMicrotask(()=>{if(this.src===address)this.metadata();});}
  networkFailure(code=2){this.error={code};this.emit("error");}
  async play(){if(this.rejectNextPlay){this.rejectNextPlay=false;throw new Error("The generated media source cannot resume.");}if(options.rejectPlay||options.failFallbackBeforeMetadata&&this.src.includes("/api/v2/recordings/"))throw new Error("The generated media source cannot start.");this.paused=false;this.emit("playing");}
 }
 class Manager {
  constructor(private options:{accountId:string;onChange:(value:unknown)=>void;resolve:(track:MusicTrack,signal:AbortSignal,options?:{refresh?:boolean})=>Promise<{url:string}>}){downloadResolvers.push(options.resolve);}
  private get records(){let records=accountEntries.get(this.options.accountId);if(!records){records={};accountEntries.set(this.options.accountId,records);}return records;}
  async hydrate(){this.options.onChange({...this.records});}
  setPriorities(){}
  enqueue(track:MusicTrack,{requested}:{requested:boolean}){enqueues.push({id:track.id,requested});this.records[track.id]={recordingId:track.id,requested:this.records[track.id]?.requested||requested,status:"downloading",track};this.options.onChange({...this.records});return Promise.resolve();}
  async prepare(id:string){if(!this.records[id]?.requested){prepares.push(id);if(this.records[id])this.records[id].status="prepared";this.options.onChange({...this.records});}}
  ensureChunk(id:string,offset:number,signal?:AbortSignal){ensured.push({id,offset,signal});return Promise.resolve();}
  getPartial(id:string){return Promise.resolve(this.options.accountId===accountId?partials.get(id):undefined);}
  dispose(){disposed.push(this.options.accountId);}
 }
 const resolved=(track:MusicTrack)=>({status:"resolved",recording:{recordingId:track.id,references:track.references,reference:track.reference,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs}},playback:track.readyPlayback});
 const modules:Record<string,unknown>={
  react,"react/jsx-runtime":{jsx:(_type:unknown,props:unknown)=>props},"next-auth/react":{signOut:async()=>{loggedOut=true;}},"./types":{musicTrack},
  "./errors":{requestJson:async(path:string,init:RequestInit={},scope?:{accountId?:string})=>{requests.push(path);requestOwners.push(scope?.accountId);if(path==="/api/v2/profile"){if(!navigator.onLine)throw new Error("Offline profile request");return {profile:{id:profileId}};}if(path==="/api/v2/library?kind=liked")return {recordings:[]};if(path==="/api/v2/settings")return {settings:{privateSession:true,...(init.body?JSON.parse(String(init.body)):{})}};if(path==="/api/auth/session")return loggedOut?{}:{user:{id:profileId}};if(path==="/api/v2/recordings/resolve"){const track=song(Number(JSON.parse(String(init.body)).reference.id));return options.deferResolve?new Promise((resolve,reject)=>resolvers.push({track,resolve,reject,signal:init.signal!})):resolved(track);}throw new Error("Unexpected request "+path);},userIssue,userMessage:(error:Error)=>error.message,UserFacingError,responseIssue},
  "./preferences":{cachedPreferences:()=>({privateSession:true}),settingsFields:(settings:unknown)=>settings,readPreferenceDraft:asyncNoop,writePreferenceDraft:asyncNoop,unacknowledgedPreferences:()=>({})},
  "./favorites":{readFavoriteDraft:asyncNoop,writeFavoriteDraft:asyncNoop,favoriteOverlay:(ids:string[])=>new Set(ids)},
  "./downloadEngine":{DurableDownloadManager:Manager},"./sharedFlight":{SharedFlight},
  "./partialPlayback":{partialPlaybackUrl:async(accountId:string,source:{track:MusicTrack},ensure:(offset:number,signal:AbortSignal)=>Promise<unknown>)=>{if(options.bridge===false)return;const registration={accountId,track:source.track,ensure};registrations.push(registration);return options.deferRegistration?new Promise<string|undefined>(resolve=>Object.assign(registration,{resolve})):"https://sakura.example/_sakura/audio/fixture";},revokePartialPlayback:()=>{revocations++;}},
  "./listeningSync":{ListeningSync:class{start=asyncNoop;stop=noop;refresh=asyncNoop;flush=asyncNoop;change=noop;},deviceIdentity:()=>"fixture"},"./sessionState":{sessionState:()=>({})},
  "../audio/engine":{MediaAudioEngine:class{initialized=false;requiresVolumeGraph=false;setVolume(){}setMode(){return Promise.resolve();}dispose(){}}},"../audio/presets":{audioTechnology:()=>"none"},
  "./playbackSource":{readyPlaybackFor},"./seekPosition":{boundedSeekPosition},"./recordingJob":{waitForRecording:async(result:unknown)=>result},"./resources":{clearResources:noop,invalidateResources:noop},"./listeningQueue":queue,
  "./offline":{localRead:async(owner:string,key:string)=>accountStorage.get(owner)?.get(key),localWrite:async(owner:string,key:string,entry:unknown)=>{let storage=accountStorage.get(owner);if(!storage){storage=new Map();accountStorage.set(owner,storage);}storage.set(key,entry);},rememberAccount:asyncNoop,lastAccount:async()=>({id:profileId}),forgetActiveAccount:asyncNoop,drainListen:asyncNoop,validOfflineAudio},
 };
 class FixtureUrl extends URL {static createObjectURL(blob:Blob){const url=URL.createObjectURL(blob);objectUrls.push(url);return url;}static revokeObjectURL(url:string){revokedUrls.push(url);URL.revokeObjectURL(url);}}
 const context=vm.createContext({exports,module:{exports},require:(name:string)=>{assert.ok(name in modules,"Unexpected player dependency "+name);return modules[name];},Audio:FixtureAudio,navigator,location,document:{visibilityState:"visible",...events(documentEvents)},window:events(windowEvents),URL:FixtureUrl,Blob,AbortController,DOMException,crypto:webcrypto,performance,queueMicrotask,Map,Set,setInterval:()=>0,clearInterval:noop,setTimeout:(callback:()=>void,delay:number)=>{const timer=setTimeout(()=>{timerCallbacks.delete(timer);timers.delete(timer);callback();},delay);timers.add(timer);timerCallbacks.set(timer,{callback,delay});return timer;},clearTimeout:(timer:ReturnType<typeof setTimeout>)=>{clearTimeout(timer);timers.delete(timer);timerCallbacks.delete(timer);}});
 vm.runInContext(code,context);
 function render(){stateSlot=0;refSlot=0;effectSlot=0;pendingEffects.length=0;value=(exports.MusicProvider as (props:unknown)=>{value:MusicState})({children:null}).value;for(const {slot,effect}of [...pendingEffects]){hooks[slot].cleanup?.();hooks[slot].cleanup=effect()||undefined;}}
 render();await until(()=>states[1]===false);await tick();
 return {timerFor(delay:number){return [...timerCallbacks].find(([,entry])=>entry.delay===delay)?.[0];},async fireTimer(delay:number){const scheduled=[...timerCallbacks].find(([,entry])=>entry.delay===delay);if(!scheduled)return false;const [timer,{callback}]=scheduled;clearTimeout(timer);timers.delete(timer);timerCallbacks.delete(timer);callback();await tick();return true;},get value(){return value;},states,requests,requestOwners,media:media!,prepares,enqueues,entries,saved,disposed,objectUrls,revokedUrls,registrations,resolvers,downloadResolvers,ensured,partials,navigator,location,get revocations(){return revocations;},get registrationPending(){return !!registrations.at(-1)?.resolve;},register(url:string|undefined,index=registrations.length-1){registrations[index]?.resolve?.(url);},resolve(index=resolvers.length-1,track=resolvers[index].track){resolvers[index].resolve(resolved(track));},rejectResolve(index=resolvers.length-1,error:unknown=new Error("Temporary network failure")){resolvers[index].reject(error);},async profile(id:string){profileId=id;value.retryConnection();await until(()=>value.account?.id===id);await tick();},async connection(online:boolean){navigator.onLine=online;for(const handler of windowEvents.get(online?"online":"offline")||[])handler();await tick();},close(){closed=true;for(const hook of hooks.toReversed())hook.cleanup?.();for(const timer of timers)clearTimeout(timer);for(const url of objectUrls)URL.revokeObjectURL(url);}};
}

test("Retry song refreshes a failed ready source and its cached resolution while keeping the position",async()=>{
 const p=await player({bridge:false,deferResolve:true});try{
  const track=song();p.value.play(track);await until(()=>p.value.status==="playing");assert.equal(p.resolvers.length,0);p.media.currentTime=37.25;p.media.emit("error");await tick();p.media.emit("error");await until(()=>p.value.status==="error");
  p.value.togglePlay();await until(()=>p.resolvers.length===1);const fresh={...track,readyPlayback:{...track.readyPlayback!,url:track.readyPlayback!.url.replace("/v123/","/v124/")}};p.resolve(0,fresh);await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.src,fresh.readyPlayback.url);assert.equal(p.media.currentTime,37.25);assert.equal(p.requests.filter(path=>path.includes("recordings/resolve")).length,1);
 }finally{p.close();}
});

test("failed download source refresh reaches the server through the provider's resolver callback",async()=>{
 const p=await player({deferResolve:true});try{
  const track=song();p.value.requestDownload(track);await until(()=>p.downloadResolvers.length===1);const waiting=p.downloadResolvers[0](track,new AbortController().signal,{refresh:true});await until(()=>p.resolvers.length===1);const fresh={...track,readyPlayback:{...track.readyPlayback!,url:track.readyPlayback!.url.replace("/v123/","/v125/")}};p.resolve(0,fresh);assert.equal((await waiting).url,fresh.readyPlayback.url);
 }finally{p.close();}
});

test("an initial transient source lookup automatically retries the explicit play request before media attaches",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);p.value.seek(23500);p.rejectResolve();await until(()=>p.value.status==="buffering");
  assert.equal(p.media.src,"");assert.equal(p.value.error,null);assert.equal(p.value.positionMs,23500);assert.deepEqual(p.enqueues,[]);
  assert.equal(await p.fireTimer(750),true);await until(()=>p.resolvers.length===2);p.resolve();await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,23.5);assert.equal(p.registrations.length,1);
 }finally{p.close();}
});

test("initial source lookup retries have a finite budget",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);
  for(const [attempt,delay]of [750,1500,3000].entries()){
   p.rejectResolve();await until(()=>p.value.status==="buffering");assert.equal(p.value.error,null);assert.equal(await p.fireTimer(delay),true);await until(()=>p.resolvers.length===attempt+2);
  }
  p.rejectResolve();await until(()=>p.value.status==="error");assert.equal(await p.fireTimer(6000),false);assert.equal(p.resolvers.length,4);assert.deepEqual(p.enqueues,[]);
 }finally{p.close();}
});

test("an interrupted initial lookup waits offline and resumes the existing play request on reconnect",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);await p.connection(false);p.rejectResolve();await until(()=>p.value.status==="buffering");assert.equal(p.value.error,null);assert.equal(await p.fireTimer(750),false);
  await p.connection(true);assert.equal(await p.fireTimer(750),true);await until(()=>p.resolvers.length===2);p.resolve();await until(()=>p.value.status==="playing");assert.equal(p.registrations.length,1);
 }finally{p.close();}
});

for(const kind of ["session","version","missing","storage","validation"] satisfies FailureKind[])test(`an initial ${kind} source failure does not retry automatically`,async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);p.rejectResolve(0,new UserFacingError({kind,title:"Terminal fixture",message:"This step requires user action.",action:"Try again"}));await until(()=>p.value.status==="error");assert.equal(await p.fireTimer(750),false);assert.equal(p.resolvers.length,1);assert.deepEqual(p.enqueues,[]);
 }finally{p.close();}
});

for(const name of ["AbortError","NotAllowedError"])test(`an initial ${name} does not restart playback automatically`,async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);p.rejectResolve(0,new DOMException("Playback cannot continue",name));await until(()=>p.value.status==="error");assert.equal(await p.fireTimer(750),false);assert.deepEqual(p.enqueues,[]);
 }finally{p.close();}
});

test("pausing after an initial lookup failure cancels its pending automatic retry",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);p.rejectResolve();await until(()=>p.value.status==="buffering");p.value.pause();await tick();assert.equal(await p.fireTimer(750),false);assert.equal(p.value.status,"paused");assert.equal(p.resolvers.length,1);
 }finally{p.close();}
});

test("repeated no-progress media events preserve the watchdog deadline until playback advances",async()=>{
 const p=await player();try{
  p.value.play(song());await until(()=>p.value.status==="playing");const original=p.timerFor(12000);assert.ok(original);
  for(let repeat=0;repeat<4;repeat++)for(const event of ["waiting","stalled","timeupdate","playing"]){p.media.emit(event);await tick();assert.equal(p.timerFor(12000),original);}
  p.media.currentTime=5;p.media.emit("timeupdate");await tick();const advanced=p.timerFor(12000);assert.ok(advanced);assert.notEqual(advanced,original);
  for(const event of ["waiting","stalled","timeupdate"]){p.media.emit(event);await tick();assert.equal(p.timerFor(12000),advanced);}
  assert.equal(await p.fireTimer(12000),true);await tick();assert.match(p.media.src,/\/api\/v2\/recordings\//);assert.equal(p.media.currentTime,5);
  p.media.emit("timeupdate");await tick();const fallback=p.timerFor(12000);assert.ok(fallback);for(const event of ["waiting","stalled","timeupdate"]){p.media.emit(event);await tick();assert.equal(p.timerFor(12000),fallback);}
  assert.equal(await p.fireTimer(12000),true);await until(()=>p.value.status==="buffering"&&p.media.src==="");assert.equal(p.value.error,null);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

for(const code of [2,4])test(`a temporary ${code===2?"network":"progressive source"} failure refreshes playback automatically and preserves the ongoing download and position`,async()=>{
 const p=await player();try{
  const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);p.media.currentTime=61.25;
  p.media.networkFailure(code);await tick();p.media.networkFailure(code);await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.equal(p.value.error,null);assert.equal(p.value.positionMs,61250);assert.deepEqual(p.prepares,[]);assert.equal(p.entries[track.id].requested,true);
  assert.equal(await p.fireTimer(750),true);await until(()=>p.value.status==="playing");await tick();
  assert.equal(p.media.currentTime,61.25);assert.equal(p.registrations.length,2);assert.equal(p.requests.filter(path=>path.includes("recordings/resolve")).length,1);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

test("a stalled fallback reopens playback without downgrading its recovering automatic download",async()=>{
 const p=await player();try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=29.2;p.media.emit("waiting");await tick();
  assert.equal(await p.fireTimer(12000),true);await tick();p.media.emit("waiting");await tick();
  assert.equal(await p.fireTimer(12000),true);await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.deepEqual(p.prepares,[]);assert.equal(p.value.error,null);assert.equal(await p.fireTimer(750),true);await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,29.2);
 }finally{p.close();}
});

test("network recovery waits for the connection and keeps a seek made while waiting",async()=>{
 const p=await player();try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=37.5;await p.connection(false);p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.equal(await p.fireTimer(750),false);assert.equal(p.value.error,null);p.value.seek(72500);await p.connection(true);assert.equal(await p.fireTimer(750),true);await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,72.5);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

test("a transient source refresh failure keeps recovering from the saved position",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=48.5;p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.equal(await p.fireTimer(750),true);await until(()=>p.resolvers.length===1);p.rejectResolve();await until(()=>p.value.status==="buffering");assert.equal(p.value.error,null);assert.equal(p.value.positionMs,48500);assert.deepEqual(p.prepares,[]);
  assert.equal(await p.fireTimer(1500),true);await until(()=>p.resolvers.length===2);p.resolve();await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,48.5);
 }finally{p.close();}
});

test("pausing while an automatic source refresh is pending fences its late completion",async()=>{
 const p=await player({deferResolve:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.equal(await p.fireTimer(750),true);await until(()=>p.resolvers.length===1);p.value.pause();assert.equal(p.resolvers[0].signal.aborted,true);p.resolve();await tick();assert.equal(p.value.status,"paused");assert.equal(p.media.src,"");assert.equal(p.registrations.length,1);
 }finally{p.close();}
});

test("successful playback progress restores the retry budget for a later unrelated interruption",async()=>{
 const p=await player();try{
  p.value.play(song());await until(()=>p.value.status==="playing");
  for(let attempt=0;attempt<4;attempt++){
   p.media.currentTime+=6;p.media.emit("timeupdate");p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");assert.equal(await p.fireTimer(750),true);await until(()=>p.value.status==="playing");await tick();
  }
  assert.equal(p.media.currentTime,24);assert.equal(p.value.error,null);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

for(const action of ["pause","next","account","logout"] as const)test(`${action} cancels pending network playback recovery`,async()=>{
 const p=await player();try{
  p.value.play(song(),[song(),song(2)]);await until(()=>p.value.status==="playing");p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");
  if(action==="pause")p.value.pause();else if(action==="next")p.value.next();else if(action==="account")await p.profile("90000000-0000-4000-8000-000000000002");else await p.value.logout();
  await tick();assert.equal(await p.fireTimer(750),false);assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);
  if(action==="next")await until(()=>p.value.status==="playing"&&p.value.track?.id===song(2).id);else assert.ok(["paused","idle"].includes(p.value.status));
 }finally{p.close();}
});

test("persistent media network failures exhaust a finite recovery budget while preserving an explicit download",async()=>{
 const p=await player();try{
  const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);p.media.currentTime=14.2;
  for(const delay of [750,1500,3000]){
   p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");assert.equal(p.value.error,null);assert.equal(await p.fireTimer(delay),true);await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,14.2);
  }
  p.media.networkFailure();await tick();p.media.networkFailure();await until(()=>p.value.status==="error");assert.equal(await p.fireTimer(6000),false);assert.equal(p.registrations.length,4);assert.equal(p.value.positionMs,14200);assert.equal(p.entries[track.id].requested,true);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

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

for(const phase of ["resolve","bridge"] as const)test(`seeking while ${phase} is pending applies the latest position when media is ready`,async()=>{
 const p=await player({deferResolve:phase==="resolve",deferRegistration:phase==="bridge"});try{const track={...song(),readyPlayback:phase==="resolve"?undefined:song().readyPlayback};p.value.play(track);await until(()=>phase==="resolve"?p.resolvers.length===1:p.registrationPending);p.value.seek(72500);if(phase==="resolve")p.resolve();else p.register("https://sakura.example/_sakura/audio/fixture");await until(()=>p.value.status==="playing");await tick();assert.equal(p.media.currentTime,72.5);assert.equal(p.value.positionMs,72500);}finally{p.close();}
});

test("ordinary playback retains a seek made before metadata through pause and resume",async()=>{
 const p=await player({bridge:false,deferMetadata:true});try{p.value.play(song());await until(()=>p.value.status==="playing");p.value.seek(72500);p.value.pause();await tick();p.value.togglePlay();await until(()=>p.states[5]==="playing");p.media.metadata();await tick();assert.equal(p.media.currentTime,72.5);}finally{p.close();}
});

test("switching from a downloaded Blob to streaming releases the old media URL",async()=>{
 const p=await player();try{const track=song(),blob=new Blob(["verified local fixture"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");assert.ok(p.media.src.startsWith("blob:"));assert.equal(p.registrations.length,0);const old=p.media.src;p.value.play(song(2));await until(()=>p.value.track?.id===song(2).id&&p.value.status==="playing");assert.ok(p.revokedUrls.includes(old));assert.equal(p.saved.has("audio:"+track.id),true);}finally{p.close();}
});

test("complete downloaded audio plays offline without source resolution or progressive transfer",async()=>{
 const p=await player({offline:true});try{const track=song(),blob=new Blob(["verified offline fixture"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");assert.ok(p.media.src.startsWith("blob:"));assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);assert.equal(p.registrations.length,0);assert.equal(p.enqueues.length,0);}finally{p.close();}
});

test("a saved Blob stored under another recording id is never used for playback",async()=>{
 const p=await player();try{const track=song(),wrong=song(2),blob=new Blob(["mis-keyed offline fixture"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track:wrong,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");assert.equal(p.media.src.startsWith("blob:"),false);assert.equal(p.registrations.at(-1)?.track.id,track.id);assert.equal(p.saved.has("audio:"+track.id),true);}finally{p.close();}
});

test("a persisted partial source can start offline and request only its canonical missing chunk",async()=>{
 const p=await player({offline:true});try{const track=song(),ready=track.readyPlayback!;p.partials.set(track.id,{fingerprint:{assetId:ready.assetId,sizeBytes:ready.sizeBytes,sha256:ready.sha256!},blob:new Blob(["prefix"],{type:"audio/mpeg"}),cachedSeconds:22});p.value.play(track);await until(()=>p.value.status==="playing");assert.match(p.media.src,/\/_sakura\/audio\//);assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);await p.registrations.at(-1)!.ensure(524288,new AbortController().signal);assert.deepEqual(p.ensured.map(item=>({id:item.id,offset:item.offset})),[{id:track.id,offset:524288}]);}finally{p.close();}
});

test("offline playback without complete or partial bytes fails without resolver traffic",async()=>{
 const p=await player({offline:true});try{p.value.play(song());await until(()=>p.value.status==="error");assert.match(p.value.error!,/not saved on this device/);assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);assert.equal(p.registrations.length,0);assert.equal(p.enqueues.length,0);}finally{p.close();}
});

test("connection loss and restoration preserve the current playing source and user download",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);const address=p.media.src;p.media.currentTime=31.2;await p.connection(false);assert.equal(p.value.offline,true);assert.equal(p.value.status,"playing");await p.connection(true);assert.equal(p.value.offline,false);assert.equal(p.value.status,"playing");assert.equal(p.media.src,address);assert.equal(p.media.currentTime,31.2);assert.equal(p.entries[track.id].requested,true);}finally{p.close();}
});

test("pausing pending resolution and starting another song rejects late source completion",async()=>{
 const p=await player({deferResolve:true});try{p.value.play({...song(),readyPlayback:undefined});await until(()=>p.resolvers.length===1);p.value.pause();assert.equal(p.resolvers[0].signal.aborted,true);p.value.play(song(2));await until(()=>p.value.status==="playing"&&p.value.track?.id===song(2).id);p.resolve(0);await tick();assert.equal(p.value.track?.id,song(2).id);assert.ok(p.enqueues.every(entry=>entry.id===song(2).id));}finally{p.close();}
});

test("skipping pending bridge registration ignores its late grant and old chunk callback",async()=>{
 const p=await player({deferRegistration:true});try{p.value.play(song());await until(()=>p.registrations.length===1);p.value.play(song(2));await until(()=>p.registrations.length===2);p.register("https://sakura.example/_sakura/audio/new",1);await until(()=>p.value.status==="playing");p.register("https://sakura.example/_sakura/audio/old",0);await tick();assert.equal(p.value.track?.id,song(2).id);assert.ok(p.enqueues.every(entry=>entry.id===song(2).id));await assert.rejects(p.registrations[0].ensure(0,new AbortController().signal),/paused|Abort/);}finally{p.close();}
});

for(const phase of ["resolve","bridge"] as const)test(`switching accounts fences a pending ${phase} response and disposes old downloads`,async()=>{
 const p=await player({deferResolve:phase==="resolve",deferRegistration:phase==="bridge"});try{p.value.play({...song(),readyPlayback:phase==="resolve"?undefined:song().readyPlayback});await until(()=>phase==="resolve"?p.resolvers.length===1:p.registrationPending);const next="90000000-0000-4000-8000-000000000002";await p.profile(next);if(phase==="resolve")p.resolve();else p.register("https://sakura.example/_sakura/audio/old");await tick();assert.equal(p.value.account?.id,next);assert.equal(p.value.track,null);assert.equal(p.media.src,"");assert.equal(p.value.status,"idle");assert.ok(p.disposed.includes(accountId));assert.equal(p.enqueues.length,0);}finally{p.close();}
});

test("logout revokes playing media and disposes account downloads without deleting saved audio",async()=>{
 const p=await player();try{const track=song(),blob=new Blob(["verified local fixture"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(song(2));await tick();const address=p.media.src;await p.value.logout();await tick();assert.equal(p.value.account,null);assert.equal(p.value.track,null);assert.equal(p.value.status,"idle");assert.equal(p.media.src,"");assert.ok(p.revokedUrls.includes(address));assert.ok(p.disposed.includes(accountId));assert.equal(p.location.href,"/login");assert.equal(p.saved.has("audio:"+track.id),true);}finally{p.close();}
});

test("removing the final current queue item releases downloaded media and returns to idle",async()=>{
 const p=await player();try{const track=song(),blob=new Blob(["queue removal fixture"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");const address=p.media.src,entry=p.value.currentEntryId!;assert.ok(address.startsWith("blob:"));p.value.removeQueue(entry);await tick();assert.equal(p.value.track,null);assert.equal(p.value.currentEntryId,null);assert.equal(p.value.status,"idle");assert.equal(p.media.src,"");assert.ok(p.revokedUrls.includes(address));}finally{p.close();}
});

test("queue navigation, repeat and shuffle preserve manual picks and canonical identity",async()=>{
 const p=await player();try{const tracks=[song(),song(2),song(3)];p.value.play(tracks[0],tracks);await until(()=>p.value.status==="playing");p.value.next();await until(()=>p.value.status==="playing"&&p.value.track?.id===tracks[1].id);p.value.previous();await until(()=>p.value.status==="playing"&&p.value.track?.id===tracks[0].id);p.value.setRepeat("one");p.media.currentTime=180;p.media.emit("ended");await tick();assert.equal(p.value.track?.id,tracks[0].id);assert.equal(p.media.currentTime,0);p.value.setRepeat("all");p.value.playQueueEntry(p.value.queue.find(entry=>entry.track.id===tracks[2].id)!.entryId);await until(()=>p.value.status==="playing"&&p.value.track?.id===tracks[2].id);p.value.next();await until(()=>p.value.status==="playing"&&p.value.track?.id===tracks[0].id);p.value.setShuffle(true);p.value.addQueue(song(4));p.value.next();await until(()=>p.value.status==="playing"&&p.value.track?.id===song(4).id);assert.ok(p.enqueues.every(entry=>[1,2,3,4].some(index=>entry.id===song(index).id)));}finally{p.close();}
});

test("ordinary verified streaming avoids automatic full cache work and falls back to the same asset",async()=>{
 const p=await player({bridge:false});try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");assert.equal(p.media.src,track.readyPlayback!.url);assert.equal(p.enqueues.some(entry=>entry.id===track.id),false);p.media.currentTime=61;p.media.emit("error");await tick();assert.equal(new URL(p.media.src).pathname,`/api/v2/recordings/${track.id}/audio`);assert.equal(new URL(p.media.src).searchParams.get("assetId"),track.readyPlayback!.assetId);assert.equal(p.media.currentTime,61);p.value.pause();p.value.togglePlay();await until(()=>p.value.status==="playing");assert.equal(p.media.currentTime,61);}finally{p.close();}
});

test("a seek during fallback metadata loading replaces the earlier restore position",async()=>{
 const p=await player({bridge:false,deferMetadata:true});try{p.value.play(song());await until(()=>p.value.status==="playing");p.media.metadata();p.media.currentTime=61.2;p.media.emit("error");await tick();p.value.seek(93750);p.media.metadata();await tick();assert.equal(p.media.currentTime,93.75);assert.equal(p.value.positionMs,93750);}finally{p.close();}
});

test("a mid-song outage and recovery retry keep the last position and explicit download",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);p.media.currentTime=25.3;await p.connection(false);p.media.emit("error");await tick();p.media.emit("error");await until(()=>p.value.status==="error");assert.equal(p.value.positionMs,25300);await p.connection(true);p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,25.3);assert.equal(p.entries[track.id].requested,true);}finally{p.close();}
});

test("a rejected repeat-one restart stops automatic transfer work until the next play gesture",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.setRepeat("one");p.media.currentTime=180;p.media.rejectNextPlay=true;p.media.emit("ended");await until(()=>p.value.status==="paused");assert.deepEqual(p.prepares,[track.id]);assert.equal(p.media.src,"");p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,0);}finally{p.close();}
});

test("account changes release old Blob playback and cannot reuse another account's saved bytes",async()=>{
 const p=await player();try{const track=song(),blob=new Blob(["account-bound audio"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(song(2));await until(()=>p.entries[song(2).id]?.requested);const address=p.media.src,next="90000000-0000-4000-8000-000000000002";await p.profile(next);assert.equal(Object.keys(p.value.downloads).length,0);assert.ok(p.revokedUrls.includes(address));assert.equal(p.value.track,null);assert.equal(p.value.status,"idle");p.value.play(track);await until(()=>p.value.status==="playing");assert.ok(!p.media.src.startsWith("blob:"));assert.equal(p.registrations.at(-1)!.accountId,next);assert.equal(p.saved.has("audio:"+track.id),true);assert.equal(p.entries[song(2).id].requested,true);}finally{p.close();}
});
