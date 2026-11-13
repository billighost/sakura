"use client";
import {offlineDatabase,savedAudio,savedAudioMetadata,offlineAudioMetadata,invalidateSavedAudioMetadata,validOfflineAudio,type OfflineAudio} from "./offline";
import type {DownloadChunk,DownloadStorage,PartialDownloadRecord} from "./downloadTypes";

export function indexedDownloadStorage(accountId:string):DownloadStorage {
 if(!accountId)throw new Error("Downloads need an account.");
 const prefix="account:"+accountId+":";
 const key=(kind:string,id:string)=>prefix+kind+":"+id;
 const range=(prefix:string)=>IDBKeyRange.bound(prefix,prefix+"\uffff");
 return {
  async list(){const rows:PartialDownloadRecord[]=[];let cursor=await (await offlineDatabase()).transaction("entries").store.openCursor(range(key("download","")));while(cursor){const value=cursor.value as PartialDownloadRecord;if(value?.version===1&&typeof value.recordingId==="string"&&value.track?.id===value.recordingId&&String(cursor.key)===key("download",value.recordingId))rows.push(value);cursor=await cursor.continue();}return rows;},
  async read(id){return (await offlineDatabase()).get("entries",key("download",id));},
  async save(record){const tx=(await offlineDatabase()).transaction("entries","readwrite"),name=key("download",record.recordingId),existing=await tx.store.get(name) as PartialDownloadRecord|undefined;await tx.store.put({...record,requested:record.requested||!!existing?.requested,mode:existing?.requested&&existing.mode==="full"?"full":record.mode},name);await tx.done;},
  async chunks(id){const result:DownloadChunk[]=[];let cursor=await (await offlineDatabase()).transaction("entries").store.openCursor(range(key("chunk",id+":")));while(cursor){const chunk=cursor.value as DownloadChunk;if(Number.isSafeInteger(chunk?.offset)&&chunk.offset>=0&&chunk.blob instanceof Blob&&chunk.blob.size>0&&/^[a-f0-9]{64}$/i.test(chunk.sha256))result.push(chunk);cursor=await cursor.continue();}return result.sort((a,b)=>a.offset-b.offset);},
  async chunk(id,offset){const value=await (await offlineDatabase()).get("entries",key("chunk",id+":"+offset)) as DownloadChunk|undefined;return value?.offset===offset&&value.blob instanceof Blob&&value.blob.size>0&&/^[a-f0-9]{64}$/i.test(value.sha256)?value:undefined;},
  async putChunk(id,chunk){await (await offlineDatabase()).put("entries",chunk,key("chunk",id+":"+chunk.offset));},
  async ready(id){const value=await (await offlineDatabase()).get("entries",key("audio",id));return validOfflineAudio(value)&&value.track.id===id?value:undefined;},
  allReady:()=>savedAudio(accountId),
  allReadyMetadata:()=>savedAudioMetadata(accountId),
  async finalize(id,audio:OfflineAudio){if(!validOfflineAudio(audio)||audio.track.id!==id)throw new Error("Only complete verified audio can be saved.");const tx=(await offlineDatabase()).transaction("entries","readwrite"),manifest=await tx.store.get(key("download",id)) as PartialDownloadRecord|undefined,existing=await tx.store.get(key("audio",id)) as OfflineAudio|undefined;const requested=audio.requested!==false||!!manifest?.requested||!!(existing&&existing.requested!==false),saved={...audio,requested};await tx.store.put(saved,key("audio",id));await tx.store.put(offlineAudioMetadata(saved),key("audio-meta",id));await tx.store.delete(key("download",id));let cursor=await tx.store.openCursor(range(key("chunk",id+":")));while(cursor){await cursor.delete();cursor=await cursor.continue();}await tx.done;invalidateSavedAudioMetadata(accountId);},
  async promoteRequested(id){const tx=(await offlineDatabase()).transaction("entries","readwrite"),audio=await tx.store.get(key("audio",id)) as OfflineAudio|undefined;if(!validOfflineAudio(audio)||audio.track.id!==id){await tx.done;return;}const promoted={...audio,requested:true};await tx.store.put(promoted,key("audio",id));await tx.store.put(offlineAudioMetadata(promoted),key("audio-meta",id));await tx.store.delete(key("download",id));let cursor=await tx.store.openCursor(range(key("chunk",id+":")));while(cursor){await cursor.delete();cursor=await cursor.continue();}await tx.done;invalidateSavedAudioMetadata(accountId);return promoted;},
  async clear(id,includeReady=false){const tx=(await offlineDatabase()).transaction("entries","readwrite");await tx.store.delete(key("download",id));if(includeReady){await tx.store.delete(key("audio",id));await tx.store.delete(key("audio-meta",id));}let cursor=await tx.store.openCursor(range(key("chunk",id+":")));while(cursor){await cursor.delete();cursor=await cursor.continue();}await tx.done;if(includeReady)invalidateSavedAudioMetadata(accountId);},
  async clearAutomatic(id){const tx=(await offlineDatabase()).transaction("entries","readwrite"),record=await tx.store.get(key("download",id)) as PartialDownloadRecord|undefined,audio=await tx.store.get(key("audio",id)) as OfflineAudio|undefined;if(record?.requested||audio&&audio.requested!==false){await tx.done;return false;}let pin=await tx.store.openCursor(range(key("audio-pin",id+":")));while(pin){if(Number((pin.value as {expiresAt?:number})?.expiresAt)>Date.now()){await tx.done;return false;}await pin.delete();pin=await pin.continue();}await tx.store.delete(key("download",id));await tx.store.delete(key("audio",id));await tx.store.delete(key("audio-meta",id));let cursor=await tx.store.openCursor(range(key("chunk",id+":")));while(cursor){await cursor.delete();cursor=await cursor.continue();}await tx.done;invalidateSavedAudioMetadata(accountId);return true;},
  async pinAutomatic(id,owner,expiresAt){await (await offlineDatabase()).put("entries",{expiresAt,owner},key("audio-pin",id+":"+owner));},
  async releaseAutomaticPin(id,owner){await (await offlineDatabase()).delete("entries",key("audio-pin",id+":"+owner));},
  async releaseAutomaticPins(ownerPrefix){
   if(!ownerPrefix)return;
   const tx=(await offlineDatabase()).transaction("entries","readwrite"),pinPrefix=key("audio-pin","");let cursor=await tx.store.openCursor(range(pinPrefix));
   while(cursor){
    const value=cursor.value as {owner?:unknown},stored=String(cursor.key),marker=stored.lastIndexOf(":"+ownerPrefix),legacyOwner=marker>=0?stored.slice(marker+1):"";
    const matches=typeof value?.owner==="string"?value.owner.startsWith(ownerPrefix):marker>=0&&legacyOwner.startsWith(ownerPrefix)&&legacyOwner.length>ownerPrefix.length&&!legacyOwner.slice(ownerPrefix.length).includes(":");
    if(matches)await cursor.delete();cursor=await cursor.continue();
   }await tx.done;
  },
  async lease(id,owner,expiresAt){const tx=(await offlineDatabase()).transaction("entries","readwrite"),name=key("download-lease",id);const lease=await tx.store.get(name) as {owner:string;expiresAt:number}|undefined;if(lease&&lease.owner!==owner&&lease.expiresAt>Date.now()){await tx.done;return false;}await tx.store.put({owner,expiresAt},name);await tx.done;return true;},
  async release(id,owner){const tx=(await offlineDatabase()).transaction("entries","readwrite"),name=key("download-lease",id);const lease=await tx.store.get(name) as {owner:string}|undefined;if(lease?.owner===owner)await tx.store.delete(name);await tx.done;},
 };
}
