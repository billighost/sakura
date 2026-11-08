import {fetchAudioHeaders} from "../core/streaming";

const MAX_BYTES=120*1024*1024;
export class DownloadIntegrityError extends Error {name="DownloadIntegrityError";}
export async function audioSha256(blob:Blob):Promise<string>{const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");}

/** A 200 response is a whole file, never a chunk at the requested offset. */
export async function readAudioRange(response:Response,start:number,end:number,total:number,signal:AbortSignal,onProgress:(bytes:number)=>void=()=>{},idleTimeoutMs=15000):Promise<{blob:Blob;whole:boolean}> {
 signal.throwIfAborted();
 const rejectResponse=(message:string):never=>{void response.body?.cancel().catch(()=>{});throw new DownloadIntegrityError(message);};
 if(!Number.isSafeInteger(total)||total<=0||total>MAX_BYTES||start<0||end<start||end>=total)return rejectResponse("This audio file cannot be saved on this device.");
 if(!response.ok||!response.body){void response.body?.cancel().catch(()=>{});throw new Error("The audio download did not start.");}
 const mime=response.headers.get("Content-Type")?.split(";")[0].toLowerCase()||"";
 if(!mime.startsWith("audio/"))return rejectResponse("The source did not return an audio file.");
 let expected=end-start+1,whole=false;
 if(response.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")||"");if(!range||Number(range[1])!==start||Number(range[2])!==end||Number(range[3])!==total)return rejectResponse("The source returned a different part of this recording.");}
 else if(response.status===200&&start===0){expected=total;whole=true;}
 else return rejectResponse("This source cannot resume the requested part of this song.");
 const length=response.headers.get("Content-Length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==expected))return rejectResponse("The audio file size changed. Please try again.");
 const reader=response.body.getReader(),parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
 try{while(true){signal.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};
   let chunk:ReadableStreamReadResult<Uint8Array>;
   try{chunk=await Promise.race([reader.read(),new Promise<never>((_resolve,reject)=>{abort=()=>{reject(signal.reason??new DOMException("Canceled","AbortError"));void reader.cancel().catch(()=>{});};signal.addEventListener("abort",abort,{once:true});if(signal.aborted){abort();return;}timer=setTimeout(()=>{reject(new Error("The connection paused. Your saved progress is safe; reconnect to continue."));void reader.cancel().catch(()=>{});},idleTimeoutMs);})]);}
   finally{if(timer)clearTimeout(timer);signal.removeEventListener("abort",abort);}
   signal.throwIfAborted();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>expected)throw new DownloadIntegrityError("The source sent more bytes than this recording contains.");parts.push(new Uint8Array(chunk.value));onProgress(bytes);
  }
  if(bytes!==expected)throw new Error("The connection ended before this part of the song arrived.");
  return {blob:new Blob(parts,{type:mime}),whole};
 }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

export async function fetchAudioRange(url:string,start:number,end:number,total:number,signal:AbortSignal,fetcher:typeof fetch=fetch,onProgress?:(bytes:number)=>void,timeoutMs=15000){
 const response=await fetchAudioHeaders(url,{signal,headers:{Range:`bytes=${start}-${end}`},headerTimeoutMs:8000},fetcher);
 return readAudioRange(response,start,end,total,signal,onProgress,timeoutMs);
}
