import type {BloomRecap} from "./uiTypes";

/** A derived story's creation date distinguishes a rebuilt period after erasure.
 * Older archives lack that field; their immutable chapter structure is retained. */
export function sameBloomStory(current:BloomRecap,incoming:BloomRecap){
 if(current.snapshotCreatedAt&&incoming.snapshotCreatedAt&&current.snapshotCreatedAt!==incoming.snapshotCreatedAt)return false;
 return current.id===incoming.id&&current.version===incoming.version&&current.timeZone===incoming.timeZone&&current.periodStart===incoming.periodStart&&current.periodEnd===incoming.periodEnd&&current.worldId===incoming.worldId&&current.summary.audibleMs===incoming.summary.audibleMs&&current.summary.playCount===incoming.summary.playCount&&current.summary.recordingCount===incoming.summary.recordingCount&&current.summary.activeDays===incoming.summary.activeDays&&current.chapters.length===incoming.chapters.length&&current.chapters.every((chapter,index)=>chapter.id===incoming.chapters[index]?.id);
}

/** Background reads may add server reveals, but cannot conceal a chapter the
 * current journey opened or replace it with an older partial response. */
export function mergeBloomRefresh(current:BloomRecap,incoming:BloomRecap):BloomRecap{
 if(!sameBloomStory(current,incoming))return incoming;
 return {...incoming,chapters:incoming.chapters.map((chapter,index)=>current.chapters[index].revealed?current.chapters[index]:chapter),listening:current.listening||incoming.listening?{...incoming.listening,...current.listening,timeZone:current.timeZone}:undefined,completed:Boolean(current.completed||incoming.completed),completedAt:current.completedAt||incoming.completedAt};
}
