"use client";
import type {DownloadEntry,MusicTrack} from "./types";
import {validOfflineAudio,invalidateSavedAudioMetadata,type OfflineAudio} from "./offline";
import {indexedDownloadStorage} from "./downloadStorage";
import {audioSha256,DownloadIntegrityError,fetchAudioRange,OPENING_AUDIO_BYTES} from "./downloadRange";
import {id3v2TagBytes,isMpegAudioFrameHeader} from "../core/audioLayout";
import {UserFacingError} from "./errors";
import type {DownloadChunk,DownloadFingerprint,DownloadSource,DownloadStorage,PartialDownloadRecord,PreparedFullAudio} from "./downloadTypes";
export type {DownloadSource,DownloadStorage,DownloadFingerprint,PartialDownloadRecord} from "./downloadTypes";

const CHUNK_BYTES=256*1024,MAX_BYTES=120*1024*1024,PRIORITY_WARMUP_MS=200,PLAYBACK_READ_AHEAD_CHUNKS=3;
const AUDIO_OPENING_WINDOW_BYTES=128*1024;
const sparseOpeningEnd=(offset:number,size:number)=>Math.min(size,Math.ceil((offset+OPENING_AUDIO_BYTES)/CHUNK_BYTES)*CHUNK_BYTES);
const activeStatus=(status:DownloadEntry["status"])=>["queued","resolving","downloading"].includes(status);
const connected=()=>typeof navigator==="undefined"||navigator.onLine!==false;
const sameFingerprint=(a:DownloadFingerprint|undefined,b:DownloadFingerprint)=>!!a&&a.sizeBytes===b.sizeBytes&&a.sha256===b.sha256;
const referenceKey=(track:MusicTrack)=>JSON.stringify([track.reference.provider,track.reference.scope||"",track.reference.id]);
const id=()=>typeof crypto.randomUUID==="function"?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now();
const preparationOwnerKey="sakura-v2-audio-preparation-owner",preparationCleanupKey="sakura-v2-audio-preparation-cleanup";
interface PendingPreparationCleanup {accountId:string;ownerPrefix:string;createdAt:number}
let documentPreparationOwner:string|undefined;
function persistPreparationOwner(owner:string){documentPreparationOwner=owner;if(typeof sessionStorage!=="undefined")try{sessionStorage.setItem(preparationOwnerKey,owner);}catch{}return owner;}
function pendingPreparationCleanups():PendingPreparationCleanup[]{
 if(typeof sessionStorage==="undefined")return [];
 try{const value=JSON.parse(sessionStorage.getItem(preparationCleanupKey)||"[]"),cutoff=Date.now()-10*60*1000;if(!Array.isArray(value))return [];return value.filter((item):item is PendingPreparationCleanup=>typeof item?.accountId==="string"&&item.accountId.length>0&&typeof item?.ownerPrefix==="string"&&item.ownerPrefix.length>0&&Number.isFinite(item.createdAt)&&item.createdAt>cutoff).slice(-32);}catch{return [];}
}
function writePreparationCleanups(items:PendingPreparationCleanup[]){if(typeof sessionStorage==="undefined")return;try{if(items.length)sessionStorage.setItem(preparationCleanupKey,JSON.stringify(items.slice(-32)));else sessionStorage.removeItem(preparationCleanupKey);}catch{}}
function rememberPreparationCleanup(accountId:string,ownerPrefix:string){writePreparationCleanups([...pendingPreparationCleanups().filter(item=>item.accountId!==accountId||item.ownerPrefix!==ownerPrefix),{accountId,ownerPrefix,createdAt:Date.now()}]);}
function forgetPreparationCleanup(accountId:string,ownerPrefix:string){writePreparationCleanups(pendingPreparationCleanups().filter(item=>item.accountId!==accountId||item.ownerPrefix!==ownerPrefix));}
function tabPreparationOwner(){
 if(documentPreparationOwner)return documentPreparationOwner;
 const fresh=()=>persistPreparationOwner(id());
 if(typeof sessionStorage==="undefined")return fresh();
 try{
  const navigation=typeof performance!=="undefined"?performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming|undefined:undefined,saved=sessionStorage.getItem(preparationOwnerKey);
  if(saved&&navigation?.type==="reload")return persistPreparationOwner(saved);writePreparationCleanups([]);return fresh();
 }catch{return fresh();}
}
const rotateTabPreparationOwner=()=>persistPreparationOwner(id());
const recoverableTransfer=(error:unknown)=>error instanceof UserFacingError
 ? ["connection","offline","busy"].includes(error.issue.kind)
 : error instanceof Error&&error.name!=="AbortError"&&/connection|network|failed to fetch|fetch failed|load failed|socket|terminated|timed? ?out|timeout|audio download did not start/i.test(error.message);
function waitForRetry(signal:AbortSignal,delay:number):Promise<void>{return new Promise((resolve,reject)=>{const finish=()=>{signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(finish,delay);const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(signal.reason??new DOMException("Canceled","AbortError"));};signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});}
interface Job {
 record:PartialDownloadRecord;entry:DownloadEntry;source?:DownloadSource;chunks:Map<number,DownloadChunk>;
 opening?:DownloadChunk;openingFlights?:Map<number,Promise<DownloadChunk|undefined>>;openingOffsets?:Set<number>;
 openingSpans?:Map<number,{end:number;done?:boolean;error?:unknown;bulk?:boolean}>;
 openingWaiters?:Map<number,Set<{resolve:(chunk:DownloadChunk|undefined)=>void;reject:(error:unknown)=>void}>>;
 fragmentPlayback?:boolean;
 controller:AbortController;active:Set<number>;loading:boolean;rangeReady:boolean;lease:boolean;leaseWaiting:boolean;
 leaseReady:boolean;
 releaseLease?:()=>void;leaseTimer?:ReturnType<typeof setInterval>;retryTimer?:ReturnType<typeof setTimeout>;
 fallbackOwner?:string;
 leaseDrain?:Promise<void>;
 lastServed:number;epoch:number;promise:Promise<void>;resolve:()=>void;reject:(error:unknown)=>void;settled:boolean;
 urgent:Set<number>;waiters:Map<number,Set<{opening:boolean;resolve:(chunk:DownloadChunk|undefined)=>void;reject:(error:unknown)=>void}>>;
 chunkControllers:Map<number,AbortController>;
 io:Promise<void>;inFlightBytes:Map<number,number>;lastPaint:number;
 warmingAt:number;
 committing:boolean;
 wholeFlight?:{epoch:number;offset:number};
 needsZeroProbe?:boolean;
 recoveryAttempts:number;recoveryTimer?:ReturnType<typeof setTimeout>;
 chunksLoaded:boolean;chunkLoad?:Promise<boolean>;
}
interface FullPreparation {recordingId:string;originalId:string;targetId?:string;owner:string;controller:AbortController;io:Promise<void>;timer?:ReturnType<typeof setInterval>;release:()=>void}
export interface DownloadManagerOptions {
 accountId:string;resolve:(track:MusicTrack,signal:AbortSignal,options?:{refresh?:boolean})=>Promise<DownloadSource>;
 onChange:(entries:Record<string,DownloadEntry>)=>void;onError?:(error:unknown,track:MusicTrack)=>void;
 fetcher?:typeof fetch;storage?:DownloadStorage;maxConcurrentChunks?:number;maxChunksPerSong?:number;chunkBytes?:number;
 idleTimeoutMs?:number;
 /** Source refreshes after a range exhausts its immediate retries. */
 maxRecoveryAttempts?:number;recoveryDelayMs?:number;
}

