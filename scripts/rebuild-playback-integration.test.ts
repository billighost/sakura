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
import {audioTechnology} from "../src/rebuild/audio/presets";
import {FEED_DEFAULTS} from "../src/rebuild/app/feedPreferences";
import * as listeningEvidence from "../src/rebuild/app/listeningEvidence";
import * as smartQueueHelpers from "../src/rebuild/app/smartQueue";
import * as autoplayHelpers from "../src/rebuild/app/autoplay";
import * as tasteOrdering from "../src/rebuild/app/tasteOrdering";
import * as personalization from "../src/rebuild/recommendations/personalization";
import {settingsFields,fullSettings,rebasePreferences,preferenceRevision,preferenceFieldRevisions,unacknowledgedPreferences,type PreferenceDraft,type PreferenceSyncMetadata} from "../src/rebuild/app/preferences";
import {favoriteOverlay,mergeFavoriteIntents,acknowledgeFavorite,type FavoriteIntent} from "../src/rebuild/app/favorites";
import type {UserSettings} from "../src/rebuild/app/types";

const accountId="90000000-0000-4000-8000-000000000001";
const code=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/MusicContext.tsx",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let attempt=0;attempt<30;attempt++){if(check())return;await tick();}assert.fail("The player did not reach the expected state.");}
function song(index=1):MusicTrack{
 const id="80000000-0000-4000-8000-"+String(index).padStart(12,"0"),assetId="81000000-0000-4000-8000-"+String(index).padStart(12,"0"),sha256="a".repeat(64);
 return {id,title:"Generated test song "+index,artists:["Local fixture"],artistsComplete:true,artistId:null,albumId:null,albumTitle:null,coverUrl:null,versionLabel:"Original recording",durationMs:180000,reference:{provider:"deezer",id:String(index)},references:[{provider:"deezer",id:String(index)}],readyPlayback:{kind:"stream",delivery:"cdn",assetId,sha256,sizeBytes:900000,mimeType:"audio/mpeg",durationMs:180000,url:`https://res.cloudinary.com/sakura/video/upload/v123/sakura/v2/audio/${id}/${sha256}.mp3`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
}

/** Runs the real provider with deterministic media, storage and React host adapters. */
async function player(options:{startupPromiseFailure?:boolean;rejectFallbackOnce?:boolean;startupRace?:boolean;deferFirstChunk?:boolean;rejectPlay?:boolean;deferRegistration?:boolean;failFallbackBeforeMetadata?:boolean;bridge?:boolean;deferResolve?:boolean;offline?:boolean;deferMetadata?:boolean;deferSmartQueue?:boolean;smartTracks?:MusicTrack[];recordListening?:boolean;clock?:boolean;remoteSettings?:Record<string,unknown>;preferenceDraft?:PreferenceDraft;deferSettingsPatch?:boolean;deferHistoryClear?:boolean;deferFavoriteStorage?:boolean;failFavoriteStorage?:boolean;favoriteReceipt?:{liked?:boolean;operationId?:string;accepted?:boolean};favoriteResponse?:(change:{recordingId:string;liked:boolean;operationId:string})=>unknown;autoplay?:boolean}={}){
 let holdTaste=false;const tasteRequests:Array<(response:unknown)=>void>=[];
 let remoteTaste:Record<string,unknown>={feedback:[],tasteEvidence:[],historyClearedAt:null};const historyClears:Array<{accountId:string;period:string;cutoff:number}>=[],historyClearResolvers:Array<()=>void>=[];
 let remoteSettings:Record<string,unknown>={privateSession:!options.recordListening,revision:0,...options.remoteSettings},preferenceDraft=options.preferenceDraft;
 const remoteFavorites=new Set<string>();const favoriteWrites:Array<Record<string,FavoriteIntent>>=[],favoriteRequests:Array<{recordingId:string;liked:boolean;operationId:string}>=[],favoriteAcks:string[]=[],favoriteStorageWaiters:Array<()=>void>=[];let holdFavorites=options.deferFavoriteStorage;
 const settingsRequests:Array<{body:Record<string,unknown>;resolve:(response:unknown)=>void;reject:(error:unknown)=>void}>=[];
 const invalidations:Array<{accountId:string;prefix:string;dropData:boolean}>=[];
 let elapsed=0;const delivered:Array<Record<string,unknown>>=[];
 const smartRequests:Array<{body:{scope:string;recordingIds?:string[]};resolve:(response:unknown)=>void}>=[];
 const states:unknown[]=[],refs:Array<{current:unknown}>=[],requests:string[]=[],requestOwners:Array<string|undefined>=[],saved=new Map<string,unknown>();
 const hooks:Array<{deps:unknown[]|undefined;cleanup?:()=>void}>=[],pendingEffects:Array<{slot:number;effect:()=>void|(()=>void)}>=[];
 const windowEvents=new Map<string,Set<()=>void>>(),documentEvents=new Map<string,Set<()=>void>>(),timers=new Set<ReturnType<typeof setTimeout>>(),timerCallbacks=new Map<ReturnType<typeof setTimeout>,{callback:()=>void;delay:number}>();
 const registrations:Array<{accountId:string;track:MusicTrack;ensure:(offset:number,signal:AbortSignal)=>Promise<unknown>;resolve?:(url:string|undefined)=>void}>=[],resolvers:Array<{track:MusicTrack;resolve:(result:unknown)=>void;reject:(error:unknown)=>void;signal:AbortSignal}>=[],ensured:Array<{id:string;offset:number;signal?:AbortSignal}>=[];
 const soundModes:string[]=[];
 const prepares:string[]=[],enqueues:Array<{id:string;requested:boolean}>=[],disposed:string[]=[],objectUrls:string[]=[],revokedUrls:string[]=[],partials=new Map<string,{fingerprint:{assetId:string;sizeBytes:number;sha256:string};blob:Blob;cachedSeconds:number}>();
 const downloadResolvers:Array<(track:MusicTrack,signal:AbortSignal,options?:{refresh?:boolean})=>Promise<{url:string}>>=[];
 const chunkWaiters:Array<{resolve:()=>void;signal?:AbortSignal}>=[];
 const entries:Record<string,{recordingId:string;requested:boolean;status:string;track:MusicTrack}>={};
 const accountEntries=new Map([[accountId,entries]]),accountStorage=new Map([[accountId,saved]]);
 let media:FixtureAudio|undefined,revocations=0,closed=false,renderQueued=false,stateSlot=0,refSlot=0,effectSlot=0,profileId=accountId,loggedOut=false,value:MusicState;
 const mediaActions=new Map<string,()=>void>();
 const navigator={onLine:!options.offline,mediaSession:{metadata:null,playbackState:"none",setActionHandler(name:string,action:()=>void){mediaActions.set(name,action);}}};
 const location={origin:"https://sakura.example",href:"https://sakura.example/library",pathname:"/library"};
 const noop=()=>{},asyncNoop=async()=>{},exports:Record<string,unknown>={};
 const events=(handlers:Map<string,Set<()=>void>>)=>({addEventListener(name:string,listener:()=>void){const group=handlers.get(name)||new Set();group.add(listener);handlers.set(name,group);},removeEventListener(name:string,listener:()=>void){handlers.get(name)?.delete(listener);}});
 function scheduleRender(){if(closed||renderQueued)return;renderQueued=true;queueMicrotask(()=>{renderQueued=false;if(!closed)render();});}
 const react={createContext:()=>({Provider:noop}),useState(initial:unknown){const slot=stateSlot++;if(slot>=states.length)states[slot]=initial;return [states[slot],(next:unknown)=>{states[slot]=typeof next==="function"?(next as (previous:unknown)=>unknown)(states[slot]):next;scheduleRender();}];},useRef(current:unknown){const slot=refSlot++;return refs[slot]||(refs[slot]={current});},useEffect(effect:()=>void|(()=>void),deps?:unknown[]){const slot=effectSlot++,previous=hooks[slot];if(!previous||!deps||deps.length!==previous.deps?.length||deps.some((dep,index)=>!Object.is(dep,previous.deps?.[index])))pendingEffects.push({slot,effect});hooks[slot]={deps,cleanup:previous?.cleanup};}};
 function captureMedia(audio:FixtureAudio){media=audio;}
 class FixtureAudio {
  private address="";preload="";volume=.8;muted=false;seeking=false;paused=true;currentTime=0;duration=Number.NaN;playbackRate=1;defaultPlaybackRate=1;preservesPitch=true;rejectNextPlay=false;error:{code:number}|null=null;
  fallbackRejected=false;loads:string[]=[];listeners=new Map<string,Set<{listener:()=>void;once:boolean}>>();
  constructor(){captureMedia(this);}
  get src(){return this.address;}set src(address:string){this.address=address?new URL(address,location.href).href:"";}
  addEventListener(name:string,listener:()=>void,options?:{once?:boolean}){const group=this.listeners.get(name)||new Set();group.add({listener,once:!!options?.once});this.listeners.set(name,group);}
  removeEventListener(name:string,listener:()=>void){for(const item of this.listeners.get(name)||[])if(item.listener===listener)this.listeners.get(name)?.delete(item);}
  emit(name:string){for(const item of [...this.listeners.get(name)||[]]){if(item.once)this.listeners.get(name)?.delete(item);item.listener();}}
  pause(){if(!this.paused)queueMicrotask(()=>this.emit("pause"));this.paused=true;}
  removeAttribute(name:string){if(name==="src")this.src="";}
  metadata(){this.duration=180;this.emit("loadedmetadata");}
  load(){this.loads.push(this.src);this.error=null;this.currentTime=0;this.duration=Number.NaN;const address=this.src;if(!address||options.deferMetadata||options.failFallbackBeforeMetadata&&address.includes("/api/v2/recordings/"))return;queueMicrotask(()=>{if(this.src===address)this.metadata();});}
  networkFailure(code=2){this.error={code};this.emit("error");}
  async play(){if(options.rejectFallbackOnce&&!this.fallbackRejected&&this.src.includes("/api/v2/recordings/")){this.fallbackRejected=true;throw new DOMException("The fallback connection briefly stopped","NetworkError");}if(options.startupPromiseFailure&&this.src.includes("/_sakura/audio/")){this.error={code:4};throw new DOMException("The initial transport stopped","NotSupportedError");}if(options.startupRace&&this.src.includes("/_sakura/audio/")){this.networkFailure(4);throw new DOMException("The initial transport stopped","NotSupportedError");}if(this.rejectNextPlay){this.rejectNextPlay=false;throw new Error("The generated media source cannot resume.");}if(options.rejectPlay||options.failFallbackBeforeMetadata&&this.src.includes("/api/v2/recordings/"))throw new Error("The generated media source cannot start.");if(options.startupRace)await tick();this.paused=false;this.emit("playing");}
 }
 class Manager {
  constructor(private options:{accountId:string;onChange:(value:unknown)=>void;resolve:(track:MusicTrack,signal:AbortSignal,options?:{refresh?:boolean})=>Promise<{url:string}>}){downloadResolvers.push(options.resolve);}
  private get records(){let records=accountEntries.get(this.options.accountId);if(!records){records={};accountEntries.set(this.options.accountId,records);}return records;}
  async hydrate(){this.options.onChange({...this.records});}
  async remove(id:string){delete this.records[id];accountStorage.get(this.options.accountId)?.delete("audio:"+id);this.options.onChange({...this.records});}
  async cancel(id:string){delete this.records[id];this.options.onChange({...this.records});}
  setPriorities(){}
  enqueue(track:MusicTrack,{requested}:{requested:boolean}){enqueues.push({id:track.id,requested});this.records[track.id]={recordingId:track.id,requested:this.records[track.id]?.requested||requested,status:"downloading",track};this.options.onChange({...this.records});return Promise.resolve();}
  async prepare(id:string){if(!this.records[id]?.requested){prepares.push(id);if(this.records[id])this.records[id].status="prepared";this.options.onChange({...this.records});}}
  ensureChunk(id:string,offset:number,signal?:AbortSignal){ensured.push({id,offset,signal});return options.deferFirstChunk?new Promise<void>((resolve,reject)=>{chunkWaiters.push({resolve,signal});signal?.addEventListener("abort",()=>reject(signal.reason),{once:true});}):Promise.resolve();}
  getPartial(id:string){return Promise.resolve(this.options.accountId===accountId?partials.get(id):undefined);}
  playbackSourceFor(id:string){const partial=this.options.accountId===accountId?partials.get(id):undefined;if(!partial)return;const track=song(Number.parseInt(id.slice(-12),10)),url="/api/v2/recordings/"+id+"/audio?assetId="+partial.fingerprint.assetId;return {track,url,fallbackUrl:url,...partial.fingerprint};}
  dispose(){disposed.push(this.options.accountId);}
 }
 const resolved=(track:MusicTrack)=>({status:"resolved",recording:{recordingId:track.id,references:track.references,reference:track.reference,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs}},playback:track.readyPlayback});
 const modules:Record<string,unknown>={
  "./feedPreferences":{FEED_DEFAULTS},"./listeningEvidence":listeningEvidence,"./smartQueue":smartQueueHelpers,"./autoplay":{...autoplayHelpers,needsAutoplay:(entries:Parameters<typeof autoplayHelpers.needsAutoplay>[0],currentId:string|null)=>options.autoplay===true&&autoplayHelpers.needsAutoplay(entries,currentId)},"./tasteOrdering":tasteOrdering,"../recommendations/personalization":personalization,
  react,"react/jsx-runtime":{jsx:(_type:unknown,props:unknown)=>props},"next-auth/react":{signOut:async()=>{loggedOut=true;}},"./types":{musicTrack},
  "./errors":{requestJson:async(path:string,init:RequestInit={},scope?:{accountId?:string})=>{requests.push(path);requestOwners.push(scope?.accountId);if(path==="/api/v2/profile"){if(!navigator.onLine)throw new Error("Offline profile request");return {profile:{id:profileId}};}if(path==="/api/v2/taste"){if(holdTaste){holdTaste=false;return new Promise(resolve=>tasteRequests.push(resolve));}return remoteTaste;}if(path==="/api/v2/library?kind=liked")return {recordings:[...remoteFavorites].map(recordingId=>({recordingId}))};if(path==="/api/v2/library"){const change=JSON.parse(String(init.body));favoriteRequests.push(change);const receipt=(options.favoriteResponse?options.favoriteResponse(change):{...change,accepted:true,...options.favoriteReceipt}) as {liked?:boolean;accepted?:boolean};if(receipt?.accepted===true&&typeof receipt.liked==="boolean"){if(receipt.liked)remoteFavorites.add(change.recordingId);else remoteFavorites.delete(change.recordingId);}return receipt;}if(path==="/api/v2/settings"){if(!init.body)return {settings:remoteSettings};const body=JSON.parse(String(init.body));if(options.deferSettingsPatch)return new Promise((resolve,reject)=>settingsRequests.push({body,resolve,reject}));const {expectedRevision,...patch}=body;if(expectedRevision!==undefined&&expectedRevision!==remoteSettings.revision)throw Object.assign(new UserFacingError(responseIssue(409,null)),{status:409});remoteSettings={...remoteSettings,...patch,revision:Number(remoteSettings.revision)+1,fieldRevisions:{...preferenceFieldRevisions(remoteSettings),...Object.fromEntries(Object.keys(patch).map(key=>[key,Number(remoteSettings.revision)+1]))}};return {settings:remoteSettings};}if(path==="/api/v2/smart-queue"){const body=JSON.parse(String(init.body));const tracks=(options.smartTracks||[song(4),song(5)]).map(track=>resolved(track).recording);return options.deferSmartQueue?new Promise(resolve=>smartRequests.push({body,resolve})):{tracks,reason:"Chosen from your fixture listening"};}if(path==="/api/auth/session")return loggedOut?{}:{user:{id:profileId}};if(path==="/api/v2/recordings/resolve"){const track=song(Number(JSON.parse(String(init.body)).reference.id));return options.deferResolve?new Promise((resolve,reject)=>resolvers.push({track,resolve,reject,signal:init.signal!})):resolved(track);}throw new Error("Unexpected request "+path);},userIssue,userMessage:(error:Error)=>error.message,UserFacingError,responseIssue},
  "./preferences":{cachedPreferences:()=>preferenceDraft?.settings||{privateSession:!options.recordListening},settingsFields,fullSettings,rebasePreferences,preferenceRevision,preferenceFieldRevisions,readPreferenceDraft:async()=>preferenceDraft,writePreferenceDraft:async(_owner:string,settings:UserSettings,pending:boolean,pendingPatch:Partial<UserSettings>,metadata?:PreferenceSyncMetadata)=>{preferenceDraft={settings,pending,pendingPatch,savedAt:Date.now(),...metadata};},unacknowledgedPreferences},
  "./favorites":{readFavoriteDraft:asyncNoop,writeFavoriteDraft:async(_owner:string,_liked:Iterable<string>,pending:Record<string,FavoriteIntent>)=>{if(!Object.keys(pending).length)return;favoriteWrites.push({...pending});if(options.failFavoriteStorage)throw new UserFacingError({kind:"storage",title:"Favorites could not be saved",message:"Storage unavailable",action:"Check storage"});if(holdFavorites)await new Promise<void>(resolve=>favoriteStorageWaiters.push(resolve));},favoriteOverlay,mergeFavoriteIntents,acknowledgeFavorite,acknowledgeFavoriteDraft:async(_owner:string,operationId:string)=>{favoriteAcks.push(operationId);}},
  "./downloadEngine":{DurableDownloadManager:Manager},"./sharedFlight":{SharedFlight},
  "./partialPlayback":{partialPlaybackUrl:async(accountId:string,source:{track:MusicTrack},ensure:(offset:number,signal:AbortSignal)=>Promise<unknown>)=>{if(options.bridge===false)return;const registration={accountId,track:source.track,ensure};registrations.push(registration);return options.deferRegistration?new Promise<string|undefined>(resolve=>Object.assign(registration,{resolve})):"https://sakura.example/_sakura/audio/fixture";},revokePartialPlayback:()=>{revocations++;}},
  "./listeningSync":{ListeningSync:class{start=asyncNoop;stop=noop;refresh=asyncNoop;flush=asyncNoop;change=noop;},deviceIdentity:()=>"fixture"},"./sessionState":{sessionState:()=>({})},
  "../audio/engine":{MediaAudioEngine:class{initialized=false;requiresVolumeGraph=false;setVolume(){}resume(){return Promise.resolve();}setMode(mode:string){soundModes.push(mode);this.initialized ||= mode!=="none";return Promise.resolve();}dispose(){}}},"../audio/presets":{audioTechnology},
  "./playbackSource":{readyPlaybackFor},"./seekPosition":{boundedSeekPosition},"./recordingJob":{waitForRecording:async(result:unknown)=>result},"./resources":{clearResources:noop,invalidateResources:(accountId:string,prefix="/api/v2/",dropData=false)=>invalidations.push({accountId,prefix,dropData})},"./listeningQueue":queue,
  "./offline":{localRead:async(owner:string,key:string)=>accountStorage.get(owner)?.get(key),localWrite:async(owner:string,key:string,entry:unknown)=>{let storage=accountStorage.get(owner);if(!storage){storage=new Map();accountStorage.set(owner,storage);}storage.set(key,entry);},rememberAccount:asyncNoop,lastAccount:async()=>({id:profileId}),forgetActiveAccount:asyncNoop,drainListen:asyncNoop,clearListeningOutbox:async(accountId:string,period:string,cutoff:number)=>{historyClears.push({accountId,period,cutoff});if(options.deferHistoryClear)await new Promise<void>(resolve=>historyClearResolvers.push(resolve));},deliverListen:async(_owner:string,chunk:Record<string,unknown>)=>{delivered.push(chunk);return true;},savedAudio:async(owner:string)=>[...(accountStorage.get(owner)||new Map())].filter(([key,value])=>String(key)==="audio:"+(value as {track?:MusicTrack})?.track?.id&&validOfflineAudio(value)).map(([,value])=>value),validOfflineAudio},
 };
 class FixtureUrl extends URL {static createObjectURL(blob:Blob){const url=URL.createObjectURL(blob);objectUrls.push(url);return url;}static revokeObjectURL(url:string){revokedUrls.push(url);URL.revokeObjectURL(url);}}
 const context=vm.createContext({exports,module:{exports},require:(name:string)=>{assert.ok(name in modules,"Unexpected player dependency "+name);return modules[name];},Audio:FixtureAudio,MediaMetadata:class{constructor(value:unknown){Object.assign(this,value);}},navigator,location,document:{visibilityState:"visible",...events(documentEvents)},window:{...events(windowEvents),dispatchEvent(event:Event){for(const listener of windowEvents.get(event.type)||[])(listener as (event:Event)=>void)(event);return true;}},CustomEvent,URL:FixtureUrl,Blob,AbortController,DOMException,crypto:webcrypto,performance:options.clock?{now:()=>elapsed}:performance,queueMicrotask,Map,Set,setInterval:()=>0,clearInterval:noop,setTimeout:(callback:()=>void,delay:number)=>{const timer=setTimeout(()=>{timerCallbacks.delete(timer);timers.delete(timer);callback();},delay);timers.add(timer);timerCallbacks.set(timer,{callback,delay});return timer;},clearTimeout:(timer:ReturnType<typeof setTimeout>)=>{clearTimeout(timer);timers.delete(timer);timerCallbacks.delete(timer);}});
 vm.runInContext(code,context);
 function render(){stateSlot=0;refSlot=0;effectSlot=0;pendingEffects.length=0;value=(exports.MusicProvider as (props:unknown)=>{value:MusicState})({children:null}).value;for(const {slot,effect}of [...pendingEffects]){hooks[slot].cleanup?.();hooks[slot].cleanup=effect()||undefined;}}
 render();await until(()=>states[1]===false);await tick();
 return {favoriteWrites,favoriteRequests,favoriteAcks,releaseFavoriteStorage(){holdFavorites=false;for(const release of favoriteStorageWaiters)release();},mediaActions,soundModes,chunkWaiters,holdTaste(){holdTaste=true;},resolveTaste(data:Record<string,unknown>){tasteRequests.at(-1)!(data);},resolveHistoryClear(index=historyClearResolvers.length-1){historyClearResolvers[index]();},invalidations,async pollTaste(){const before=requests.filter(path=>path==="/api/v2/taste").length;for(const listener of windowEvents.get("focus")||[])listener();await until(()=>requests.filter(path=>path==="/api/v2/taste").length>before);await tick();await tick();},remoteChoice(patch:Record<string,unknown>){remoteSettings={...remoteSettings,...patch,revision:Number(remoteSettings.revision)+1,fieldRevisions:{...preferenceFieldRevisions(remoteSettings),...Object.fromEntries(Object.keys(patch).map(key=>[key,Number(remoteSettings.revision)+1]))}};},get preferenceDraft(){return preferenceDraft;},settingsRequests,resolveSettings(index=settingsRequests.length-1){const {expectedRevision,...patch}=settingsRequests[index].body;void expectedRevision;remoteSettings={...remoteSettings,...patch,revision:Number(remoteSettings.revision)+1,fieldRevisions:{...preferenceFieldRevisions(remoteSettings),...Object.fromEntries(Object.keys(patch).map(key=>[key,Number(remoteSettings.revision)+1]))}};settingsRequests[index].resolve({settings:remoteSettings});},conflictSettings(patch:Record<string,unknown>,index=settingsRequests.length-1){remoteSettings={...remoteSettings,...patch,revision:Number(remoteSettings.revision)+1,fieldRevisions:{...preferenceFieldRevisions(remoteSettings),...Object.fromEntries(Object.keys(patch).map(key=>[key,Number(remoteSettings.revision)+1]))}};settingsRequests[index].reject(Object.assign(new UserFacingError(responseIssue(409,null)),{status:409}));},delivered,advance(ms:number){elapsed+=ms;media!.currentTime+=ms/1000;},dispatch(name:string,detail:Record<string,unknown>){for(const listener of windowEvents.get(name)||[])(listener as (event:Event)=>void)(new CustomEvent(name,{detail}));},timerFor(delay:number){return [...timerCallbacks].find(([,entry])=>entry.delay===delay)?.[0];},async fireTimer(delay:number){const scheduled=[...timerCallbacks].find(([,entry])=>entry.delay===delay);if(!scheduled)return false;const [timer,{callback}]=scheduled;clearTimeout(timer);timers.delete(timer);timerCallbacks.delete(timer);callback();await tick();return true;},get value(){return value;},states,requests,requestOwners,smartRequests,historyClears,setTaste(data:Record<string,unknown>){remoteTaste=data;},resolveSmart(tracks:MusicTrack[],index=smartRequests.length-1){smartRequests[index].resolve({tracks:tracks.map(track=>resolved(track).recording),reason:"Chosen fixture songs"});},media:media!,prepares,enqueues,entries,saved,disposed,objectUrls,revokedUrls,registrations,resolvers,downloadResolvers,ensured,partials,navigator,location,get revocations(){return revocations;},get registrationPending(){return !!registrations.at(-1)?.resolve;},register(url:string|undefined,index=registrations.length-1){registrations[index]?.resolve?.(url);},resolve(index=resolvers.length-1,track=resolvers[index].track){resolvers[index].resolve(resolved(track));},rejectResolve(index=resolvers.length-1,error:unknown=new Error("Temporary network failure")){resolvers[index].reject(error);},async profile(id:string){profileId=id;value.retryConnection();await until(()=>value.account?.id===id);await tick();},async connection(online:boolean){navigator.onLine=online;for(const handler of windowEvents.get(online?"online":"offline")||[])handler();await tick();},close(){closed=true;for(const hook of hooks.toReversed())hook.cleanup?.();for(const timer of timers)clearTimeout(timer);for(const url of objectUrls)URL.revokeObjectURL(url);}};
}

test("startup error event and original Play rejection share one surviving fallback transport",async()=>{
 const p=await player({startupRace:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");await tick();
  assert.equal(p.media.src,"https://sakura.example"+song().readyPlayback!.fallbackUrl);
  assert.equal(p.media.loads.filter(url=>url.includes("/api/v2/recordings/")).length,1);
  assert.equal(p.value.error,null);assert.deepEqual(p.prepares,[]);
 }finally{p.close();}
});

test("a queued error from the rejected source cannot stop the replacement media transport",async()=>{
 const p=await player({startupPromiseFailure:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");
  const fallback=p.media.src;assert.ok(fallback.includes("/api/v2/recordings/"));assert.equal(p.media.error,null);
  // WebKit checkpoints promise callbacks between native event listeners. The
  // original rejection can load the fallback before its queued error arrives.
  p.media.emit("error");await tick();
  assert.equal(p.value.status,"playing");assert.equal(p.value.error,null);assert.equal(p.media.src,fallback);
  assert.equal(p.media.loads.filter(url=>url===fallback).length,1);
 }finally{p.close();}
});

test("progressive startup waits for its first verified chunk without a media deadline or full-file wait",async()=>{
 const p=await player({deferFirstChunk:true});try{
  p.value.play(song());await until(()=>p.chunkWaiters.length===1);
  assert.equal(p.value.status,"buffering");assert.equal(p.media.src,"");assert.equal(p.value.error,null);
  assert.equal(await p.fireTimer(12000),false);assert.equal(p.entries[song().id].status,"downloading");
  p.chunkWaiters[0].resolve();await until(()=>p.value.status==="playing");
  assert.equal(p.entries[song().id].status,"downloading");assert.equal(p.ensured[0].offset,0);
 }finally{p.close();}
});

test("a restored partial asset starts playback from saved chunks without a new catalog lookup",async()=>{
 const p=await player({deferResolve:true});try{
  const track=song(),ready=track.readyPlayback!;
  p.partials.set(track.id,{fingerprint:{assetId:ready.assetId,sizeBytes:ready.sizeBytes,sha256:ready.sha256!},blob:new Blob([new Uint8Array(4096)],{type:"audio/mpeg"}),cachedSeconds:8});
  p.value.play({...track,readyPlayback:undefined});await until(()=>p.value.status==="playing");
  assert.equal(p.resolvers.length,0);assert.equal(p.requests.includes("/api/v2/recordings/resolve"),false);
  assert.equal(p.registrations[0].track.id,track.id);assert.equal(p.ensured[0].offset,0);assert.equal(p.value.error,null);
 }finally{p.close();}
});

test("a fallback Play promise's transient network rejection recovers without an error event",async()=>{
 const p=await player({rejectFallbackOnce:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=12.5;
  p.media.networkFailure();await until(()=>p.value.status==="buffering"&&p.media.src==="");
  assert.equal(p.value.error,null);assert.equal(p.value.positionMs,12500);assert.deepEqual(p.prepares,[]);
  assert.equal(await p.fireTimer(750),true);await until(()=>p.value.status==="playing");await tick();
  assert.equal(p.media.currentTime,12.5);assert.equal(p.value.error,null);
 }finally{p.close();}
});

test("pausing before the first chunk arrives cancels media startup and preserves an explicit download",async()=>{
 const p=await player({deferFirstChunk:true});try{
  p.value.play(song());await until(()=>p.chunkWaiters.length===1);
  p.value.requestDownload(song());await until(()=>p.entries[song().id].requested);
  p.value.pause();await tick();p.chunkWaiters[0].resolve();await tick();
  assert.equal(p.chunkWaiters[0].signal?.aborted,true);assert.equal(p.value.status,"paused");
  assert.equal(p.media.src,"");assert.equal(p.value.error,null);assert.equal(p.entries[song().id].requested,true);
 }finally{p.close();}
});

test("smart queue appends suggestions without interrupting current music or removing manual picks",async()=>{
 const p=await player({smartTracks:[song(2),song(3),song(4)]});try{
  p.value.play(song(1),[song(1),song(2)]);await until(()=>p.value.status==="playing");p.value.addQueue(song(3));await tick();const current=p.value.currentEntryId,manual=p.value.queue.find(entry=>entry.track.id===song(3).id)!;
  await p.value.smartQueue({append:true});await tick();assert.equal(p.value.currentEntryId,current);assert.equal(p.value.queue.find(entry=>entry.entryId===manual.entryId)?.priority,"manual");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(1).id,song(3).id,song(2).id,song(4).id]);assert.equal(p.value.smartQueueBusy,false);
 }finally{p.close();}
});
test("starting a soundtrack plays its first song and retains the manually chosen next song",async()=>{
 const p=await player({smartTracks:[song(4),song(3),song(5)]});try{
  p.value.play(song(1));await until(()=>p.value.status==="playing");p.value.addQueue(song(3));await tick();const manual=p.value.queue.find(entry=>entry.track.id===song(3).id)!;
  await p.value.smartQueue();await until(()=>p.value.track?.id===song(4).id&&p.value.status==="playing");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(4).id,song(3).id,song(5).id]);assert.equal(p.value.queue[1].entryId,manual.entryId);
 }finally{p.close();}
});
test("a delayed smart queue cannot replace a newer listening choice",async()=>{
 const p=await player({deferSmartQueue:true});try{
  const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);p.value.play(song(2));await until(()=>p.value.status==="playing");p.resolveSmart([song(4)]);await generated;await tick();assert.equal(p.value.track?.id,song(2).id);assert.equal(p.value.queue.some(entry=>entry.track.id===song(4).id),false);assert.equal(p.value.smartQueueBusy,false);
 }finally{p.close();}
});
test("offline soundtracks use only complete verified requested audio on this account",async()=>{
 const p=await player({offline:true});try{
  const blob=new Blob(["verified soundtrack fixture"],{type:"audio/mpeg"});for(const index of [1,2,3]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:index===3?blob.size+1:blob.size,savedAt:Date.now(),requested:true});}
  await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.ok(p.media.src.startsWith("blob:"));assert.equal(p.value.queue.length,2);assert.equal(p.value.queue.some(entry=>entry.track.id===song(3).id),false);assert.equal(p.requests.some(path=>path==="/api/v2/smart-queue"),false);
 }finally{p.close();}
});
test("download soundtracks keep unsaved manual picks for later and never stream a removed download",async()=>{
 const p=await player({smartTracks:[song(1),song(2),song(3)]});try{
  const blob=new Blob(["verified offline queue fixture"],{type:"audio/mpeg"});for(const index of [1,2]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}
  p.value.play(song(4));await until(()=>p.value.status==="playing");p.value.addQueue(song(3));await tick();await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing"&&p.value.track?.id===song(1).id);await tick();
  assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(1).id,song(2).id]);assert.ok(p.value.queue.every(entry=>entry.localOnly));assert.equal(p.value.parkedPicks[0].track.id,song(3).id);assert.ok(Array.isArray(p.saved.get("smart-parked-picks")));
  await p.value.removeDownload(song(2).id);p.value.next();await until(()=>p.value.status==="error");assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);assert.match(p.value.error||"",/no longer saved/);
  p.value.restoreParkedPicks();await tick();assert.equal(p.value.parkedPicks.length,0);assert.equal(p.value.queue.find(entry=>entry.track.id===song(3).id)?.priority,"manual");
 }finally{p.close();}
});
test("reconnecting reconciles another device’s partial history clear before reusing cached taste",async()=>{
 const p=await player();try{
  p.saved.set("personalization-evidence",{history:[{recordingId:song(1).id,audibleMs:300000,playCount:2,completedCount:1,skippedCount:0}],feedback:[]});
  const cutoff="2026-11-08T00:00:00Z",periodStart="2026-11-01T00:00:00Z";p.setTaste({feedback:[],tasteEvidence:[],historyClearedAt:cutoff,historyDeletion:{periodStart,clearedAt:cutoff}});await p.connection(true);await until(()=>p.historyClears.length>0);await tick();
  assert.equal(p.historyClears[0].accountId,accountId);assert.equal(p.historyClears[0].period,"week");assert.equal(p.historyClears[0].cutoff,Date.parse(cutoff));assert.equal((p.saved.get("personalization-evidence") as {history:unknown[]}).history.length,0);assert.equal(p.saved.get("personalization-clear-marker"),cutoff);
 }finally{p.close();}
});
test("Retry song refreshes a failed ready source and its cached resolution while keeping the position",async()=>{
 const p=await player({bridge:false,deferResolve:true});try{
  const track=song();p.value.play(track);await until(()=>p.value.status==="playing");assert.equal(p.resolvers.length,0);p.media.currentTime=37.25;p.media.networkFailure(3);await tick();p.media.networkFailure(3);await until(()=>p.value.status==="error");
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
  p.media.networkFailure(3); // The first error changes to the same-asset gateway.
  await tick();p.media.networkFailure(3);
  await until(()=>p.states[5]==="error");
  assert.deepEqual(p.prepares,[track.id]);
  assert.ok(p.revocations>2,"The failed progressive capability must be revoked.");
  p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);
  p.value.play(track);await until(()=>p.states[5]==="playing");p.media.networkFailure(3);await tick();p.media.networkFailure(3);await until(()=>p.states[5]==="error");
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
 const p=await player({failFallbackBeforeMetadata:true});try{p.value.play(song());await until(()=>p.states[5]==="playing");p.media.currentTime=42.4;p.media.networkFailure(3);await until(()=>p.states[5]==="error");assert.equal(p.states[7],42400);p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,42.4);}finally{p.close();}
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
 const p=await player({offline:true});try{const track=song(),ready=track.readyPlayback!;p.partials.set(track.id,{fingerprint:{assetId:ready.assetId,sizeBytes:ready.sizeBytes,sha256:ready.sha256!},blob:new Blob(["prefix"],{type:"audio/mpeg"}),cachedSeconds:22});p.value.play(track);await until(()=>p.value.status==="playing");assert.match(p.media.src,/\/_sakura\/audio\//);assert.equal(p.requests.some(path=>path.includes("recordings/resolve")),false);await p.registrations.at(-1)!.ensure(524288,new AbortController().signal);assert.deepEqual(p.ensured.map(item=>({id:item.id,offset:item.offset})),[{id:track.id,offset:0},{id:track.id,offset:524288}]);}finally{p.close();}
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
 const p=await player({bridge:false});try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");assert.equal(p.media.src,track.readyPlayback!.url);assert.equal(p.enqueues.some(entry=>entry.id===track.id),false);p.media.currentTime=61;p.media.networkFailure(3);await tick();assert.equal(new URL(p.media.src).pathname,`/api/v2/recordings/${track.id}/audio`);assert.equal(new URL(p.media.src).searchParams.get("assetId"),track.readyPlayback!.assetId);assert.equal(p.media.currentTime,61);p.value.pause();p.value.togglePlay();await until(()=>p.value.status==="playing");assert.equal(p.media.currentTime,61);}finally{p.close();}
});

test("a seek during fallback metadata loading replaces the earlier restore position",async()=>{
 const p=await player({bridge:false,deferMetadata:true});try{p.value.play(song());await until(()=>p.value.status==="playing");p.media.metadata();p.media.currentTime=61.2;p.media.networkFailure(3);await tick();p.value.seek(93750);p.media.metadata();await tick();assert.equal(p.media.currentTime,93.75);assert.equal(p.value.positionMs,93750);}finally{p.close();}
});

test("a mid-song outage and recovery retry keep the last position and explicit download",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(track);await until(()=>p.entries[track.id].requested);p.media.currentTime=25.3;await p.connection(false);p.media.networkFailure(3);await tick();p.media.networkFailure(3);await until(()=>p.value.status==="error");assert.equal(p.value.positionMs,25300);await p.connection(true);p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,25.3);assert.equal(p.entries[track.id].requested,true);}finally{p.close();}
});

