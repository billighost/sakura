import {localRead,localWrite,localDelete,localEntries,offlineDatabase} from "./offline";
import type {MusicTrack} from "./types";
import {localId,portableTrack} from "./sessionState";

export interface FavoriteIntent {track:MusicTrack;liked:boolean;operationId:string;createdAt?:number;baseRevision?:number}
export interface FavoriteConfirmation {recordingId:string;liked:boolean;revision:number}
export interface FavoriteDraft {likedIds:string[];pending:Record<string,FavoriteIntent>;savedAt:number;revisions?:Record<string,number>;confirmed?:Record<string,FavoriteConfirmation>}
export type FavoriteServerSnapshot = {states:Record<string,{liked:boolean;revision:number}>}|{likedIds:Iterable<string>;revisions:Record<string,number>};
const prefix="sakura-v2-favorites:";
const writes=new Map<string,Promise<void>>();
const writeStamps=new Map<string,number>();
const intentStamps=new Map<string,number>();
interface IntentRecord {key:string;intent:FavoriteIntent;savedAt:number}
interface FavoriteAcknowledgment {operationId:string;key:string;createdAt:number}
const intentPrefix=(accountId:string)=>"sakura-v2-favorite-intent:"+accountId+":";
const ackPrefix=(accountId:string)=>"sakura-v2-favorite-ack:"+accountId+":";
const choicePrefix=(accountId:string)=>"sakura-v2-favorite-choice:"+accountId+":";
const intentVersion=(intent:FavoriteIntent)=>intent.operationId+":"+(intent.baseRevision??0);
const compareIntents=(a:FavoriteIntent,b:FavoriteIntent)=>(a.createdAt??0)-(b.createdAt??0)||a.operationId.localeCompare(b.operationId);
export function mergeFavoriteRevisions(...sources:Array<Record<string,number>|undefined>):Record<string,number>{
 const result:Record<string,number>={};
 for(const source of sources)for(const [key,revision]of Object.entries(source||{}))if(key&&Number.isSafeInteger(revision)&&revision>=0)result[key]=Math.max(result[key]||0,revision);
 return result;
}
/** Account-local logical ordering survives same-tick choices and clock rollback.
 * Server revisions separately protect choices made on another device. */
export function createFavoriteIntent(accountId:string,track:MusicTrack,liked:boolean,baseRevision=0):FavoriteIntent {
 let stamp=Math.max(Date.now(),(intentStamps.get(accountId)||0)+1);
 try{const draft=draftFields(JSON.parse(localStorage.getItem(prefix+accountId)||"null"));stamp=Math.max(stamp,(draft?.savedAt||0)+1);for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(!name?.startsWith(intentPrefix(accountId)))continue;const record=JSON.parse(localStorage.getItem(name)||"null") as IntentRecord|null;if(Number.isSafeInteger(record?.intent?.createdAt)&&record!.intent.createdAt!>=0)stamp=Math.max(stamp,record!.intent.createdAt!+1);}}catch{}
 intentStamps.set(accountId,stamp);
 return {track:portableTrack(track),liked,operationId:localId(),createdAt:stamp,baseRevision:Number.isSafeInteger(baseRevision)&&baseRevision>=0?baseRevision:0};
}
function confirmation(value:unknown):FavoriteConfirmation|undefined {
 if(!value||typeof value!=="object")return;const receipt=value as FavoriteConfirmation;
 if(typeof receipt.recordingId!=="string"||typeof receipt.liked!=="boolean"||!Number.isSafeInteger(receipt.revision)||receipt.revision<0)return;
 return {recordingId:receipt.recordingId,liked:receipt.liked,revision:receipt.revision};
}
function mergeConfirmed(...sources:Array<Record<string,FavoriteConfirmation>|undefined>){
 const result:Record<string,FavoriteConfirmation>={};
 for(const source of sources)for(const value of Object.values(source||{})){const receipt=confirmation(value);if(receipt&&(!result[receipt.recordingId]||receipt.revision>result[receipt.recordingId].revision))result[receipt.recordingId]=receipt;}
 return result;
}
function snapshotConfirmed(liked:Iterable<string>,revisions:Record<string,number>|undefined,pending:Record<string,FavoriteIntent>={}){
 const ids=new Set(liked);return Object.fromEntries(Object.entries(mergeFavoriteRevisions(revisions)).filter(([id])=>!pending[id]).map(([recordingId,revision])=>[recordingId,{recordingId,revision,liked:ids.has(recordingId)}]));
}
function draftFields(value:unknown):FavoriteDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as FavoriteDraft;
 if(!Array.isArray(draft.likedIds)||!draft.likedIds.every(id=>typeof id==="string")||!draft.pending||typeof draft.pending!=="object"||!Number.isSafeInteger(draft.savedAt)||draft.savedAt<0)return;
 const pending:Record<string,FavoriteIntent>={};
 for(const [key,intent] of Object.entries(draft.pending))if(intent&&typeof intent.liked==="boolean"&&typeof intent.operationId==="string"&&intent.track&&typeof intent.track.id==="string"&&typeof intent.track.title==="string"&&Array.isArray(intent.track.artists)&&intent.track.reference&&typeof intent.track.reference.id==="string")pending[key]={...intent,track:portableTrack(intent.track),createdAt:Number.isFinite(intent.createdAt)?intent.createdAt:draft.savedAt,baseRevision:Number.isSafeInteger(intent.baseRevision)&&intent.baseRevision!>=0?intent.baseRevision:0};
 return {likedIds:draft.likedIds,pending,savedAt:draft.savedAt,revisions:mergeFavoriteRevisions(draft.revisions),confirmed:mergeConfirmed(draft.confirmed,snapshotConfirmed(draft.likedIds,draft.revisions,pending))};
}
/** Independent tab drafts may contain different songs, or opposite choices for
 * one song. Keep every song and order deliberate choices, never whole drafts. */
