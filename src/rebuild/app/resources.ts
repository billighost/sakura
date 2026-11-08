"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { localDelete, localRead, localWrite } from "./offline";
import { requestJson, userIssue, UserFacingError } from "./errors";
export interface ResourceState<T>{data:T|undefined;loading:boolean;error:UserFacingError|null;updatedAt:number}
const EMPTY:ResourceState<never>={data:undefined,loading:false,error:null,updatedAt:0};
type Resource={snapshot:ResourceState<unknown>;listeners:Set<()=>void>;flight:Promise<void>|null;controller:AbortController|null;generation:number;reload:boolean;cacheQueue:Promise<void>};
const entries=new Map<string,Resource>();
const storageKey=(accountId:string,path:string)=>"sakura-v2-resource-invalidated:"+accountId+":"+path;
function invalidatedAt(accountId:string,path:string){try{const value=Number(localStorage.getItem(storageKey(accountId,path)));return Number.isFinite(value)?value:0;}catch{return 0;}}
function rememberInvalidation(accountId:string,path:string,updatedAt:number){const stamp=Math.max(Date.now(),updatedAt+1,invalidatedAt(accountId,path));try{localStorage.setItem(storageKey(accountId,path),String(stamp));}catch{}return stamp;}
function resource(key:string):Resource{let item=entries.get(key);if(!item){item={snapshot:EMPTY,listeners:new Set(),flight:null,controller:null,generation:0,reload:false,cacheQueue:Promise.resolve()};entries.set(key,item);}return item;}
function update(item:Resource,patch:Partial<ResourceState<unknown>>){item.snapshot={...item.snapshot,...patch};for(const listener of item.listeners)listener();}
export async function loadResource(accountId:string,path:string,force=false){
 const key=accountId+":"+path,item=resource(key);
 if(force)invalidate(item,accountId,path);
 if(item.flight)return item.flight;
 if(!item.reload&&item.snapshot.data!==undefined&&fresh(item.snapshot.updatedAt))return;
 item.flight=(async()=>{
  let allowSaved=!force&&!item.reload;
  try{do{
   item.reload=false;const version=item.generation,controller=new AbortController();item.controller=controller;
   const current=()=>!controller.signal.aborted&&entries.get(key)===item&&item.generation===version;
   update(item,{loading:item.snapshot.data===undefined,error:null});
   try{
    if(allowSaved&&item.snapshot.data===undefined){
     const saved=await localRead<{data:unknown;updatedAt:number}>(accountId,"resource:"+path).catch(()=>undefined);
     if(!current())continue;
     if(saved&&Number.isFinite(saved.updatedAt)&&saved.updatedAt>invalidatedAt(accountId,path)){
      update(item,{data:saved.data,updatedAt:saved.updatedAt,loading:false});
      if(current()&&!item.reload&&fresh(saved.updatedAt))break;
     }
    }
    const data=await requestJson(path,{signal:controller.signal},{accountId});if(!current())continue;
    const updatedAt=Math.max(Date.now(),invalidatedAt(accountId,path)+1);update(item,{data,updatedAt,loading:false,error:null});
    await cacheTask(item,async()=>{if(current())await localWrite(accountId,"resource:"+path,{data,updatedAt});});
   }catch(error){if(current()){
    const issue=error instanceof UserFacingError?error:new UserFacingError(userIssue(error));
    // Definitive unavailable/session responses must not resurrect old private
    // content on the next navigation from its persisted browser cache.
    const unavailable=issue.issue.kind==="missing"||issue.issue.kind==="session";
    if(unavailable){rememberInvalidation(accountId,path,item.snapshot.updatedAt);await cacheTask(item,()=>localDelete(accountId,"resource:"+path));}
    if(current())update(item,{loading:false,error:issue,...(unavailable?{data:undefined,updatedAt:0}:{})});
   }}finally{allowSaved=false;if(item.controller===controller)item.controller=null;}
  }while(item.reload&&entries.get(key)===item);
  }finally{item.flight=null;item.controller=null;}
 })();return item.flight;
}
function cacheTask(item:Resource,task:()=>Promise<void>){const operation=item.cacheQueue.catch(()=>{}).then(task);item.cacheQueue=operation.catch(()=>{});return item.cacheQueue;}
function invalidate(item:Resource,accountId:string,path:string){item.generation++;item.reload=true;item.controller?.abort();rememberInvalidation(accountId,path,item.snapshot.updatedAt);void cacheTask(item,()=>localDelete(accountId,"resource:"+path));update(item,{updatedAt:0});}
function fresh(updatedAt:number){const age=Date.now()-updatedAt;return updatedAt>0&&age>=-1000&&age<120000;}
/** Stable snapshots are shared by subscribers and explicit prefetch callers. */
export function resourceSnapshot<T>(accountId:string,path:string):ResourceState<T>{return (entries.get(accountId+":"+path)?.snapshot||EMPTY) as ResourceState<T>;}
export function useResource<T>(accountId:string|null,path:string|null){const key=accountId&&path?accountId+":"+path:null;
 const subscribe=useCallback((listener:()=>void)=>{if(!key)return()=>{};const item=resource(key);item.listeners.add(listener);return()=>{item.listeners.delete(listener);};},[key]);
 const snapshot=useCallback(()=>accountId&&path?resourceSnapshot<T>(accountId,path):EMPTY,[accountId,path]);const result=useSyncExternalStore(subscribe,snapshot,()=>EMPTY) as ResourceState<T>;
 useEffect(()=>{if(accountId&&path)void loadResource(accountId,path);},[accountId,path]);
 // Effects start fetching after the first paint. An eligible empty snapshot is
 // already pending, so show its loading UI instead of flashing an empty room.
 return {...result,loading:result.loading||!!(accountId&&path&&result.data===undefined&&!result.error),retry:()=>{if(accountId&&path)void loadResource(accountId,path,true);}};
}
export function invalidateResources(accountId:string,prefix="/api/v2/"){for(const [key,item]of entries){if(key.startsWith(accountId+":"+prefix)){const path=key.slice(accountId.length+1);invalidate(item,accountId,path);if(item.listeners.size&&!item.flight)void loadResource(accountId,path);}}}
export function clearResources(accountId:string){for(const [key,item] of entries)if(key.startsWith(accountId+":")){item.generation++;item.reload=false;item.controller?.abort();entries.delete(key);update(item,EMPTY);}}