test("a rejected repeat-one restart stops automatic transfer work until the next play gesture",async()=>{
 const p=await player();try{const track=song();p.value.play(track);await until(()=>p.value.status==="playing");p.value.setRepeat("one");p.media.currentTime=180;p.media.rejectNextPlay=true;p.media.emit("ended");await until(()=>p.value.status==="paused");assert.deepEqual(p.prepares,[track.id]);assert.equal(p.media.src,"");p.value.togglePlay();await until(()=>p.states[5]==="playing");await tick();assert.equal(p.media.currentTime,0);}finally{p.close();}
});

test("account changes release old Blob playback and cannot reuse another account's saved bytes",async()=>{
 const p=await player();try{const track=song(),blob=new Blob(["account-bound audio"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.value.play(track);await until(()=>p.value.status==="playing");p.value.requestDownload(song(2));await until(()=>p.entries[song(2).id]?.requested);const address=p.media.src,next="90000000-0000-4000-8000-000000000002";await p.profile(next);assert.equal(Object.keys(p.value.downloads).length,0);assert.ok(p.revokedUrls.includes(address));assert.equal(p.value.track,null);assert.equal(p.value.status,"idle");p.value.play(track);await until(()=>p.value.status==="playing");assert.ok(!p.media.src.startsWith("blob:"));assert.equal(p.registrations.at(-1)!.accountId,next);assert.equal(p.saved.has("audio:"+track.id),true);assert.equal(p.entries[song(2).id].requested,true);}finally{p.close();}
});


test("pause and natural ending keep the final audible interval and commit one terminal outcome",async()=>{
 const p=await player({recordListening:true,clock:true});try{
  p.value.play(song(),[song(),song(2)]);await until(()=>p.value.status==="playing");p.advance(1000);p.value.pause();await tick();assert.equal(p.delivered[0].msPlayed,1000);assert.equal(p.delivered[0].finished,false);
  p.value.togglePlay();await until(()=>p.value.status==="playing");p.advance(179000);p.media.paused=true;p.media.emit("ended");await until(()=>p.value.track?.id===song(2).id);await tick();
  const first=p.delivered.filter(chunk=>chunk.recordingId===song().id);assert.equal(first.reduce((sum,c)=>sum+Number(c.msPlayed),0),180000);assert.equal(first.filter(c=>c.completed).length,1);assert.equal(first.some(c=>c.skipped),false);assert.equal(first.at(-1)?.finished,true);
 }finally{p.close();}
});

test("volume boundaries record sounding intervals and exclude muted media movement",async()=>{
 const p=await player({recordListening:true,clock:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.advance(1000);p.value.setVolume(0);await tick();p.advance(9000);p.value.setVolume(.8);await tick();p.advance(1000);p.value.pause();await tick();assert.equal(p.delivered.reduce((sum,c)=>sum+Number(c.msPlayed),0),2000);
 }finally{p.close();}
});

test("native mute changes use the previous sound boundary rather than crediting silent time",async()=>{
 const p=await player({recordListening:true,clock:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.advance(1000);p.media.muted=true;p.media.emit("volumechange");p.advance(9000);p.media.muted=false;p.media.emit("volumechange");p.advance(1000);p.value.pause();await tick();assert.equal(p.delivered.reduce((sum,c)=>sum+Number(c.msPlayed),0),2000);
 }finally{p.close();}
});

test("a settings change fences an older soundtrack response and releases its busy state",async()=>{
 const p=await player({deferSmartQueue:true});try{
  const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);const change=p.value.updateSettings({discovery:.8});await tick();p.resolveSmart([song(4)]);await generated;await change;await tick();assert.equal(p.value.track,null);assert.equal(p.value.queue.length,0);assert.equal(p.value.smartQueueBusy,false);
 }finally{p.close();}
});

test("a new song exclusion fences an older soundtrack response",async()=>{
 const p=await player({deferSmartQueue:true});try{
  const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);p.dispatch("sakura-taste-updated",{accountId,feedback:{target:"recording",targetId:song(4).id,kind:"exclude"}});p.resolveSmart([song(4)]);await generated;await tick();assert.equal(p.value.track,null);assert.equal(p.value.queue.length,0);assert.equal(p.value.smartQueueBusy,false);
 }finally{p.close();}
});

test("collection soundtracks reject songs returned outside the selected source",async()=>{
 const p=await player({smartTracks:[song(1),song(4),song(2)]});try{
  await p.value.smartQueue({scope:"collection",tracks:[song(1),song(2)]});await until(()=>p.value.status==="playing");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(1).id,song(2).id]);
 }finally{p.close();}
});

