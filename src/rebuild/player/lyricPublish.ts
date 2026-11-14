"use client";
import { UserFacingError, responseIssue } from "../app/errors";
import type { PlayerLyrics } from "./useLyrics";

export interface LyricPublishProgress {stage:"challenge"|"preparing"|"publishing";message:string;attempts?:number;elapsedMs?:number}
export interface LyricPublishReply {published:boolean;lyricsAvailable?:boolean;lyrics?:PlayerLyrics}
export interface LyricPublishPreparation {ready:Promise<void>;readonly expiresAt:number;cancel:()=>void}
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
interface PreparationState {recordingId:string;accountId:string;controller:AbortController;expiresAt:number;token?:string;consumed:boolean;progress:LyricPublishProgress;listeners:Set<(progress:LyricPublishProgress)=>void>}
const preparations=new WeakMap<LyricPublishPreparation,PreparationState>();
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
    worker.onmessageerror=()=>fail("The publishing helper returned an unreadable response. Your draft is kept; try again.");
    worker.onmessage=event=>{
      const data=event.data;
      if(data?.type==="complete"){
        if(typeof data.token!=="string"||!data.token.startsWith(challenge.prefix+":")||!/^\d{1,16}$/.test(data.token.slice(challenge.prefix.length+1))){fail(descriptions["lyrics-publish-invalid-challenge"]);return;}
        cleanup();resolve(data.token);
      }else if(data?.type==="error")fail(data.reason==="expired"?descriptions["lyrics-publish-token"]:descriptions["lyrics-publish-invalid-challenge"]);
      else if(data?.type==="progress")onProgress?.({stage:"preparing",message:"Preparing your lyrics. You can keep listening while this finishes.",attempts:data.attempts,elapsedMs:data.elapsedMs});
    };
    try{worker.postMessage({...challenge,maximumMs});}catch{fail("The publishing helper could not start. Your draft is kept; try again.");}
    if(signal.aborted)abort();
  });
}
function checkPublishConnection(){
  if(typeof navigator!=="undefined"&&navigator.onLine===false)throw publishIssue("Your lyrics draft is saved on this device. Reconnect to publish it to LRCLIB.");
  if(Date.now()<retryAt)throw publishIssue(`LRCLIB asked Sakura to wait. Your draft is kept; try again in ${Math.ceil((retryAt-Date.now())/1000)} seconds.`,"busy");
}
/** The challenge is independent of the manuscript. Prepare one token while
 * the contributor writes, without uploading any lyrics or publishing. */
export function createLyricPublishPreparation(recordingId:string,options:{accountId:string;onProgress?:(progress:LyricPublishProgress)=>void}):LyricPublishPreparation{
  const state:PreparationState={recordingId,accountId:options.accountId,controller:new AbortController(),expiresAt:0,consumed:false,progress:{stage:"challenge",message:"Preparing publication while you add the words…"},listeners:new Set(options.onProgress?[options.onProgress]:[])};
  const report=(progress:LyricPublishProgress)=>{state.progress=progress;for(const listener of state.listeners)listener(progress);};
  const ready=(async()=>{
    checkPublishConnection();report(state.progress);
    const challenge=await post<Challenge>("/api/v2/lyrics/challenge",{recordingId},state.accountId,state.controller.signal,20000);
    state.expiresAt=challenge.expiresAt;
    state.token=await solveLyricPublishChallenge(challenge,state.controller.signal,report);
    report({stage:"preparing",message:"Publication is ready for your words."});
  })();
  // Opening a studio must never produce an unhandled rejection. The original
  // promise remains rejectable so a publish click can retry a failed prefetch.
  void ready.catch(()=>{});
  const preparation:LyricPublishPreparation={ready,get expiresAt(){return state.expiresAt;},cancel:()=>{state.controller.abort();state.listeners.clear();}};
  preparations.set(preparation,state);
  return preparation;
}
async function preparedToken(preparation:LyricPublishPreparation,signal:AbortSignal,onProgress?:((progress:LyricPublishProgress)=>void)){
  const state=preparations.get(preparation)!;
  const abort=()=>preparation.cancel();signal.addEventListener("abort",abort,{once:true});
  if(onProgress){state.listeners.add(onProgress);onProgress(state.progress);}
  try{signal.throwIfAborted();await preparation.ready;signal.throwIfAborted();return state.token;}
  finally{signal.removeEventListener("abort",abort);if(onProgress)state.listeners.delete(onProgress);}
}
/** Proof-of-work lives in a cancellable browser worker; each server request
 * remains short. A published 201/202 is final, even while LRCLIB indexes it. */
export async function publishLyricSubmission(recordingId:string,text:string,format:"plain"|"lrc",options:{accountId:string;signal:AbortSignal;onProgress?:(progress:LyricPublishProgress)=>void;preparation?:LyricPublishPreparation}):Promise<LyricPublishReply>{
  const {accountId,signal,onProgress}=options;signal.throwIfAborted();
  checkPublishConnection();
  let publishToken:string|undefined;
  const prepared=options.preparation,state=prepared&&preparations.get(prepared);
  if(prepared&&state&&state.recordingId===recordingId&&state.accountId===accountId&&state.expiresAt&&state.expiresAt<=Date.now()+5000)prepared.cancel();
  if(prepared&&state&&!state.consumed&&!state.controller.signal.aborted&&state.recordingId===recordingId&&state.accountId===accountId&&(!state.expiresAt||state.expiresAt>Date.now()+5000)){
    state.consumed=true;
    try{publishToken=await preparedToken(prepared,signal,onProgress);if(state.expiresAt<=Date.now()+1000)publishToken=undefined;}
    catch{signal.throwIfAborted();checkPublishConnection();}
  }
  if(!publishToken){
    // An expired, failed, canceled or foreign preparation is recoverable. A
    // fresh foreground challenge still validates the actual submission.
    onProgress?.({stage:"challenge",message:"Checking this recording and your lyrics…"});
    const challenge=await post<Challenge>("/api/v2/lyrics/challenge",{recordingId,text,format},accountId,signal,20000);
    publishToken=await solveLyricPublishChallenge(challenge,signal,onProgress);
  }
  signal.throwIfAborted();onProgress?.({stage:"publishing",message:"Publishing your lyrics to LRCLIB…"});
  const result=await post<LyricPublishReply>("/api/v2/lyrics/publish",{recordingId,text,format,publishToken},accountId,signal,55000);
  if(result.published!==true)throw publishIssue("LRCLIB has not confirmed this upload. Your draft is kept; check the song before trying again.");
  return result;
}
