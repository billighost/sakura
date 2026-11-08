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
}
interface BridgeLease {key:string;url:string;expiresAt:number;ensureChunk?:(offset:number,signal:AbortSignal)=>Promise<unknown>}
const leases=new Map<string,BridgeLease>();
const requests=new Map<string,AbortController>();
let listening=false;
let bridgeEpoch=0;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function listenForChunks(){
 if(listening)return;
 listening=true;
 navigator.serviceWorker.addEventListener("controllerchange",()=>{bridgeEpoch++;for(const controller of requests.values())controller.abort();requests.clear();leases.clear();});
 navigator.serviceWorker.addEventListener("message",event=>{
  const data=event.data as {type?:string;token?:string;requestId?:string;offset?:number};
  if(data.type==="sakura-audio-cancel"&&data.requestId){requests.get(data.requestId)?.abort();return;}
  if(data.type!=="sakura-audio-chunk"||!data.token||!data.requestId||!event.ports[0])return;
  const port=event.ports[0],lease=leases.get(data.token);
  if(!lease?.ensureChunk||typeof data.offset!=="number"||!Number.isSafeInteger(data.offset)||data.offset<0){port.postMessage({status:"unavailable"});port.close();return;}
  const controller=new AbortController();requests.set(data.requestId,controller);
  void lease.ensureChunk(data.offset!,controller.signal).then(chunk=>port.postMessage({status:chunk===undefined?"unavailable":"ready"}),()=>port.postMessage({status:"failed"})).finally(()=>{requests.delete(data.requestId!);port.close();});
 });
}

/** A private, client-bound media URL joins saved chunks to their exact source. */
export async function partialPlaybackUrl(accountId:string,source:DownloadSource,ensureChunk?:(offset:number,signal:AbortSignal)=>Promise<unknown>):Promise<string|undefined>{
 if(typeof navigator==="undefined"||!("serviceWorker" in navigator)||!navigator.serviceWorker.controller||!uuid.test(accountId)||!uuid.test(source.track.id)||!uuid.test(source.assetId)||!Number.isSafeInteger(source.sizeBytes)||source.sizeBytes<=0||source.sizeBytes>120*1024*1024||!source.sha256||!/^[a-f0-9]{64}$/i.test(source.sha256)||!source.fallbackUrl)return;
 let fallback:URL;
 try{fallback=new URL(source.fallbackUrl,location.origin);if(fallback.origin!==location.origin||fallback.pathname!=="/api/v2/recordings/"+source.track.id+"/audio"||fallback.searchParams.get("assetId")!==source.assetId||fallback.username||fallback.password||fallback.hash)return;}catch{return;}
 const key=JSON.stringify([accountId,source.track.id,source.assetId,source.sizeBytes,source.sha256]);
 for(const [token,lease]of leases){if(lease.expiresAt<Date.now()){leases.delete(token);continue;}if(lease.key===key){lease.ensureChunk=ensureChunk;return lease.url;}}
 listenForChunks();
 const epoch=bridgeEpoch;
 const token=crypto.randomUUID(),url="/_sakura/audio/"+token;
 const bridge:AudioBridge={accountId,recordingId:source.track.id,assetId:source.assetId,sizeBytes:source.sizeBytes,sha256:source.sha256.toLowerCase(),fallbackUrl:fallback.pathname+fallback.search,mimeType:source.track.readyPlayback?.mimeType};
 const supported=await new Promise<boolean>(resolve=>{
  const channel=new MessageChannel();
  const timer=setTimeout(()=>{channel.port1.close();resolve(false);},1500);
  channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.status==="ready"&&event.data?.version===1);};
  navigator.serviceWorker.controller!.postMessage({type:"sakura-audio-register",token,bridge},[channel.port2]);
 });
 if(!supported||epoch!==bridgeEpoch)return;
 while(leases.size>=64)leases.delete(leases.keys().next().value!);
 leases.set(token,{key,url,expiresAt:Date.now()+5*60*60*1000,ensureChunk});
 return url;
}

/** Account changes revoke every old capability and outstanding range read. */
export function revokePartialPlayback(){
 bridgeEpoch++;
 for(const controller of requests.values())controller.abort();
 requests.clear();leases.clear();
 if(typeof navigator!=="undefined"&&"serviceWorker" in navigator)navigator.serviceWorker.controller?.postMessage({type:"sakura-audio-revoke"});
}