test("reconnecting reconciles every selective clear performed while this device was away",async()=>{
 const p=await player();try{
  p.setTaste({feedback:[],tasteEvidence:[],historyClearedAt:"2026-11-08T00:00:00Z",historyDeletion:{periodStart:"2026-11-01T00:00:00Z",clearedAt:"2026-11-08T00:00:00Z"},historyDeletions:[{periodStart:"2026-09-01T00:00:00Z",clearedAt:"2026-10-01T00:00:00Z"},{periodStart:"2026-11-01T00:00:00Z",clearedAt:"2026-11-08T00:00:00Z"}]});await p.connection(true);await until(()=>p.historyClears.length===2);assert.deepEqual(p.historyClears.map(clear=>clear.period),["month","week"]);assert.equal(p.saved.get("personalization-clear-marker"),"2026-11-08T00:00:00Z");
 }finally{p.close();}
});


test("leaving a failed audio source records an ending without claiming a deliberate skip",async()=>{
 const p=await player({recordListening:true,clock:true,bridge:false});try{
  p.value.play(song(),[song(),song(2)]);await until(()=>p.value.status==="playing");p.advance(1000);p.media.networkFailure(3);await tick();p.media.networkFailure(3);await until(()=>p.value.status==="error");p.value.next();await until(()=>p.value.track?.id===song(2).id&&p.value.status==="playing");const failed=p.delivered.filter(chunk=>chunk.recordingId===song().id);assert.equal(failed.reduce((sum,c)=>sum+Number(c.msPlayed),0),1000);assert.equal(failed.some(c=>c.skipped),false);assert.equal(failed.at(-1)?.finished,true);
 }finally{p.close();}
});


