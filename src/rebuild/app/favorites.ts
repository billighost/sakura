import {localRead,localWrite,localDelete,localEntries} from "./offline";
import type {MusicTrack} from "./types";
import {portableTrack} from "./sessionState";

export interface FavoriteIntent {track:MusicTrack;liked:boolean;operationId:string;createdAt?:number}
export interface FavoriteDraft {likedIds:string[];pending:Record<string,FavoriteIntent>;savedAt:number}
const prefix="sakura-v2-favorites:";
const writes=new Map<string,Promise<void>>();
const writeStamps=new Map<string,number>();
interface IntentRecord {key:string;intent:FavoriteIntent;savedAt:number}
const intentPrefix=(accountId:string)=>"sakura-v2-favorite-intent:"+accountId+":";
const ackPrefix=(accountId:string)=>"sakura-v2-favorite-ack:"+accountId+":";
function draftFields(value:unknown):FavoriteDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as FavoriteDraft;
 if(!Array.isArray(draft.likedIds)||!draft.likedIds.every(id=>typeof id==="string")||!draft.pending||typeof draft.pending!=="object"||!Number.isFinite(draft.savedAt))return;
 const pending:Record<string,FavoriteIntent>={};
 for(const [key,intent] of Object.entries(draft.pending))if(intent&&typeof intent.liked==="boolean"&&typeof intent.operationId==="string"&&intent.track&&typeof intent.track.id==="string"&&typeof intent.track.title==="string"&&Array.isArray(intent.track.artists)&&intent.track.reference&&typeof intent.track.reference.id==="string")pending[key]={...intent,track:portableTrack(intent.track),createdAt:Number.isFinite(intent.createdAt)?intent.createdAt:draft.savedAt};
 return {likedIds:draft.likedIds,pending,savedAt:draft.savedAt};
}
/** Independent tab drafts may contain different songs, or opposite choices for
 * one song. Keep every song and order deliberate choices, never whole drafts. */
export function mergeFavoriteIntents(...sources:Array<Record<string,FavoriteIntent>|undefined>):Record<string,FavoriteIntent>{
 const result:Record<string,FavoriteIntent>={};
 for(const source of sources)for(const [key,intent]of Object.entries(source||{})){
  const previous=result[key];
  if(!previous||(intent.createdAt??0)>(previous.createdAt??0)||(intent.createdAt??0)===(previous.createdAt??0)&&intent.operationId>=previous.operationId)result[key]=intent;
 }
 return result;
}
export function favoriteOverlay(liked:Iterable<string>,pending:Record<string,FavoriteIntent>,identity:(track:MusicTrack)=>string=(track)=>track.id):Set<string>{
 const result=new Set(liked);for(const [key,intent] of Object.entries(pending)){const id=identity(intent.track);if(key!==id)result.delete(key);if(intent.liked)result.add(id);else result.delete(id);}return result;
}
export function acknowledgeFavorite(pending:Record<string,FavoriteIntent>,key:string,operationId:string){
 const next={...pending};if(next[key]?.operationId===operationId)delete next[key];return next;
}
export async function readFavoriteDraft(accountId:string):Promise<FavoriteDraft|undefined>{
 let mirror:FavoriteDraft|undefined;try{const raw=localStorage.getItem(prefix+accountId);if(raw)mirror=draftFields(JSON.parse(raw));}catch{}
 const disk=draftFields(await localRead(accountId,"favorite-draft").catch(()=>undefined)),draft=disk&&(!mirror||disk.savedAt>mirror.savedAt)?disk:mirror;
 const records=new Map<string,IntentRecord>(),acknowledged=new Set<string>();
 for(const [key,intent]of Object.entries(draft?.pending||{}))records.set(intent.operationId,{key,intent,savedAt:draft!.savedAt});
 function collect(value:unknown){
  if(!value||typeof value!=="object")return;const record=value as IntentRecord;
  if(typeof record.key!=="string"||!Number.isFinite(record.savedAt))return;
  const clean=draftFields({likedIds:[],pending:{[record.key]:record.intent},savedAt:record.savedAt})?.pending[record.key];if(!clean)return;
  const old=records.get(clean.operationId);if(!old||record.savedAt>=old.savedAt)records.set(clean.operationId,{...record,intent:clean});
 }
 // One immutable key per operation protects another tab's offline choices
 // from a stale complete-draft write. Receipt tombstones prevent resurrection.
 const entries=await localEntries<unknown>(accountId,"favorite-").catch(()=>[]);
 for(const entry of entries){if(entry.name.startsWith("favorite-ack:"))acknowledged.add(entry.name.slice("favorite-ack:".length));else if(entry.name.startsWith("favorite-intent:"))collect(entry.value);}
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(ackPrefix(accountId)))acknowledged.add(name.slice(ackPrefix(accountId).length));else if(name?.startsWith(intentPrefix(accountId)))collect(JSON.parse(localStorage.getItem(name)||"null"));}}catch{}
 const pending=mergeFavoriteIntents(...[...records.values()].filter(record=>!acknowledged.has(record.intent.operationId)).map(record=>({[record.key]:record.intent})));
 if(!draft&&!Object.keys(pending).length)return;
 return {likedIds:[...favoriteOverlay(draft?.likedIds||[],pending)],pending,savedAt:Math.max(draft?.savedAt||0,...[...records.values()].map(record=>record.savedAt))};
}
export async function writeFavoriteDraft(accountId:string,liked:Iterable<string>,pending:Record<string,FavoriteIntent>){
 let existing:FavoriteDraft|undefined;try{existing=draftFields(JSON.parse(localStorage.getItem(prefix+accountId)||"null"));}catch{}
 const savedAt=Math.max(Date.now(),(writeStamps.get(accountId)||0)+1,(existing?.savedAt||0)+1);writeStamps.set(accountId,savedAt);
 const draft:FavoriteDraft={likedIds:[...liked],pending:Object.fromEntries(Object.entries(pending).map(([key,intent])=>[key,{...intent,track:portableTrack(intent.track),createdAt:intent.createdAt??existing?.pending[key]?.createdAt??savedAt}])),savedAt};
 const records=Object.entries(draft.pending).map(([key,intent])=>({key,intent,savedAt}));
 let mirrored=false;try{localStorage.setItem(prefix+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 let journalMirrored=true;for(const record of records)try{if(!localStorage.getItem(ackPrefix(accountId)+record.intent.operationId))localStorage.setItem(intentPrefix(accountId)+record.intent.operationId,JSON.stringify(record));}catch{journalMirrored=false;}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{
  for(const record of records)if(!await localRead(accountId,"favorite-ack:"+record.intent.operationId))await localWrite(accountId,"favorite-intent:"+record.intent.operationId,record);
  await localWrite(accountId,"favorite-draft",draft);await localWrite(accountId,"liked",draft.likedIds);
 });writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored||!journalMirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
/** Only a matching server acknowledgement can retire this operation. A later
 * operation for the same song has a different ID and remains pending. */
export async function acknowledgeFavoriteDraft(accountId:string,operationId:string){
 const stamp=Date.now();let mirrored=false;
 try{localStorage.setItem(ackPrefix(accountId)+operationId,String(stamp));localStorage.removeItem(intentPrefix(accountId)+operationId);mirrored=true;}catch{}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{await localWrite(accountId,"favorite-ack:"+operationId,stamp);await localDelete(accountId,"favorite-intent:"+operationId);});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
