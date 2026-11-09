"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { requestJson } from "./errors";
import type { RoomSort, RoomSortDirection } from "./trackSorting";

export type RoomLayout = "list" | "cards" | "compact";
export interface RoomPresentation { layout:RoomLayout;sort:RoomSort;direction:RoomSortDirection }
export interface StoredRoomPresentation extends RoomPresentation { savedAt:number;pending:boolean;serverUpdatedAt?:string }

export const DEFAULT_ROOM_PRESENTATION:RoomPresentation={layout:"list",sort:"kept",direction:"asc"};
const layouts=new Set<RoomLayout>(["list","cards","compact"]);
const sorts=new Set<RoomSort>(["kept","title","artist","duration","added"]);
const directions=new Set<RoomSortDirection>(["asc","desc"]);
const memoryStorage=new Map<string,string>();
const writes=new Map<string,Promise<void>>();
const changeEvent="sakura-collection-presentation-changed";

export function roomPresentation(value:unknown):RoomPresentation|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const record=value as Record<string,unknown>;
 if(!layouts.has(record.layout as RoomLayout)||!sorts.has(record.sort as RoomSort)||!directions.has(record.direction as RoomSortDirection))return null;
 return {layout:record.layout as RoomLayout,sort:record.sort as RoomSort,direction:record.direction as RoomSortDirection};
}

export function storedRoomPresentation(value:unknown):StoredRoomPresentation|null {
 const presentation=roomPresentation(value);
 if(!presentation||!value||typeof value!=="object")return null;
 const record=value as Record<string,unknown>,savedAt=record.savedAt;
 if(typeof savedAt!=="number"||!Number.isSafeInteger(savedAt)||savedAt<0||typeof record.pending!=="boolean")return null;
 const serverUpdatedAt=typeof record.serverUpdatedAt==="string"&&Number.isFinite(Date.parse(record.serverUpdatedAt))?record.serverUpdatedAt:undefined;
 return {...presentation,savedAt,pending:record.pending,...(serverUpdatedAt?{serverUpdatedAt}:{})};
}

export function mergeRoomPresentation(current:RoomPresentation,patch:Partial<RoomPresentation>):RoomPresentation {
 return roomPresentation({...current,...patch})||current;
}

function keyFor(accountId:string|undefined,room:string){return "sakura-collection-presentation:"+(accountId||"guest")+":"+room;}
function legacyKeyFor(accountId:string|undefined,room:string){return "sakura-collection-layout:"+(accountId||"guest")+":"+room;}
function browserRead(key:string):string {
 try{return localStorage.getItem(key)||memoryStorage.get(key)||"";}catch{return memoryStorage.get(key)||"";}
}
function readStored(key:string):StoredRoomPresentation|null {
 const raw=browserRead(key);if(!raw)return null;
 try{return storedRoomPresentation(JSON.parse(raw));}catch{return null;}
}
function browserWrite(key:string,value:StoredRoomPresentation){
 const raw=JSON.stringify(value);memoryStorage.set(key,raw);
 try{localStorage.setItem(key,raw);}catch{}
 window.dispatchEvent(new CustomEvent(changeEvent,{detail:key}));
}
function nextStamp(previous:number){return Math.max(Date.now(),previous+1);}
function migrateLegacy(accountId:string|undefined,room:string,key:string):StoredRoomPresentation|null {
 let layout:string|null=null;try{layout=localStorage.getItem(legacyKeyFor(accountId,room));}catch{}
 if(!layouts.has(layout as RoomLayout))return null;
 const migrated={...DEFAULT_ROOM_PRESENTATION,layout:layout as RoomLayout,savedAt:nextStamp(0),pending:Boolean(accountId)};
 browserWrite(key,migrated);return migrated;
}
function localState(accountId:string|undefined,room:string,key:string){return readStored(key)||migrateLegacy(accountId,room,key);}
function emitStored(key:string,value:StoredRoomPresentation){browserWrite(key,value);}