test("stale offline feed edits preserve a newer privacy choice and rebase unrelated controls",async()=>{
 const base={privateSession:true,learnFromListening:true,discovery:.35},local={...base,discovery:.7};const draft={settings:local as UserSettings,pending:true,pendingPatch:{learnFromListening:true,discovery:.7},savedAt:Date.now(),serverRevision:2,serverSettings:base,baseSettings:{learnFromListening:true,discovery:.35}};
 const p=await player({preferenceDraft:draft,remoteSettings:{learnFromListening:false,discovery:.35,revision:5}});try{await until(()=>p.value.settings.discovery===.7&&p.value.settings.learnFromListening===false);assert.equal(p.preferenceDraft?.pending,false);assert.equal(p.preferenceDraft?.serverRevision,6);assert.equal(p.preferenceDraft?.serverSettings?.learnFromListening,false);}finally{p.close();}
});

test("a newer slider edit survives an accepted older preference write",async()=>{
 const p=await player({deferSettingsPatch:true});try{
  const first=p.value.updateSettings({discovery:.6});await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===1);assert.equal(p.settingsRequests[0].body.expectedRevision,0);
  const second=p.value.updateSettings({discovery:.9});await tick();p.resolveSettings(0);await first;await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===2);assert.equal(p.settingsRequests[1].body.discovery,.9);assert.equal(p.settingsRequests[1].body.expectedRevision,1);p.resolveSettings(1);await second;await tick();assert.equal(p.value.settings.discovery,.9);assert.equal(p.preferenceDraft?.pending,false);
 }finally{p.close();}
});

