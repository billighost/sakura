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
export async function rememberAccount(account:Account){await (await db()).put("entries",account,"last-account");}
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
export async function deliverListen(accountId:string,chunk:ListenChunk){const name="listen:"+chunk.eventId+":"+chunk.sequence;await localWrite(accountId,name,chunk);try{const response=await fetch("/api/v2/history",{method:"POST",headers:{"Content-Type":"application/json","X-Sakura-Account":accountId},body:JSON.stringify(chunk),keepalive:true});if(response.ok)await localDelete(accountId,name);}catch{/* The exact sequence remains queued for a later connection. */}}
export async function drainListen(accountId:string){let cursor=await (await db()).transaction("entries").store.openCursor();const pending:ListenChunk[]=[];while(cursor){if(String(cursor.key).startsWith(key(accountId,"listen:")))pending.push(cursor.value as ListenChunk);cursor=await cursor.continue();}for(const chunk of pending)await deliverListen(accountId,chunk);}
