"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { localDelete, localRead, localWrite } from "./offline";
import { requestJson, userIssue, UserFacingError } from "./errors";
import {browserOffline,canonicalResourcePath,durableCatalogResource,resourceIsFresh} from "./resourcePolicy";
import { normalizeProductDto } from "./productDto";
export interface ResourceState<T>{data:T|undefined;loading:boolean;error:UserFacingError|null;updatedAt:number}
export interface ResourceLoadOptions {force?:boolean;signal?:AbortSignal;kind?:"visible"|"prefetch"}
const EMPTY:ResourceState<never>={data:undefined,loading:false,error:null,updatedAt:0};
type ResourceFlight={promise:Promise<void>;cancel:AbortController;owners:Map<symbol,ResourceLoadOptions["kind"]>};
type Resource={snapshot:ResourceState<unknown>;listeners:Set<()=>void>;flight:ResourceFlight|null;controller:AbortController|null;subscriberReload:AbortController|null;generation:number;reload:boolean;cacheQueue:Promise<void>;accessedAt:number;cachePending:number};
const entries=new Map<string,Resource>();
const storageKey=(accountId:string,path:string)=>"sakura-v2-resource-invalidated:"+accountId+":"+path;
const revocationKey=(accountId:string,path:string)=>"sakura-v2-resource-revoked:"+accountId+":"+path;
const revocations=new Map<string,number>();
const erasureKey=(accountId:string)=>"sakura-v2-listening-resource-erased:"+accountId;
const listeningResource=(path:string)=>/^\/api\/v2\/(bloom|history|profile|taste|feed|home|mixes|listening|personalization)(\/|\?|$)/.test(path)||path.startsWith("/api/v2/search/suggestions");
function listeningErasedAt(accountId:string,path:string){try{const stamp=listeningResource(path)?Number(localStorage.getItem(erasureKey(accountId))):0;return Number.isFinite(stamp)?stamp:0;}catch{return 0;}}
function invalidatedAt(accountId:string,path:string){try{const value=Number(localStorage.getItem(storageKey(accountId,path))),erased=listeningResource(path)?Number(localStorage.getItem(erasureKey(accountId))):0;return Math.max(Number.isFinite(value)?value:0,Number.isFinite(erased)?erased:0);}catch{return 0;}}
function rememberInvalidation(accountId:string,path:string,updatedAt:number){const stamp=Math.max(Date.now(),updatedAt+1,invalidatedAt(accountId,path));try{localStorage.setItem(storageKey(accountId,path),String(stamp));}catch{}return stamp;}
function revokedAt(accountId:string,path:string){const key=revocationKey(accountId,path),memory=revocations.get(key)||0;try{const saved=Number(localStorage.getItem(key));return Math.max(memory,Number.isFinite(saved)?saved:0);}catch{return memory;}}
function rememberRevocation(accountId:string,path:string,updatedAt:number){const stamp=Math.max(rememberInvalidation(accountId,path,updatedAt),revokedAt(accountId,path));const key=revocationKey(accountId,path);revocations.set(key,stamp);try{localStorage.setItem(key,String(stamp));}catch{}return stamp;}
function resource(key:string):Resource{let item=entries.get(key);if(!item){item={snapshot:EMPTY,listeners:new Set(),flight:null,controller:null,subscriberReload:null,generation:0,reload:false,cacheQueue:Promise.resolve(),accessedAt:Date.now(),cachePending:0};entries.set(key,item);if(entries.size>160){const retired=[...entries].filter(([candidate,value])=>candidate!==key&&!value.listeners.size&&!value.flight&&!value.cachePending).sort((a,b)=>a[1].accessedAt-b[1].accessedAt);for(const [candidate,value]of retired){if(entries.size<=160)break;value.generation++;entries.delete(candidate);}}}item.accessedAt=Date.now();return item;}
function update(item:Resource,patch:Partial<ResourceState<unknown>>){item.snapshot={...item.snapshot,...patch};for(const listener of item.listeners)listener();}
export async function loadResource(accountId:string,path:string,options:boolean|ResourceLoadOptions=false){
 const {force=false,signal,kind}=typeof options==="boolean"?{force:options}:options;
 signal?.throwIfAborted();
 const originalPath=path;
 path=canonicalResourcePath(path);
 const key=accountId+":"+path,item=resource(key);
 const revocation=revokedAt(accountId,path);
 if(revocation>0&&item.snapshot.data!==undefined&&item.snapshot.updatedAt<=revocation)invalidate(item,accountId,path,true);
 if(force&&browserOffline()&&item.snapshot.data!==undefined){update(item,{loading:false,error:null});return;}
 if(force)invalidate(item,accountId,path);
 if(item.flight)return ownFlight(item,item.flight,signal,kind);
 if(!item.reload&&item.snapshot.data!==undefined&&(resourceIsFresh(path,item.snapshot.updatedAt)||browserOffline()))return;
 const flight:ResourceFlight={promise:Promise.resolve(),cancel:new AbortController(),owners:new Map()};
 item.flight=flight;
 flight.promise=Promise.resolve().then(async()=>{
  let allowSaved=!force&&!item.reload;
  try{do{
   flight.cancel.signal.throwIfAborted();
   item.reload=false;const version=item.generation,erasure=listeningErasedAt(accountId,path),controller=new AbortController();item.controller=controller;
   const current=()=>{if(!flight.cancel.signal.aborted&&!controller.signal.aborted&&entries.get(key)===item&&item.generation===version&&listeningErasedAt(accountId,path)!==erasure){invalidate(item,accountId,path,true);}return !flight.cancel.signal.aborted&&!controller.signal.aborted&&item.flight===flight&&entries.get(key)===item&&item.generation===version;};
   update(item,{loading:item.snapshot.data===undefined,error:null});
   try{
    if(allowSaved&&item.snapshot.data===undefined){
     const saved=await localRead<{data:unknown;updatedAt:number}>(accountId,"resource:"+path).catch(()=>undefined)|| (originalPath!==path?await localRead<{data:unknown;updatedAt:number}>(accountId,"resource:"+originalPath).catch(()=>undefined):undefined);
     if(!current())continue;
     if(saved&&Number.isFinite(saved.updatedAt)&&saved.updatedAt>0&&saved.updatedAt>Math.max(listeningErasedAt(accountId,path),revokedAt(accountId,path))){
      const data=normalizeProductDto(saved.data);
      update(item,{data,updatedAt:saved.updatedAt,loading:false});
      if(data!==saved.data)await cacheTask(item,async()=>{if(current())await localWrite(accountId,"resource:"+path,{data,updatedAt:saved.updatedAt});}).catch(()=>{});
      if(current()&&!item.reload&&(saved.updatedAt>Math.max(invalidatedAt(accountId,path),invalidatedAt(accountId,originalPath))&&resourceIsFresh(path,saved.updatedAt)||browserOffline()))break;
     }
    }
    if(browserOffline()){
     if(item.snapshot.data!==undefined){update(item,{loading:false,error:null});break;}
     throw new UserFacingError({kind:"offline",title:"This page has not been saved on this device yet.",message:"Visit this page while connected to keep it available for your offline hours.",action:"Try again"});
    }
    const data=normalizeProductDto(await requestJson(path,{signal:controller.signal},{accountId}));if(!current())continue;
    const updatedAt=Math.max(Date.now(),invalidatedAt(accountId,path)+1,revokedAt(accountId,path)+1);update(item,{data,updatedAt,loading:false,error:null});
    // Subscribers already see the response. Explicit preparation callers still
    // await persistence so an immediate reload can consume the prepared data.
    await cacheTask(item,async()=>{if(current())await localWrite(accountId,"resource:"+path,{data,updatedAt});}).catch(()=>{});
   }catch(error){if(current()){
    const issue=error instanceof UserFacingError?error:new UserFacingError(userIssue(error));
    // Definitive unavailable/session responses must not resurrect old private
    // content on the next navigation from its persisted browser cache.
    const unavailable=issue.issue.kind==="missing"||issue.issue.kind==="session";
    if(unavailable){
     rememberRevocation(accountId,path,item.snapshot.updatedAt);
     update(item,{loading:false,error:issue,data:undefined,updatedAt:0});
     await cacheTask(item,()=>localDelete(accountId,"resource:"+path)).catch(()=>{});
    }else if(current())update(item,{loading:false,error:issue});
   }}finally{allowSaved=false;if(item.controller===controller)item.controller=null;}
  }while(!flight.cancel.signal.aborted&&item.reload&&item.flight===flight&&entries.get(key)===item);
  }finally{if(item.flight===flight){item.flight=null;item.controller=null;}}
 });
 // A transport may settle after its last consumer has left.
 void flight.promise.catch(()=>{});
 return ownFlight(item,flight,signal,kind);
}
/** A visible room can join speculative work without inheriting its cancellation. */
function ownFlight(item:Resource,flight:ResourceFlight,signal:AbortSignal|undefined,kind:ResourceLoadOptions["kind"]){
 const owner=Symbol();flight.owners.set(owner,kind);
 return new Promise<void>((resolve,reject)=>{
  let settled=false;
  const finish=(callback:()=>void)=>{
   if(settled)return;settled=true;signal?.removeEventListener("abort",abort);flight.cancel.signal.removeEventListener("abort",cancelled);flight.owners.delete(owner);callback();
   if(item.flight===flight)stopUnownedFlight(item);
  };
  const abort=()=>finish(()=>reject(signal?.reason??new DOMException("Canceled","AbortError")));
  // Legacy unsignalled callers historically complete silently on account clear.
  const cancelled=()=>finish(()=>signal?reject(flight.cancel.signal.reason):resolve());
  signal?.addEventListener("abort",abort,{once:true});flight.cancel.signal.addEventListener("abort",cancelled,{once:true});
  flight.promise.then(()=>finish(resolve),error=>finish(()=>flight.cancel.signal.aborted&&!signal?resolve():reject(error)));
  if(signal?.aborted)abort();else if(flight.cancel.signal.aborted)cancelled();
 });
}
function stopUnownedFlight(item:Resource){
 const flight=item.flight;
 if(!flight||flight.owners.size||item.listeners.size)return;
 // Detach first: a new owner must not wait for an abandoned transport that
 // fails to acknowledge abort. The generation fences its late response/write.
 item.flight=null;item.generation++;item.reload=false;item.controller?.abort(new DOMException("No active consumers","AbortError"));item.controller=null;
 flight.cancel.abort(new DOMException("No active consumers","AbortError"));update(item,{loading:false});
}
function cacheTask(item:Resource,task:()=>Promise<void>){item.cachePending++;const operation=item.cacheQueue.catch(()=>{}).then(task).finally(()=>{item.cachePending--;});item.cacheQueue=operation.catch(()=>{});return operation;}
function invalidate(item:Resource,accountId:string,path:string,dropData=false){item.generation++;item.reload=true;item.controller?.abort();rememberInvalidation(accountId,path,item.snapshot.updatedAt);if(dropData)void cacheTask(item,()=>localDelete(accountId,"resource:"+path)).catch(()=>{});update(item,{updatedAt:0,...(dropData?{data:undefined,error:null}: {})});}
/** Stable snapshots are shared by subscribers and explicit prefetch callers. */
export function resourceSnapshot<T>(accountId:string,path:string):ResourceState<T>{return (entries.get(accountId+":"+canonicalResourcePath(path))?.snapshot||EMPTY) as ResourceState<T>;}
export function useResource<T>(accountId:string|null,path:string|null){const canonicalPath=path?canonicalResourcePath(path):null,key=accountId&&canonicalPath?accountId+":"+canonicalPath:null;
 const owner=useRef<{key:string|null;controller:AbortController}|null>(null);
 const subscribe=useCallback((listener:()=>void)=>{if(!key)return()=>{};const item=resource(key);item.listeners.add(listener);return()=>{item.listeners.delete(listener);if(!item.listeners.size)item.subscriberReload?.abort(new DOMException("Room left","AbortError"));stopUnownedFlight(item);};},[key]);
 const snapshot=useCallback(()=>accountId&&canonicalPath?resourceSnapshot<T>(accountId,canonicalPath):EMPTY,[accountId,canonicalPath]);const result=useSyncExternalStore(subscribe,snapshot,()=>EMPTY) as ResourceState<T>;
 useEffect(()=>{
  if(!accountId||!path)return;
  const controller=new AbortController();
  owner.current={key,controller};
  const load=()=>{void loadResource(accountId,path,{signal:controller.signal,kind:"visible"}).catch(()=>{});};load();
  window.addEventListener("online",load);
  return()=>{window.removeEventListener("online",load);controller.abort(new DOMException("Room left","AbortError"));if(owner.current?.controller===controller)owner.current=null;};
 },[accountId,path,key]);
 // Effects start fetching after the first paint. An eligible empty snapshot is
 // already pending, so show its loading UI instead of flashing an empty room.
 return {...result,loading:result.loading||!!(accountId&&path&&result.data===undefined&&!result.error),retry:()=>{if(accountId&&path)void loadResource(accountId,path,{force:true,signal:owner.current?.key===key?owner.current.controller.signal:undefined,kind:"visible"}).catch(()=>{});}};
}
export function invalidateResources(accountId:string,prefix="/api/v2/",dropData=false){
 if(dropData){try{const stamp=Math.max(Date.now(),...Array.from(entries).filter(([key])=>key.startsWith(accountId+":")).map(([,item])=>item.snapshot.updatedAt+1));localStorage.setItem(erasureKey(accountId),String(stamp));for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key?.startsWith(`sakura-bloom-scene:${accountId}:`))localStorage.removeItem(key);}}catch{}}
 for(const [key,item]of entries){if(key.startsWith(accountId+":"+prefix)){const path=key.slice(accountId.length+1);if(prefix==="/api/v2/"&&durableCatalogResource(path))continue;invalidate(item,accountId,path,dropData&&listeningResource(path));if(item.listeners.size&&!item.flight)reloadSubscribers(accountId,path,item);}}
}
function reloadSubscribers(accountId:string,path:string,item:Resource){
 const controller=new AbortController();item.subscriberReload=controller;
 void loadResource(accountId,path,{signal:controller.signal,kind:"visible"}).catch(()=>{}).finally(()=>{if(item.subscriberReload===controller)item.subscriberReload=null;});
}
export function clearResources(accountId:string){for(const [key,item] of entries)if(key.startsWith(accountId+":")){item.generation++;item.reload=false;item.flight?.cancel.abort(new DOMException("Account changed","AbortError"));item.controller?.abort();entries.delete(key);update(item,EMPTY);}}

// Another tab's erasure also revokes mounted stories and pending cache writes.
if(typeof window!=="undefined")window.addEventListener("storage",event=>{
 const prefix="sakura-v2-listening-resource-erased:";if(!event.key?.startsWith(prefix))return;
 const accountId=event.key.slice(prefix.length);
 for(const [key,item]of entries){if(!key.startsWith(accountId+":"))continue;const path=key.slice(accountId.length+1);if(!listeningResource(path))continue;invalidate(item,accountId,path,true);if(item.listeners.size&&!item.flight)reloadSubscribers(accountId,path,item);}
 window.dispatchEvent(new CustomEvent("sakura-listening-erased",{detail:{accountId}}));
});
