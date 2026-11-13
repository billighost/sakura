import {checkExportCanceled} from "../player/exportWork";

const RESOURCE_TIMEOUT_MS=15000;
type WaitOptions={signal?:AbortSignal;timeoutMs?:number;message?:string;stop?:()=>void};

/** Stop sibling resource waits on every exit, including an individual resource failure. */
export function bloomExportOwner(parent?:AbortSignal){
 const controller=new AbortController(),abort=()=>controller.abort(parent?.reason);
 parent?.addEventListener("abort",abort,{once:true});if(parent?.aborted)abort();
 return {signal:controller.signal,release:()=>{parent?.removeEventListener("abort",abort);controller.abort(new DOMException("Bloom export closed","AbortError"));}};
}

/** A cancelled export releases its owners even if a browser resource never settles. */
export async function waitForBloomExport<T>(start:()=>PromiseLike<T>,{signal,timeoutMs=RESOURCE_TIMEOUT_MS,message="The Bloom image is taking too long to prepare. Please try again.",stop}:WaitOptions={}):Promise<T>{
 checkExportCanceled(signal);
 return new Promise<T>((resolve,reject)=>{
  let settled=false;
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);};
  const finish=(value:T|unknown,failed=false,stopped=false)=>{if(settled)return;settled=true;clean();if(stopped)try{stop?.();}catch{}if(failed)reject(value);else resolve(value as T);};
  const abort=()=>finish(new DOMException("Canceled","AbortError"),true,true);
  const timer=setTimeout(()=>finish(new Error(message),true,true),timeoutMs);
  signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted){abort();return;}
  try{Promise.resolve(start()).then(value=>finish(value),error=>finish(error,true));}catch(error){finish(error,true);}
 });
}

export async function bloomExportFrame(signal?:AbortSignal){
 let frame=0;
 await waitForBloomExport(()=>new Promise<void>(resolve=>{frame=requestAnimationFrame(()=>resolve());}),{signal,stop:()=>cancelAnimationFrame(frame)});
}

export async function bloomExportImageReady(image:HTMLImageElement,signal?:AbortSignal,timeoutMs=8000){
 await waitForBloomExport(()=>image.decode().catch(error=>{if(image.complete&&image.naturalWidth>0)return;throw error;}),{signal,timeoutMs,message:"The Bloom artwork could not finish decoding. Please try again.",stop:()=>image.removeAttribute("src")});
}

export async function bloomExportDataUrl(blob:Blob,signal?:AbortSignal,timeoutMs=8000){
 const reader=new FileReader();
 try{
  return await waitForBloomExport(()=>new Promise<string>((resolve,reject)=>{
   reader.onload=()=>resolve(String(reader.result));
   reader.onerror=()=>reject(reader.error??new Error("The song artwork could not be read."));
   reader.onabort=()=>reject(new DOMException("Canceled","AbortError"));
   reader.readAsDataURL(blob);
  }),{signal,timeoutMs,stop:()=>reader.abort()});
 }finally{reader.onload=null;reader.onerror=null;reader.onabort=null;}
}

export async function bloomExportPng(canvas:HTMLCanvasElement,signal?:AbortSignal){
 return waitForBloomExport(()=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("The Bloom image could not be saved.")),"image/png")),{signal,message:"The Bloom image could not finish encoding. Please try again."});
}
