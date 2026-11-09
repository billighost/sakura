"use client";
import type {DownloadEntry,MusicTrack} from "./types";
import type {OfflineAudio} from "./offline";
import {indexedDownloadStorage} from "./downloadStorage";
import {audioSha256,DownloadIntegrityError,fetchAudioRange} from "./downloadRange";
import {UserFacingError} from "./errors";
import type {DownloadChunk,DownloadFingerprint,DownloadSource,DownloadStorage,PartialDownloadRecord} from "./downloadTypes";
export type {DownloadSource,DownloadStorage,DownloadFingerprint,PartialDownloadRecord} from "./downloadTypes";

const CHUNK_BYTES=256*1024,MAX_BYTES=120*1024*1024,PRIORITY_WARMUP_MS=200,PLAYBACK_READ_AHEAD_CHUNKS=3;
const activeStatus=(status:DownloadEntry["status"])=>["queued","resolving","downloading"].includes(status);
const connected=()=>typeof navigator==="undefined"||navigator.onLine!==false;
const sameFingerprint=(a:DownloadFingerprint|undefined,b:DownloadFingerprint)=>!!a&&a.sizeBytes===b.sizeBytes&&a.sha256===b.sha256;
const referenceKey=(track:MusicTrack)=>JSON.stringify([track.reference.provider,track.reference.scope||"",track.reference.id]);
const id=()=>typeof crypto.randomUUID==="function"?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now();
const recoverableTransfer=(error:unknown)=>error instanceof UserFacingError
 ? ["connection","offline","busy"].includes(error.issue.kind)
 : error instanceof Error&&error.name!=="AbortError"&&/connection|network|failed to fetch|fetch failed|load failed|socket|terminated|timed? ?out|timeout|audio download did not start/i.test(error.message);
