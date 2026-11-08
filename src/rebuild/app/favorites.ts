import {localRead,localWrite} from "./offline";
import type {MusicTrack} from "./types";
import {portableTrack} from "./sessionState";

export interface FavoriteIntent {track:MusicTrack;liked:boolean;operationId:string}
export interface FavoriteDraft {likedIds:string[];pending:Record<string,FavoriteIntent>;savedAt:number}
const prefix="sakura-v2-favorites:";
const writes=new Map<string,Promise<void>>();
function draftFields(value:unknown):FavoriteDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as FavoriteDraft;
 if(!Array.isArray(draft.likedIds)||!draft.likedIds.every(id=>typeof id==="string")||!draft.pending||typeof draft.pending!=="object"||!Number.isFinite(draft.savedAt))return;
 const pending:Record<string,FavoriteIntent>={};
 for(const [key,intent] of Object.entries(draft.pending))if(intent&&typeof intent.liked==="boolean"&&typeof intent.operationId==="string"&&intent.track&&typeof intent.track.id==="string"&&typeof intent.track.title==="string"&&Array.isArray(intent.track.artists)&&intent.track.reference&&typeof intent.track.reference.id==="string")pending[key]={...intent,track:portableTrack(intent.track)};
 return {likedIds:draft.likedIds,pending,savedAt:draft.savedAt};
}
export function favoriteOverlay(liked:Iterable<string>,pending:Record<string,FavoriteIntent>,identity:(track:MusicTrack)=>string=(track)=>track.id):Set<string>{
 const result=new Set(liked);for(const [key,intent] of Object.entries(pending)){const id=identity(intent.track);if(key!==id)result.delete(key);if(intent.liked)result.add(id);else result.delete(id);}return result;
}
export function acknowledgeFavorite(pending:Record<string,FavoriteIntent>,key:string,operationId:string){
 const next={...pending};if(next[key]?.operationId===operationId)delete next[key];return next;
}
export async function readFavoriteDraft(accountId:string):Promise<FavoriteDraft|undefined>{
 let mirror:FavoriteDraft|undefined;try{const raw=localStorage.getItem(prefix+accountId);if(raw)mirror=draftFields(JSON.parse(raw));}catch{}
 const disk=draftFields(await localRead(accountId,"favorite-draft").catch(()=>undefined));return disk&&(!mirror||disk.savedAt>mirror.savedAt)?disk:mirror;
}
export async function writeFavoriteDraft(accountId:string,liked:Iterable<string>,pending:Record<string,FavoriteIntent>){
 const draft:FavoriteDraft={likedIds:[...liked],pending:Object.fromEntries(Object.entries(pending).map(([key,intent])=>[key,{...intent,track:portableTrack(intent.track)}])),savedAt:Date.now()};
 let mirrored=false;try{localStorage.setItem(prefix+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{await localWrite(accountId,"favorite-draft",draft);await localWrite(accountId,"liked",draft.likedIds);});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
