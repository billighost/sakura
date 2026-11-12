"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useMusic,type PreparedPlaybackAudio} from "../app/MusicContext";
import {musicTrack,type MusicTrack} from "../app/types";
import {localDelete,localRead,localWrite} from "../app/offline";
import {requestJson} from "../app/errors";
import {retainArtwork} from "../player/imageCache";
import {sameOriginArtworkUrl} from "../player/imageUrl";
import {bloomDesignForItem} from "./design";
import {sameBloomStory} from "./refresh";
import {prepareBloomAssets,bloomAssetManifest,type BloomPreparationProgress,type BloomPreparedAssets} from "./preparation";
import {BloomPreparationIdentity,bloomPreparationScope,requireBloomOpening} from "./preparationIdentity";
import {BLOOM_SPECULATIVE_LIMITS,bloomSpeculationPool} from "./speculation";
import {preloadBloomWorld} from "./worlds/preload";
import type {BloomPreparedStory,BloomRecap} from "./uiTypes";

export interface BloomPreparationState {ready:boolean;progress:BloomPreparationProgress|null;error:unknown;prepared?:BloomPreparedStory}
const EMPTY:BloomPreparationState={ready:false,progress:null,error:null};
type Entry={accountId:string;id:string;controller:AbortController;identity:BloomPreparationIdentity;mode:"detail"|"speculative";state:BloomPreparationState;listeners:Set<(state:BloomPreparationState)=>void>;users:number;details:number;task:Promise<BloomPreparedAssets>;assets?:BloomPreparedAssets;timer?:ReturnType<typeof setTimeout>};
const entries=new Map<string,Entry>(),erasures=new Map<string,number>();
const keyFor=(accountId:string,id:string)=>`${accountId}:${id}`;
const savedKey=(id:string)=>`bloom-prepared:${id}`;
function erasedAt(accountId:string){try{return Math.max(Number(localStorage.getItem("sakura-v2-listening-resource-erased:"+accountId))||0,Number(localStorage.getItem("sakura-bloom-preparation-erased:"+accountId))||0);}catch{return 0;}}
function eraseGeneration(accountId:string){return erasures.get(accountId)||0;}
function dispose(entry:Entry){entry.controller.abort();entry.assets?.release();clearTimeout(entry.timer);if(entries.get(keyFor(entry.accountId,entry.id))===entry)entries.delete(keyFor(entry.accountId,entry.id));entry.state=EMPTY;for(const listener of entry.listeners)listener(EMPTY);}
function revokeAccount(accountId:string,remember=true){if(remember)try{localStorage.setItem("sakura-bloom-preparation-erased:"+accountId,String(Math.max(Date.now(),erasedAt(accountId))));}catch{}erasures.set(accountId,eraseGeneration(accountId)+1);for(const entry of entries.values())if(entry.accountId===accountId){dispose(entry);entry.state={...EMPTY,error:new Error("This listening story was removed. Refresh Bloom to continue.")};for(const listener of entry.listeners)listener(entry.state);void localDelete(accountId,savedKey(entry.id)).catch(()=>{});}}

if(typeof window!=="undefined"){
 const revoke=(event:Event)=>{const detail=(event as CustomEvent<{accountId?:string;scope?:string}>).detail;if(detail?.accountId&&detail.scope!=="feedback")revokeAccount(detail.accountId);};
 window.addEventListener("sakura-listening-erased",revoke);window.addEventListener("sakura-personalization-cleared",revoke);
 window.addEventListener("storage",event=>{const prefix="sakura-bloom-preparation-erased:";if(event.key?.startsWith(prefix))revokeAccount(event.key.slice(prefix.length),false);});
 window.addEventListener("pagehide",()=>{for(const entry of entries.values())dispose(entry);});
}

