import {sameBloomStory} from "./refresh";
import type {BloomPreparedStory,BloomRecap} from "./uiTypes";

export interface BloomPreparationProgress {phase:"story"|"assets"|"ready";completed:number;total:number;songsReady:number;songCount:number}
export interface BloomPreparedAssets {prepared:BloomPreparedStory;audioFor:(recording:Record<string,unknown>)=>{release:()=>void;sizeBytes?:number}|undefined;release:()=>void}
export interface BloomPreparationOptions {
 signal:AbortSignal;
 loadStory:()=>Promise<BloomPreparedStory>;
 expected?:BloomRecap;
 prepareAudio:(recording:Record<string,unknown>,signal:AbortSignal)=>Promise<{release:()=>void;sizeBytes?:number}>;
 prepareArtwork:(url:string,signal:AbortSignal)=>Promise<void>;
 preloadWorld:(prepared:BloomPreparedStory)=>Promise<unknown>;
 onProgress?:(progress:BloomPreparationProgress)=>void;
 validateStory?:(story:BloomRecap)=>void;
 limits?:()=>{maxRecordings:number;maxAudioBytes:number}|undefined;
}

function recordingKey(recording:Record<string,unknown>){
 const id=recording.recordingId||recording.id;
 if(typeof id==="string"&&id)return id;
 const reference=recording.reference as {provider?:string;scope?:string;id?:string}|undefined;
 if(reference?.provider&&reference.id)return `${reference.provider}:${reference.scope||""}:${reference.id}`;
 throw new Error("A song in this Bloom is missing its recording details. Refresh the story to try again.");
}

function abortable<T>(task:Promise<T>,signal:AbortSignal,timeoutMs?:number):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(value:T|unknown,error=false)=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);clearTimeout(timer);if(error)reject(value);else resolve(value as T);};
  const abort=()=>finish(signal.reason??new DOMException("Bloom preparation was cancelled","AbortError"),true);
  signal.addEventListener("abort",abort,{once:true});
  if(timeoutMs)timer=setTimeout(()=>finish(new Error("Bloom artwork is taking too long to load. Try preparing it again."),true),timeoutMs);
  task.then(value=>finish(value),error=>finish(error,true));if(signal.aborted)abort();
 });
}

/** Include music from every chapter collection and artist, even songs which
 * accompany a later scene or appear only on the completed poster. */
export function bloomAssetManifest(prepared:BloomPreparedStory){
 const recordings=new Map<string,Record<string,unknown>>(),artwork=new Set<string>();
 const addArtwork=(url:unknown)=>{if(typeof url==="string"&&url)artwork.add(url);};
 const addRecording=(recording:Record<string,unknown>|null|undefined)=>{if(!recording)return;recordings.set(recordingKey(recording),recording);addArtwork(recording.coverUrl);};
 for(const chapter of prepared.chapters){
  addRecording(chapter.relatedRecording);
  for(const entry of chapter.recordings||[])addRecording(entry.recording);
  for(const artist of chapter.artists||[]){addArtwork(artist.imageUrl);for(const entry of artist.recordings)addRecording(entry.recording);}
 }
 return {recordings:[...recordings.values()],artwork:[...artwork]};
}

/** Readiness is published only after all full verified audio capabilities and
 * artwork are available. Partial success is released on failure/cancellation. */
export async function prepareBloomAssets(options:BloomPreparationOptions):Promise<BloomPreparedAssets>{
 options.signal.throwIfAborted();
 const failedController=new AbortController(),signal=failedController.signal;
 const relayAbort=()=>failedController.abort(options.signal.reason??new DOMException("Bloom preparation was cancelled","AbortError"));
 options.signal.addEventListener("abort",relayAbort,{once:true});
 const releases:Array<()=>void>=[],audio=new Map<string,{release:()=>void}>();let released=false;
 const release=()=>{if(released)return;released=true;signal.removeEventListener("abort",abort);options.signal.removeEventListener("abort",relayAbort);audio.clear();for(const dispose of releases.splice(0))dispose();failedController.abort(new DOMException("Bloom viewing closed","AbortError"));};
 const abort=()=>release();signal.addEventListener("abort",abort,{once:true});
 try{
  options.onProgress?.({phase:"story",completed:0,total:1,songsReady:0,songCount:0});
  const prepared=await abortable(options.loadStory(),signal);signal.throwIfAborted();
  options.validateStory?.(prepared.story);
  if(options.expected&&!sameBloomStory(options.expected,prepared.story))throw new Error("This Bloom has changed. Refresh the story to prepare its new soundtrack.");
  if(prepared.chapters.length!==prepared.story.chapters.length||prepared.chapters.some((chapter,index)=>chapter.id!==prepared.story.chapters[index]?.id||!chapter.stat))throw new Error("This Bloom's story has not finished preparing. Refresh to try again.");
  const manifest=bloomAssetManifest(prepared),total=manifest.recordings.length+manifest.artwork.length+1;
  const limits=options.limits?.();if(limits&&manifest.recordings.length>limits.maxRecordings)throw new Error("This Bloom will finish saving when you open its welcome screen.");
  let completed=0,songsReady=0,audioBytes=0;
  const progress=(ready=false)=>options.onProgress?.({phase:ready?"ready":"assets",completed,total,songsReady,songCount:manifest.recordings.length});
  progress();
  const tasks:Array<()=>Promise<void>>=[async()=>{await abortable(options.preloadWorld(prepared),signal);signal.throwIfAborted();completed++;progress();},
   ...manifest.artwork.map(url=>async()=>{await abortable(options.prepareArtwork(url,signal),signal,15000);signal.throwIfAborted();completed++;progress();}),
   ...manifest.recordings.map(recording=>async()=>{let capabilityReleased=false;const releaseCapability=(capability:{release:()=>void})=>{if(!capabilityReleased){capabilityReleased=true;capability.release();}};const pending=options.prepareAudio(recording,signal);void pending.then(capability=>{if(signal.aborted||released)releaseCapability(capability);},()=>{});const capability=await abortable(pending,signal);if(signal.aborted||released){releaseCapability(capability);signal.throwIfAborted();throw new Error("Bloom preparation was cancelled.");}const limits=options.limits?.(),size=capability.sizeBytes;if(limits&&(!Number.isSafeInteger(size)||size!<=0||audioBytes+size!>limits.maxAudioBytes)){releaseCapability(capability);throw new Error("This Bloom will finish saving when you open its welcome screen.");}audioBytes+=size||0;audio.set(recordingKey(recording),capability);releases.push(()=>releaseCapability(capability));songsReady++;completed++;progress();})];
  let next=0,failed:unknown;
  // Three consumers limit metadata/storage work; the shared download scheduler
  // gives active playback and explicit saves priority over these full files.
  await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{
   while(next<tasks.length&&!failed&&!signal.aborted){const task=tasks[next++];try{await task();}catch(error){failed=error;failedController.abort(error);release();}}
  }));
  if(failed)throw failed;signal.throwIfAborted();
  const finalLimits=options.limits?.();if(finalLimits&&(manifest.recordings.length>finalLimits.maxRecordings||audioBytes>finalLimits.maxAudioBytes))throw new Error("This Bloom will finish saving when you open its welcome screen.");
  options.validateStory?.(prepared.story);progress(true);
  return {prepared,audioFor:recording=>released?undefined:audio.get(recordingKey(recording)),release};
 }catch(error){release();signal.removeEventListener("abort",abort);throw error;}
}