test("a revision conflict refreshes settings and keeps another device's newer same-field choice",async()=>{
 const p=await player({deferSettingsPatch:true});try{
  const change=p.value.updateSettings({discovery:.6});await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===1);p.conflictSettings({discovery:.85});await change;await tick();assert.equal(p.value.settings.discovery,.85);assert.equal(p.preferenceDraft?.pending,false);assert.equal(p.settingsRequests.length,1);
 }finally{p.close();}
});


test("an older offline intent cannot override a newer field choice that returned to its original value",async()=>{
 const p=await player({deferSettingsPatch:true,remoteSettings:{discovery:.35,fieldRevisions:{discovery:0}}});try{
  const change=p.value.updateSettings({discovery:.6});await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===1);p.remoteChoice({discovery:.9});p.conflictSettings({discovery:.35});await change;await tick();assert.equal(p.value.settings.discovery,.35);assert.equal(p.preferenceDraft?.pending,false);assert.equal(p.settingsRequests.length,1);
 }finally{p.close();}
});

test("a mounted artist editor cannot stage choices against a newer account baseline",async()=>{
 const p=await player({deferSettingsPatch:true,remoteSettings:{seedArtists:["A"],seedArtistSelections:[],fieldRevisions:{seedArtists:1,seedArtistSelections:1}}});try{
  const baseline=p.value.artistChoiceVersion;p.remoteChoice({seedArtists:["B"],seedArtistSelections:[]});await p.pollTaste();await until(()=>p.value.settings.seedArtists[0]==="B");
  await assert.rejects(p.value.updateSettings({seedArtists:["Stale draft"],seedArtistSelections:[]},{artistChoiceVersion:baseline}),(error:unknown)=>error instanceof UserFacingError&&error.status===409&&error.issue.kind==="validation");
  assert.deepEqual(p.value.settings.seedArtists,["B"]);assert.equal(p.settingsRequests.length,0);
 }finally{p.close();}
});

