"use client";
import { openDB } from "idb";
import type { MusicTrack, Account } from "./types";
import {listeningTimeFallsInPeriod} from "./listeningEvidence";
let database:ReturnType<typeof openDB>|null=null;
const db=()=>database||(database=openDB("sakura-ink-v1",1,{upgrade(db){db.createObjectStore("entries");}}));
/** Shared database for atomic download chunk and manifest transactions. */
export const offlineDatabase=db;
const key=(accountId:string,name:string)=>"account:"+accountId+":"+name;
export async function localRead<T>(accountId:string,name:string):Promise<T|undefined>{return (await db()).get("entries",key(accountId,name));}
export async function localWrite(accountId:string,name:string,value:unknown){await (await db()).put("entries",value,key(accountId,name));}
export async function localDelete(accountId:string,name:string){await (await db()).delete("entries",key(accountId,name));}
export interface OfflineAudio {track:MusicTrack;blob:Blob;sha256:string;sizeBytes:number;savedAt:number;requested?:boolean}
export function validOfflineAudio(value:unknown):value is OfflineAudio {
 const saved=value as Partial<OfflineAudio>|null;
 return !!saved&&saved.blob instanceof Blob&&saved.blob.type.startsWith("audio/")&&typeof saved.sizeBytes==="number"&&Number.isSafeInteger(saved.sizeBytes)&&saved.sizeBytes>0&&saved.sizeBytes<=120*1024*1024&&saved.blob.size===saved.sizeBytes&&typeof saved.sha256==="string"&&/^[a-f0-9]{64}$/i.test(saved.sha256)&&typeof saved.track?.id==="string"&&!!saved.track.id;
}
export async function savedAudio(accountId:string):Promise<OfflineAudio[]>{const result:OfflineAudio[]=[];const prefix=key(accountId,"audio:");let cursor=await (await db()).transaction("entries").store.openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff"));while(cursor){if(validOfflineAudio(cursor.value)&&String(cursor.key)===key(accountId,"audio:"+cursor.value.track.id))result.push(cursor.value);cursor=await cursor.continue();}return result;}
/** Cached account data may be discarded without deleting this account's downloaded songs. */
export async function removeAccountCache(accountId:string,options:{includeDownloads?:boolean}={}){const database=await db(),tx=database.transaction("entries","readwrite");let cursor=await tx.store.openCursor();while(cursor){const name=String(cursor.key);const audio=["audio:","download:","chunk:"].some(prefix=>name.startsWith(key(accountId,prefix)));if(name.startsWith(key(accountId,""))&&(options.includeDownloads||!audio))await cursor.delete();cursor=await cursor.continue();}await tx.done;const active=await database.get("entries","last-account") as Account|undefined;if(active?.id===accountId)await forgetActiveAccount();}
export async function forgetActiveAccount(){try{localStorage.removeItem("sakura-v2-active-account");localStorage.removeItem("sakura-v2-theme");}catch{}await (await db()).delete("entries","last-account");}
export async function rememberAccount(account:Account){try{localStorage.setItem("sakura-v2-active-account",account.id);}catch{}await (await db()).put("entries",account,"last-account");}
export async function lastAccount():Promise<Account|undefined>{return (await db()).get("entries","last-account");}
export async function verifiedAudio(response:Response,expectedBytes:number,signal:AbortSignal,onProgress:(bytes:number)=>void,expectedSha?:string,idleTimeoutMs=20000):Promise<{blob:Blob;sha256:string}>{
 signal.throwIfAborted();
 if(!response.ok||!response.body)throw new Error("The audio download did not start.");
 const mime=response.headers.get("Content-Type")?.split(";")[0]||"";if(!mime.startsWith("audio/"))throw new Error("The source didn’t return an audio file.");
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||expectedBytes>120*1024*1024)throw new Error("This audio file cannot be saved on this device.");
 const reader=response.body.getReader();const parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;let lastPaint=0;
 async function read(){signal.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};try{return await Promise.race([reader.read(),new Promise<never>((_,reject)=>{abort=()=>{reject(signal.reason??new DOMException("Canceled","AbortError"));void reader.cancel().catch(()=>{});};signal.addEventListener("abort",abort,{once:true});if(signal.aborted){abort();return;}timer=setTimeout(()=>{reject(new Error("The connection paused before the song finished. Try downloading again."));void reader.cancel().catch(()=>{});},idleTimeoutMs);})]);}finally{if(timer)clearTimeout(timer);signal.removeEventListener("abort",abort);}}
 try{while(true){signal.throwIfAborted();const chunk=await read();signal.throwIfAborted();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>expectedBytes)throw new Error("The audio file size changed. Please try again.");parts.push(new Uint8Array(chunk.value));if(performance.now()-lastPaint>150){onProgress(bytes);lastPaint=performance.now();}}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(bytes!==expectedBytes)throw new Error("The connection ended before the complete song arrived.");
 const blob=new Blob(parts,{type:mime});const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");if(signal.aborted)throw new DOMException("Canceled","AbortError");if(expectedSha&&sha256!==expectedSha.toLowerCase())throw new Error("The audio file did not match this verified recording. Try again.");onProgress(bytes);return {blob,sha256};
}
export interface ListenChunk {eventId:string;recordingId:string;sequence:number;msPlayed:number;positionMs:number;completed:boolean;skipped?:boolean;context:string;contextId?:string|null;finished?:boolean;occurredAt?:string}
const listenFlights=new Map<string,Promise<boolean>>();
const listenControllers=new Map<string,AbortController>();
const listenClearRanges=new Map<string,{period:"week"|"month"|"all";cutoffMs:number}[]>();
const listenFlightChunks=new Map<string,ListenChunk>();
function validListenChunk(value:unknown):value is ListenChunk {
 const chunk=value as Partial<ListenChunk>|null;
 return !!chunk&&typeof chunk.eventId==="string"&&!!chunk.eventId&&typeof chunk.recordingId==="string"&&!!chunk.recordingId&&Number.isSafeInteger(chunk.sequence)&&chunk.sequence!>=0&&chunk.sequence!<=100000&&Number.isSafeInteger(chunk.msPlayed)&&chunk.msPlayed!>=0&&chunk.msPlayed!<=120000&&Number.isSafeInteger(chunk.positionMs)&&chunk.positionMs!>=0&&chunk.positionMs!<=21600000&&typeof chunk.completed==="boolean"&&(chunk.skipped===undefined||typeof chunk.skipped==="boolean")&&(chunk.finished===undefined||typeof chunk.finished==="boolean")&&typeof chunk.context==="string"&&!!chunk.context.trim()&&chunk.context.length<=40&&(chunk.contextId==null||typeof chunk.contextId==="string"&&!!chunk.contextId.trim()&&chunk.contextId.length<=120)&&(chunk.occurredAt===undefined||typeof chunk.occurredAt==="string"&&Number.isFinite(Date.parse(chunk.occurredAt)));
}
/** Clear only listening evidence; saved audio and collection choices stay on this device. */
export async function clearListeningOutbox(accountId:string,period:"week"|"month"|"all"="all",cutoffMs=Date.now()) {
 listenClearRanges.set(accountId,[...(listenClearRanges.get(accountId)||[]),{period,cutoffMs}]);
 const prefix="sakura-v2-outbox:"+accountId+":";
 const matches=(name:string)=>name.startsWith(prefix)&&listeningTimeFallsInPeriod(listenFlightChunks.get(name)?.occurredAt,period,cutoffMs);
 for(const [name,controller]of listenControllers)if(matches(name))controller.abort();
 await Promise.allSettled([...listenFlights].filter(([name])=>matches(name)).map(([,flight])=>flight));
 const tx=(await db()).transaction("entries","readwrite");let cursor=await tx.store.openCursor(IDBKeyRange.bound(key(accountId,"listen:"),key(accountId,"listen:")+"\uffff"));while(cursor){const chunk=cursor.value as ListenChunk;if(listeningTimeFallsInPeriod(chunk?.occurredAt,period,cutoffMs))await cursor.delete();cursor=await cursor.continue();}await tx.done;
 try{const names:string[]=[];for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(prefix))names.push(name);}for(const name of names){let chunk:ListenChunk|undefined;try{chunk=JSON.parse(localStorage.getItem(name)||"null");}catch{}if(listeningTimeFallsInPeriod(chunk?.occurredAt,period,cutoffMs))localStorage.removeItem(name);}}catch{}
}
export async function deliverListen(accountId:string,chunk:ListenChunk,timeoutMs=10000):Promise<boolean>{
 const name="listen:"+chunk.eventId+":"+chunk.sequence,mirror="sakura-v2-outbox:"+accountId+":"+chunk.eventId+":"+chunk.sequence;
 const pending=listenFlights.get(mirror);if(pending)return pending;
 let mirrored=false;try{localStorage.setItem(mirror,JSON.stringify(chunk));mirrored=true;}catch{}
 const flight=(async()=>{await localWrite(accountId,name,chunk).catch(error=>{if(!mirrored)throw error;});if((listenClearRanges.get(accountId)||[]).some(range=>listeningTimeFallsInPeriod(chunk.occurredAt,range.period,range.cutoffMs))){await localDelete(accountId,name).catch(()=>{});try{localStorage.removeItem(mirror);}catch{}return false;}const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);listenControllers.set(mirror,controller);try{const response=await fetch("/api/v2/history",{method:"POST",headers:{"Content-Type":"application/json","X-Sakura-Account":accountId},body:JSON.stringify(chunk),keepalive:true,signal:controller.signal});if(response.ok||[400,404,409,410].includes(response.status)){await localDelete(accountId,name).catch(()=>{});try{localStorage.removeItem(mirror);}catch{}return true;}return false;}catch{/* The exact sequence remains queued for a later connection. */return false;}finally{clearTimeout(timer);if(listenControllers.get(mirror)===controller)listenControllers.delete(mirror);}})();
 listenFlights.set(mirror,flight);listenFlightChunks.set(mirror,chunk);try{return await flight;}finally{if(listenFlights.get(mirror)===flight){listenFlights.delete(mirror);listenFlightChunks.delete(mirror);}}
}
export async function drainListen(accountId:string,options:{timeoutMs?:number;maxDurationMs?:number;maxChunks?:number}={}){
 const deadline=performance.now()+(options.maxDurationMs??10000);
 const pending=new Map<string,ListenChunk>(),invalidDisk:string[]=[],invalidMirror:string[]=[];
 try{let cursor=await (await db()).transaction("entries").store.openCursor();while(cursor){const name=String(cursor.key);if(name.startsWith(key(accountId,"listen:"))){const chunk=cursor.value;if(validListenChunk(chunk))pending.set(chunk.eventId+":"+chunk.sequence,chunk);else invalidDisk.push(name.slice(key(accountId,"").length));}cursor=await cursor.continue();}}catch{}
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith("sakura-v2-outbox:"+accountId+":")){try{const chunk:unknown=JSON.parse(localStorage.getItem(name)||"null");if(validListenChunk(chunk))pending.set(chunk.eventId+":"+chunk.sequence,chunk);else invalidMirror.push(name);}catch{invalidMirror.push(name);}}}for(const name of invalidMirror)localStorage.removeItem(name);}catch{}
 await Promise.allSettled(invalidDisk.map(name=>localDelete(accountId,name)));
 for(const chunk of [...pending.values()].sort((a,b)=>a.eventId.localeCompare(b.eventId)||a.sequence-b.sequence).slice(0,options.maxChunks??100)){const remaining=deadline-performance.now();if(remaining<=0||!await deliverListen(accountId,chunk,Math.min(options.timeoutMs??10000,remaining)))break;}
}