export function mergeFavoriteIntents(...sources:Array<Record<string,FavoriteIntent>|undefined>):Record<string,FavoriteIntent>{
 const result:Record<string,FavoriteIntent>={};
 for(const source of sources)for(const [key,intent]of Object.entries(source||{})){
  const previous=result[key];
  if(!previous||compareIntents(intent,previous)>0||intent.operationId===previous.operationId&&(intent.baseRevision??0)>(previous.baseRevision??0))result[key]=intent;
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
 const records=new Map<string,IntentRecord>(),acknowledged=new Set<string>(),acks:FavoriteAcknowledgment[]=[],orders=new Map<string,number>();
 let confirmed=mergeConfirmed(mirror?.confirmed,disk?.confirmed);
 const revisions=mergeFavoriteRevisions(mirror?.revisions,disk?.revisions);
 const accept=(value:unknown)=>{const receipt=confirmation(value);if(receipt)confirmed=mergeConfirmed(confirmed,{[receipt.recordingId]:receipt});};
 const acceptAck=(value:unknown)=>{accept(value);if(!value||typeof value!=="object")return;const ack=(value as {choice?:FavoriteAcknowledgment}).choice;if(ack&&typeof ack.key==="string"&&typeof ack.operationId==="string"&&Number.isSafeInteger(ack.createdAt)&&ack.createdAt>=0)acks.push(ack);};
 function collect(value:unknown){
  if(!value||typeof value!=="object")return;const record=value as IntentRecord;
  if(typeof record.key!=="string"||!Number.isFinite(record.savedAt))return;
  const clean=draftFields({likedIds:[],pending:{[record.key]:record.intent},savedAt:record.savedAt})?.pending[record.key];if(!clean)return;
  const old=records.get(clean.operationId);if(!old||(clean.baseRevision??0)>(old.intent.baseRevision??0)||(clean.baseRevision??0)===(old.intent.baseRevision??0)&&record.savedAt>=old.savedAt)records.set(clean.operationId,{...record,intent:clean});
 }
 // One immutable key per operation protects another tab's offline choices
 // from a stale complete-draft write. Receipt tombstones prevent resurrection.
 for(const source of [mirror,disk])for(const [key,intent]of Object.entries(source?.pending||{}))collect({key,intent,savedAt:source!.savedAt});
 const entries=await localEntries<unknown>(accountId,"favorite-").catch(()=>[]);
 const aliases=await localRead<Record<string,string>>(accountId,"aliases").catch(()=>undefined),identity=(track:MusicTrack)=>{const value=aliases?.[track.reference.provider+":"+(track.reference.scope||"")+":"+track.reference.id];return typeof value==="string"&&value?value:track.id;};
 for(const entry of entries){if(entry.name.startsWith("favorite-ack:")){acknowledged.add(entry.name.slice("favorite-ack:".length));acceptAck(entry.value);}else if(entry.name.startsWith("favorite-intent:"))collect(entry.value);else if(entry.name.startsWith("favorite-choice:"))accept(entry.value);else if(entry.name.startsWith("favorite-order:")){const order=entry.value as {operationId?:string;createdAt?:number};if(typeof order?.operationId==="string"&&Number.isSafeInteger(order.createdAt)&&order.createdAt!>=0)orders.set(order.operationId,order.createdAt!);}}
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(ackPrefix(accountId))){acknowledged.add(name.slice(ackPrefix(accountId).length));acceptAck(JSON.parse(localStorage.getItem(name)||"null"));}else if(name?.startsWith(intentPrefix(accountId)))collect(JSON.parse(localStorage.getItem(name)||"null"));else if(name?.startsWith(choicePrefix(accountId)))accept(JSON.parse(localStorage.getItem(name)||"null"));}}catch{}
 for(const record of records.values()){const order=orders.get(record.intent.operationId);if(order!==undefined)record.intent.createdAt=order;}for(const ack of acks){const order=orders.get(ack.operationId);if(order!==undefined)ack.createdAt=order;}
 const pending=mergeFavoriteIntents(...[...records.values()].filter(record=>!acknowledged.has(record.intent.operationId)&&!acks.some(ack=>(ack.key===record.key||ack.key===identity(record.intent.track))&&compareIntents(record.intent,{...record.intent,operationId:ack.operationId,createdAt:ack.createdAt})<=0)).map(record=>({[record.key]:record.intent})));
 if(!draft&&!Object.keys(pending).length&&!Object.keys(confirmed).length)return;
 const liked=new Set(draft?.likedIds||[]);for(const receipt of Object.values(confirmed)){revisions[receipt.recordingId]=Math.max(revisions[receipt.recordingId]||0,receipt.revision);if(receipt.liked)liked.add(receipt.recordingId);else liked.delete(receipt.recordingId);}
 return {likedIds:[...favoriteOverlay(liked,pending,identity)],pending,revisions,confirmed,savedAt:Math.max(draft?.savedAt||0,...[...records.values()].map(record=>record.savedAt))};
}
/** Reserve a stable order for each deliberate operation in a shared transaction.
 * A stale rewrite reuses its old order even if it commits after a newer choice. */
