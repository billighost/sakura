import {fetchAudioHeaders} from "../core/streaming";
import {responseIssue,UserFacingError} from "./errors";

const MAX_BYTES=120*1024*1024;
export class DownloadIntegrityError extends Error {
 name="DownloadIntegrityError";
 constructor(message:string,readonly retryAlternate=false){super(message);}
}
const blobHashes=new WeakMap<Blob,Promise<string>>();
/** Blob contents are immutable; a newly deserialized/replaced Blob is hashed anew. */
export function audioSha256(blob:Blob):Promise<string>{let flight=blobHashes.get(blob);if(!flight){flight=(async()=>{const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");})();blobHashes.set(blob,flight);void flight.catch(()=>{if(blobHashes.get(blob)===flight)blobHashes.delete(blob);});}return flight;}

/** Only a small, promptly delivered JSON error may supply an application reason. */
async function audioResponseError(response:Response,signal:AbortSignal,timeoutMs:number):Promise<UserFacingError>{
 let payload:unknown;
 const length=response.headers.get("Content-Length");
 if(response.body&&/^application\/json(?:;|$)/i.test(response.headers.get("Content-Type")||"")&&!(length!==null&&Number(length)>4096)){
  const reader=response.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
  try{payload=await Promise.race([
   (async()=>{const decoder=new TextDecoder();let text="",bytes=0;while(true){const chunk=await reader.read();signal.throwIfAborted();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>4096)return; text+=decoder.decode(chunk.value,{stream:true});}return JSON.parse(text+decoder.decode());})(),
   new Promise<undefined>((resolve,reject)=>{abort=()=>reject(signal.reason??new DOMException("Canceled","AbortError"));signal.addEventListener("abort",abort,{once:true});if(signal.aborted){abort();return;}timer=setTimeout(()=>resolve(undefined),Math.min(timeoutMs,1000));}),
  ]);}catch{signal.throwIfAborted();}
  finally{if(timer)clearTimeout(timer);signal.removeEventListener("abort",abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
 }else void response.body?.cancel().catch(()=>{});
 signal.throwIfAborted();return new UserFacingError(responseIssue(response.status,payload,"download"));
}

/** A 200 response is a whole file, never a chunk at the requested offset. */
export async function readAudioRange(response:Response,start:number,end:number,total:number,signal:AbortSignal,onProgress:(bytes:number)=>void=()=>{},idleTimeoutMs=15000,allowWhole=true,onMode:(whole:boolean)=>void=()=>{}):Promise<{blob:Blob;whole:boolean}> {
 if(signal.aborted){void response.body?.cancel().catch(()=>{});signal.throwIfAborted();}
 const rejectResponse=(message:string,retryAlternate=true):never=>{void response.body?.cancel().catch(()=>{});throw new DownloadIntegrityError(message,retryAlternate);};
 if(!Number.isSafeInteger(total)||total<=0||total>MAX_BYTES||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=total)return rejectResponse("This audio file cannot be saved on this device.",false);
 if(!response.ok)throw await audioResponseError(response,signal,idleTimeoutMs);
 if(!response.body)throw new Error("The audio download did not start.");
 const mime=response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()||"";
 if(!mime.startsWith("audio/"))return rejectResponse("The source did not return an audio file.");
 let expected=end-start+1,whole=false,wrongWholeOffset=false;
 if(response.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")||"");if(!range||Number(range[1])!==start||Number(range[2])!==end||Number(range[3])!==total)return rejectResponse("The source returned a different part of this recording.");}
 else if(response.status===200){wrongWholeOffset=start!==0;expected=total;whole=true;}
 else return rejectResponse("This source cannot resume the requested part of this song.");
 const length=response.headers.get("Content-Length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==expected))return rejectResponse("The audio file size changed. Please try again.");
 onMode(whole);
 if(wrongWholeOffset)return rejectResponse("This source cannot resume the requested part of this song.");
 if(whole&&!allowWhole&&end-start+1<total)return rejectResponse("This source cannot prepare a short audio range. Try saving the full song.");
 const reader=response.body.getReader(),parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
 try{while(true){signal.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};
   let chunk:ReadableStreamReadResult<Uint8Array>;
   try{chunk=await Promise.race([reader.read(),new Promise<never>((_resolve,reject)=>{abort=()=>{reject(signal.reason??new DOMException("Canceled","AbortError"));void reader.cancel().catch(()=>{});};signal.addEventListener("abort",abort,{once:true});if(signal.aborted){abort();return;}timer=setTimeout(()=>{reject(new Error("The connection paused. Your saved progress is safe; reconnect to continue."));void reader.cancel().catch(()=>{});},idleTimeoutMs);})]);}
   finally{if(timer)clearTimeout(timer);signal.removeEventListener("abort",abort);}
   signal.throwIfAborted();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>expected)throw new DownloadIntegrityError("The source sent more bytes than this recording contains.",true);parts.push(new Uint8Array(chunk.value));onProgress(bytes);
  }
  if(bytes!==expected)throw new Error("The connection ended before this part of the song arrived.");
  return {blob:new Blob(parts,{type:mime}),whole};
 }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

export async function fetchAudioRange(url:string,start:number,end:number,total:number,signal:AbortSignal,fetcher:typeof fetch=fetch,onProgress?:(bytes:number)=>void,timeoutMs=15000,allowWhole=true,onMode?:(whole:boolean)=>void){
 const response=await fetchAudioHeaders(url,{signal,headers:{Range:`bytes=${start}-${end}`},headerTimeoutMs:8000},fetcher);
 return readAudioRange(response,start,end,total,signal,onProgress,timeoutMs,allowWhole,onMode);
}
