"use client";

import type {DownloadSource} from "./downloadTypes";

interface AudioBridge {
 accountId:string;
 recordingId:string;
 assetId:string;
 sizeBytes:number;
 sha256:string;
 fallbackUrl:string;
 mimeType?:string;
 nativeOpening?:boolean;
}
interface BridgeLease {url:string;expiresAt:number;ensureChunk?:(offset:number,signal:AbortSignal,opening?:boolean)=>Promise<unknown>}
const leases=new Map<string,BridgeLease>();
const requests=new Map<string,{controller:AbortController;token:string}>();
let listening=false;
let bridgeEpoch=0;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function chunkFailureStatus(error:unknown):"unavailable"|"invalid"{
 const value=error&&typeof error==="object"?error as {name?:unknown;issue?:{kind?:unknown}}:undefined;
 // A fingerprint/range mismatch must never be hidden by another byte source.
 // Network, timeout, storage and cancellation failures may safely fall back to
 // the capability's exact same-origin asset gateway, which rechecks the range.
 return value?.name==="DownloadIntegrityError"||value?.issue?.kind==="version"||value?.issue?.kind==="validation"?"invalid":"unavailable";
}

function listenForChunks(){
 if(listening)return;
 listening=true;
 navigator.serviceWorker.addEventListener("controllerchange",()=>{bridgeEpoch++;for(const request of requests.values())request.controller.abort();requests.clear();leases.clear();});
 navigator.serviceWorker.addEventListener("message",event=>{
  const data=event.data as {type?:string;token?:string;requestId?:string;offset?:number;opening?:boolean};
  if(data.type==="sakura-audio-cancel"&&data.requestId){requests.get(data.requestId)?.controller.abort();return;}
  if(data.type!=="sakura-audio-chunk"||!data.token||!data.requestId||!event.ports[0])return;
  const port=event.ports[0],lease=leases.get(data.token);
  if(!lease?.ensureChunk||typeof data.offset!=="number"||!Number.isSafeInteger(data.offset)||data.offset<0){port.postMessage({status:"unavailable"});port.close();return;}
  const controller=new AbortController();requests.set(data.requestId,{controller,token:data.token});
  void lease.ensureChunk(data.offset!,controller.signal,data.opening===true).then(chunk=>port.postMessage({status:chunk===undefined?"unavailable":"ready"}),error=>port.postMessage({status:chunkFailureStatus(error)})).finally(()=>{requests.delete(data.requestId!);port.close();});
 });
}

function revokeToken(token:string){
 if(typeof navigator!=="undefined"&&"serviceWorker" in navigator)navigator.serviceWorker.controller?.postMessage({type:"sakura-audio-revoke-token",token});
}

function releaseLease(token:string){
 if(!leases.delete(token))return false;
 for(const [requestId,request]of requests)if(request.token===token){request.controller.abort();requests.delete(requestId);}
 revokeToken(token);return true;
}

/** A private, client-bound media URL joins saved chunks to their exact source. */
export async function partialPlaybackUrl(accountId:string,source:DownloadSource,ensureChunk?:(offset:number,signal:AbortSignal,opening?:boolean)=>Promise<unknown>):Promise<string|undefined>{
 if(typeof navigator==="undefined"||!("serviceWorker" in navigator)||!navigator.serviceWorker.controller||!uuid.test(accountId)||!uuid.test(source.track.id)||!uuid.test(source.assetId)||!Number.isSafeInteger(source.sizeBytes)||source.sizeBytes<=0||source.sizeBytes>120*1024*1024||!source.sha256||!/^[a-f0-9]{64}$/i.test(source.sha256)||!source.fallbackUrl)return;
 let fallback:URL;
 try{fallback=new URL(source.fallbackUrl,location.origin);if(fallback.origin!==location.origin||fallback.pathname!=="/api/v2/recordings/"+source.track.id+"/audio"||fallback.searchParams.get("assetId")!==source.assetId||fallback.username||fallback.password||fallback.hash)return;}catch{return;}
 for(const [token,lease]of leases)if(lease.expiresAt<Date.now())releaseLease(token);
 // Each media element owns a capability. Sharing one URL would let a canceled
 // same-song voice replace the surviving consumer's range callback.
 if(leases.size>=64)return;
 listenForChunks();
 const epoch=bridgeEpoch;
 const token=crypto.randomUUID(),url="/_sakura/audio/"+token;
 const bridge:AudioBridge={accountId,recordingId:source.track.id,assetId:source.assetId,sizeBytes:source.sizeBytes,sha256:source.sha256.toLowerCase(),fallbackUrl:fallback.pathname+fallback.search,mimeType:source.mimeType||source.track.readyPlayback?.mimeType,nativeOpening:true};
 const supported=await new Promise<boolean>(resolve=>{
  const channel=new MessageChannel();
  const timer=setTimeout(()=>{channel.port1.close();resolve(false);},1500);
  channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.status==="ready"&&event.data?.version===1);};
  navigator.serviceWorker.controller!.postMessage({type:"sakura-audio-register",token,bridge},[channel.port2]);
 });
 if(!supported||epoch!==bridgeEpoch){revokeToken(token);return;}
 if(leases.size>=64){revokeToken(token);return;}
 leases.set(token,{url,expiresAt:Date.now()+5*60*60*1000,ensureChunk});
 return url;
}

/** Account changes revoke every old capability and outstanding range read. */
export function revokePartialPlayback(){
 bridgeEpoch++;
 for(const request of requests.values())request.controller.abort();
 requests.clear();leases.clear();
 if(typeof navigator!=="undefined"&&"serviceWorker" in navigator)navigator.serviceWorker.controller?.postMessage({type:"sakura-audio-revoke"});
}

/** Release one media capability without interrupting another Bloom crossfade. */
export function revokePartialPlaybackUrl(url:string){
 const match=/^\/_sakura\/audio\/([a-f0-9-]{36})$/i.exec(url);if(!match)return;
 releaseLease(match[1]);
}