type PrepareAudio=(track:MusicTrack,signal:AbortSignal,options?:{complete?:boolean})=>Promise<PreparedPlaybackAudio>;
function acquire(accountId:string,id:string,prepareAudio:PrepareAudio,initial?:BloomRecap,archival=false,mode:"detail"|"speculative"="detail"){
 const key=keyFor(accountId,id);let entry=entries.get(key);
 for(const candidate of entries.values())if(candidate.mode==="speculative"&&candidate!==entry)dispose(candidate);
 if(entry){try{entry.controller.signal.throwIfAborted();if(initial)entry.identity.expect(initial);if(mode==="detail"&&entry.state.error)throw entry.state.error;}catch{dispose(entry);entry=undefined;}}
 if(entry&&mode==="detail")entry.mode="detail";
 if(!entry){
  const controller=new AbortController(),generation=eraseGeneration(accountId),erasure=erasedAt(accountId);
  const current=()=>{controller.signal.throwIfAborted();if(generation!==eraseGeneration(accountId)||erasure!==erasedAt(accountId))throw new DOMException("Listening history changed","AbortError");};
  entry={accountId,id,controller,identity:new BloomPreparationIdentity(initial),mode,state:EMPTY,listeners:new Set(),users:0,details:0,task:undefined as unknown as Promise<BloomPreparedAssets>};
  entries.set(key,entry);const owner=entry;
  const publish=(state:BloomPreparationState)=>{if(controller.signal.aborted)return;owner.state=state;for(const listener of owner.listeners)listener(state);};
  const loadStory=async()=>{
   current();let prepared:BloomPreparedStory;
   if(archival&&initial)prepared={story:initial,chapters:initial.chapters,listening:initial.listening};
   else if(navigator.onLine===false){
    const saved=await localRead<{prepared:BloomPreparedStory;updatedAt:number}>(accountId,savedKey(id));current();
    if(!saved||saved.updatedAt<=erasure)throw new Error("This Bloom has not been prepared on this device. Reconnect to save its story and soundtrack.");
    prepared=saved.prepared;
   }else prepared=await requestJson<BloomPreparedStory>(`/api/v2/bloom/${encodeURIComponent(id)}/prepare`,{method:"POST",signal:controller.signal},{context:"page",accountId});
   current();owner.identity.accept(prepared.story);requireBloomOpening(prepared.story);
   return prepared;
  };
  owner.task=prepareBloomAssets({signal:controller.signal,loadStory,
   validateStory:story=>{current();owner.identity.check(story);requireBloomOpening(story);},
   limits:()=>owner.mode==="speculative"?BLOOM_SPECULATIVE_LIMITS:undefined,
   prepareAudio:(recording,signal)=>prepareAudio(musicTrack(recording),signal,{complete:true}),
   prepareArtwork:async(url,signal)=>{signal.throwIfAborted();const address=sameOriginArtworkUrl(url);if(!address)throw new Error("This Bloom's artwork could not be prepared.");await retainArtwork(address,false,{signal,timeoutMs:15000});signal.throwIfAborted();},
   preloadWorld:async prepared=>{await Promise.all([preloadBloomWorld(bloomDesignForItem(prepared.story)),import("./BloomStory")]);current();},
   onProgress:progress=>publish({...owner.state,progress,error:null}),
  }).then(async assets=>{
   try{current();owner.identity.check(assets.prepared.story);requireBloomOpening(assets.prepared.story);await localWrite(accountId,savedKey(id),{prepared:assets.prepared,updatedAt:Date.now()});current();owner.identity.check(assets.prepared.story);requireBloomOpening(assets.prepared.story);}catch(error){assets.release();throw error;}
   owner.assets=assets;publish({...owner.state,ready:true,prepared:assets.prepared,error:null});return assets;
  }).catch(error=>{publish({...owner.state,ready:false,error});throw error;});
  void owner.task.catch(()=>{});
 }
 clearTimeout(entry.timer);entry.users++;if(mode==="detail")entry.details++;
 const owner=entry;let released=false;
 return {entry:owner,release:()=>{if(released)return;released=true;owner.users--;if(mode==="detail")owner.details--;if(owner.details===0)owner.mode="speculative";if(owner.users===0){if(mode==="speculative")dispose(owner);else owner.timer=setTimeout(()=>{if(owner.users===0)dispose(owner);},1500);}else if(owner.details===0&&owner.assets){const manifest=bloomAssetManifest(owner.assets.prepared),bytes=manifest.recordings.reduce((sum,recording)=>sum+(owner.assets!.audioFor(recording)?.sizeBytes||Infinity),0);if(manifest.recordings.length>BLOOM_SPECULATIVE_LIMITS.maxRecordings||bytes>BLOOM_SPECULATIVE_LIMITS.maxAudioBytes)dispose(owner);}}};
}

