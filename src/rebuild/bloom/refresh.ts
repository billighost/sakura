import type {BloomRecap} from "./uiTypes";
import {resumeBloomIndex} from "./story";

function experienceIdentity(recap:BloomRecap){const value=recap.experience;return value?JSON.stringify([value.version,value.seed,value.composition,value.palette,value.tempo,value.copyVariant,value.opening,value.closing,value.finaleTitle]):null;}

/** A derived story's creation date distinguishes a rebuilt period after erasure.
 * Older archives lack that field; their immutable chapter structure is retained. */
export function sameBloomStory(current:BloomRecap,incoming:BloomRecap){
 if(current.snapshotCreatedAt&&incoming.snapshotCreatedAt&&current.snapshotCreatedAt!==incoming.snapshotCreatedAt)return false;
 if(experienceIdentity(current)!==experienceIdentity(incoming))return false;
 return current.id===incoming.id&&current.version===incoming.version&&current.timeZone===incoming.timeZone&&current.periodStart===incoming.periodStart&&current.periodEnd===incoming.periodEnd&&current.worldId===incoming.worldId&&current.summary.audibleMs===incoming.summary.audibleMs&&current.summary.playCount===incoming.summary.playCount&&current.summary.recordingCount===incoming.summary.recordingCount&&current.summary.activeDays===incoming.summary.activeDays&&current.chapters.length===incoming.chapters.length&&current.chapters.every((chapter,index)=>chapter.id===incoming.chapters[index]?.id);
}

/** Background reads may add server reveals, but cannot conceal a chapter the
 * current journey opened or replace it with an older partial response. */
export function mergeBloomRefresh(current:BloomRecap,incoming:BloomRecap):BloomRecap{
 if(!sameBloomStory(current,incoming))return incoming;
 const disclosed=Object.fromEntries(Object.entries(current.listening||{}).filter(([,value])=>value!==undefined));
 return {...incoming,chapters:incoming.chapters.map((chapter,index)=>current.chapters[index].revealed?current.chapters[index]:chapter),listening:current.listening||incoming.listening?{...incoming.listening,...disclosed,timeZone:current.timeZone}:undefined,completed:Boolean(current.completed||incoming.completed),completedAt:current.completedAt||incoming.completedAt};
}

/** A saved reading position belongs to the particular generated story. */
export function bloomProgressRecord(recap:BloomRecap,index:number){return {index,version:recap.version||1,snapshotCreatedAt:recap.snapshotCreatedAt,experienceSeed:recap.experience?.seed,experienceVersion:recap.experience?.version};}

export function restoredBloomIndex(recap:BloomRecap,stored:unknown){
 if(!stored||typeof stored!=="object"||Array.isArray(stored))return 0;
 const record=stored as Record<string,unknown>;
 if(record.version!==undefined&&record.version!==(recap.version||1))return 0;
 if(record.snapshotCreatedAt!==undefined&&record.snapshotCreatedAt!==recap.snapshotCreatedAt)return 0;
 if(recap.experience&&(record.experienceSeed!==recap.experience.seed||record.experienceVersion!==recap.experience.version))return 0;
 if(!recap.experience&&(record.experienceSeed!==undefined||record.experienceVersion!==undefined))return 0;
 return resumeBloomIndex(recap,typeof record.index==="number"?record.index:0);
}
