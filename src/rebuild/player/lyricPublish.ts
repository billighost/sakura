"use client";
import { UserFacingError, responseIssue } from "../app/errors";
import type { PlayerLyrics } from "./useLyrics";

export interface LyricPublishProgress {stage:"challenge"|"preparing"|"publishing";message:string;attempts?:number;elapsedMs?:number}
export interface LyricPublishReply {published:boolean;lyricsAvailable?:boolean;lyrics?:PlayerLyrics}
interface Challenge {prefix:string;target:string;expiresAt:number}
const descriptions:Record<string,string>={
  "lyrics-publish-metadata":"This song needs a verified album and duration before it can be published. Your draft is kept.",
  "lyrics-publish-token":"The publishing session expired. Your draft is kept; try publishing again.",
  "lyrics-publish-rate-limit":"LRCLIB is receiving too many requests. Your draft is kept; try again after a short wait.",
  "lyrics-publish-rejected":"LRCLIB did not accept these lyrics. Check the song details and timestamps, then try again.",
  "lyrics-publish-unavailable":"LRCLIB publishing is temporarily unavailable. Your draft is kept.",
  "lyrics-publish-invalid-challenge":"LRCLIB returned an incomplete publish challenge. Please try again.",
};
let retryAt=0;
function publishIssue(message:string,kind:"connection"|"validation"|"busy"="connection"){return new UserFacingError({kind,title:"Your lyrics draft is kept.",message,action:"Try publishing again"});}
async function post<T>(url:string,body:unknown,accountId:string,signal:AbortSignal,timeoutMs:number):Promise<T>{
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
  try{
    const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Sakura-Account":accountId},body:JSON.stringify(body),signal:deadline});
    let data:Record<string,unknown>;try{data=await response.json();}catch{throw publishIssue("Sakura could not read the publishing response. Your draft is kept.");}
    if(!response.ok){
      if(response.status===401)throw new UserFacingError(responseIssue(401,null,"save"));
      const retryAfterMs=typeof data.retryAfterMs==="number"?data.retryAfterMs:Number(response.headers.get("Retry-After")||0)*1000;
      if(response.status===429)retryAt=Math.max(retryAt,Date.now()+Math.max(retryAfterMs||60000,1000));
      const message=descriptions[String(data.reason)]||(response.status===400||response.status===413?"Check the lyrics and make sure every synced line has a valid timestamp within the song. Your draft is kept.":descriptions["lyrics-publish-unavailable"]);
      throw publishIssue(message,response.status===429?"busy":response.status===400||response.status===413?"validation":"connection");
    }
    if(!data||typeof data!=="object"||Array.isArray(data))throw publishIssue("Sakura could not read the publishing response. Your draft is kept.");
    return data as T;
  }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof UserFacingError)throw error;throw publishIssue("The connection ended while publishing. Your draft is kept; reconnect and check the song's lyrics before trying again.");}
}
export function solveLyricPublishChallenge(challenge:Challenge,signal:AbortSignal,onProgress?:(progress:LyricPublishProgress)=>void):Promise<string>{
  signal.throwIfAborted();
  if(!challenge||typeof challenge.prefix!=="string"||!/^[a-zA-Z0-9_-]{1,256}$/.test(challenge.prefix)||typeof challenge.target!=="string"||!/^[a-fA-F0-9]{64}$/.test(challenge.target)||!Number.isFinite(challenge.expiresAt)||challenge.expiresAt<=Date.now())return Promise.reject(publishIssue(descriptions["lyrics-publish-invalid-challenge"]));
  if(typeof Worker==="undefined")return Promise.reject(publishIssue("This browser could not prepare your lyrics for publishing. Your draft is kept; try an updated browser."));
  return new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker("/lyric-publish-worker.js",{name:"sakura-lyrics-publish"});}catch{reject(publishIssue("The publishing helper could not open. Your draft is kept; reconnect and try again."));return;}
    const maximumMs=Math.min(240000,challenge.expiresAt-Date.now());
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);worker.terminate();};
    const fail=(message:string)=>{cleanup();reject(publishIssue(message));};
    const abort=()=>{cleanup();reject(signal.reason);};
    const timer=setTimeout(()=>fail(descriptions["lyrics-publish-token"]),maximumMs+1000);
    signal.addEventListener("abort",abort,{once:true});
    worker.onerror=()=>fail("The publishing helper stopped before finishing. Your draft is kept; try again.");
    worker.onmessage=event=>{
      const data=event.data;
      if(data?.type==="complete"&&typeof data.token==="string"&&data.token.startsWith(challenge.prefix+":")){
        cleanup();resolve(data.token);
      }else if(data?.type==="error")fail(data.reason==="expired"?descriptions["lyrics-publish-token"]:descriptions["lyrics-publish-invalid-challenge"]);
      else if(data?.type==="progress")onProgress?.({stage:"preparing",message:"Preparing your lyrics. You can keep listening while this finishes.",attempts:data.attempts,elapsedMs:data.elapsedMs});
    };
    worker.postMessage({...challenge,maximumMs});
    if(signal.aborted)abort();
  });
}
/** Proof-of-work lives in a cancellable browser worker; each server request
 * remains short. A published 201/202 is final, even while LRCLIB indexes it. */
export async function publishLyricSubmission(recordingId:string,text:string,format:"plain"|"lrc",options:{accountId:string;signal:AbortSignal;onProgress?:(progress:LyricPublishProgress)=>void}):Promise<LyricPublishReply>{
  const {accountId,signal,onProgress}=options;signal.throwIfAborted();
  if(typeof navigator!=="undefined"&&navigator.onLine===false)throw publishIssue("Your lyrics draft is saved on this device. Reconnect to publish it to LRCLIB.");
  if(Date.now()<retryAt)throw publishIssue(`LRCLIB asked Sakura to wait. Your draft is kept; try again in ${Math.ceil((retryAt-Date.now())/1000)} seconds.`,"busy");
  onProgress?.({stage:"challenge",message:"Checking this recording and your lyrics…"});
  const challenge=await post<Challenge>("/api/v2/lyrics/challenge",{recordingId,text,format},accountId,signal,20000);
  const publishToken=await solveLyricPublishChallenge(challenge,signal,onProgress);
  signal.throwIfAborted();onProgress?.({stage:"publishing",message:"Publishing your lyrics to LRCLIB…"});
  const result=await post<LyricPublishReply>("/api/v2/lyrics/publish",{recordingId,text,format,publishToken},accountId,signal,55000);
  if(result.published!==true)throw publishIssue("LRCLIB has not confirmed this upload. Your draft is kept; check the song before trying again.");
  return result;
}