function waitForRetry(signal:AbortSignal,delay:number):Promise<void>{return new Promise((resolve,reject)=>{const finish=()=>{signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(finish,delay);const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(signal.reason??new DOMException("Canceled","AbortError"));};signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});}
interface Job {
 record:PartialDownloadRecord;entry:DownloadEntry;source?:DownloadSource;chunks:Map<number,DownloadChunk>;
 controller:AbortController;active:Set<number>;loading:boolean;rangeReady:boolean;lease:boolean;leaseWaiting:boolean;
 leaseReady:boolean;
 releaseLease?:()=>void;leaseTimer?:ReturnType<typeof setInterval>;retryTimer?:ReturnType<typeof setTimeout>;
 fallbackOwner?:string;
 leaseDrain?:Promise<void>;
 lastServed:number;epoch:number;promise:Promise<void>;resolve:()=>void;reject:(error:unknown)=>void;settled:boolean;
 urgent:Set<number>;waiters:Map<number,Set<{resolve:(chunk:DownloadChunk|undefined)=>void;reject:(error:unknown)=>void}>>;
 chunkControllers:Map<number,AbortController>;
 io:Promise<void>;inFlightBytes:Map<number,number>;lastPaint:number;
 warmingAt:number;
 committing:boolean;
 wholeFlight?:{epoch:number;offset:number};
 needsZeroProbe?:boolean;
 recoveryAttempts:number;recoveryTimer?:ReturnType<typeof setTimeout>;
}
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
 private deleting=new Map<string,Promise<void>>();private pruning:Promise<void>|undefined;
 private promotions=new Map<string,Promise<void>>();
 private sequence=0;private priorityIds:string[]=[];private currentId:string|undefined;private owner=id();
 private channel:BroadcastChannel|undefined;
 private priorityWake:ReturnType<typeof setTimeout>|undefined;private pruneAgain=false;
 private online=()=>{for(const job of this.jobs.values()){if(job.entry.status==="failed"&&job.record.requested)void this.resume(job.record.recordingId).catch(()=>{});else if(activeStatus(job.entry.status))this.schedule();}};
 private offline=()=>this.suspendForConnection();
 constructor(private options:DownloadManagerOptions){
  this.storage=options.storage||indexedDownloadStorage(options.accountId);
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
 private externalRemoval(recordingId:string){if(this.stopped)return;const job=this.jobs.get(recordingId);if(job){job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(recordingId);const error=new DOMException("Removed in another tab","AbortError");this.rejectChunks(job,error);this.settle(job,error);}delete this.complete[recordingId];this.emit();this.schedule();}
 private async externalSaved(recordingId:string){const saved=await this.storage.ready(recordingId);if(this.stopped||!saved)return;const job=this.jobs.get(recordingId);if(job){job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(recordingId);this.rejectChunks(job,new DOMException("Completed in another tab","AbortError"));this.settle(job);}this.complete[recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job?.entry.operationId||id(),sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.emit();this.schedule();}
 private jobFor(trackOrId:MusicTrack|string){return this.jobs.get(typeof trackOrId==="string"?(this.aliases.get(trackOrId)||trackOrId):(this.aliases.get(referenceKey(trackOrId))||this.aliases.get(trackOrId.id)||trackOrId.id));}
 private resetPromise(job:Job){if(!job.settled)return;job.settled=false;job.promise=new Promise<void>((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});void job.promise.catch(()=>{});}
 private settle(job:Job,error?:unknown){if(job.settled)return;job.settled=true;if(error)job.reject(error);else job.resolve();}
 private isCurrent(job:Job,epoch:number){return !this.stopped&&job.epoch===epoch&&this.jobs.get(job.record.recordingId)===job;}
 private newJob(record:PartialDownloadRecord):Job {
  const job:Job={record,entry:{recordingId:record.recordingId,track:record.track,status:record.status,downloadedBytes:0,totalBytes:record.fingerprint?.sizeBytes??null,operationId:id(),requested:record.requested,mode:record.mode,updatedAt:record.updatedAt,error:record.error},controller:new AbortController(),chunks:new Map(),active:new Set(),loading:false,rangeReady:false,lease:false,leaseWaiting:false,leaseReady:false,lastServed:0,epoch:0,promise:Promise.resolve(),resolve:()=>{},reject:()=>{},settled:true,urgent:new Set(),waiters:new Map(),chunkControllers:new Map(),io:Promise.resolve(),inFlightBytes:new Map(),lastPaint:0,warmingAt:Date.now(),committing:false,recoveryAttempts:0};
  this.resetPromise(job);return job;
 }
 private async withIO(job:Job,epoch:number,operation:()=>Promise<void>):Promise<boolean>{let performed=false;const flight=job.io.catch(()=>{}).then(async()=>{if(!this.isCurrent(job,epoch))return;await operation();performed=true;});job.io=flight.catch(()=>{});await flight;return performed;}
 private async save(job:Job){job.record={...job.record,status:job.entry.status,requested:!!job.entry.requested,updatedAt:Date.now(),error:job.entry.error};job.entry.mode=job.record.mode;job.entry.updatedAt=job.record.updatedAt;if(job.committing)return;const record={...job.record};await this.withIO(job,job.epoch,()=>this.storage.save(record));}
 private updateBytes(job:Job){job.entry.downloadedBytes=[...job.chunks.values()].reduce((sum,chunk)=>sum+chunk.blob.size,0)+[...job.inFlightBytes].reduce((sum,[offset,bytes])=>sum+(job.chunks.has(offset)?0:bytes),0);job.entry.totalBytes=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??null;job.entry.mode=job.record.mode;job.entry.cachedSeconds=job.entry.totalBytes?Math.min(job.record.track.durationMs/1000,Math.floor([...job.chunks.values()].reduce((sum,chunk)=>sum+chunk.blob.size,0)/job.entry.totalBytes*job.record.track.durationMs/1000)):0;job.entry.activeChunks=job.active.size;}
 async hydrate():Promise<void>{
  const [audio,records]=await Promise.all([this.storage.allReady(),this.storage.list()]);if(this.stopped)return;
  for(const value of audio){const record=records.find(record=>record.recordingId===value.track.id),requested=value.requested!==false||!!record?.requested;this.complete[value.track.id]={recordingId:value.track.id,track:value.track,status:"ready",downloadedBytes:value.sizeBytes,totalBytes:value.sizeBytes,operationId:id(),sha256:value.sha256,requested:value.requested!==false,mode:"full",updatedAt:value.savedAt};if(requested&&(value.requested===false||record))await this.promoteComplete(value.track.id,value.track,true).catch(()=>{});else if(record)await this.storage.finalize(value.track.id,value);if(this.stopped)return;}
  for(const record of records){if(this.complete[record.recordingId]||this.jobs.has(record.recordingId)||!Number.isSafeInteger(record.chunkBytes)||record.chunkBytes<1024||record.chunkBytes>4*1024*1024||!["full","prefix","playback"].includes(record.mode)||!["queued","resolving","downloading","paused","prepared","failed"].includes(record.status)||record.playbackOffset!==undefined&&(!Number.isSafeInteger(record.playbackOffset)||record.playbackOffset<0||record.playbackOffset%record.chunkBytes!==0)||record.fingerprint&&(!/^[a-f0-9]{64}$/i.test(record.fingerprint.sha256)||!Number.isSafeInteger(record.fingerprint.sizeBytes)||record.fingerprint.sizeBytes<=0||record.fingerprint.sizeBytes>MAX_BYTES||record.playbackOffset!==undefined&&record.playbackOffset>=record.fingerprint.sizeBytes))continue;
   // A persisted playback transfer is no longer playing after the app closes.
   // Restore its saved prefix; a fresh playback request can upgrade it again.
   const demoted=!record.requested&&record.mode==="full",parkedPlayback=!record.requested&&record.mode==="playback"&&activeStatus(record.status);
   const restored={...record,mode:demoted?"prefix" as const:record.mode,status:parkedPlayback?"prepared" as const:activeStatus(record.status)?"queued" as const:record.status};const job=this.newJob(restored);this.jobs.set(record.recordingId,job);this.aliases.set(referenceKey(record.track),record.recordingId);
   const epoch=job.epoch;
   try{const chunks=await this.storage.chunks(record.recordingId);if(this.stopped)return;if(!this.isCurrent(job,epoch))continue;for(const chunk of chunks)job.chunks.set(chunk.offset,chunk);this.updateBytes(job);
    if(demoted||parkedPlayback)await this.save(job);if(!this.isCurrent(job,epoch))continue;
    if(!activeStatus(restored.status))this.settle(job);
   }catch(error){if(this.isCurrent(job,epoch))this.fail(job,error);}
  }
  this.emit();this.schedule();void this.pruneCache().catch(()=>{});
 }
 enqueue(track:MusicTrack,options:{mode?:"full"|"prefix"|"playback";priority?:number;requested?:boolean}={}):Promise<void>{
  if(this.stopped)return Promise.reject(new DOMException("Downloads stopped","AbortError"));
  const mode=options.mode??"full",requested=options.requested??mode==="full";
  const canonical=this.aliases.get(referenceKey(track))||this.aliases.get(track.id)||track.id;
  const deletion=this.deleting.get(canonical);if(deletion)return deletion.then(()=>this.enqueue(track,options));
  if(this.complete[canonical])return requested?this.promoteComplete(canonical,track):Promise.resolve();
  let job=this.jobs.get(canonical);
  if(job?.record.requested&&!requested&&["paused","failed"].includes(job.entry.status))return Promise.resolve();
  if(job&&!job.record.requested&&!requested&&mode==="prefix"&&job.record.mode==="full"&&canonical!==(this.currentId&&this.aliases.get(this.currentId)||this.currentId))return this.prepare(canonical);
  if(job){job.record.priority=Math.max(job.record.priority,options.priority??0);if(requested){job.record.requested=true;job.entry.requested=true;job.record.mode="full";job.record.playbackOffset=undefined;}else if(mode==="full")job.record.mode="full";else if(mode==="playback")job.record.mode="playback";
   if(["prepared","paused","failed"].includes(job.entry.status)&&!(mode==="prefix"&&job.entry.status==="prepared")){if(job.record.refreshSource){job.source=undefined;job.rangeReady=false;}job.epoch++;job.controller.abort();this.release(job);job.recoveryAttempts=0;job.controller=new AbortController();job.entry.status="queued";job.entry.error=undefined;job.warmingAt=Date.now();this.resetPromise(job);}
  }else{const now=Date.now();job=this.newJob({version:1,recordingId:canonical,track:{...track,id:canonical},status:"queued",mode,requested,priority:options.priority??0,chunkBytes:this.chunkBytes,createdAt:now,updatedAt:now});this.jobs.set(canonical,job);}
  this.aliases.set(referenceKey(track),canonical);this.aliases.set(track.id,canonical);this.emit();const epoch=job.epoch;void this.save(job).then(()=>this.schedule()).catch(error=>{if(this.isCurrent(job!,epoch))this.fail(job!,error);});return job.promise;
 }
 setPriorities(recordingIds:string[],currentId?:string){this.priorityIds=recordingIds;this.currentId=currentId;for(const job of this.jobs.values())if(activeStatus(job.entry.status)&&(!job.lease||job.loading))job.warmingAt=Date.now();this.schedule();void this.pruneCache().catch(()=>{});}
 private promoteComplete(recordingId:string,track:MusicTrack,force=false):Promise<void>{
  const existing=this.promotions.get(recordingId);if(existing)return existing;const previous=this.complete[recordingId];if(previous?.status==="ready"&&previous.requested===true&&!force)return Promise.resolve();
  const pending={...previous,recordingId,track:previous?.track||track,status:"queued" as const,requested:true,mode:"full" as const,operationId:id(),downloadedBytes:previous?.downloadedBytes||0,totalBytes:previous?.totalBytes??null};this.complete[recordingId]=pending;this.emit();
  const operation=(async()=>{const saved=await this.storage.promoteRequested(recordingId);if(this.stopped||this.complete[recordingId]!==pending)return;if(!saved){delete this.complete[recordingId];return this.enqueue({...track,id:recordingId},{mode:"full",requested:true});}this.complete[recordingId]={...pending,track:saved.track,status:"ready",sha256:saved.sha256,downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,updatedAt:saved.savedAt};this.emit();this.broadcastSaved(recordingId);})().catch(error=>{if(!this.stopped&&this.complete[recordingId]===pending){this.complete[recordingId]={...pending,status:"failed",error:error instanceof Error?error.message:"This song could not be saved. Please try again."};this.emit();this.options.onError?.(error,pending.track);}throw error;}).finally(()=>{if(this.promotions.get(recordingId)===operation)this.promotions.delete(recordingId);});this.promotions.set(recordingId,operation);void operation.catch(()=>{});return operation;
 }
 sourceFor(recordingId:string):DownloadSource|undefined{return this.jobFor(recordingId)?.source;}
 /** Playback joins the existing chunk flight; canceling a reader leaves downloads running. */
 async ensureChunk(recordingId:string,offset:number,signal?:AbortSignal):Promise<DownloadChunk|undefined>{
  signal?.throwIfAborted();const canonical=this.aliases.get(recordingId)||recordingId,job=this.jobFor(canonical);
  if(!Number.isSafeInteger(offset)||offset<0||offset%(job?.record.chunkBytes??this.chunkBytes)!==0)throw new DownloadIntegrityError("This playback range does not belong to the recording.");
  if(!job){const audio=await this.storage.ready(canonical);if(!audio||offset>=audio.sizeBytes)return;const blob=audio.blob.slice(offset,Math.min(audio.sizeBytes,offset+this.chunkBytes),audio.blob.type);return {offset,blob,sha256:await audioSha256(blob)};}
  if(!Number.isSafeInteger(offset)||offset<0||offset%job.record.chunkBytes!==0||job.record.fingerprint&&offset>=job.record.fingerprint.sizeBytes)throw new DownloadIntegrityError("This playback range does not belong to the recording.");
  const existing=job.chunks.get(offset);if(existing&&await audioSha256(existing.blob)===existing.sha256){if(!job.record.requested){job.record.mode="playback";job.record.playbackOffset=offset;job.entry.mode="playback";this.preemptPlaybackWork(job,offset);if(connected())void this.enqueue(job.record.track,{mode:"playback",requested:false}).catch(()=>{});else void this.save(job).catch(()=>{});}return existing;}else if(existing){job.chunks.delete(offset);this.updateBytes(job);}
  if(job.wholeFlight?.epoch===job.epoch&&job.wholeFlight.offset===offset)return;
  if(!connected())throw new Error("The connection is offline. This part of the song is not saved on this device.");
  if(!job.record.requested){job.record.mode="playback";job.record.playbackOffset=offset;job.entry.mode="playback";}job.urgent.add(offset);
  return new Promise<DownloadChunk|undefined>((resolve,reject)=>{const group=job.waiters.get(offset)||new Set();const detach=()=>{signal?.removeEventListener("abort",abort);group.delete(waiter);if(!group.size){job.waiters.delete(offset);job.urgent.delete(offset);this.schedule();}};const waiter={resolve:(chunk:DownloadChunk|undefined)=>{detach();resolve(chunk);},reject:(error:unknown)=>{detach();reject(error);}};const abort=()=>waiter.reject(signal?.reason??new DOMException("Canceled","AbortError"));group.add(waiter);job.waiters.set(offset,group);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();this.preemptPlaybackWork(job,offset,true);void this.enqueue(job.record.track,{mode:job.record.requested?"full":"playback",requested:job.record.requested}).catch(()=>{});this.schedule();});
 }
 private responseMode(job:Job,epoch:number,offset:number,whole:boolean){if(!this.isCurrent(job,epoch)||!job.active.has(offset))return;if(!whole){if(job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset)job.wholeFlight=undefined;job.needsZeroProbe=false;job.rangeReady=true;this.schedule();return;}job.wholeFlight={epoch,offset};job.needsZeroProbe=offset!==0;for(const waiter of job.waiters.get(offset)||[])waiter.resolve(undefined);job.waiters.delete(offset);job.urgent.delete(offset);}
 private publishChunk(job:Job,chunk:DownloadChunk){job.chunks.set(chunk.offset,chunk);job.urgent.delete(chunk.offset);for(const waiter of job.waiters.get(chunk.offset)||[])waiter.resolve(chunk);job.waiters.delete(chunk.offset);}
 private rejectChunks(job:Job,error:unknown){for(const group of job.waiters.values())for(const waiter of group)waiter.reject(error);job.waiters.clear();job.urgent.clear();}
 private preemptPlaybackWork(job:Job,offset:number,global=false){let local=false;for(const activeOffset of job.active)if(activeOffset!==offset&&!job.waiters.has(activeOffset)){const controller=job.chunkControllers.get(activeOffset);if(controller&&!controller.signal.aborted){local=true;controller.abort(new DOMException("Playback moved","AbortError"));}}
  const current=this.currentId&&(this.aliases.get(this.currentId)||this.currentId);if(local||!global||current!==job.record.recordingId||!job.waiters.has(offset)||this.active<(this.options.maxConcurrentChunks??4))return;
  const candidates=[...this.jobs.values()].filter(other=>other!==job&&!other.record.requested&&this.priority(other)<this.priority(job)).flatMap(other=>[...other.active].filter(activeOffset=>!other.waiters.has(activeOffset)).map(activeOffset=>({job:other,controller:other.chunkControllers.get(activeOffset)}))).filter((candidate):candidate is {job:Job;controller:AbortController}=>!!candidate.controller&&!candidate.controller.signal.aborted).sort((a,b)=>this.priority(a.job)-this.priority(b.job)||b.job.lastServed-a.job.lastServed);
  candidates[0]?.controller.abort(new DOMException("Higher priority playback","AbortError"));
 }
 async getPartial(recordingId:string):Promise<{blob:Blob;cachedSeconds:number;fingerprint:DownloadFingerprint}|undefined>{
  const job=this.jobFor(recordingId);if(!job?.record.fingerprint)return;
  const chunks=[...job.chunks.values()].sort((a,b)=>a.offset-b.offset);if(!chunks.length)return;for(const chunk of chunks)if(await audioSha256(chunk.blob)!==chunk.sha256)return;
  const parts:Blob[]=[];let offset=0;while(job.chunks.has(offset)){const chunk=job.chunks.get(offset)!;parts.push(chunk.blob);offset+=chunk.blob.size;}if(!parts.length)parts.push(chunks[0].blob);return {blob:new Blob(parts,{type:job.record.mimeType||parts[0].type}),cachedSeconds:job.entry.cachedSeconds||0,fingerprint:job.record.fingerprint};
 }
 async pause(recordingId:string):Promise<void>{const job=this.jobFor(recordingId);if(!job||job.entry.status==="ready")return;const reconcileCommit=job.committing,epoch=++job.epoch;job.entry.status="paused";job.controller.abort();job.controller=new AbortController();this.release(job);this.rejectChunks(job,new DOMException("Download paused","AbortError"));this.settle(job);this.emit();if(!reconcileCommit){await this.save(job);return;}await job.io;if(!this.isCurrent(job,epoch))return;job.committing=false;let saved=await this.storage.ready(job.record.recordingId);if(!this.isCurrent(job,epoch))return;if(saved){if(job.record.requested&&saved.requested!==true)saved=await this.storage.promoteRequested(job.record.recordingId);if(!saved||!this.isCurrent(job,epoch))return;this.complete[job.record.recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(job.record.recordingId);this.settle(job);this.emit();return;}await this.save(job);}
 /** Paused/skipped automatic songs retain their exact verified playback chunks. */
 async prepare(recordingId:string):Promise<void>{
  const job=this.jobFor(recordingId);if(!job||job.record.requested||job.record.mode==="prefix")return;
  const failed=job.entry.status==="failed",playback=job.record.mode==="playback",epoch=++job.epoch;if(!playback){job.record.mode="prefix";job.record.playbackOffset=undefined;}job.controller.abort();job.controller=new AbortController();this.release(job);this.rejectChunks(job,new DOMException("Playback moved on","AbortError"));this.settle(job);if(!failed)job.entry.error=undefined;
  const target=this.targetBytes(job);let complete=playback||target>0;for(let offset=0;!playback&&offset<target;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)){complete=false;break;}job.entry.status=failed?"failed":complete?"prepared":"queued";job.warmingAt=Date.now();this.updateBytes(job);if(!complete&&!failed)this.resetPromise(job);this.emit();
  await job.io;if(!this.isCurrent(job,epoch)||job.record.requested)return;const saved=await this.storage.ready(job.record.recordingId);if(!this.isCurrent(job,epoch)||job.record.requested)return;
  if(saved){this.complete[job.record.recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(job.record.recordingId);this.settle(job);this.emit();return;}
  await this.save(job);if(!this.isCurrent(job,epoch))return;this.emit();this.schedule();void this.pruneCache(job.record.recordingId).catch(()=>{});
 }
 resume(recordingId:string):Promise<void>{const job=this.jobFor(recordingId);return job?this.enqueue(job.record.track,{mode:job.record.mode,requested:job.record.requested,priority:job.record.priority}):Promise.resolve();}
 cancel(recordingId:string):Promise<void>{const canonical=this.aliases.get(recordingId)||recordingId,pending=this.deleting.get(canonical);if(pending)return pending;const job=this.jobFor(canonical),promotion=this.promotions.get(canonical);if(!job){if(!promotion)return Promise.resolve();delete this.complete[canonical];const operation=promotion.catch(()=>{}).then(()=>this.clearExclusive(canonical,true)).then(()=>this.broadcastRemoval(canonical)).finally(()=>{this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}const jobId=job.record.recordingId;job.epoch++;job.controller.abort();this.release(job);this.jobs.delete(jobId);const error=new DOMException("Canceled","AbortError");this.rejectChunks(job,error);this.settle(job,error);const operation=job.io.then(()=>this.clearExclusive(jobId,true)).then(()=>this.broadcastRemoval(jobId)).finally(()=>{this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}
 remove(recordingId:string):Promise<void>{const canonical=this.aliases.get(recordingId)||recordingId,pending=this.deleting.get(canonical);if(pending)return pending;if(this.jobFor(canonical))return this.cancel(canonical);const promotion=this.promotions.get(canonical);delete this.complete[canonical];const operation=(promotion?.catch(()=>{})||Promise.resolve()).then(()=>this.clearExclusive(canonical,true)).then(()=>this.broadcastRemoval(canonical)).finally(()=>{if(this.deleting.get(canonical)===operation)this.deleting.delete(canonical);this.emit();this.schedule();});this.deleting.set(canonical,operation);return operation;}
 dispose(){if(this.stopped)return;this.stopped=true;if(this.priorityWake)clearTimeout(this.priorityWake);this.channel?.close();this.channel=undefined;if(typeof window!=="undefined"){window.removeEventListener("online",this.online);window.removeEventListener("offline",this.offline);}for(const job of this.jobs.values()){job.epoch++;job.controller.abort();if(job.retryTimer)clearTimeout(job.retryTimer);this.release(job);const error=new DOMException("Downloads stopped","AbortError");this.rejectChunks(job,error);this.settle(job,error);}}
 private suspendForConnection(){if(this.stopped)return;for(const job of this.jobs.values()){if(!activeStatus(job.entry.status))continue;const epoch=++job.epoch;job.controller.abort();job.controller=new AbortController();this.release(job);job.entry.status="queued";job.inFlightBytes.clear();this.updateBytes(job);this.rejectChunks(job,new Error("The connection is offline. Saved audio will resume when it returns."));void this.save(job).catch(error=>{if(this.isCurrent(job,epoch))this.fail(job,error);});}this.emit();}
 private priority(job:Job){const recordingId=job.record.recordingId;if(recordingId===(this.currentId&&this.aliases.get(this.currentId)||this.currentId))return 100000;if(job.waiters.size)return 90000;const index=this.priorityIds.findIndex(value=>(this.aliases.get(value)||value)===recordingId);return index<0?(job.record.requested?2000:0)+Math.max(-100,Math.min(100,job.record.priority)):80000-Math.min(index,50)*50;}
 private schedule(){if(this.scheduled||this.stopped)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}
 private pump(){
  if(this.stopped||!connected())return;
  const candidates=[...this.jobs.values()].filter(job=>activeStatus(job.entry.status)&&!job.recoveryTimer).sort((a,b)=>this.priority(b)-this.priority(a)||a.lastServed-b.lastServed||a.record.createdAt-b.record.createdAt);
  for(const job of candidates){if(!job.lease){this.acquire(job);continue;}if(job.leaseReady&&!job.source&&!job.loading&&!job.active.size&&this.resolving<2){job.loading=true;this.resolving++;void this.resolveJob(job);}}
  const limit=this.options.maxConcurrentChunks??4;
  while(this.active<limit){const eligible=candidates.filter(job=>job.lease&&job.leaseReady&&job.source&&!job.loading&&job.active.size<(job.rangeReady?(this.options.maxChunksPerSong??2):1)&&this.nextOffset(job)!==null).sort((a,b)=>this.priority(b)-this.priority(a)||a.lastServed-b.lastServed);
   const job=eligible[0];if(!job)break;const pending=candidates.find(other=>this.priority(other)>this.priority(job)&&!other.active.size&&(!other.leaseReady||!other.source||other.loading)&&other.warmingAt+PRIORITY_WARMUP_MS>Date.now());if(pending){if(!this.priorityWake)this.priorityWake=setTimeout(()=>{this.priorityWake=undefined;this.schedule();},Math.max(1,pending.warmingAt+PRIORITY_WARMUP_MS-Date.now()));break;}const offset=this.nextOffset(job)!;job.active.add(offset);job.lastServed=++this.sequence;this.active++;job.entry.status="downloading";this.updateBytes(job);this.emit();void this.chunk(job,offset);
  }
  for(const job of candidates)if(job.leaseReady&&job.source&&!job.loading&&!job.active.size&&this.nextOffset(job)===null&&!(job.record.mode==="playback"&&job.record.playbackOffset===undefined))void this.finish(job);
 }
 private targetBytes(job:Job){const total=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??0;if(job.record.mode==="full")return total;if(job.record.mode==="playback")return Math.min(total,(job.record.playbackOffset??total)+job.record.chunkBytes*PLAYBACK_READ_AHEAD_CHUNKS);const fraction=22000/Math.max(22000,job.record.track.durationMs);return Math.min(total,Math.max(job.record.chunkBytes,Math.ceil(total*fraction/job.record.chunkBytes)*job.record.chunkBytes));}
 private nextOffset(job:Job):number|null{const total=job.source?.sizeBytes??job.record.fingerprint?.sizeBytes??0,target=this.targetBytes(job);if(target>0&&job.needsZeroProbe&&!job.active.has(0))return 0;for(const offset of job.urgent)if(offset<total&&!job.chunks.has(offset)&&!job.active.has(offset))return offset;const start=job.record.mode==="playback"?job.record.playbackOffset??target:0;for(let offset=start;offset<target;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)&&!job.active.has(offset))return offset;return null;}
 private acquire(job:Job){
  if(job.leaseWaiting||job.retryTimer||job.leaseDrain||this.stopped)return;job.leaseWaiting=true;const epoch=job.epoch,recordingId=job.record.recordingId,leaseOwner=this.owner+":"+id();let releaseAcquisition:(()=>void)|undefined;
  const releaseStale=()=>{releaseAcquisition?.();};
  const acquired=async()=>{if(!this.isCurrent(job,epoch)||!activeStatus(job.entry.status)){releaseStale();return;}job.lease=true;job.leaseWaiting=false;job.leaseReady=false;const saved=await this.storage.ready(recordingId);if(!this.isCurrent(job,epoch)){releaseStale();return;}if(saved){const requested=saved.requested!==false||job.record.requested;if(requested&&saved.requested===false)await this.withIO(job,epoch,()=>this.storage.finalize(recordingId,{...saved,requested:true}));if(!this.isCurrent(job,epoch)){releaseStale();return;}this.complete[recordingId]={recordingId:saved.track.id,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,operationId:job.entry.operationId,sha256:saved.sha256,requested,mode:"full",updatedAt:saved.savedAt};this.jobs.delete(recordingId);this.settle(job);this.release(job);this.emit();return;}const record=await this.storage.read(recordingId);if(!this.isCurrent(job,epoch)){releaseStale();return;}if(record?.fingerprint&&sameFingerprint(job.record.fingerprint,record.fingerprint)){const chunks=await this.storage.chunks(recordingId);if(!this.isCurrent(job,epoch)){releaseStale();return;}for(const chunk of chunks)job.chunks.set(chunk.offset,chunk);this.updateBytes(job);}job.leaseReady=true;this.schedule();};
  if(typeof navigator!=="undefined"&&navigator.locks){
   void navigator.locks.request("sakura-download:"+this.options.accountId+":"+recordingId,{signal:job.controller.signal},async()=>{await new Promise<void>((resolve,reject)=>{releaseAcquisition=resolve;if(this.isCurrent(job,epoch))job.releaseLease=resolve;void acquired().catch(reject);});}).catch(error=>{if(!this.isCurrent(job,epoch))return;job.leaseWaiting=false;if(!job.controller.signal.aborted)this.fail(job,error);});
  }else{void this.storage.lease(recordingId,leaseOwner,Date.now()+8000).then(async held=>{if(!this.isCurrent(job,epoch)){if(held)void this.storage.release(recordingId,leaseOwner).catch(()=>{});return;}job.leaseWaiting=false;if(!held){job.retryTimer=setTimeout(()=>{if(!this.isCurrent(job,epoch))return;job.retryTimer=undefined;this.schedule();},1000);return;}releaseAcquisition=()=>{void this.storage.release(recordingId,leaseOwner).catch(()=>{});};job.releaseLease=releaseAcquisition;job.fallbackOwner=leaseOwner;job.leaseTimer=setInterval(()=>{void this.storage.lease(recordingId,leaseOwner,Date.now()+8000).then(ok=>{if(!this.isCurrent(job,epoch))return;if(!ok)this.leaseLost(job);}).catch(()=>{if(this.isCurrent(job,epoch))this.leaseLost(job);});},2000);await acquired();}).catch(error=>{if(this.isCurrent(job,epoch))this.fail(job,error);});}
 }
 private release(job:Job){if(job.leaseTimer)clearInterval(job.leaseTimer);if(job.retryTimer)clearTimeout(job.retryTimer);if(job.recoveryTimer)clearTimeout(job.recoveryTimer);const unlock=job.releaseLease,fallbackOwner=job.fallbackOwner,recordingId=job.record.recordingId;job.leaseTimer=undefined;job.retryTimer=undefined;job.recoveryTimer=undefined;job.lease=false;job.leaseWaiting=false;job.leaseReady=false;job.releaseLease=undefined;job.fallbackOwner=undefined;if(!unlock)return;let finish:()=>void=()=>{};const drain=new Promise<void>(resolve=>{finish=resolve;});job.leaseDrain=drain;queueMicrotask(()=>{const renewal=fallbackOwner?setInterval(()=>{void this.storage.lease(recordingId,fallbackOwner,Date.now()+8000).catch(()=>{});},2000):undefined;void job.io.catch(()=>{}).finally(()=>{if(renewal)clearInterval(renewal);unlock();finish();if(job.leaseDrain===drain)job.leaseDrain=undefined;this.schedule();});});}
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
   if(canonical!==old){const other=this.jobs.get(canonical);this.aliases.set(old,canonical);this.aliases.set(referenceKey(job.record.track),canonical);this.jobs.delete(old);
    if(other&&other!==job){const pending=this.enqueue(other.record.track,{mode:job.record.mode,requested:job.record.requested,priority:job.record.priority});pending.then(()=>this.settle(job),error=>this.settle(job,error));for(const [offset,group] of job.waiters){void this.ensureChunk(canonical,offset).then(chunk=>{if(chunk)for(const waiter of group)waiter.resolve(chunk);else for(const waiter of group)waiter.reject(new Error("This part of the song could not be prepared."));},error=>{for(const waiter of group)waiter.reject(error);});}job.waiters.clear();this.release(job);await job.io;await this.storage.clear(old);this.emit();return;}
    this.release(job);job.record.recordingId=canonical;job.record.track=source.track;job.entry.recordingId=canonical;job.entry.track=source.track;this.jobs.set(canonical,job);await job.io;if(!this.isCurrent(job,epoch))return;await this.storage.clear(old);if(!this.isCurrent(job,epoch))return;
   }
   const fingerprint:DownloadFingerprint={assetId:source.assetId,sizeBytes:source.sizeBytes,sha256:source.sha256!.toLowerCase()};
   if(!sameFingerprint(job.record.fingerprint,fingerprint)){job.chunks.clear();job.record.mimeType=undefined;await this.withIO(job,epoch,()=>this.storage.clear(canonical));}
   if(!this.isCurrent(job,epoch))return;
   job.record.fingerprint=fingerprint;job.record.refreshSource=undefined;job.source=source;job.record.track=source.track;job.entry.track=source.track;
   for(const [offset,chunk] of job.chunks){const expected=Math.min(job.record.chunkBytes,source.sizeBytes-offset);if(offset%job.record.chunkBytes!==0||chunk.blob.size!==expected||offset>=source.sizeBytes||await audioSha256(chunk.blob)!==chunk.sha256){job.chunks.clear();job.record.mimeType=undefined;await this.withIO(job,epoch,()=>this.storage.clear(canonical));break;}}
   if(!this.isCurrent(job,epoch))return;
   for(const [offset,group] of job.waiters)if(offset>=source.sizeBytes){for(const waiter of group)waiter.reject(new DownloadIntegrityError("This playback range does not belong to the recording."));job.waiters.delete(offset);job.urgent.delete(offset);}
   job.rangeReady=false;job.entry.status="queued";this.updateBytes(job);await this.save(job);this.emit();
  }catch(error){if(epoch===job.epoch&&!this.stopped&&!job.controller.signal.aborted&&!this.recover(job,error))this.fail(job,error);}
  finally{job.loading=false;this.resolving--;this.schedule();}}
 private async chunk(job:Job,offset:number){const epoch=job.epoch,source=job.source!,parent=job.controller.signal,controller=new AbortController(),abort=()=>controller.abort(parent.reason);if(parent.aborted)abort();else parent.addEventListener("abort",abort,{once:true});job.chunkControllers.set(offset,controller);const signal=controller.signal,end=Math.min(source.sizeBytes-1,offset+job.record.chunkBytes-1);try{
   const sameOrigin=(url:string)=>{try{return typeof location!=="undefined"&&new URL(url,location.href).origin===location.origin||url.startsWith("/");}catch{return false;}};
   const first=source.fallbackUrl&&sameOrigin(source.fallbackUrl)?source.fallbackUrl:source.url;const alternate=first===source.url?source.fallbackUrl:source.url;
   let result:Awaited<ReturnType<typeof fetchAudioRange>>|undefined,lastError:unknown;const structuralFailures=new Set<string>();
   for(let attempt=0;attempt<3;attempt++){signal.throwIfAborted();if(!this.isCurrent(job,epoch))return;if(!connected()){this.suspendForConnection();return;}const url=attempt===1&&alternate?alternate:first;
    job.inFlightBytes.set(offset,0);
    try{result=await fetchAudioRange(url,offset,end,source.sizeBytes,signal,this.options.fetcher,bytes=>{if(epoch!==job.epoch)return;job.inFlightBytes.set(offset,bytes);this.updateBytes(job);if(Date.now()-job.lastPaint>150){job.lastPaint=Date.now();this.emit();}},this.options.idleTimeoutMs,job.record.mode==="full",whole=>this.responseMode(job,epoch,offset,whole));break;}catch(error){lastError=error;if(error instanceof DownloadIntegrityError){if(!error.retryAlternate)throw error;structuralFailures.add(url);const trappedWhole=job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset;if(!alternate||structuralFailures.has(first)&&structuralFailures.has(alternate)){if(trappedWhole&&offset!==0)return;throw error;}}if(signal.aborted||!this.isCurrent(job,epoch))throw error;if(!connected()){this.suspendForConnection();return;}if(error instanceof UserFacingError&&["session","version","validation","storage"].includes(error.issue.kind))throw error;if(attempt<2&&!(error instanceof DownloadIntegrityError))await waitForRetry(signal,250*(attempt+1));}}
   if(!result){job.record.refreshSource=true;throw lastError;}if(this.stopped||epoch!==job.epoch)return;
   if(job.record.mimeType&&job.record.mimeType!==result.blob.type)throw new DownloadIntegrityError("The source changed audio format while this song was being saved.");const firstFormat=!job.record.mimeType;job.record.mimeType=result.blob.type;
   // The service worker reads the manifest before a chunk. Publish its format before waking the first media reader.
   if(firstFormat)await this.save(job);if(!this.isCurrent(job,epoch))return;
   if(result.whole){if(await audioSha256(result.blob)!==job.record.fingerprint!.sha256)throw new DownloadIntegrityError("The audio file did not match this verified recording. Check again.");for(let start=0;start<source.sizeBytes;start+=job.record.chunkBytes){const blob=result.blob.slice(start,Math.min(source.sizeBytes,start+job.record.chunkBytes),result.blob.type),chunk={offset:start,blob,sha256:await audioSha256(blob)};if(this.stopped||epoch!==job.epoch)return;await this.withIO(job,epoch,()=>this.storage.putChunk(job.record.recordingId,chunk));if(epoch!==job.epoch)return;this.publishChunk(job,chunk);}}
   else{const chunk={offset,blob:result.blob,sha256:await audioSha256(result.blob)};if(this.stopped||epoch!==job.epoch)return;await this.withIO(job,epoch,()=>this.storage.putChunk(job.record.recordingId,chunk));if(epoch!==job.epoch)return;this.publishChunk(job,chunk);job.rangeReady=true;}
   job.recoveryAttempts=0;this.updateBytes(job);await this.save(job);this.emit();
  }catch(error){if(epoch===job.epoch&&!this.stopped&&!signal.aborted&&!job.controller.signal.aborted&&!this.recover(job,error,true))this.fail(job,error);}
  finally{parent.removeEventListener("abort",abort);if(job.chunkControllers.get(offset)===controller)job.chunkControllers.delete(offset);if(job.wholeFlight?.epoch===epoch&&job.wholeFlight.offset===offset)job.wholeFlight=undefined;job.active.delete(offset);job.inFlightBytes.delete(offset);this.active--;this.updateBytes(job);this.schedule();}}
 private async finish(job:Job){if(job.loading||!activeStatus(job.entry.status))return;job.loading=true;const epoch=job.epoch;try{
   let complete=true;for(let offset=0;offset<job.source!.sizeBytes;offset+=job.record.chunkBytes)if(!job.chunks.has(offset)){complete=false;break;}if(!complete){job.entry.status="prepared";await this.save(job);if(!this.isCurrent(job,epoch))return;this.settle(job);this.release(job);this.emit();void this.pruneCache(job.record.recordingId).catch(()=>{});return;}
   const blob=new Blob([...job.chunks.values()].sort((a,b)=>a.offset-b.offset).map(chunk=>chunk.blob),{type:job.record.mimeType||"audio/mpeg"});if(blob.size!==job.source!.sizeBytes||await audioSha256(blob)!==job.record.fingerprint!.sha256)throw new DownloadIntegrityError("The audio file did not match this verified recording. Check again.");if(epoch!==job.epoch||this.stopped)return;
   // A fully verified file is already occupying the same durable storage as an
   // explicit download. Keep it in Saved even when playback fetched the bytes.
   job.record.requested=true;job.entry.requested=true;
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
 private fail(job:Job,error:unknown){if(this.stopped||this.jobs.get(job.record.recordingId)!==job)return;job.epoch++;job.committing=false;job.controller.abort();job.controller=new AbortController();job.entry.status="failed";job.entry.error=error instanceof Error?error.message:"The song could not finish saving. Your progress is safe.";this.release(job);this.rejectChunks(job,error);this.settle(job,error);if(error instanceof DownloadIntegrityError){job.record.refreshSource=true;job.chunks.clear();job.source=undefined;job.record.mimeType=undefined;job.rangeReady=false;job.inFlightBytes.clear();this.updateBytes(job);void this.withIO(job,job.epoch,()=>this.storage.clear(job.record.recordingId)).then(()=>this.save(job)).catch(()=>{});}else void this.save(job).catch(()=>{});this.emit();if(job.record.requested)this.options.onError?.(error,job.record.track);this.schedule();}
 private cacheProtected(recordingId:string,protectId?:string){return recordingId===protectId||recordingId===(this.currentId&&this.aliases.get(this.currentId)||this.currentId)||this.priorityIds.slice(0,3).some(value=>(this.aliases.get(value)||value)===recordingId);}
 /** Serialize eviction with clicks and atomically refuse any explicit stored download. */
 private evictAutomatic(recordingId:string,protectId?:string):Promise<boolean>{
  const job=this.jobs.get(recordingId),entry=job?.entry||this.complete[recordingId];if(!entry||entry.requested!==false||this.cacheProtected(recordingId,protectId)||this.deleting.has(recordingId))return Promise.resolve(false);
  const active=job&&activeStatus(job.entry.status);if(job){job.epoch++;job.controller.abort();job.controller=new AbortController();job.entry.status="paused";this.release(job);this.rejectChunks(job,new DOMException("Playback cache expired","AbortError"));this.settle(job);}
  let removed=false;const operation=(job?.io||Promise.resolve()).then(async()=>{
   if(this.stopped||this.cacheProtected(recordingId,protectId)||job?.record.requested||this.complete[recordingId]?.requested===true){if(job&&active){job.entry.status="queued";job.warmingAt=Date.now();this.resetPromise(job);}return;}
   removed=await this.withExclusive(recordingId,()=>this.storage.clearAutomatic(recordingId));if(removed){if(!job||this.jobs.get(recordingId)===job)this.jobs.delete(recordingId);if(this.complete[recordingId]?.requested===false)delete this.complete[recordingId];return;}
   const saved=await this.storage.ready(recordingId),record=await this.storage.read(recordingId);if(saved){this.complete[recordingId]={recordingId,track:saved.track,status:"ready",downloadedBytes:saved.sizeBytes,totalBytes:saved.sizeBytes,sha256:saved.sha256,operationId:job?.entry.operationId||id(),requested:saved.requested!==false,mode:"full",updatedAt:saved.savedAt};if(!job||this.jobs.get(recordingId)===job)this.jobs.delete(recordingId);}else if(job&&this.jobs.get(recordingId)===job&&record){job.record={...record,requested:true};job.entry.requested=true;job.entry.mode="full";job.entry.status=active?"queued":record.status;if(active){job.warmingAt=Date.now();this.resetPromise(job);}}
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