test("artist edit guards detect a remote change and revert even when visible choices match",async()=>{
 const p=await player({deferSettingsPatch:true,remoteSettings:{seedArtists:["A"],seedArtistSelections:[],fieldRevisions:{seedArtists:0,seedArtistSelections:0}}});try{
  const baseline=p.value.artistChoiceVersion;p.remoteChoice({seedArtists:["B"],seedArtistSelections:[]});p.remoteChoice({seedArtists:["A"],seedArtistSelections:[]});await p.pollTaste();await until(()=>p.value.artistChoiceVersion!==baseline);
  assert.deepEqual(p.value.settings.seedArtists,["A"]);await assert.rejects(p.value.updateSettings({seedArtists:["Stale draft"],seedArtistSelections:[]},{artistChoiceVersion:baseline}));assert.equal(p.settingsRequests.length,0);
 }finally{p.close();}
});

test("unrelated remote settings do not discard the artist editor baseline",async()=>{
 const p=await player({deferSettingsPatch:true,remoteSettings:{seedArtists:["A"],seedArtistSelections:[],fieldRevisions:{seedArtists:0,seedArtistSelections:0}}});try{
  const baseline=p.value.artistChoiceVersion;p.remoteChoice({volume:.31});await p.pollTaste();await until(()=>p.value.settings.volume===.31);assert.equal(p.value.artistChoiceVersion,baseline);
  const save=p.value.updateSettings({seedArtists:["New draft"],seedArtistSelections:[]},{artistChoiceVersion:baseline});await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===1);p.resolveSettings();await save;assert.deepEqual(p.value.settings.seedArtists,["New draft"]);
 }finally{p.close();}
});


test("an unchanged taste poll preserves cached stories and an active soundtrack request",async()=>{
 const p=await player({deferSmartQueue:true});try{
  p.invalidations.length=0;const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);await p.pollTaste();assert.deepEqual(p.invalidations,[]);assert.equal(p.value.smartQueueBusy,true);p.resolveSmart([song(4)]);await generated;await until(()=>p.value.track?.id===song(4).id&&p.value.status==="playing");
 }finally{p.close();}
});

test("reordered equivalent listening and feedback do not trigger another cache refresh",async()=>{
 const p=await player();try{
  const a={recordingId:song(1).id,audibleMs:1000,playCount:1,completedCount:0,skippedCount:0,lastPlayedAt:"2026-11-01T00:00:00Z",hourWeights:[{hour:1,audibleMs:500},{hour:2,audibleMs:500}]},b={...a,recordingId:song(2).id};const feedback=[{target:"recording",targetId:song(1).id,kind:"snooze",expiresAt:"2026-11-09T00:00:00Z"},{target:"recording",targetId:song(2).id,kind:"less",expiresAt:null}];
  p.setTaste({feedback,tasteEvidence:[a,b],historyClearedAt:null});await p.pollTaste();p.invalidations.length=0;p.setTaste({feedback:[...feedback].reverse(),tasteEvidence:[b,{...a,hourWeights:[...a.hourWeights].reverse()}],historyClearedAt:null});await p.pollTaste();assert.deepEqual(p.invalidations,[]);
 }finally{p.close();}
});

test("new listening updates the journal and Bloom shelf without resetting stories or a requested queue",async()=>{
 const p=await player({deferSmartQueue:true});try{
  p.invalidations.length=0;const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);p.setTaste({feedback:[],tasteEvidence:[{recordingId:song(1).id,audibleMs:1000,playCount:1,completedCount:0,skippedCount:0}],historyClearedAt:null});await p.pollTaste();assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/profile"),true);assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/history"),true);assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/"||item.prefix.includes("bloom")&&item.prefix!=="/api/v2/bloom/shelf"||item.dropData),false);assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/bloom/shelf"),true);assert.equal(p.value.smartQueueBusy,true);p.resolveSmart([song(4)]);await generated;await until(()=>p.value.track?.id===song(4).id&&p.value.status==="playing");
 }finally{p.close();}
});

test("feedback changes refresh recommendations while preserving Bloom and listening caches",async()=>{
 const p=await player({deferSmartQueue:true});try{
  p.invalidations.length=0;const generated=p.value.smartQueue();await until(()=>p.smartRequests.length===1);p.setTaste({feedback:[{target:"recording",targetId:song(4).id,kind:"snooze",expiresAt:null}],tasteEvidence:[],historyClearedAt:null});await p.pollTaste();assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/taste"),true);assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/"||item.prefix.includes("bloom")||item.prefix==="/api/v2/history"||item.prefix==="/api/v2/profile"||item.dropData),false);p.resolveSmart([song(4)]);await generated;await tick();assert.equal(p.value.track,null);
 }finally{p.close();}
});

test("feedback-only clearing leaves valid Bloom and listening data cached",async()=>{
 const p=await player();try{p.invalidations.length=0;p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"all"});await tick();assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/taste"),true);assert.equal(p.invalidations.some(item=>item.prefix==="/api/v2/"||item.prefix.includes("bloom")||item.prefix==="/api/v2/history"||item.prefix==="/api/v2/profile"||item.dropData),false);}finally{p.close();}
});


test("an immediate offline queue after a partial feedback clear keeps older exclusions",async()=>{
 const p=await player({offline:true});try{
  const blob=new Blob(["verified partial-clear audio"],{type:"audio/mpeg"});for(const index of [1,2,3]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}
  const old={target:"recording",targetId:song(1).id,kind:"block",expiresAt:null},recent={target:"recording",targetId:song(2).id,kind:"block",expiresAt:null};for(const feedback of [old,recent])p.dispatch("sakura-taste-updated",{accountId,feedback});
  p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"week",feedbackAuthoritative:true,tasteFeedback:[old]});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.equal(p.value.queue.some(entry=>entry.track.id===song(1).id),false);assert.equal(p.value.queue.some(entry=>entry.track.id===song(2).id),true);assert.equal((p.saved.get("personalization-evidence") as {feedback:unknown[]}).feedback.length,1);
 }finally{p.close();}
});

test("a legacy partial clear reply preserves known exclusions until authoritative refresh",async()=>{
 const p=await player({offline:true});try{
  const blob=new Blob(["verified legacy-clear audio"],{type:"audio/mpeg"});for(const index of [1,2]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}p.dispatch("sakura-taste-updated",{accountId,feedback:{target:"recording",targetId:song(1).id,kind:"block",expiresAt:null}});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"month"});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(2).id]);
 }finally{p.close();}
});


test("a feedback choice newer than the clear cutoff survives its delayed reply within one millisecond",async()=>{
 const p=await player({offline:true});try{
  const blob=new Blob(["verified ordered-clear audio"],{type:"audio/mpeg"});for(const index of [1,2,3]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}
  const old={target:"recording",targetId:song(1).id,kind:"block",expiresAt:null,updatedAt:"2026-11-08T00:00:00.000001Z"},newer={...old,targetId:song(2).id,updatedAt:"2026-11-08T00:00:00.000004Z"};p.dispatch("sakura-taste-updated",{accountId,feedback:old});p.dispatch("sakura-taste-updated",{accountId,feedback:newer});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"week",cutoff:"2026-11-08T00:00:00.000003Z",feedbackAuthoritative:true,tasteFeedback:[old]});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(3).id]);
 }finally{p.close();}
});

test("a newer undo cannot be reversed by an older clear reply",async()=>{
 const p=await player({offline:true});try{
  const blob=new Blob(["verified ordered-undo audio"],{type:"audio/mpeg"});for(const index of [1,2]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}
  const old={target:"recording",targetId:song(1).id,kind:"block",expiresAt:null,updatedAt:"2026-11-08T00:00:00.000001Z"};p.dispatch("sakura-taste-updated",{accountId,feedback:old});p.dispatch("sakura-taste-updated",{accountId,removedTargetId:song(1).id,target:"recording",mutationAt:"2026-11-08T00:00:00.000004Z"});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"week",cutoff:"2026-11-08T00:00:00.000003Z",feedbackAuthoritative:true,tasteFeedback:[old]});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.equal(p.value.queue.some(entry=>entry.track.id===song(1).id),true);
 }finally{p.close();}
});

test("a delayed pre-clear choice response cannot recreate an erased exclusion",async()=>{
 const p=await player({offline:true});try{
  const track=song(1),blob=new Blob(["verified erased-choice audio"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"all",cutoff:"2026-11-08T00:00:00.000003Z",feedbackAuthoritative:true,tasteFeedback:[]});p.dispatch("sakura-taste-updated",{accountId,feedback:{target:"recording",targetId:track.id,kind:"block",expiresAt:null,updatedAt:"2026-11-08T00:00:00.000002Z"}});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.equal(p.value.track?.id,track.id);
 }finally{p.close();}
});

