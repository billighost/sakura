"use client";
import { openDB } from "idb";
import type { MusicTrack, Account } from "./types";
let database:ReturnType<typeof openDB>|null=null;
const db=()=>database||(database=openDB("sakura-ink-v1",1,{upgrade(db){db.createObjectStore("entries");}}));
const key=(accountId:string,name:string)=>"account:"+accountId+":"+name;
export async function localRead<T>(accountId:string,name:string):Promise<T|undefined>{return (await db()).get("entries",key(accountId,name));}
export async function localWrite(accountId:string,name:string,value:unknown){await (await db()).put("entries",value,key(accountId,name));}
export async function localDelete(accountId:string,name:string){await (await db()).delete("entries",key(accountId,name));}
export interface OfflineAudio {track:MusicTrack;blob:Blob;sha256:string;sizeBytes:number;savedAt:number}
export async function savedAudio(accountId:string):Promise<OfflineAudio[]>{const result:OfflineAudio[]=[];let cursor=await (await db()).transaction("entries").store.openCursor();while(cursor){if(String(cursor.key).startsWith(key(accountId,"audio:")))result.push(cursor.value as OfflineAudio);cursor=await cursor.continue();}return result;}
export async function removeAccountCache(accountId:string){const tx=(await db()).transaction("entries","readwrite");let cursor=await tx.store.openCursor();while(cursor){if(String(cursor.key).startsWith(key(accountId,"")))await cursor.delete();cursor=await cursor.continue();}await tx.done;await (await db()).delete("entries","last-account");}
export async function forgetActiveAccount(){try{localStorage.removeItem("sakura-v2-active-account");localStorage.removeItem("sakura-v2-theme");}catch{}await (await db()).delete("entries","last-account");}
export async function rememberAccount(account:Account){try{localStorage.setItem("sakura-v2-active-account",account.id);}catch{}await (await db()).put("entries",account,"last-account");}
export async function lastAccount():Promise<Account|undefined>{return (await db()).get("entries","last-account");}
export async function verifiedAudio(response:Response,expectedBytes:number,signal:AbortSignal,onProgress:(bytes:number)=>void,expectedSha?:string,idleTimeoutMs=20000):Promise<{blob:Blob;sha256:string}>{
 if(!response.ok||!response.body)throw new Error("The audio download did not start.");
 const mime=response.headers.get("Content-Type")?.split(";")[0]||"";if(!mime.startsWith("audio/"))throw new Error("The source didn’t return an audio file.");
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||expectedBytes>120*1024*1024)throw new Error("This audio file cannot be saved on this device.");
 const reader=response.body.getReader();const parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;let lastPaint=0;
 async function read(){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new Error("The connection paused before the song finished. Try downloading again."));},idleTimeoutMs);})]);}finally{if(timer)clearTimeout(timer);}}
 try{while(true){if(signal.aborted)throw new DOMException("Canceled","AbortError");const chunk=await read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>expectedBytes)throw new Error("The audio file size changed. Please try again.");parts.push(new Uint8Array(chunk.value));if(performance.now()-lastPaint>150){onProgress(bytes);lastPaint=performance.now();}}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(bytes!==expectedBytes)throw new Error("The connection ended before the complete song arrived.");
 const blob=new Blob(parts,{type:mime});const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");if(signal.aborted)throw new DOMException("Canceled","AbortError");if(expectedSha&&sha256!==expectedSha.toLowerCase())throw new Error("The audio file did not match this verified recording. Try again.");onProgress(bytes);return {blob,sha256};
}
export interface ListenChunk {eventId:string;recordingId:string;sequence:number;msPlayed:number;positionMs:number;completed:boolean;context:string;finished?:boolean;occurredAt?:string}
const listenFlights=new Map<string,Promise<void>>();
export async function deliverListen(accountId:string,chunk:ListenChunk){
 const name="listen:"+chunk.eventId+":"+chunk.sequence,mirror="sakura-v2-outbox:"+accountId+":"+chunk.eventId+":"+chunk.sequence;
 const pending=listenFlights.get(mirror);if(pending)return pending;
 let mirrored=false;try{localStorage.setItem(mirror,JSON.stringify(chunk));mirrored=true;}catch{}
 const flight=(async()=>{await localWrite(accountId,name,chunk).catch(error=>{if(!mirrored)throw error;});try{const response=await fetch("/api/v2/history",{method:"POST",headers:{"Content-Type":"application/json","X-Sakura-Account":accountId},body:JSON.stringify(chunk),keepalive:true});if(response.ok){await localDelete(accountId,name).catch(()=>{});try{localStorage.removeItem(mirror);}catch{}}}catch{/* The exact sequence remains queued for a later connection. */}})();
 listenFlights.set(mirror,flight);try{await flight;}finally{if(listenFlights.get(mirror)===flight)listenFlights.delete(mirror);}
}
export async function drainListen(accountId:string){
 const pending=new Map<string,ListenChunk>();
 try{let cursor=await (await db()).transaction("entries").store.openCursor();while(cursor){if(String(cursor.key).startsWith(key(accountId,"listen:"))){const chunk=cursor.value as ListenChunk;pending.set(chunk.eventId+":"+chunk.sequence,chunk);}cursor=await cursor.continue();}}catch{}
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith("sakura-v2-outbox:"+accountId+":")){const chunk=JSON.parse(localStorage.getItem(name)||"null") as ListenChunk;if(chunk)pending.set(chunk.eventId+":"+chunk.sequence,chunk);}}}catch{}
 for(const chunk of [...pending.values()].sort((a,b)=>a.eventId.localeCompare(b.eventId)||a.sequence-b.sequence))await deliverListen(accountId,chunk);
}