/** Shelf and detail subscribers share the same preparation and retained full
 * files. The short grace period transfers ownership during client navigation. */
export function useBloomPreparation(accountId:string|null,id:string|null,initial?:BloomRecap,archival=false,enabled=true,mode:"detail"|"speculative"="detail"){
 const music=useMusic(),latest=useRef(music);
 useEffect(()=>{latest.current=music;},[music]);
 const previousAccount=useRef(accountId);
 useEffect(()=>{const previous=previousAccount.current;previousAccount.current=accountId;if(previous&&previous!==accountId)for(const entry of entries.values())if(entry.accountId===previous)dispose(entry);},[accountId]);
 const [version,setVersion]=useState(0),[state,setState]=useState<{key:string|null;value:BloomPreparationState}>({key:null,value:EMPTY});
 const key=accountId&&id?keyFor(accountId,id):null,scope=initial?bloomPreparationScope(initial):"";
 const lease=useRef<ReturnType<typeof acquire>|null>(null);
 useEffect(()=>{if(enabled&&key&&mode==="detail")return bloomSpeculationPool.detail(key);},[enabled,key,mode]);
 useEffect(()=>{
  if(!accountId||!id||!enabled)return;
  if(mode==="speculative"&&!bloomSpeculationPool.allows(keyFor(accountId,id)))return;
  const held=acquire(accountId,id,(track,signal,options)=>{if(latest.current.account?.id!==accountId)return Promise.reject(new DOMException("Account changed","AbortError"));return latest.current.preparePlaybackAudio(track,signal,options);},initial,archival,mode);lease.current=held;
  const listener=(value:BloomPreparationState)=>setState({key:keyFor(accountId,id),value});held.entry.listeners.add(listener);listener(held.entry.state);
  return()=>{held.entry.listeners.delete(listener);held.release();if(lease.current===held)lease.current=null;};
  // Story receipts may update frequently; only the immutable snapshot identity
  // and chapter structure replace the assets retained for this viewing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[accountId,id,scope,archival,enabled,version,mode]);
 const retry=useCallback(()=>{if(key){const entry=entries.get(key);if(entry)dispose(entry);}setVersion(value=>value+1);},[key]);
 const prepare=useCallback(async()=>{const held=lease.current;if(!held||keyFor(held.entry.accountId,held.entry.id)!==key)throw new Error("Bloom preparation has not started yet.");held.entry.controller.signal.throwIfAborted();const assets=await held.entry.task;held.entry.controller.signal.throwIfAborted();held.entry.identity.check(assets.prepared.story,initial);requireBloomOpening(assets.prepared.story);return assets.prepared;},[initial,key]);
 const playback=useCallback((recording:Record<string,unknown>):PreparedPlaybackAudio|undefined=>{const held=lease.current;if(!held||held.entry.controller.signal.aborted||keyFor(held.entry.accountId,held.entry.id)!==key)return;try{if(held.entry.assets){held.entry.identity.check(held.entry.assets.prepared.story,initial);requireBloomOpening(held.entry.assets.prepared.story);}}catch{return;}const capability=held.entry.assets?.audioFor(recording) as PreparedPlaybackAudio|undefined;return capability?{...capability,release:()=>{}}:undefined;},[initial,key]);
 useEffect(()=>{const restore=(event:PageTransitionEvent)=>{if(event.persisted)setVersion(value=>value+1);};window.addEventListener("pageshow",restore);return()=>window.removeEventListener("pageshow",restore);},[]);
 const matching=state.key===key&&(!initial||!state.value.prepared||sameBloomStory(initial,state.value.prepared.story));
 return {...(matching?state.value:EMPTY),retry,prepare,playback};
}

export function useBloomSpeculativeOwnership(key:string|null,eligible:boolean,priority:number){
 const [state,setState]=useState<{key:string|null;granted:boolean}>({key:null,granted:false});
 useEffect(()=>{if(eligible&&key)return bloomSpeculationPool.request(key,priority,granted=>setState({key,granted}));},[eligible,key,priority]);
 return eligible&&state.key===key&&state.granted;
}