test("a history-erasure response preserves feedback changed while its taste read was in flight",async()=>{
 const p=await player();try{
  p.holdTaste();await p.pollTaste();const feedback={target:"recording",targetId:song(1).id,kind:"block",expiresAt:null,updatedAt:"2026-11-08T00:00:00.000004Z"};p.dispatch("sakura-taste-updated",{accountId,feedback});p.resolveTaste({feedback:[],tasteEvidence:[],historyClearedAt:"2026-11-08T00:00:00Z",historyDeletion:{periodStart:null,clearedAt:"2026-11-08T00:00:00Z"}});await until(()=>p.historyClears.length>0);await tick();const retained=(p.saved.get("personalization-evidence") as {feedback:Array<typeof feedback>}).feedback;assert.equal(retained.length,1);assert.equal(retained[0].targetId,feedback.targetId);assert.equal(retained[0].updatedAt,feedback.updatedAt);
 }finally{p.close();}
});


test("older exclusions beyond the recent five hundred choices still apply to offline playback",async()=>{
 const p=await player();try{
  const choices=Array.from({length:500},(_,index)=>({target:"recording",targetId:song(index+2).id,kind:"block",expiresAt:null}));choices.push({target:"recording",targetId:song(1).id,kind:"block",expiresAt:null});p.setTaste({feedback:choices,tasteEvidence:[],historyClearedAt:null});await p.pollTaste();const blob=new Blob(["verified older-exclusion audio"],{type:"audio/mpeg"});for(const index of [1,502]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}await p.connection(false);await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.deepEqual(p.value.queue.map(entry=>entry.track.id),[song(502).id]);
 }finally{p.close();}
});


test("an older clear reply cannot restore choices erased by a newer clear",async()=>{
 const p=await player({offline:true});try{const track=song(1),blob=new Blob(["verified newer-clear audio"],{type:"audio/mpeg"});p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"all",cutoff:"2026-11-08T00:00:00.000005Z",feedbackAuthoritative:true,tasteFeedback:[]});p.dispatch("sakura-personalization-cleared",{accountId,scope:"feedback",period:"week",cutoff:"2026-11-08T00:00:00.000003Z",feedbackAuthoritative:true,tasteFeedback:[{target:"recording",targetId:track.id,kind:"block",expiresAt:null,updatedAt:"2026-11-01T00:00:00Z"}]});await p.value.smartQueue({scope:"downloads"});await until(()=>p.value.status==="playing");assert.equal(p.value.track?.id,track.id);}finally{p.close();}
});