/** Account-scoped jobs yield after every chunk so queue edits can change priority. */
export class DurableDownloadManager {
 private storage:DownloadStorage;private jobs=new Map<string,Job>();private aliases=new Map<string,string>();
 private complete:Record<string,DownloadEntry>={};private active=0;private resolving=0;private scheduled=false;private stopped=false;
 private openingActive=0;private openingWaiting=0;
 private deleting=new Map<string,Promise<void>>();private pruning:Promise<void>|undefined;
 private promotions=new Map<string,Promise<void>>();
 private sequence=0;private priorityIds:string[]=[];private currentId:string|undefined;private owner=id();private preparationOwner=tabPreparationOwner();
 private channel:BroadcastChannel|undefined;
 private priorityWake:ReturnType<typeof setTimeout>|undefined;private pruneAgain=false;
 private fullPreparations=new Set<FullPreparation>();private ownedPreparations=new Set<string>();
 private speculativeOwners=new Map<string,MusicTrack>();
 private online=()=>{for(const job of this.jobs.values()){if(job.entry.status==="failed"&&job.record.requested)void this.resume(job.record.recordingId).catch(()=>{});else if(activeStatus(job.entry.status))this.schedule();}};
 private offline=()=>this.suspendForConnection();
 constructor(private options:DownloadManagerOptions){
  this.storage=options.storage||indexedDownloadStorage(options.accountId);
  void this.drainPreparationCleanups();
  if(typeof window!=="undefined"){window.addEventListener("online",this.online);window.addEventListener("offline",this.offline);if("BroadcastChannel" in window){this.channel=new BroadcastChannel("sakura-downloads:"+options.accountId);this.channel.addEventListener("message",event=>{const message=event.data;if(message?.sender===this.owner||typeof message?.recordingId!=="string")return;if(message.type==="removed")this.externalRemoval(message.recordingId);else if(message.type==="saved")void this.externalSaved(message.recordingId);});}}
  if(!Number.isInteger(this.chunkBytes)||this.chunkBytes<1024||this.chunkBytes>4*1024*1024)throw new Error("Download chunks must be between 1KB and 4MB.");
  for(const limit of [options.maxConcurrentChunks??4,options.maxChunksPerSong??2])if(!Number.isInteger(limit)||limit<1||limit>12)throw new Error("Download concurrency must be between one and twelve.");
  if(!Number.isInteger(options.maxRecoveryAttempts??3)||(options.maxRecoveryAttempts??3)<0||(options.maxRecoveryAttempts??3)>12)throw new Error("Download recovery attempts must be between zero and twelve.");
  if(!Number.isFinite(options.recoveryDelayMs??1000)||(options.recoveryDelayMs??1000)<0)throw new Error("Download recovery delay must be non-negative.");
 }
 private get chunkBytes(){return this.options.chunkBytes??CHUNK_BYTES;}
 private snapshot(){return {...this.complete,...Object.fromEntries([...this.jobs].map(([key,job])=>[key,{...job.entry}]))};}
 private emit(){if(!this.stopped)this.options.onChange(this.snapshot());}
 private broadcastRemoval(recordingId:string){this.channel?.postMessage({type:"removed",recordingId,sender:this.owner});}
 private broadcastSaved(recordingId:string){this.channel?.postMessage({type:"saved",recordingId,sender:this.owner});}
 private externalRemoval(recordingId:string){if(this.stopped)return;invalidateSavedAudioMetadata(this.options.accountId);const job=this.jobs.get(recordingId);if(job){job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(recordingId);const error=new DOMException("Removed in another tab","AbortError");this.rejectChunks(job,error);this.settle(job,error);}delete this.complete[recordingId];this.emit();this.schedule();}
 private async externalSaved(recordingId:string){invalidateSavedAudioMetadata(this.options.accountId);const saved=await this.storage.ready(recordingId);if(this.stopped||!saved)return;const job=this.jobs.get(recordingId);if(job){job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(recordingId);this.rejectChunks(job,new DOMException("Completed in another tab","AbortError"));this.settle(job);}this.complete[recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job?.entry.operationId||id(),sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.emit();this.schedule();}
 private jobFor(trackOrId:MusicTrack|string){return this.jobs.get(typeof trackOrId==="string"?(this.aliases.get(trackOrId)||trackOrId):(this.aliases.get(referenceKey(trackOrId))||this.aliases.get(trackOrId.id)||trackOrId.id));}
 private resetPromise(job:Job){if(!job.settled)return;job.settled=false;job.promise=new Promise<void>((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});void job.promise.catch(()=>{});}
 private settle(job:Job,error?:unknown){if(job.settled)return;job.settled=true;if(error)job.reject(error);else job.resolve();}
 private isCurrent(job:Job,epoch:number){return !this.stopped&&job.epoch===epoch&&this.jobs.get(job.record.recordingId)===job;}
 private newJob(record:PartialDownloadRecord):Job {
  const job:Job={record,entry:{recordingId:record.recordingId,track:record.track,status:record.status,downloadedBytes:Number.isSafeInteger(record.downloadedBytes)?Math.max(0,Math.min(record.fingerprint?.sizeBytes??MAX_BYTES,record.downloadedBytes!)):0,cachedSeconds:Number.isFinite(record.cachedSeconds)?Math.max(0,Math.min(record.track.durationMs/1000,record.cachedSeconds!)):0,totalBytes:record.fingerprint?.sizeBytes??null,operationId:id(),requested:record.requested,mode:record.mode,updatedAt:record.updatedAt,error:record.error},controller:new AbortController(),chunks:new Map(),chunksLoaded:!record.fingerprint,active:new Set(),loading:false,rangeReady:false,lease:false,leaseWaiting:false,leaseReady:false,lastServed:0,epoch:0,promise:Promise.resolve(),resolve:()=>{},reject:()=>{},settled:true,urgent:new Set(),waiters:new Map(),chunkControllers:new Map(),io:Promise.resolve(),inFlightBytes:new Map(),lastPaint:0,warmingAt:Date.now(),committing:false,recoveryAttempts:0};
  this.resetPromise(job);return job;
 }
 private async withIO(job:Job,epoch:number,operation:()=>Promise<void>):Promise<boolean>{let performed=false;const flight=job.io.catch(()=>{}).then(async()=>{if(!this.isCurrent(job,epoch))return;await operation();performed=true;});job.io=flight.catch(()=>{});await flight;return performed;}
 private async save(job:Job){job.record={...job.record,status:job.entry.status,requested:!!job.entry.requested,updatedAt:Date.now(),error:job.entry.error,downloadedBytes:job.entry.downloadedBytes,cachedSeconds:job.entry.cachedSeconds};job.entry.mode=job.record.mode;job.entry.updatedAt=job.record.updatedAt;if(job.committing)return;const record={...job.record};await this.withIO(job,job.epoch,()=>this.storage.save(record));}
 private updateBytes(job:Job){const loaded=[...job.chunks.values()].reduce((sum,chunk)=>sum+chunk.blob.size,0),committed=job.chunksLoaded?loaded:Math.max(loaded,job.record.downloadedBytes??0);job.entry.downloadedBytes=committed+[...job.inFlightBytes].reduce((sum,[offset,bytes])=>sum+(job.chunks.has(offset)?0:bytes),0);job.entry.totalBytes=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??null;job.entry.mode=job.record.mode;job.entry.cachedSeconds=job.entry.totalBytes?Math.min(job.record.track.durationMs/1000,Math.floor(committed/job.entry.totalBytes*job.record.track.durationMs/1000)):0;job.entry.activeChunks=job.active.size;}
 async hydrate():Promise<void>{
  const [audio,records]=await Promise.all([this.storage.allReadyMetadata?this.storage.allReadyMetadata():this.storage.allReady(),this.storage.list()]);if(this.stopped)return;const byId=new Map(records.map(record=>[record.recordingId,record]));
  for(const value of audio){const record=byId.get(value.track.id),requested=value.requested!==false||!!record?.requested;this.complete[value.track.id]={recordingId:value.track.id,track:value.track,status:"ready",downloadedBytes:value.sizeBytes,totalBytes:value.sizeBytes,operationId:id(),sha256:value.sha256,requested:value.requested!==false,mode:"full",updatedAt:value.savedAt};if(requested&&(value.requested===false||record))await this.promoteComplete(value.track.id,value.track,true).catch(()=>{});else if(record){const stored=await this.storage.ready(value.track.id);if(stored)await this.storage.finalize(value.track.id,stored);}if(this.stopped)return;}
  for(const record of records){if(this.complete[record.recordingId]||this.jobs.has(record.recordingId)||!Number.isSafeInteger(record.chunkBytes)||record.chunkBytes<1024||record.chunkBytes>4*1024*1024||!["full","prefix","playback"].includes(record.mode)||!["queued","resolving","downloading","paused","prepared","failed"].includes(record.status)||record.playbackOffset!==undefined&&(!Number.isSafeInteger(record.playbackOffset)||record.playbackOffset<0||record.playbackOffset%record.chunkBytes!==0)||record.fingerprint&&(!/^[a-f0-9]{64}$/i.test(record.fingerprint.sha256)||!Number.isSafeInteger(record.fingerprint.sizeBytes)||record.fingerprint.sizeBytes<=0||record.fingerprint.sizeBytes>MAX_BYTES||record.playbackOffset!==undefined&&record.playbackOffset>=record.fingerprint.sizeBytes))continue;
   // A persisted playback transfer is no longer playing after the app closes.
   // Restore its saved prefix; a fresh playback request can upgrade it again.
   const demoted=!record.requested&&record.mode==="full",parkedPlayback=!record.requested&&record.mode==="playback"&&activeStatus(record.status);
   const restored={...record,mode:demoted?"prefix" as const:record.mode,status:parkedPlayback?"prepared" as const:activeStatus(record.status)?"queued" as const:record.status};const job=this.newJob(restored);this.jobs.set(record.recordingId,job);this.aliases.set(referenceKey(record.track),record.recordingId);
   const epoch=job.epoch;
   try{
    if(demoted||parkedPlayback)await this.save(job);if(!this.isCurrent(job,epoch))continue;
    if(!activeStatus(restored.status))this.settle(job);
   }catch(error){if(this.isCurrent(job,epoch))this.fail(job,error);}
  }
  this.emit();this.schedule();void this.pruneCache().catch(()=>{});
 }
 /** Only the selected/resumed song loads chunk Blob handles. */
 private async loadChunks(job:Job,force=false):Promise<boolean>{
  if(job.chunkLoad){if(await job.chunkLoad)return true;if(this.jobs.get(job.record.recordingId)===job&&!this.stopped)return this.loadChunks(job,force);return false;}if(job.chunksLoaded&&!force)return true;
  const epoch=job.epoch,recordingId=job.record.recordingId;
  const flight=(async()=>{const chunks=await this.storage.chunks(recordingId);if(!this.isCurrent(job,epoch))return false;for(const chunk of chunks)job.chunks.set(chunk.offset,chunk);job.chunksLoaded=true;this.updateBytes(job);return true;})();job.chunkLoad=flight;try{return await flight;}finally{if(job.chunkLoad===flight)job.chunkLoad=undefined;}
 }
 getReadyTracks():MusicTrack[]{return Object.values(this.complete).filter(entry=>entry.status==="ready"&&entry.requested!==false).map(entry=>entry.track);}
 enqueue(track:MusicTrack,options:{mode?:"full"|"prefix"|"playback";priority?:number;requested?:boolean}={}):Promise<void>{
  if(this.stopped)return Promise.reject(new DOMException("Downloads stopped","AbortError"));
  let mode=options.mode??"full";const requested=options.requested??mode==="full";
  const canonical=this.aliases.get(referenceKey(track))||this.aliases.get(track.id)||track.id;
  if(this.fullPinned(canonical))mode="full";
  const deletion=this.deleting.get(canonical);if(deletion)return deletion.then(()=>this.enqueue(track,options));
  if(this.complete[canonical])return requested?this.promoteComplete(canonical,track):Promise.resolve();
  let job=this.jobs.get(canonical);
  if(job?.record.requested&&!requested&&["paused","failed"].includes(job.entry.status))return Promise.resolve();
  if(job&&!job.record.requested&&!requested&&mode==="prefix"&&job.record.mode==="full"&&canonical!==(this.currentId&&this.aliases.get(this.currentId)||this.currentId))return this.prepare(canonical);
  if(job){job.record.priority=Math.max(job.record.priority,options.priority??0);if(requested||job.record.requested){job.record.requested=true;job.entry.requested=true;job.record.mode="full";job.record.playbackOffset=undefined;}else if(mode==="full")job.record.mode="full";else if(mode==="playback")job.record.mode="playback";
   if(["prepared","paused","failed"].includes(job.entry.status)&&!(mode==="prefix"&&job.entry.status==="prepared")){if(job.record.refreshSource){job.source=undefined;job.rangeReady=false;}job.epoch++;job.controller.abort();this.release(job);job.recoveryAttempts=0;job.controller=new AbortController();job.entry.status="queued";job.entry.error=undefined;job.warmingAt=Date.now();this.resetPromise(job);}
  }else{const now=Date.now();job=this.newJob({version:1,recordingId:canonical,track:{...track,id:canonical},status:"queued",mode,requested,priority:options.priority??0,chunkBytes:this.chunkBytes,createdAt:now,updatedAt:now});this.jobs.set(canonical,job);}
  this.aliases.set(referenceKey(track),canonical);this.aliases.set(track.id,canonical);this.emit();const epoch=job.epoch;void this.save(job).then(()=>this.schedule()).catch(error=>{if(this.isCurrent(job!,epoch))this.fail(job!,error);});return job.promise;
 }
 /** Obsolete next-song owners may park unfinished work, never a completed save. */
 enqueueSpeculative(track:MusicTrack,options:{signal:AbortSignal;priority?:number}):Promise<void>{
  const {signal}=options;signal.throwIfAborted();const owner=id();this.speculativeOwners.set(owner,track);
  let rejectAbort:(error:unknown)=>void=()=>{};const canceled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const release=()=>{if(!this.speculativeOwners.delete(owner))return;signal.removeEventListener("abort",abort);const job=this.jobFor(track);if(!job||job.record.requested||this.fullPinned(job.record.recordingId)||this.cacheProtected(job.record.recordingId))return;
   if([...this.speculativeOwners.values()].some(value=>this.jobFor(value)===job))return;
   job.record.mode="prefix";job.record.playbackOffset=undefined;void this.pause(job.record.recordingId).catch(()=>{});
  };
  const abort=()=>{rejectAbort(signal.reason??new DOMException("Next-song preparation canceled","AbortError"));release();};signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  const work=this.enqueue(track,{mode:"full",requested:false,priority:options.priority??40});return Promise.race([work,canceled]).finally(release);
 }
 setPriorities(recordingIds:string[],currentId?:string){this.priorityIds=recordingIds;this.currentId=currentId;for(const job of this.jobs.values())if(activeStatus(job.entry.status)&&(!job.lease||job.loading))job.warmingAt=Date.now();this.schedule();void this.pruneCache().catch(()=>{});}
 private fullPinned(recordingId:string){for(const value of this.fullPreparations)if((this.aliases.get(value.recordingId)||value.recordingId)===recordingId||value.targetId===recordingId||value.recordingId===recordingId)return true;return false;}
 private async drainPreparationCleanups(){if(!this.storage.releaseAutomaticPins)return;for(const item of pendingPreparationCleanups())if(item.accountId===this.options.accountId)try{await this.storage.releaseAutomaticPins(item.ownerPrefix);forgetPreparationCleanup(item.accountId,item.ownerPrefix);}catch{}}
 private pinFull(preparation:FullPreparation):Promise<void>{
  preparation.io=preparation.io.then(async()=>{if(!this.fullPreparations.has(preparation))return;await this.storage.pinAutomatic?.(preparation.recordingId,preparation.owner,Date.now()+90000);});return preparation.io;
 }
 private async moveFullPins(previous:string,canonical:string){
  if(this.ownedPreparations.delete(previous))this.ownedPreparations.add(canonical);
  await Promise.all([...this.fullPreparations].filter(value=>value.recordingId===previous).map(async value=>{
   const old=value.recordingId;value.targetId=canonical;
   value.io=value.io.then(async()=>{if(!this.fullPreparations.has(value))return;await this.storage.pinAutomatic?.(canonical,value.owner,Date.now()+90000);if(this.fullPreparations.has(value))value.recordingId=canonical;else await this.storage.releaseAutomaticPin?.(canonical,value.owner);await this.storage.releaseAutomaticPin?.(old,value.owner);});await value.io;
  }));
 }
 /** Full verified media joins the scheduler and remains pinned for the consumer's lifetime. */
 async prepareFull(track:MusicTrack,signal:AbortSignal):Promise<PreparedFullAudio>{
  signal.throwIfAborted();if(this.stopped)throw new DOMException("Downloads stopped","AbortError");
  if(this.fullPreparations.size>=64)throw new Error("Too many audio experiences are being prepared.");
  const recordingId=this.aliases.get(referenceKey(track))||this.aliases.get(track.id)||track.id;
  const previous=this.jobFor(recordingId);if(!previous||previous.record.mode!=="full")this.ownedPreparations.add(recordingId);
  const preparation:FullPreparation={recordingId,originalId:recordingId,owner:this.preparationOwner+":prepare:"+id(),controller:new AbortController(),io:Promise.resolve(),release:()=>{}};
  const abort=()=>{preparation.controller.abort(signal.reason??new DOMException("Audio preparation canceled","AbortError"));preparation.release();};
  preparation.release=()=>{
   if(!this.fullPreparations.delete(preparation))return;signal.removeEventListener("abort",abort);if(preparation.timer)clearInterval(preparation.timer);
   preparation.controller.abort(new DOMException("Audio preparation released","AbortError"));
   // Storage can still reject eviction until its asynchronous pin removal commits.
   void preparation.io.catch(()=>{}).then(()=>this.storage.releaseAutomaticPin?.(preparation.recordingId,preparation.owner)).then(()=>this.pruneCache()).catch(()=>{});
   const canonical=preparation.targetId??this.aliases.get(preparation.recordingId)??preparation.recordingId,job=this.jobFor(canonical)??this.jobFor(preparation.originalId);
   if(!this.fullPinned(canonical)&&this.ownedPreparations.delete(canonical)&&!this.stopped&&job&&!job.record.requested&&!this.cacheProtected(job.record.recordingId))void this.pause(job.record.recordingId).catch(()=>{});
  };
  this.fullPreparations.add(preparation);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  if(this.storage.pinAutomatic&&this.fullPreparations.has(preparation))preparation.timer=setInterval(()=>{void this.pinFull(preparation).catch(error=>{preparation.controller.abort(error);preparation.release();});},30000);
  let rejectAbort:(error:unknown)=>void=()=>{};const canceled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const stopped=()=>rejectAbort(preparation.controller.signal.reason??new DOMException("Audio preparation canceled","AbortError"));preparation.controller.signal.addEventListener("abort",stopped,{once:true});if(preparation.controller.signal.aborted)stopped();
  try{
   const work=(async()=>{await this.pinFull(preparation);preparation.controller.signal.throwIfAborted();await this.enqueue(track,{mode:"full",requested:false,priority:40});preparation.controller.signal.throwIfAborted();const canonical=this.aliases.get(referenceKey(track))||this.aliases.get(track.id)||track.id;let audio=await this.storage.ready(canonical);
    // Another tab can evict an unpinned cache before this consumer arrives.
    // Reconcile its stale ready snapshot once, then rebuild through normal checks.
    if((!validOfflineAudio(audio)||audio.track.id!==canonical)&&this.complete[canonical]?.status==="ready"){delete this.complete[canonical];preparation.controller.signal.throwIfAborted();await this.enqueue({...track,id:canonical},{mode:"full",requested:false,priority:40});preparation.controller.signal.throwIfAborted();audio=await this.storage.ready(canonical);}
    if(!validOfflineAudio(audio)||audio.track.id!==canonical)throw new Error("This soundtrack has not finished saving. Resume its download to prepare it.");return {audio,release:preparation.release};})();
   return await Promise.race([work,canceled]);
  }catch(error){preparation.release();throw error;}finally{preparation.controller.signal.removeEventListener("abort",stopped);}
 }
 async releasePreparationPins(){
  const ownerPrefix=this.preparationOwner+":prepare:",preparations=[...this.fullPreparations],writes=preparations.map(preparation=>preparation.io.catch(()=>{})),bulk=this.storage.releaseAutomaticPins;if(bulk){rememberPreparationCleanup(this.options.accountId,ownerPrefix);this.preparationOwner=rotateTabPreparationOwner();}for(const preparation of preparations)preparation.release();await Promise.allSettled(writes);if(bulk){await this.storage.releaseAutomaticPins!(ownerPrefix);forgetPreparationCleanup(this.options.accountId,ownerPrefix);}
 }
 private promoteComplete(recordingId:string,track:MusicTrack,force=false):Promise<void>{
  const existing=this.promotions.get(recordingId);if(existing)return existing;const previous=this.complete[recordingId];if(previous?.status==="ready"&&previous.requested===true&&!force)return Promise.resolve();
  const pending={...previous,recordingId,track:previous?.track||track,status:"queued" as const,requested:true,mode:"full" as const,operationId:id(),downloadedBytes:previous?.downloadedBytes||0,totalBytes:previous?.totalBytes??null};this.complete[recordingId]=pending;this.emit();
  const operation=(async()=>{const saved=await this.storage.promoteRequested(recordingId);if(this.stopped||this.complete[recordingId]!==pending)return;if(!saved){delete this.complete[recordingId];return this.enqueue({...track,id:recordingId},{mode:"full",requested:true});}this.complete[recordingId]={...pending,track:saved.track,status:"ready",sha256:saved.sha256,downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,updatedAt:saved.savedAt};this.emit();this.broadcastSaved(recordingId);})().catch(error=>{if(!this.stopped&&this.complete[recordingId]===pending){this.complete[recordingId]={...pending,status:"failed",error:error instanceof Error?error.message:"This song could not be saved. Please try again."};this.emit();this.options.onError?.(error,pending.track);}throw error;}).finally(()=>{if(this.promotions.get(recordingId)===operation)this.promotions.delete(recordingId);});this.promotions.set(recordingId,operation);void operation.catch(()=>{});return operation;
 }
 sourceFor(recordingId:string):DownloadSource|undefined{return this.jobFor(recordingId)?.source;}
 /** A known immutable asset can play saved chunks without another catalog lookup, including after reopening. */
 playbackSourceFor(recordingId:string):DownloadSource|undefined{
  const job=this.jobFor(recordingId),record=job?.record,fingerprint=record?.fingerprint;
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if(!record||!fingerprint||record.track.id!==record.recordingId||!uuid.test(record.recordingId)||!uuid.test(fingerprint.assetId)||!Number.isSafeInteger(fingerprint.sizeBytes)||fingerprint.sizeBytes<=0||fingerprint.sizeBytes>MAX_BYTES||!/^[a-f0-9]{64}$/i.test(fingerprint.sha256))return;
  const url="/api/v2/recordings/"+record.recordingId+"/audio?assetId="+encodeURIComponent(fingerprint.assetId);
  return {track:record.track,url,fallbackUrl:url,...fingerprint,mimeType:record.mimeType||job?.source?.mimeType};
 }
 /** Playback joins the existing chunk flight; canceling a reader leaves downloads running. */
 async warmPlaybackPosition(recordingId:string,positionMs:number,durationMs:number,signal:AbortSignal):Promise<void>{
  signal.throwIfAborted();const canonical=this.aliases.get(recordingId)||recordingId;
  if(this.complete[canonical]?.status==="ready"||!Number.isFinite(positionMs)||positionMs<=0||!Number.isFinite(durationMs)||durationMs<=0)return;
  const job=this.jobFor(canonical),size=job?.record.fingerprint?.sizeBytes??job?.source?.sizeBytes;
  if(!job||!size)return;
  // Compressed files may use variable bitrate. Keep the opening container probe
  // and native seek; this only warms an estimated neighborhood of the position.
  const audioStart=job.record.audioStartBytes??0,fragmentBytes=Math.min(job.record.chunkBytes,OPENING_AUDIO_BYTES),offset=Math.floor(Math.min(size-1,Math.max(audioStart,audioStart+Math.floor(positionMs/durationMs*(size-audioStart))))/fragmentBytes)*fragmentBytes;
  if(offset>0){if(job.record.chunkBytes<=OPENING_AUDIO_BYTES)await this.ensureChunk(canonical,offset,signal);else await this.ensureOpeningChunk(canonical,signal,offset);}
 }
 /** Physical opening fragments never replace full resumable chunks. */
 async ensureOpeningChunk(recordingId:string,signal?:AbortSignal,offset=0,sparse=false):Promise<DownloadChunk|undefined>{
  if(offset===0)return this.ensureChunk(recordingId,0,signal,true);signal?.throwIfAborted();
  const job=this.jobFor(recordingId),canonical=job?.record.recordingId??this.aliases.get(recordingId)??recordingId,source=job?.source??this.playbackSourceFor(canonical),size=source?.sizeBytes;
  if(!Number.isSafeInteger(offset)||offset<0||size!==undefined&&offset>=size)throw new DownloadIntegrityError("This playback range does not belong to the recording.");
  if(!job){const audio=await this.storage.ready(canonical);signal?.throwIfAborted();if(!audio||offset>=audio.sizeBytes)return;const blob=audio.blob.slice(offset,Math.min(audio.sizeBytes,offset+OPENING_AUDIO_BYTES),audio.blob.type);return {offset,blob,sha256:await audioSha256(blob)};}
  if(!source||!size)return;job.fragmentPlayback=true;const epoch=job.epoch,startup=job.record.audioStartBytes!==undefined&&job.record.audioStartBytes>0&&offset>=job.record.audioStartBytes&&offset<(job.record.audioOpeningEndBytes??job.record.audioStartBytes)&&(offset-job.record.audioStartBytes)%OPENING_AUDIO_BYTES===0,expected=Math.min(OPENING_AUDIO_BYTES,(startup?job.record.audioOpeningEndBytes!:size)-offset),stored=await this.storage.openingChunk?.(canonical,offset);signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;
  if(stored?.offset===offset&&stored.blob.size===expected&&await audioSha256(stored.blob)===stored.sha256){signal?.throwIfAborted();return this.isCurrent(job,epoch)?stored:undefined;}
  const base=Math.floor(offset/job.record.chunkBytes)*job.record.chunkBytes,covering=job.chunks.get(base)??await this.storage.chunk?.(canonical,base);signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;if(covering?.offset===base&&offset+expected<=base+covering.blob.size&&await audioSha256(covering.blob)===covering.sha256){signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;const blob=covering.blob.slice(offset-base,offset-base+expected,covering.blob.type);return {offset,blob,sha256:await audioSha256(blob)};}
  for(const [start,span]of job.openingSpans??[])if(offset>=start&&offset<=span.end&&(offset-start)%OPENING_AUDIO_BYTES===0){if(span.error){if(!recoverableTransfer(span.error))throw span.error;job.openingSpans?.delete(start);break;}if(!span.done)return span.bulk?this.ensureBulkFragment(job,offset,signal):this.waitForOpening(job,offset,signal);}
  if(!sparse&&!startup&&offset%OPENING_AUDIO_BYTES===0)return this.ensureBulkFragment(job,offset,signal);
  job.openingOffsets??=new Set();if(!job.openingOffsets.has(offset)&&job.openingOffsets.size>=4)throw new DownloadIntegrityError("The audio opening contains too many metadata blocks.",false);job.openingOffsets.add(offset);
  job.openingFlights??=new Map();let flight=job.openingFlights.get(offset);
  if(!flight){
   let resolveFirst:(chunk:DownloadChunk|undefined)=>void=()=>{},rejectFirst:(error:unknown)=>void=()=>{};flight=new Promise((resolve,reject)=>{resolveFirst=resolve;rejectFirst=reject;});void flight.catch(()=>{});job.openingFlights.set(offset,flight);
   const end=(startup?job.record.audioOpeningEndBytes!:sparseOpeningEnd(offset,size))-1,span:{end:number;done?:boolean;error?:unknown}={end};job.openingSpans??=new Map();job.openingSpans.set(offset,span);
   // End the bounded startup range at a bulk boundary so its continuation does
   // not wait for the unwanted prefix of another bulk request.
   const controller=job.controller.signal;let admitted=false;this.openingWaiting++;this.preemptForOpening(job);this.schedule();
   const publish=async(physicalOffset:number,blob:Blob)=>{if(!this.isCurrent(job,epoch))return;if(job.record.mimeType&&job.record.mimeType!==blob.type)throw new DownloadIntegrityError("The source changed audio format while this song was being saved.");const chunk={offset:physicalOffset,blob,sha256:await audioSha256(blob)};if(!this.isCurrent(job,epoch))return;if(this.storage.putOpeningChunk)await this.withIO(job,epoch,()=>this.storage.putOpeningChunk!(canonical,chunk));if(!this.isCurrent(job,epoch))return;if(physicalOffset===offset)resolveFirst(chunk);for(const waiter of job.openingWaiters?.get(physicalOffset)??[])waiter.resolve(chunk);};
   const current=flight;void(async()=>{
    try{while(this.active+this.openingActive>=(this.options.maxConcurrentChunks??4)){controller.throwIfAborted();if(!this.isCurrent(job,epoch))return;await waitForRetry(controller,10);}controller.throwIfAborted();if(!this.isCurrent(job,epoch))return;this.openingWaiting--;this.openingActive++;admitted=true;
     try{await fetchAudioRange(source.url,offset,end,size,controller,this.options.fetcher,undefined,this.options.idleTimeoutMs,false,undefined,undefined,publish,undefined,true);}catch(error){if(!source.fallbackUrl||source.fallbackUrl===source.url||error instanceof DownloadIntegrityError&&!error.retryAlternate||error instanceof UserFacingError&&["session","version","validation","storage"].includes(error.issue.kind))throw error;controller.throwIfAborted();await fetchAudioRange(source.fallbackUrl,offset,end,size,controller,this.options.fetcher,undefined,this.options.idleTimeoutMs,false,undefined,undefined,publish,undefined,true);}
    }catch(error){span.error=error;rejectFirst(error);for(const [physical,group]of job.openingWaiters??[])if(physical>=offset&&physical<=end)for(const waiter of group)waiter.reject(error);if(this.isCurrent(job,epoch)&&!controller.aborted&&error instanceof DownloadIntegrityError)this.fail(job,error);}
    finally{span.done=true;resolveFirst(undefined);if(!this.isCurrent(job,epoch))for(const [physical,group]of job.openingWaiters??[])if(physical>=offset&&physical<=end)for(const waiter of group)waiter.resolve(undefined);if(job.openingFlights?.get(offset)===current)job.openingFlights.delete(offset);if(admitted)this.openingActive--;else this.openingWaiting--;this.schedule();}
   })();
  }
  if(!signal)return flight;
  return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason??new DOMException("Canceled","AbortError"));signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();void flight!.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));});
 }
 private waitForOpening(job:Job,offset:number,signal?:AbortSignal):Promise<DownloadChunk|undefined>{
  return new Promise((resolve,reject)=>{const epoch=job.epoch;job.openingWaiters??=new Map();const group=job.openingWaiters.get(offset)??new Set(),detach=()=>{signal?.removeEventListener("abort",abort);group.delete(waiter);if(!group.size)job.openingWaiters?.delete(offset);},waiter={resolve:(chunk:DownloadChunk|undefined)=>{detach();resolve(chunk);},reject:(error:unknown)=>{detach();reject(error);}},abort=()=>waiter.reject(signal?.reason??new DOMException("Canceled","AbortError"));group.add(waiter);job.openingWaiters.set(offset,group);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();void this.storage.openingChunk?.(job.record.recordingId,offset).then(async chunk=>{if(chunk&&await audioSha256(chunk.blob)===chunk.sha256&&this.isCurrent(job,epoch))waiter.resolve(chunk);}).catch(waiter.reject);});
 }
 private async ensureBulkFragment(job:Job,offset:number,signal?:AbortSignal):Promise<DownloadChunk|undefined>{
  signal?.throwIfAborted();job.fragmentPlayback=true;const epoch=job.epoch,base=Math.floor(offset/job.record.chunkBytes)*job.record.chunkBytes,reader=new AbortController(),abort=()=>reader.abort(signal?.reason);
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  const fragment=this.waitForOpening(job,offset,reader.signal);
  void this.ensureChunk(job.record.recordingId,base,reader.signal).then(async chunk=>{if(!chunk){for(const waiter of job.openingWaiters?.get(offset)??[])waiter.resolve(undefined);return;}const blob=chunk.blob.slice(offset-base,Math.min(chunk.blob.size,offset-base+OPENING_AUDIO_BYTES),chunk.blob.type),value={offset,blob,sha256:await audioSha256(blob)};if(this.isCurrent(job,epoch))for(const waiter of job.openingWaiters?.get(offset)??[])waiter.resolve(value);}).catch(error=>{if(reader.signal.aborted)return;for(const waiter of job.openingWaiters?.get(offset)??[])waiter.reject(error);});
  try{return await fragment;}finally{reader.abort(new DOMException("Fragment is ready","AbortError"));signal?.removeEventListener("abort",abort);}
 }
 private preemptForOpening(job:Job){
  for(const offset of job.active){if(offset===0||job.waiters.has(offset))continue;const controller=job.chunkControllers.get(offset);if(controller&&!controller.signal.aborted){controller.abort(new DOMException("Audio opening takes priority","AbortError"));return;}}
  if(this.active+this.openingActive<(this.options.maxConcurrentChunks??4))return;
  const candidates=[job,...[...this.jobs.values()].filter(other=>other!==job&&!other.record.requested).sort((a,b)=>this.priority(a)-this.priority(b))];
  for(const other of candidates)for(const offset of other.active){if(other===job&&offset===0&&((this.options.maxConcurrentChunks??4)>1||!job.opening)||other.waiters.has(offset))continue;const controller=other.chunkControllers.get(offset);if(controller&&!controller.signal.aborted){controller.abort(new DOMException("Audio opening takes priority","AbortError"));return;}}
 }
 /** Save actual MPEG frames before the native element is given its source. */
 async ensurePlaybackOpening(recordingId:string,signal?:AbortSignal):Promise<DownloadChunk|undefined>{
  const selected=this.jobFor(recordingId);if(selected)selected.fragmentPlayback=true;
  const header=await this.ensureOpeningChunk(recordingId,signal);signal?.throwIfAborted();if(!header)return;
  const job=this.jobFor(recordingId),size=job?.source?.sizeBytes??job?.record.fingerprint?.sizeBytes;
  if(!job||!size)return header;if(!/^audio\/(?:mpeg|mp3)$/i.test(header.blob.type)){job.record.audioStartBytes=0;job.record.audioOpeningEndBytes=Math.min(size,AUDIO_OPENING_WINDOW_BYTES);await this.save(job);return header;}
  const epoch=job.epoch;let opening=header,audioStart=0;
  for(let tags=0;tags<4;tags++){const data=new Uint8Array(await opening.blob.arrayBuffer()),tag=id3v2TagBytes(data,size-audioStart);signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;
   if(tag===undefined)return header;if(tag===0){if(audioStart>0&&!isMpegAudioFrameHeader(data))return header;job.record.audioStartBytes=audioStart;job.record.audioOpeningEndBytes=audioStart>0?sparseOpeningEnd(audioStart,size):Math.min(size,AUDIO_OPENING_WINDOW_BYTES);await this.save(job);return this.isCurrent(job,epoch)?opening:undefined;}
   audioStart+=tag;if(audioStart>32*1024*1024||audioStart>=size)return header;const next=await this.ensureOpeningChunk(recordingId,signal,audioStart,true);signal?.throwIfAborted();if(!next||!this.isCurrent(job,epoch))return;opening=next;
  }
  return header;
 }
 async ensureChunk(recordingId:string,offset:number,signal?:AbortSignal,opening=false):Promise<DownloadChunk|undefined>{
  signal?.throwIfAborted();const canonical=this.aliases.get(recordingId)||recordingId,job=this.jobFor(canonical);
  if(!Number.isSafeInteger(offset)||offset<0||offset%(job?.record.chunkBytes??this.chunkBytes)!==0)throw new DownloadIntegrityError("This playback range does not belong to the recording.");
  if(!job){const audio=await this.storage.ready(canonical);if(!audio||offset>=audio.sizeBytes)return;const blob=audio.blob.slice(offset,Math.min(audio.sizeBytes,offset+this.chunkBytes),audio.blob.type);return {offset,blob,sha256:await audioSha256(blob)};}
  if(opening)job.fragmentPlayback=true;
  if(!Number.isSafeInteger(offset)||offset<0||offset%job.record.chunkBytes!==0||job.record.fingerprint&&offset>=job.record.fingerprint.sizeBytes)throw new DownloadIntegrityError("This playback range does not belong to the recording.");
  if(!job.chunksLoaded&&!job.chunks.has(offset)){const epoch=job.epoch;if(this.storage.chunk){const chunk=await this.storage.chunk(canonical,offset);signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;if(chunk)job.chunks.set(offset,chunk);}else if(!await this.loadChunks(job))return;}
  const existing=job.chunks.get(offset);if(existing&&await audioSha256(existing.blob)===existing.sha256){if(!job.record.requested&&!this.fullPinned(canonical)){job.record.mode="playback";job.record.playbackOffset=offset;job.entry.mode="playback";this.preemptPlaybackWork(job,offset);if(connected())void this.enqueue(job.record.track,{mode:"playback",requested:false}).catch(()=>{});else void this.save(job).catch(()=>{});}return existing;}else if(existing){job.chunks.delete(offset);this.updateBytes(job);}
  if(opening&&offset===0&&job.record.chunkBytes>OPENING_AUDIO_BYTES){const epoch=job.epoch,candidate=job.opening??await this.storage.openingChunk?.(canonical);signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;if(candidate?.offset===0&&candidate.blob.size===OPENING_AUDIO_BYTES&&await audioSha256(candidate.blob)===candidate.sha256){signal?.throwIfAborted();if(!this.isCurrent(job,epoch))return;job.opening=candidate;return candidate;}}
  if(job.wholeFlight?.epoch===job.epoch&&job.wholeFlight.offset===offset)return;
  if(!connected())throw new Error("The connection is offline. This part of the song is not saved on this device.");
  if(!job.record.requested&&!this.fullPinned(canonical)){job.record.mode="playback";job.record.playbackOffset=offset;job.entry.mode="playback";}job.urgent.add(offset);
  return new Promise<DownloadChunk|undefined>((resolve,reject)=>{const group=job.waiters.get(offset)||new Set();const detach=()=>{signal?.removeEventListener("abort",abort);group.delete(waiter);if(!group.size){job.waiters.delete(offset);job.urgent.delete(offset);this.schedule();}};const waiter={opening,resolve:(chunk:DownloadChunk|undefined)=>{detach();resolve(chunk);},reject:(error:unknown)=>{detach();reject(error);}};const abort=()=>waiter.reject(signal?.reason??new DOMException("Canceled","AbortError"));group.add(waiter);job.waiters.set(offset,group);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();this.preemptPlaybackWork(job,offset,true);void this.enqueue(job.record.track,{mode:job.record.requested?"full":"playback",requested:job.record.requested}).catch(()=>{});this.schedule();});
 }
 private responseMode(job:Job,epoch:number,offset:number,whole:boolean){if(!this.isCurrent(job,epoch)||!job.active.has(offset))return;if(!whole){if(job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset)job.wholeFlight=undefined;job.needsZeroProbe=false;job.rangeReady=true;this.schedule();return;}job.wholeFlight={epoch,offset};job.needsZeroProbe=offset!==0;for(const waiter of job.waiters.get(offset)||[])waiter.resolve(undefined);job.waiters.delete(offset);job.urgent.delete(offset);}
 private publishChunk(job:Job,chunk:DownloadChunk){job.chunks.set(chunk.offset,chunk);job.urgent.delete(chunk.offset);for(const waiter of job.waiters.get(chunk.offset)||[])waiter.resolve(chunk);job.waiters.delete(chunk.offset);}
 private async publishOpening(job:Job,epoch:number,blob:Blob){
  if(!this.storage.putOpeningChunk||!this.isCurrent(job,epoch)||blob.size!==OPENING_AUDIO_BYTES)return;
  if(job.record.mimeType&&job.record.mimeType!==blob.type)throw new DownloadIntegrityError("The source changed audio format while this song was being saved.");
  if(!job.record.mimeType){job.record.mimeType=blob.type;await this.save(job);}if(!this.isCurrent(job,epoch))return;
  const chunk={offset:0,blob,sha256:await audioSha256(blob)};if(!this.isCurrent(job,epoch))return;
  await this.withIO(job,epoch,()=>this.storage.putOpeningChunk!(job.record.recordingId,chunk));if(!this.isCurrent(job,epoch))return;
  job.opening=chunk;for(const waiter of job.waiters.get(0)||[])if(waiter.opening)waiter.resolve(chunk);
 }
 private async publishBulkFragment(job:Job,epoch:number,offset:number,blob:Blob){
  if(!this.storage.putOpeningChunk||!this.isCurrent(job,epoch))return;if(offset===0){await this.publishOpening(job,epoch,blob);return;}
  if(job.record.mimeType&&job.record.mimeType!==blob.type)throw new DownloadIntegrityError("The source changed audio format while this song was being saved.");
  if(!job.record.mimeType){job.record.mimeType=blob.type;await this.save(job);}if(!this.isCurrent(job,epoch))return;
  const chunk={offset,blob,sha256:await audioSha256(blob)};if(!this.isCurrent(job,epoch))return;await this.withIO(job,epoch,()=>this.storage.putOpeningChunk!(job.record.recordingId,chunk));if(!this.isCurrent(job,epoch))return;
  for(const waiter of job.openingWaiters?.get(offset)??[])waiter.resolve(chunk);
 }
 private rejectChunks(job:Job,error:unknown){for(const group of job.waiters.values())for(const waiter of group)waiter.reject(error);job.waiters.clear();job.urgent.clear();for(const group of job.openingWaiters?.values()??[])for(const waiter of group)waiter.reject(error);job.openingWaiters?.clear();}
 private preemptPlaybackWork(job:Job,offset:number,global=false){let local=false;for(const activeOffset of job.active)if((activeOffset<offset||activeOffset>=offset+job.record.chunkBytes*PLAYBACK_READ_AHEAD_CHUNKS)&&!job.waiters.has(activeOffset)){const controller=job.chunkControllers.get(activeOffset);if(controller&&!controller.signal.aborted){local=true;controller.abort(new DOMException("Playback moved","AbortError"));}}
  const current=this.currentId&&(this.aliases.get(this.currentId)||this.currentId);if(local||!global||current!==job.record.recordingId||!job.waiters.has(offset)||this.active<(this.options.maxConcurrentChunks??4))return;
  const candidates=[...this.jobs.values()].filter(other=>other!==job&&!other.record.requested&&this.priority(other)<this.priority(job)).flatMap(other=>[...other.active].filter(activeOffset=>!other.waiters.has(activeOffset)).map(activeOffset=>({job:other,controller:other.chunkControllers.get(activeOffset)}))).filter((candidate):candidate is {job:Job;controller:AbortController}=>!!candidate.controller&&!candidate.controller.signal.aborted).sort((a,b)=>this.priority(a.job)-this.priority(b.job)||b.job.lastServed-a.job.lastServed);
  candidates[0]?.controller.abort(new DOMException("Higher priority playback","AbortError"));
 }
 async getPartial(recordingId:string):Promise<{blob:Blob;cachedSeconds:number;fingerprint:DownloadFingerprint}|undefined>{
  const job=this.jobFor(recordingId);if(!job?.record.fingerprint)return;
  if(!await this.loadChunks(job))return;
  const chunks=[...job.chunks.values()].sort((a,b)=>a.offset-b.offset);if(!chunks.length)return;for(const chunk of chunks)if(await audioSha256(chunk.blob)!==chunk.sha256)return;
  const parts:Blob[]=[];let offset=0;while(job.chunks.has(offset)){const chunk=job.chunks.get(offset)!;parts.push(chunk.blob);offset+=chunk.blob.size;}if(!parts.length)parts.push(chunks[0].blob);return {blob:new Blob(parts,{type:job.record.mimeType||parts[0].type}),cachedSeconds:job.entry.cachedSeconds||0,fingerprint:job.record.fingerprint};
 }
 async pause(recordingId:string):Promise<void>{const job=this.jobFor(recordingId);if(!job||job.entry.status==="ready")return;const reconcileCommit=job.committing,epoch=++job.epoch;job.entry.status="paused";job.controller.abort();job.controller=new AbortController();this.release(job);this.rejectChunks(job,new DOMException("Download paused","AbortError"));this.settle(job);this.emit();if(!reconcileCommit){await this.save(job);return;}await job.io;if(!this.isCurrent(job,epoch))return;job.committing=false;let saved=await this.storage.ready(job.record.recordingId);if(!this.isCurrent(job,epoch))return;if(saved){if(job.record.requested&&saved.requested!==true)saved=await this.storage.promoteRequested(job.record.recordingId);if(!saved||!this.isCurrent(job,epoch))return;this.complete[job.record.recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(job.record.recordingId);this.settle(job);this.emit();return;}await this.save(job);}
 /** Paused/skipped automatic songs retain their exact verified playback chunks. */
 async prepare(recordingId:string):Promise<void>{
  const job=this.jobFor(recordingId);if(job)job.fragmentPlayback=false;if(!job)return;if(job.record.requested||job.record.mode==="prefix"||this.fullPinned(job.record.recordingId)){await this.clearPlaybackFragments(job,job.epoch);return;}
  const failed=job.entry.status==="failed",playback=job.record.mode==="playback",epoch=++job.epoch;if(!playback){job.record.mode="prefix";job.record.playbackOffset=undefined;}job.controller.abort();job.controller=new AbortController();this.release(job);this.rejectChunks(job,new DOMException("Playback moved on","AbortError"));this.settle(job);if(!failed)job.entry.error=undefined;
  const target=this.targetBytes(job);let complete=playback||target>0;for(let offset=0;!playback&&offset<target;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)){complete=false;break;}job.entry.status=failed?"failed":complete?"prepared":"queued";job.warmingAt=Date.now();this.updateBytes(job);if(!complete&&!failed)this.resetPromise(job);this.emit();
  await this.clearPlaybackFragments(job,epoch);await job.io;if(!this.isCurrent(job,epoch)||job.record.requested)return;const saved=await this.storage.ready(job.record.recordingId);if(!this.isCurrent(job,epoch)||job.record.requested)return;
  if(saved){this.complete[job.record.recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(job.record.recordingId);this.settle(job);this.emit();return;}
  await this.save(job);if(!this.isCurrent(job,epoch))return;this.emit();this.schedule();void this.pruneCache(job.record.recordingId).catch(()=>{});
 }
 private async clearPlaybackFragments(job:Job,epoch:number){if(!this.storage.clearPlaybackFragments)return;const start=job.record.audioStartBytes??0,end=job.record.audioOpeningEndBytes??OPENING_AUDIO_BYTES;await this.withIO(job,epoch,()=>this.storage.clearPlaybackFragments!(job.record.recordingId,start,end));}
 resume(recordingId:string):Promise<void>{const job=this.jobFor(recordingId);return job?this.enqueue(job.record.track,{mode:job.record.mode,requested:job.record.requested,priority:job.record.priority}):Promise.resolve();}
 cancel(recordingId:string):Promise<void>{const canonical=this.aliases.get(recordingId)||recordingId,pending=this.deleting.get(canonical);if(pending)return pending;const job=this.jobFor(canonical),promotion=this.promotions.get(canonical);if(!job){if(!promotion)return Promise.resolve();delete this.complete[canonical];const operation=promotion.catch(()=>{}).then(()=>this.clearExclusive(canonical,true)).then(()=>this.broadcastRemoval(canonical)).finally(()=>{this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}const jobId=job.record.recordingId;job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(jobId);const error=new DOMException("Canceled","AbortError");this.rejectChunks(job,error);this.settle(job,error);const operation=job.io.then(()=>this.clearExclusive(jobId,true)).then(()=>this.broadcastRemoval(jobId)).finally(()=>{this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}
 remove(recordingId:string):Promise<void>{const canonical=this.aliases.get(recordingId)||recordingId,pending=this.deleting.get(canonical);if(pending)return pending;if(this.jobFor(canonical))return this.cancel(canonical);const promotion=this.promotions.get(canonical);delete this.complete[canonical];const operation=(promotion?.catch(()=>{})||Promise.resolve()).then(()=>this.clearExclusive(canonical,true)).then(()=>this.broadcastRemoval(canonical)).finally(()=>{if(this.deleting.get(canonical)===operation)this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}
 dispose(){if(this.stopped)return;this.stopped=true;for(const preparation of [...this.fullPreparations])preparation.release();this.ownedPreparations.clear();if(this.priorityWake)clearTimeout(this.priorityWake);this.channel?.close();this.channel=undefined;if(typeof window!=="undefined"){window.removeEventListener("online",this.online);window.removeEventListener("offline",this.offline);}for(const job of this.jobs.values()){job.epoch++;job.controller.abort();if(job.retryTimer)clearTimeout(job.retryTimer);this.release(job);const error=new DOMException("Downloads stopped","AbortError");this.rejectChunks(job,error);this.settle(job,error);}}
 private suspendForConnection(){if(this.stopped)return;for(const job of this.jobs.values()){if(!activeStatus(job.entry.status))continue;const epoch=++job.epoch;job.controller.abort();job.controller=new AbortController();this.release(job);job.entry.status="queued";job.inFlightBytes.clear();this.updateBytes(job);this.rejectChunks(job,new Error("The connection is offline. Saved audio will resume when it returns."));void this.save(job).catch(error=>{if(this.isCurrent(job,epoch))this.fail(job,error);});}this.emit();}
 private priority(job:Job){const recordingId=job.record.recordingId;if(recordingId===(this.currentId&&this.aliases.get(this.currentId)||this.currentId))return 100000;if(job.waiters.size)return 90000;const index=this.priorityIds.findIndex(value=>(this.aliases.get(value)||value)===recordingId);return index<0?(job.record.requested?2000:0)+Math.max(-100,Math.min(100,job.record.priority)):80000-Math.min(index,50)*50;}
 private schedule(){if(this.scheduled||this.stopped)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}
 private pump(){
  if(this.stopped||!connected())return;
  const candidates=[...this.jobs.values()].filter(job=>activeStatus(job.entry.status)&&!job.recoveryTimer).sort((a,b)=>this.priority(b)-this.priority(a)||a.lastServed-b.lastServed||a.record.createdAt-b.record.createdAt);
  let leases=candidates.filter(job=>job.lease||job.leaseWaiting||job.leaseDrain).length;const leaseLimit=(this.options.maxConcurrentChunks??4)+2;
  for(const job of candidates){if(!job.lease){if(leases<leaseLimit||job.waiters.size||job.record.recordingId===this.currentId){if(!job.leaseWaiting&&!job.leaseDrain){leases++;this.acquire(job);}}continue;}if(job.leaseReady&&!job.source&&!job.loading&&!job.active.size&&this.resolving<2){job.loading=true;this.resolving++;void this.resolveJob(job);}}
  const limit=this.options.maxConcurrentChunks??4;
  while(this.active+this.openingActive+this.openingWaiting<limit){const eligible=candidates.filter(job=>job.lease&&job.leaseReady&&job.source&&!job.loading&&job.active.size<(job.rangeReady?(this.options.maxChunksPerSong??2):1)&&this.nextOffset(job)!==null).sort((a,b)=>this.priority(b)-this.priority(a)||a.lastServed-b.lastServed);
   const job=eligible[0];if(!job)break;const pending=candidates.find(other=>this.priority(other)>this.priority(job)&&!other.active.size&&(!other.leaseReady||!other.source||other.loading)&&other.warmingAt+PRIORITY_WARMUP_MS>Date.now());if(pending){if(!this.priorityWake)this.priorityWake=setTimeout(()=>{this.priorityWake=undefined;this.schedule();},Math.max(1,pending.warmingAt+PRIORITY_WARMUP_MS-Date.now()));break;}const offset=this.nextOffset(job)!;job.active.add(offset);job.lastServed=++this.sequence;this.active++;job.entry.status="downloading";this.updateBytes(job);this.emit();void this.chunk(job,offset);
  }
  for(const job of candidates)if(job.leaseReady&&job.source&&!job.loading&&!job.active.size&&!job.openingFlights?.size&&this.nextOffset(job)===null&&!(job.record.mode==="playback"&&job.record.playbackOffset===undefined))void this.finish(job);
 }
 private targetBytes(job:Job){const total=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??0;if(job.record.mode==="full")return total;if(job.record.mode==="playback")return Math.min(total,(job.record.playbackOffset??total)+job.record.chunkBytes*PLAYBACK_READ_AHEAD_CHUNKS);const fraction=22000/Math.max(22000,job.record.track.durationMs);return Math.min(total,Math.max(job.record.chunkBytes,Math.ceil(total*fraction/job.record.chunkBytes)*job.record.chunkBytes));}
 private nextOffset(job:Job):number|null{const total=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??0,target=this.targetBytes(job);if(target>0&&job.needsZeroProbe&&!job.active.has(0))return 0;for(const offset of job.urgent)if(offset<total&&!job.chunks.has(offset)&&!job.active.has(offset))return offset;if(job.openingFlights?.size)return null;const start=job.record.mode==="playback"?job.record.playbackOffset??target:0;for(let offset=start;offset<target;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)&&!job.active.has(offset))return offset;return null;}
 private acquire(job:Job){
  if(job.leaseWaiting||job.retryTimer||job.leaseDrain||this.stopped)return;job.leaseWaiting=true;const epoch=job.epoch,recordingId=job.record.recordingId,leaseOwner=this.owner+":"+id();let releaseAcquisition:(()=>void)|undefined;
  const releaseStale=()=>{releaseAcquisition?.();};
  const acquired=async()=>{if(!this.isCurrent(job,epoch)||!activeStatus(job.entry.status)){releaseStale();return;}job.lease=true;job.leaseWaiting=false;job.leaseReady=false;const saved=await this.storage.ready(recordingId);if(!this.isCurrent(job,epoch)){releaseStale();return;}if(saved){const requested=saved.requested!==false||job.record.requested;if(requested&&saved.requested===false)await this.withIO(job,epoch,()=>this.storage.finalize(recordingId,{...saved,requested:true}));if(!this.isCurrent(job,epoch)){releaseStale();return;}this.complete[recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(recordingId);this.settle(job);this.release(job);this.emit();return;}const record=await this.storage.read(recordingId);if(!this.isCurrent(job,epoch)){releaseStale();return;}if(record?.fingerprint&&sameFingerprint(job.record.fingerprint,record.fingerprint)){if(!await this.loadChunks(job,true)||!this.isCurrent(job,epoch)){releaseStale();return;}}job.leaseReady=true;this.schedule();};
  if(typeof navigator!=="undefined"&&navigator.locks){
   void navigator.locks.request("sakura-download:"+this.options.accountId+":"+recordingId,{signal:job.controller.signal},async()=>{await new Promise<void>((resolve,reject)=>{releaseAcquisition=resolve;if(this.isCurrent(job,epoch))job.releaseLease=resolve;void acquired().catch(reject);});}).catch(error=>{if(!this.isCurrent(job,epoch))return;job.leaseWaiting=false;if(!job.controller.signal.aborted)this.fail(job,error);});
  }else{void this.storage.lease(recordingId,leaseOwner,Date.now()+8000).then(async held=>{if(!this.isCurrent(job,epoch)){if(held)void this.storage.release(recordingId,leaseOwner).catch(()=>{});return;}job.leaseWaiting=false;if(!held){job.retryTimer=setTimeout(()=>{if(!this.isCurrent(job,epoch))return;job.retryTimer=undefined;this.schedule();},1000);return;}releaseAcquisition=()=>{void this.storage.release(recordingId,leaseOwner).catch(()=>{});};job.releaseLease=releaseAcquisition;job.fallbackOwner=leaseOwner;job.leaseTimer=setInterval(()=>{void this.storage.lease(recordingId,leaseOwner,Date.now()+8000).then(ok=>{if(!this.isCurrent(job,epoch))return;if(!ok)this.leaseLost(job);}).catch(()=>{if(this.isCurrent(job,epoch))this.leaseLost(job);});},2000);await acquired();}).catch(error=>{if(this.isCurrent(job,epoch))this.fail(job,error);});}
 }
 private release(job:Job){job.openingFlights?.clear();job.openingSpans?.clear();job.openingOffsets?.clear();if(job.leaseTimer)clearInterval(job.leaseTimer);if(job.retryTimer)clearTimeout(job.retryTimer);if(job.recoveryTimer)clearTimeout(job.recoveryTimer);const unlock=job.releaseLease,fallbackOwner=job.fallbackOwner,recordingId=job.record.recordingId;job.leaseTimer=undefined;job.retryTimer=undefined;job.recoveryTimer=undefined;job.lease=false;job.leaseWaiting=false;job.leaseReady=false;job.releaseLease=undefined;job.fallbackOwner=undefined;if(!unlock)return;let finish:()=>void=()=>{};const drain=new Promise<void>(resolve=>{finish=resolve;});job.leaseDrain=drain;queueMicrotask(()=>{const renewal=fallbackOwner?setInterval(()=>{void this.storage.lease(recordingId,fallbackOwner,Date.now()+8000).catch(()=>{});},2000):undefined;void job.io.catch(()=>{}).finally(()=>{if(renewal)clearInterval(renewal);unlock();finish();if(job.leaseDrain===drain)job.leaseDrain=undefined;this.schedule();});});}
 private async withExclusive<T>(recordingId:string,operation:()=>Promise<T>):Promise<T>{const name="sakura-download:"+this.options.accountId+":"+recordingId;if(typeof navigator!=="undefined"&&navigator.locks)return navigator.locks.request(name,operation);const owner=this.owner+":clear:"+id();while(!await this.storage.lease(recordingId,owner,Date.now()+8000))await new Promise(resolve=>setTimeout(resolve,50));const renewal=setInterval(()=>{void this.storage.lease(recordingId,owner,Date.now()+8000).catch(()=>{});},2000);try{return await operation();}finally{clearInterval(renewal);await this.storage.release(recordingId,owner).catch(()=>{});}}
 private clearExclusive(recordingId:string,includeReady=false){return this.withExclusive(recordingId,()=>this.storage.clear(recordingId,includeReady));}
 private leaseLost(job:Job){const paused=this.pause(job.record.recordingId),epoch=job.epoch;void paused.catch(error=>{if(this.isCurrent(job,epoch))this.fail(job,error);});}
 private async resolveJob(job:Job){const epoch=job.epoch;try{
   job.entry.status="resolving";this.emit();let source=await this.options.resolve(job.record.track,job.controller.signal,{refresh:job.record.refreshSource===true});if(!this.isCurrent(job,epoch))return;
   for(let preparation=0;!/^[a-f0-9]{64}$/i.test(source.sha256||"")&&preparation<2;preparation++){
    await new Promise<void>((resolve,reject)=>{const signal=job.controller.signal,abort=()=>{clearTimeout(timer);reject(signal.reason??new DOMException("Canceled","AbortError"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},2000);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});
    if(!this.isCurrent(job,epoch))return;source=await this.options.resolve(job.record.track,job.controller.signal,{refresh:true});if(!this.isCurrent(job,epoch))return;
   }
   if(!source.assetId||!Number.isSafeInteger(source.sizeBytes)||source.sizeBytes<=0||source.sizeBytes>MAX_BYTES||!/^[a-f0-9]{64}$/i.test(source.sha256||""))throw new DownloadIntegrityError("This recording needs a verified audio fingerprint before it can be saved. Check again.");
   const canonical=source.track.id,old=job.record.recordingId;
   if(canonical!==old){await this.moveFullPins(old,canonical);if(!this.isCurrent(job,epoch))return;const other=this.jobs.get(canonical);this.aliases.set(old,canonical);this.aliases.set(referenceKey(job.record.track),canonical);this.jobs.delete(old);
    if(other&&other!==job){const pending=this.enqueue(other.record.track,{mode:job.record.mode,requested:job.record.requested,priority:job.record.priority});pending.then(()=>this.settle(job),error=>this.settle(job,error));for(const [offset,group] of job.waiters){void this.ensureChunk(canonical,offset).then(chunk=>{if(chunk)for(const waiter of group)waiter.resolve(chunk);else for(const waiter of group)waiter.reject(new Error("This part of the song could not be prepared."));},error=>{for(const waiter of group)waiter.reject(error);});}job.waiters.clear();this.release(job);await job.io;await this.storage.clear(old);this.emit();return;}
    this.release(job);job.record.recordingId=canonical;job.record.track=source.track;job.entry.recordingId=canonical;job.entry.track=source.track;this.jobs.set(canonical,job);await job.io;if(!this.isCurrent(job,epoch))return;await this.storage.clear(old);if(!this.isCurrent(job,epoch))return;
   }
   const fingerprint:DownloadFingerprint={assetId:source.assetId,sizeBytes:source.sizeBytes,sha256:source.sha256!.toLowerCase()};
   if(!sameFingerprint(job.record.fingerprint,fingerprint)){job.chunks.clear();job.opening=undefined;job.openingFlights?.clear();job.openingOffsets?.clear();job.record.audioStartBytes=undefined;job.record.audioOpeningEndBytes=undefined;job.record.mimeType=undefined;await this.withIO(job,epoch,()=>this.storage.clear(canonical));}
   if(!this.isCurrent(job,epoch))return;
   job.record.fingerprint=fingerprint;job.record.refreshSource=undefined;job.source=source;job.record.track=source.track;job.entry.track=source.track;
   for(const [offset,chunk] of job.chunks){const expected=Math.min(job.record.chunkBytes,source.sizeBytes-offset);if(offset%job.record.chunkBytes!==0||chunk.blob.size!==expected||offset>=source.sizeBytes||await audioSha256(chunk.blob)!==chunk.sha256){job.chunks.clear();job.opening=undefined;job.record.audioStartBytes=undefined;job.record.audioOpeningEndBytes=undefined;job.record.mimeType=undefined;await this.withIO(job,epoch,()=>this.storage.clear(canonical));break;}}
   if(!this.isCurrent(job,epoch))return;
   for(const [offset,group] of job.waiters)if(offset>=source.sizeBytes){for(const waiter of group)waiter.reject(new DownloadIntegrityError("This playback range does not belong to the recording."));job.waiters.delete(offset);job.urgent.delete(offset);}
   job.rangeReady=false;job.entry.status="queued";this.updateBytes(job);await this.save(job);this.emit();
  }catch(error){if(epoch===job.epoch&&!this.stopped&&!job.controller.signal.aborted&&!this.recover(job,error))this.fail(job,error);}
  finally{job.loading=false;this.resolving--;this.schedule();}}
 private async chunk(job:Job,offset:number){const epoch=job.epoch,source=job.source!,parent=job.controller.signal,controller=new AbortController(),abort=()=>controller.abort(parent.reason);if(parent.aborted)abort();else parent.addEventListener("abort",abort,{once:true});job.chunkControllers.set(offset,controller);const signal=controller.signal,end=Math.min(source.sizeBytes-1,offset+job.record.chunkBytes-1),span:{end:number;done?:boolean;error?:unknown;bulk?:boolean}={end,bulk:true};job.openingSpans??=new Map();job.openingSpans.set(offset,span);try{
   // The resolver supplies a verified CDN/Worker URL. Use it before the app
   // proxy so successful downloads do not consume Vercel audio bandwidth.
   const first=source.url,alternate=source.fallbackUrl!==first?source.fallbackUrl:undefined;
   let result:Awaited<ReturnType<typeof fetchAudioRange>>|undefined,lastError:unknown;const structuralFailures=new Set<string>();
   for(let attempt=0;attempt<3;attempt++){signal.throwIfAborted();if(!this.isCurrent(job,epoch))return;if(!connected()){this.suspendForConnection();return;}const url=attempt===1&&alternate?alternate:first;
    job.inFlightBytes.set(offset,0);
    try{result=await fetchAudioRange(url,offset,end,source.sizeBytes,signal,this.options.fetcher,bytes=>{if(epoch!==job.epoch)return;job.inFlightBytes.set(offset,bytes);this.updateBytes(job);if(Date.now()-job.lastPaint>150){job.lastPaint=Date.now();this.emit();}},this.options.idleTimeoutMs,job.record.mode==="full",whole=>this.responseMode(job,epoch,offset,whole),offset===0?blob=>this.publishOpening(job,epoch,blob):undefined,(physical,blob)=>this.publishBulkFragment(job,epoch,physical,blob),()=>job.fragmentPlayback===true,job.fragmentPlayback===true);break;}catch(error){lastError=error;if(error instanceof DownloadIntegrityError){if(!error.retryAlternate)throw error;structuralFailures.add(url);const trappedWhole=job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset;if(!alternate||structuralFailures.has(first)&&structuralFailures.has(alternate)){if(trappedWhole&&offset!==0)return;throw error;}}if(signal.aborted||!this.isCurrent(job,epoch))throw error;if(!connected()){this.suspendForConnection();return;}if(error instanceof UserFacingError&&["session","version","validation","storage"].includes(error.issue.kind))throw error;if(attempt<2&&!(error instanceof DownloadIntegrityError))await waitForRetry(signal,250*(attempt+1));}}
   if(!result){job.record.refreshSource=true;throw lastError;}if(this.stopped||epoch!==job.epoch)return;
   if(job.record.mimeType&&job.record.mimeType!==result.blob.type)throw new DownloadIntegrityError("The source changed audio format while this song was being saved.");const firstFormat=!job.record.mimeType;job.record.mimeType=result.blob.type;
   // The service worker reads the manifest before a chunk. Publish its format before waking the first media reader.
   if(firstFormat)await this.save(job);if(!this.isCurrent(job,epoch))return;
   if(result.whole){if(await audioSha256(result.blob)!==job.record.fingerprint!.sha256)throw new DownloadIntegrityError("The audio file did not match this verified recording. Check again.");for(let start=0;start<source.sizeBytes;start+=job.record.chunkBytes){const blob=result.blob.slice(start,Math.min(source.sizeBytes,start+job.record.chunkBytes),result.blob.type),chunk={offset:start,blob,sha256:await audioSha256(blob)};if(this.stopped||epoch!==job.epoch)return;await this.withIO(job,epoch,()=>this.storage.putChunk(job.record.recordingId,chunk));if(epoch!==job.epoch)return;this.publishChunk(job,chunk);}}
   else{const chunk={offset,blob:result.blob,sha256:await audioSha256(result.blob)};if(this.stopped||epoch!==job.epoch)return;await this.withIO(job,epoch,()=>this.storage.putChunk(job.record.recordingId,chunk));if(epoch!==job.epoch)return;this.publishChunk(job,chunk);job.rangeReady=true;}
   job.recoveryAttempts=0;this.updateBytes(job);await this.save(job);this.emit();
  }catch(error){if(epoch===job.epoch&&!this.stopped&&!signal.aborted&&!job.controller.signal.aborted&&!this.recover(job,error,true))this.fail(job,error);}
  finally{if(job.openingSpans?.get(offset)===span){if(signal.aborted)job.openingSpans.delete(offset);else span.done=true;}parent.removeEventListener("abort",abort);if(job.chunkControllers.get(offset)===controller)job.chunkControllers.delete(offset);if(job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset)job.wholeFlight=undefined;job.active.delete(offset);job.inFlightBytes.delete(offset);this.active--;this.updateBytes(job);this.schedule();}}
 private async finish(job:Job){if(job.loading||job.openingFlights?.size||!activeStatus(job.entry.status))return;job.loading=true;const epoch=job.epoch;try{
   let complete=true;for(let offset=0;offset<job.source!.sizeBytes;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)){complete=false;break;}if(!complete){job.entry.status="prepared";await this.save(job);if(!this.isCurrent(job,epoch))return;this.settle(job);this.release(job);this.emit();void this.pruneCache(job.record.recordingId).catch(()=>{});return;}
   const blob=new Blob([...job.chunks.values()].sort((a,b)=>a.offset-b.offset).map(chunk=>chunk.blob),{type:job.record.mimeType||"audio/mpeg"});if(blob.size!==job.source!.sizeBytes||await audioSha256(blob)!==job.record.fingerprint!.sha256)throw new DownloadIntegrityError("The audio file did not match this verified recording. Check again.");if(epoch!==job.epoch||this.stopped)return;
   // Experience preparation owns an evictable cache lease. Explicit saves and
   // ordinary full playback downloads retain their existing Saved behavior.
   if(!this.fullPinned(job.record.recordingId)){job.record.requested=true;job.entry.requested=true;}
   job.committing=true;let committed:OfflineAudio|undefined;await this.withIO(job,epoch,async()=>{await this.storage.finalize(job.record.recordingId,{track:job.record.track,blob,sizeBytes:blob.size,sha256:job.record.fingerprint!.sha256,savedAt:Date.now(),requested:job.record.requested});committed=await this.storage.ready(job.record.recordingId);});if(!this.isCurrent(job,epoch))return;
   if(job.record.requested&&committed?.requested!==true){await this.withIO(job,epoch,async()=>{committed=await this.storage.promoteRequested(job.record.recordingId);});if(!this.isCurrent(job,epoch))return;}
   if(!committed)throw new Error("The completed song could not be saved on this device. Please try again.");
   this.complete[job.record.recordingId]={...job.entry,status:"ready",downloadedBytes:blob.size,totalBytes:blob.size,sha256:job.record.fingerprint!.sha256,requested:committed.requested!==false,mode:"full",activeChunks:0};this.jobs.delete(job.record.recordingId);this.settle(job);this.release(job);this.emit();this.broadcastSaved(job.record.recordingId);
  }catch(error){if(epoch===job.epoch&&!this.stopped)this.fail(job,error);}finally{job.loading=false;job.committing=false;this.schedule();}}
 /** Restart an interrupted source without settling readers or losing verified bytes. */
 private recover(job:Job,error:unknown,fromRange=false):boolean{
  const expiredSource=fromRange&&error instanceof UserFacingError&&error.issue.kind==="missing"&&error.issue.title==="Audio is still being found for this song.";
  if(!(recoverableTransfer(error)||expiredSource)||job.recoveryAttempts>=(this.options.maxRecoveryAttempts??3))return false;
  if(!connected()){this.suspendForConnection();return true;}
  const epoch=++job.epoch,attempt=++job.recoveryAttempts;job.controller.abort();job.controller=new AbortController();this.release(job);
  job.source=undefined;job.rangeReady=false;job.wholeFlight=undefined;job.needsZeroProbe=false;job.record.refreshSource=true;job.entry.status="queued";job.entry.error=undefined;job.inFlightBytes.clear();this.updateBytes(job);
  // The queued manifest also resumes automatically after a reload during backoff.
  job.recoveryTimer=setTimeout(()=>{if(!this.isCurrent(job,epoch))return;job.recoveryTimer=undefined;job.warmingAt=Date.now();this.schedule();},Math.min(8000,(this.options.recoveryDelayMs??1000)*2**(attempt-1)));
  void this.save(job).catch(saveError=>{if(this.isCurrent(job,epoch))this.fail(job,saveError);});this.emit();return true;
 }
 private fail(job:Job,error:unknown){if(this.stopped||this.jobs.get(job.record.recordingId)!==job)return;job.epoch++;job.committing=false;job.controller.abort();job.controller=new AbortController();job.entry.status="failed";job.entry.error=error instanceof Error?error.message:"The song could not finish saving. Your progress is safe.";this.release(job);this.rejectChunks(job,error);this.settle(job,error);if(error instanceof DownloadIntegrityError){job.record.refreshSource=true;job.chunks.clear();job.opening=undefined;job.openingFlights?.clear();job.openingOffsets?.clear();job.openingSpans?.clear();job.record.audioStartBytes=undefined;job.record.audioOpeningEndBytes=undefined;job.source=undefined;job.record.mimeType=undefined;job.rangeReady=false;job.inFlightBytes.clear();this.updateBytes(job);void this.withIO(job,job.epoch,()=>this.storage.clear(job.record.recordingId)).then(()=>this.save(job)).catch(()=>{});}else void this.save(job).catch(()=>{});this.emit();if(job.record.requested)this.options.onError?.(error,job.record.track);this.schedule();}
 private cacheProtected(recordingId:string,protectId?:string){return this.fullPinned(recordingId)||recordingId===protectId||recordingId===(this.currentId&&this.aliases.get(this.currentId)||this.currentId)||this.priorityIds.slice(0,3).some(value=>(this.aliases.get(value)||value)===recordingId);}
 /** Serialize eviction with clicks and atomically refuse any explicit stored download. */
 private evictAutomatic(recordingId:string,protectId?:string):Promise<boolean>{
  const job=this.jobs.get(recordingId),entry=job?.entry||this.complete[recordingId];if(!entry||entry.requested!==false||this.cacheProtected(recordingId,protectId)||this.deleting.has(recordingId))return Promise.resolve(false);
  const active=job&&activeStatus(job.entry.status);if(job){job.epoch++;job.controller.abort();job.controller=new AbortController();job.entry.status="paused";this.release(job);this.rejectChunks(job,new DOMException("Playback cache expired","AbortError"));this.settle(job);}
  let removed=false;const operation=(job?.io||Promise.resolve()).then(async()=>{
   if(this.stopped||this.cacheProtected(recordingId,protectId)||job?.record.requested||this.complete[recordingId]?.requested===true){if(job&&active){job.entry.status="queued";job.warmingAt=Date.now();this.resetPromise(job);}return;}
   removed=await this.withExclusive(recordingId,()=>this.storage.clearAutomatic(recordingId));if(removed){if(!job||this.jobs.get(recordingId)===job)this.jobs.delete(recordingId);if(this.complete[recordingId]?.requested===false)delete this.complete[recordingId];return;}
   const saved=await this.storage.ready(recordingId),record=await this.storage.read(recordingId);if(saved){this.complete[recordingId]={recordingId,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,sha256:saved.sha256,operationId:job?.entry.operationId||id(),requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};if(!job||this.jobs.get(recordingId)===job)this.jobs.delete(recordingId);}else if(job&&this.jobs.get(recordingId)===job&&record){job.record={...record};job.entry.requested=record.requested;job.entry.mode=record.mode;job.entry.status=active?"queued":record.status;if(active){job.warmingAt=Date.now();this.resetPromise(job);}}
  }).finally(()=>{this.deleting.delete(recordingId);this.emit();this.schedule();});this.deleting.set(recordingId,operation);return operation.then(()=>removed);
 }
 /** Complete and partial automatic cache share one budget; explicit files stay untouched. */
 private pruneCache(protectId?:string):Promise<void>{
  if(this.pruning){this.pruneAgain=true;return this.pruning;}
  const operation=(async()=>{const automatic=Object.values(this.snapshot()).filter(entry=>entry.requested===false);let total=automatic.reduce((sum,entry)=>sum+entry.downloadedBytes,0),count=automatic.length;const ageLimit=Date.now()-7*24*60*60*1000;
   automatic.sort((a,b)=>Number(activeStatus(a.status))-Number(activeStatus(b.status))||(a.updatedAt??0)-(b.updatedAt??0));
   for(const entry of automatic){if(this.stopped)return;const stale=(entry.updatedAt??0)<ageLimit;if(total<=48*1024*1024&&count<=12&&!stale)continue;if(this.cacheProtected(entry.recordingId,protectId))continue;if(await this.evictAutomatic(entry.recordingId,protectId)){total-=entry.downloadedBytes;count--;}}
   this.emit();
  })();this.pruning=operation.finally(()=>{this.pruning=undefined;if(this.pruneAgain&&!this.stopped){this.pruneAgain=false;void this.pruneCache().catch(()=>{});}});return this.pruning;
 }
}