async function reserveIntentOrder(accountId:string,records:IntentRecord[]){
 if(!records.length)return;const database=await offlineDatabase(),tx=database.transaction("entries","readwrite"),done=tx.done;void done.catch(()=>{});const accountPrefix="account:"+accountId+":";
 let clock=Number(await tx.store.get(accountPrefix+"favorite-clock"))||0;
 for(const record of records){const name=accountPrefix+"favorite-order:"+record.intent.operationId,stored=await tx.store.get(name) as {createdAt?:number}|undefined;const createdAt=Number.isSafeInteger(stored?.createdAt)&&stored!.createdAt!>=0?stored!.createdAt!:Math.max(clock+1,record.intent.createdAt??0);clock=Math.max(clock,createdAt);record.intent.createdAt=createdAt;await tx.store.put({operationId:record.intent.operationId,createdAt},name);await tx.store.put(record,accountPrefix+"favorite-intent:"+intentVersion(record.intent));}
 await tx.store.put(clock,accountPrefix+"favorite-clock");await done;intentStamps.set(accountId,Math.max(intentStamps.get(accountId)||0,clock));
}
export async function writeFavoriteDraft(accountId:string,liked:Iterable<string>,pending:Record<string,FavoriteIntent>,revisions?:Record<string,number>,serverSnapshot?:FavoriteServerSnapshot){
 let existing:FavoriteDraft|undefined;try{existing=draftFields(JSON.parse(localStorage.getItem(prefix+accountId)||"null"));}catch{}
 const savedAt=Math.max(Date.now(),(writeStamps.get(accountId)||0)+1,(existing?.savedAt||0)+1);writeStamps.set(accountId,savedAt);
 const likedIds=[...liked],serverChoices=serverSnapshot&&"states" in serverSnapshot?mergeConfirmed(Object.fromEntries(Object.entries(serverSnapshot.states).map(([recordingId,value])=>[recordingId,{...value,recordingId}]))):snapshotConfirmed(serverSnapshot?.likedIds||likedIds,serverSnapshot?.revisions||revisions,serverSnapshot?{}:pending);
 const confirmed=mergeConfirmed(existing?.confirmed,serverChoices);
 const draft:FavoriteDraft={likedIds,pending:Object.fromEntries(Object.entries(pending).map(([key,intent])=>[key,{...intent,track:portableTrack(intent.track),createdAt:intent.createdAt??existing?.pending[key]?.createdAt??savedAt,baseRevision:Number.isSafeInteger(intent.baseRevision)&&intent.baseRevision!>=0?intent.baseRevision:0}])),savedAt,revisions:mergeFavoriteRevisions(existing?.revisions,revisions),confirmed};
 const records=Object.entries(draft.pending).map(([key,intent])=>({key,intent,savedAt}));
 let mirrored=false;try{localStorage.setItem(prefix+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 let journalMirrored=true;for(const record of records)try{if(!localStorage.getItem(ackPrefix(accountId)+record.intent.operationId))localStorage.setItem(intentPrefix(accountId)+intentVersion(record.intent),JSON.stringify(record));}catch{journalMirrored=false;}
 for(const receipt of Object.values(confirmed))try{localStorage.setItem(choicePrefix(accountId)+receipt.recordingId+":"+receipt.revision,JSON.stringify(receipt));}catch{journalMirrored=false;}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{
  await reserveIntentOrder(accountId,records);
  for(const record of records){if(pending[record.key]?.operationId===record.intent.operationId)pending[record.key].createdAt=record.intent.createdAt;try{if(!localStorage.getItem(ackPrefix(accountId)+record.intent.operationId))localStorage.setItem(intentPrefix(accountId)+intentVersion(record.intent),JSON.stringify(record));}catch{}if(!await localRead(accountId,"favorite-ack:"+record.intent.operationId))await localWrite(accountId,"favorite-intent:"+intentVersion(record.intent),record);}
  for(const receipt of Object.values(confirmed))await localWrite(accountId,"favorite-choice:"+receipt.recordingId+":"+receipt.revision,receipt);
  await localWrite(accountId,"favorite-draft",draft);await localWrite(accountId,"liked",draft.likedIds);
 });writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored||!journalMirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
/** Only a matching server acknowledgement can retire this operation. A later
 * operation for the same song has a different ID and remains pending. */
export async function acknowledgeFavoriteDraft(accountId:string,operationId:string,accepted?:FavoriteConfirmation){
 const entries=await localEntries<unknown>(accountId,"favorite-intent:").catch(()=>[]);const records=entries.map(entry=>entry.value as IntentRecord).filter(record=>record?.intent?.operationId===operationId);try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(intentPrefix(accountId))){const record=JSON.parse(localStorage.getItem(name)||"null") as IntentRecord;if(record?.intent?.operationId===operationId)records.push(record);}}}catch{}
 const record=records.sort((a,b)=>(b.intent.baseRevision??0)-(a.intent.baseRevision??0)||b.savedAt-a.savedAt)[0],stamp=Date.now(),receipt=confirmation(accepted),choice=record?{key:receipt?.recordingId||record.key,operationId,createdAt:record.intent.createdAt??record.savedAt}:undefined,tombstone={...(receipt||{}),acknowledgedAt:stamp,...(choice?{choice}:{})};let mirrored=false;
 try{localStorage.setItem(ackPrefix(accountId)+operationId,JSON.stringify(tombstone));localStorage.removeItem(intentPrefix(accountId)+operationId);if(record)localStorage.removeItem(intentPrefix(accountId)+intentVersion(record.intent));mirrored=true;}catch{}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{await localWrite(accountId,"favorite-ack:"+operationId,tombstone);await localDelete(accountId,"favorite-intent:"+operationId);if(record)await localDelete(accountId,"favorite-intent:"+intentVersion(record.intent));});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