for(const scope of ["history","all"] as const)for(const receipt of ["older","duplicate"] as const)test(`${receipt==="older"?"an":"a"} ${receipt} ${scope} clear receipt preserves newer listening and its current event`,async()=>{
 const p=await player({recordListening:true,clock:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");const newer="2026-11-08T00:00:00.000005Z";
  p.dispatch("sakura-personalization-cleared",{accountId,scope,period:"all",cutoff:newer,feedbackAuthoritative:true,tasteFeedback:[]});
  p.advance(1000);p.value.pause();await tick();p.value.togglePlay();await until(()=>p.value.status==="playing");p.advance(2000);
  const cutoff=receipt==="older"?"2026-11-08T00:00:00.000003Z":newer;
  p.dispatch("sakura-personalization-cleared",{accountId,scope,period:"week",cutoff,feedbackAuthoritative:true,tasteFeedback:[]});p.value.pause();await tick();
  assert.equal(p.delivered.reduce((sum,chunk)=>sum+Number(chunk.msPlayed),0),3000);
  assert.equal(new Set(p.delivered.map(chunk=>chunk.eventId)).size,1);
  assert.equal((p.saved.get("personalization-evidence") as {history:Array<{audibleMs:number}>}).history[0].audibleMs,3000);
  assert.equal(p.saved.get("personalization-clear-marker"),newer);
  assert.equal(p.historyClears.length,2);assert.equal(p.historyClears[1].period,"week");
 }finally{p.close();}
});

test("cross-device history clears retain their microsecond ordering within one millisecond",async()=>{
 const p=await player();try{
  const older="2026-11-08T00:00:00.000003Z",newer="2026-11-08T00:00:00.000005Z";
  p.dispatch("sakura-personalization-cleared",{accountId,scope:"history",period:"week",cutoff:older});await tick();
  p.setTaste({feedback:[],tasteEvidence:[],historyClearedAt:newer,historyDeletions:[{periodStart:"2026-11-01T00:00:00.000005Z",clearedAt:newer},{periodStart:null,clearedAt:older}]});await p.pollTaste();await tick();
  assert.equal(p.historyClears.length,2);assert.equal(p.historyClears[1].period,"week");assert.equal(p.saved.get("personalization-clear-marker"),newer);
 }finally{p.close();}
});

test("an in-flight history reconciliation cannot restore data erased by a newer clear",async()=>{
 const p=await player({recordListening:true,clock:true,deferHistoryClear:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");const older="2026-11-08T00:00:00.000003Z",newer="2026-11-08T00:00:00.000005Z";
  p.setTaste({feedback:[],tasteEvidence:[{recordingId:song().id,audibleMs:9000,playCount:1,completedCount:0,skippedCount:0}],historyClearedAt:older,historyDeletion:{periodStart:null,clearedAt:older}});await p.pollTaste();assert.equal(p.historyClears.length,1);
  p.dispatch("sakura-personalization-cleared",{accountId,scope:"history",period:"all",cutoff:newer});p.advance(1000);p.value.pause();await tick();
  p.resolveHistoryClear(0);await tick();await tick();
  assert.equal((p.saved.get("personalization-evidence") as {history:Array<{audibleMs:number}>}).history[0].audibleMs,1000);assert.equal(p.saved.get("personalization-clear-marker"),newer);
  p.resolveHistoryClear(1);
 }finally{p.close();}
});

test("a remote timezone change refreshes calendar views once and retains cached data",async()=>{
 const p=await player();try{
  p.invalidations.length=0;p.remoteChoice({timeZone:"Asia/Tokyo"});await p.pollTaste();await until(()=>p.value.settings.timeZone==="Asia/Tokyo");
  for(const prefix of ["/api/v2/profile","/api/v2/history","/api/v2/bloom/shelf"])assert.equal(p.invalidations.some(item=>prefix.startsWith(item.prefix)),true,prefix);
  assert.equal(p.invalidations.some(item=>item.dropData),false);
  p.invalidations.length=0;await p.pollTaste();assert.deepEqual(p.invalidations,[]);
 }finally{p.close();}
});

test("listening and feedback recorded during local history reconciliation survive its older snapshot",async()=>{
 const p=await player({recordListening:true,clock:true,deferHistoryClear:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");const cutoff="2026-11-08T00:00:00.000003Z";
  p.setTaste({feedback:[],tasteEvidence:[{recordingId:song().id,audibleMs:9000,playCount:1,completedCount:0,skippedCount:0}],historyClearedAt:cutoff,historyDeletion:{periodStart:"2026-11-01T00:00:00.000003Z",clearedAt:cutoff}});await p.pollTaste();
  const feedback={target:"recording",targetId:song(2).id,kind:"block",expiresAt:null,updatedAt:"2026-11-08T00:00:00.000005Z"};p.dispatch("sakura-taste-updated",{accountId,feedback});p.advance(1000);p.value.pause();await tick();p.resolveHistoryClear();await tick();await tick();
  const retained=p.saved.get("personalization-evidence") as {history:Array<{audibleMs:number}>;feedback:Array<typeof feedback>};assert.equal(retained.history[0].audibleMs,10000);assert.equal(retained.feedback[0].targetId,feedback.targetId);
 }finally{p.close();}
});


test("duplicate metadata and duration notifications cannot rewind an already restored transport",async()=>{
 const p=await player({bridge:false});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.value.seek(31500);p.media.currentTime=38.25;
  for(const event of ["loadedmetadata","durationchange","loadedmetadata"]){p.media.emit(event);await tick();}
  assert.equal(p.media.currentTime,38.25);p.media.emit("timeupdate");await tick();assert.equal(p.value.positionMs,38250);
 }finally{p.close();}
});

for(const duration of [Number.POSITIVE_INFINITY,Number.NaN])test(`initial playback with ${String(duration)} duration keeps advancing when metadata finally arrives`,async()=>{
 const p=await player({bridge:false,deferMetadata:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.duration=duration;p.media.currentTime=7.25;
  p.media.emit("timeupdate");await tick();assert.equal(p.value.positionMs,7250);
  p.media.metadata();await tick();assert.equal(p.media.currentTime,7.25);
  p.media.currentTime=9.5;p.media.emit("durationchange");p.media.emit("timeupdate");await tick();assert.equal(p.value.positionMs,9500);
 }finally{p.close();}
});

test("a replacement stream restores a saved position once even with an infinite duration",async()=>{
 const p=await player({bridge:false,deferMetadata:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.metadata();p.value.seek(31500);await tick();
  p.media.networkFailure();await tick();p.media.duration=Number.POSITIVE_INFINITY;p.media.emit("loadedmetadata");await tick();assert.equal(p.media.currentTime,31.5);
  p.media.currentTime=38.25;p.media.metadata();p.media.emit("timeupdate");await tick();assert.equal(p.value.positionMs,38250);
 }finally{p.close();}
});

for(const duration of [Number.POSITIVE_INFINITY,Number.NaN])test(`an advancing source with ${String(duration)} duration preserves its live position through recovery`,async()=>{
 const p=await player({bridge:false});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.duration=duration;p.media.currentTime=56.75;
  p.media.emit("timeupdate");await tick();assert.equal(p.value.positionMs,56750);p.media.networkFailure();await tick();
  assert.equal(p.media.currentTime,56.75);assert.equal(p.value.positionMs,56750);
 }finally{p.close();}
});

test("the original playback speed and pitch survive source replacement and unexpected browser rate changes",async()=>{
 const p=await player({bridge:false});try{
  p.value.play(song());await until(()=>p.value.status==="playing");
  p.media.playbackRate=1.2;p.media.defaultPlaybackRate=.8;p.media.preservesPitch=false;p.media.emit("ratechange");
  assert.equal(p.media.playbackRate,1);assert.equal(p.media.defaultPlaybackRate,1);assert.equal(p.media.preservesPitch,true);
  p.media.currentTime=32.5;p.media.networkFailure();await tick();assert.equal(p.media.playbackRate,1);assert.equal(p.media.currentTime,32.5);
 }finally{p.close();}
});

test("choosing None while an older audio technology save is pending keeps dry playback after acknowledgement and reconnect",async()=>{
 const p=await player({bridge:false,deferSettingsPatch:true});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=29;
  const enhanced=p.value.updateSettings({audioTechnology:"warmth"});await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===1);
  const original=p.value.updateSettings({audioTechnology:"none"});await tick();assert.equal(p.value.settings.audioTechnology,"none");assert.equal(p.soundModes.at(-1),"none");
  p.resolveSettings(0);await enhanced;assert.equal(p.value.settings.audioTechnology,"none");
  await new Promise(resolve=>setTimeout(resolve,210));await until(()=>p.settingsRequests.length===2);p.resolveSettings(1);await original;
  await p.connection(false);await p.connection(true);await tick();
  assert.equal(p.value.settings.audioTechnology,"none");assert.equal(p.preferenceDraft?.settings.audioTechnology,"none");assert.equal(p.soundModes.at(-1),"none");assert.equal(p.media.currentTime,29);assert.equal(p.value.status,"playing");
 }finally{p.close();}
});


test("repeated headset or OS Play commands keep an already playing recording and resume a paused one",async()=>{
 const p=await player({bridge:false});try{
  p.value.play(song());await until(()=>p.value.status==="playing");p.media.currentTime=42.5;
  p.mediaActions.get("play")!();p.mediaActions.get("play")!();await tick();assert.equal(p.value.status,"playing");assert.equal(p.media.currentTime,42.5);
  p.mediaActions.get("pause")!();await tick();assert.equal(p.value.status,"paused");p.mediaActions.get("play")!();await until(()=>p.value.status==="playing");assert.equal(p.media.currentTime,42.5);
 }finally{p.close();}
});

test("rapid duplicate like presses wait for one durable choice before sending its operation",async()=>{
 const p=await player({deferFavoriteStorage:true});try{
  const first=p.value.toggleLike(song()),second=p.value.toggleLike(song());await tick();assert.equal(p.favoriteRequests.length,0);assert.equal(p.favoriteWrites.length,1);assert.equal(p.value.liked.has(song().id),true);
  p.releaseFavoriteStorage();await Promise.all([first,second]);assert.equal(p.favoriteRequests.length,1);assert.ok(p.favoriteRequests[0].operationId);assert.deepEqual(p.favoriteAcks,[p.favoriteRequests[0].operationId]);assert.equal(p.value.liked.has(song().id),true);
 }finally{p.releaseFavoriteStorage();p.close();}
});

test("total favorite storage failure surfaces a notice and sends no undurable operation",async()=>{
 const p=await player({failFavoriteStorage:true});try{
  await p.value.toggleLike(song());assert.equal(p.favoriteRequests.length,0);assert.equal(p.favoriteAcks.length,0);assert.equal(p.value.notice?.issue.kind,"storage");
 }finally{p.close();}
});

test("a duplicate receipt adopts the newer remote unlike without resurrecting the song",async()=>{
 const p=await player({favoriteReceipt:{liked:false,accepted:true}});try{
  await p.value.toggleLike(song());assert.equal(p.favoriteRequests.length,1);assert.equal(p.favoriteAcks.length,1);assert.equal(p.value.liked.has(song().id),false);
 }finally{p.close();}
});

test("an unrelated favorite receipt cannot acknowledge a pending local choice",async()=>{
 const p=await player({favoriteReceipt:{operationId:"another-operation",accepted:true}});try{
  await p.value.toggleLike(song());assert.equal(p.favoriteAcks.length,0);assert.equal(p.value.liked.has(song().id),true);assert.ok(p.value.notice);
 }finally{p.close();}
});

for(const [label,response] of [
 ["empty",()=>({})],
 ["liked only",(change:{liked:boolean})=>({liked:change.liked})],
 ["missing operation ID",(change:{liked:boolean})=>({liked:change.liked,accepted:true})],
 ["missing acceptance",(change:{liked:boolean;operationId:string})=>({liked:change.liked,operationId:change.operationId})],
 ["missing confirmed choice",(change:{operationId:string})=>({operationId:change.operationId,accepted:true})],
 ["nonboolean confirmed choice",(change:{operationId:string})=>({liked:"yes",operationId:change.operationId,accepted:true})],
 ["explicit refusal",(change:{liked:boolean;operationId:string})=>({...change,accepted:false})],
] as const)test(`a ${label} 2xx favorite receipt retains its durable operation until a valid retry`,async()=>{
 let healthy=false;
 const p=await player({favoriteResponse:change=>healthy?{...change,accepted:true}:response(change)});
 try{
  await p.value.toggleLike(song());assert.equal(p.favoriteRequests.length,1);assert.equal(p.favoriteAcks.length,0);assert.equal(p.value.liked.has(song().id),true);assert.ok(p.value.notice);
  const original=p.favoriteRequests[0],durable=p.favoriteWrites.at(-1)?.[song().id];assert.equal(durable?.operationId,original.operationId);assert.equal(durable?.liked,true);
  healthy=true;await p.connection(true);await until(()=>p.favoriteAcks.length===1);
  assert.equal(p.favoriteRequests.length,2);assert.deepEqual(p.favoriteRequests[1],original);assert.deepEqual(p.favoriteAcks,[original.operationId]);assert.equal(p.value.liked.has(song().id),true);
 }finally{p.close();}
});

test("automatic continuation preserves manual picks and the playing recording",async()=>{
 const p=await player({autoplay:true});try{
  p.value.play(song(1));p.value.addQueue(song(3));await until(()=>p.value.status==="playing"&&p.value.queue.some(entry=>entry.track.id===song(4).id));
  assert.equal(p.value.track?.id,song(1).id);const current=p.value.queue.findIndex(entry=>entry.entryId===p.value.currentEntryId);assert.equal(p.value.queue[current+1].track.id,song(3).id);assert.equal(p.value.queue[current+1].priority,"manual");assert.ok(p.value.queue.some(entry=>entry.track.id===song(5).id&&entry.context==="autoplay"));
 }finally{p.close();}
});

test("a delayed automatic continuation cannot append against a newer selected song",async()=>{
 const p=await player({autoplay:true,deferSmartQueue:true});try{
  p.value.play(song(1));await until(()=>p.value.status==="playing"&&p.smartRequests.length===1);p.value.play(song(2));await until(()=>p.value.status==="playing"&&p.value.track?.id===song(2).id);
  p.resolveSmart([song(4)],0);await tick();await tick();assert.equal(p.value.track?.id,song(2).id);assert.equal(p.value.queue.some(entry=>entry.track.id===song(4).id),false);
 }finally{p.close();}
});

test("offline automatic continuation cycles verified saved songs without a resolver request",async()=>{
 const p=await player({autoplay:true,offline:true});try{
  const blob=new Blob(["saved offline continuation"],{type:"audio/mpeg"});for(const index of [1,2,3]){const track=song(index);p.saved.set("audio:"+track.id,{track,blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true});}
  p.value.play(song(1));await until(()=>p.value.status==="playing"&&p.value.queue.length>=3);assert.ok(p.value.queue.slice(1).every(entry=>entry.localOnly&&[song(2).id,song(3).id].includes(entry.track.id)));assert.equal(p.requests.some(path=>path==="/api/v2/smart-queue"||path.includes("recordings/resolve")),false);
 }finally{p.close();}
});

test("an automatic request yields to an explicit soundtrack action while it is pending",async()=>{
 const p=await player({autoplay:true,deferSmartQueue:true});try{
  p.value.play(song(1));await until(()=>p.value.status==="playing"&&p.smartRequests.length===1);const explicit=p.value.smartQueue({append:true});await until(()=>p.smartRequests.length===2);
  p.resolveSmart([song(4)],0);await tick();assert.equal(p.value.queue.some(entry=>entry.track.id===song(4).id),false);p.resolveSmart([song(5)],1);await explicit;assert.equal(p.value.queue.some(entry=>entry.track.id===song(5).id),true);
 }finally{p.close();}
});

test("canceling a download in its staging tick prevents an acquisition from starting",async()=>{
 const p=await player();try{
  p.value.requestDownload(song());p.value.cancelDownload(song().id);await tick();await tick();assert.deepEqual(p.enqueues,[]);assert.equal(Object.keys(p.entries).length,0);
 }finally{p.close();}
});