interface RemoteResult { room?:unknown;preference?:unknown }
async function pushPending(accountId:string,room:string,key:string):Promise<void>{
 const running=writes.get(key);if(running)return running;
 const operation=(async()=>{
  const draft=readStored(key);if(!draft?.pending)return;
  const sentAt=draft.savedAt;
  try{
   const result=await requestJson<RemoteResult>("/api/v2/collection-view",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({room,layout:draft.layout,sort:draft.sort,direction:draft.direction})},{context:"save",accountId,timeoutMs:10000});
   const accepted=roomPresentation(result.preference);if(!accepted)return;
   const latest=readStored(key);if(!latest||latest.savedAt!==sentAt)return;
   emitStored(key,{...accepted,savedAt:latest.savedAt,pending:false,...(typeof (result.preference as {updatedAt?:unknown})?.updatedAt==="string"?{serverUpdatedAt:(result.preference as {updatedAt:string}).updatedAt}:{})});
  }catch{/* Local intent remains pending and retries on focus or reconnection. */}
 })();
 writes.set(key,operation);try{await operation;}finally{if(writes.get(key)===operation)writes.delete(key);}
}

async function reconcile(accountId:string,room:string,key:string):Promise<void>{
 const before=readStored(key);
 if(before?.pending){await pushPending(accountId,room,key);return;}
 try{
  const result=await requestJson<RemoteResult>("/api/v2/collection-view?room="+encodeURIComponent(room),{}, {context:"page",accountId,timeoutMs:10000});
  const remote=roomPresentation(result.preference),latest=readStored(key);
  if(latest?.pending){await pushPending(accountId,room,key);return;}
  if(remote){
   const updatedAt=typeof (result.preference as {updatedAt?:unknown})?.updatedAt==="string"?(result.preference as {updatedAt:string}).updatedAt:undefined;
   emitStored(key,{...remote,savedAt:nextStamp(latest?.savedAt||0),pending:false,...(updatedAt?{serverUpdatedAt:updatedAt}:{})});
  }else if(latest){emitStored(key,{...latest,pending:true});await pushPending(accountId,room,key);}
 }catch{/* A local value is sufficient while the account service is unavailable. */}
}

/** Immediate local presentation with background account reconciliation. */
export function useRoomPresentation(accountId:string|undefined,room:string){
 const storageKey=useMemo(()=>keyFor(accountId,room),[accountId,room]);
 const subscribe=useCallback((notify:()=>void)=>{
  const changed=(event:Event)=>{
   if(event instanceof StorageEvent){if(event.key===null||event.key===storageKey)notify();return;}
   if((event as CustomEvent<string>).detail===storageKey)notify();
  };
  window.addEventListener("storage",changed);window.addEventListener(changeEvent,changed);
  return()=>{window.removeEventListener("storage",changed);window.removeEventListener(changeEvent,changed);};
 },[storageKey]);
 const raw=useSyncExternalStore(subscribe,()=>browserRead(storageKey),()=>"");
 const stored=useMemo(()=>{try{return storedRoomPresentation(JSON.parse(raw));}catch{return null;}},[raw]);
 const presentation:RoomPresentation=stored?{layout:stored.layout,sort:stored.sort,direction:stored.direction}:DEFAULT_ROOM_PRESENTATION;
 useEffect(()=>{
  const initial=localState(accountId,room,storageKey);
  if(initial)window.dispatchEvent(new CustomEvent(changeEvent,{detail:storageKey}));
  if(!accountId)return;
  let live=true;
  const refresh=()=>{if(live)void reconcile(accountId,room,storageKey);};
  const visible=()=>{if(document.visibilityState==="visible")refresh();};
  refresh();window.addEventListener("focus",refresh);window.addEventListener("online",refresh);document.addEventListener("visibilitychange",visible);
  return()=>{live=false;window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",visible);};
 },[accountId,room,storageKey]);
 useEffect(()=>{
  if(!accountId||!stored?.pending)return;
  const timer=setTimeout(()=>void pushPending(accountId,room,storageKey),250);
  return()=>clearTimeout(timer);
 },[accountId,room,storageKey,stored?.pending,stored?.savedAt]);
 const change=useCallback((patch:Partial<RoomPresentation>)=>{
  const current=readStored(storageKey)||{...DEFAULT_ROOM_PRESENTATION,savedAt:0,pending:false};
  const next=mergeRoomPresentation(current,patch);
  emitStored(storageKey,{...next,savedAt:nextStamp(current.savedAt),pending:Boolean(accountId)});
 },[accountId,storageKey]);
 return [presentation,change] as const;
}
