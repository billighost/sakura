import type { DownloadEntry } from "./types";

export function visibleDownloads(entries:DownloadEntry[]):DownloadEntry[]{return entries.filter(entry=>entry.requested!==false);}
/** Playback may begin from cached parts while a requested offline save is unfinished. */
export function currentOfflineSave(recordingId:string,entries:DownloadEntry[]):{kind:"ready"|"saving"|"failed"|"paused"|"unsaved";entry?:DownloadEntry;label:string}{
 const entry=entries.find(item=>item.recordingId===recordingId);
 if(!entry||entry.requested===false)return {kind:"unsaved",entry,label:"This song is not saved for offline listening."};
 if(entry.status==="ready")return {kind:"ready",entry,label:"This song is fully saved for offline listening."};
 if(entry.status==="failed")return {kind:"failed",entry,label:"Your offline save is incomplete. Retry to finish saving."};
 if(entry.status==="paused"||entry.status==="prepared")return {kind:"paused",entry,label:"Your offline save is paused. Resume to finish saving."};
 return {kind:"saving",entry,label:"Your offline save is still in progress."};
}
export function downloadPercent(entry:Pick<DownloadEntry,"downloadedBytes"|"totalBytes">):number|null {
 if(!entry.totalBytes||!Number.isFinite(entry.totalBytes)||entry.totalBytes<=0)return null;
 return Math.max(0,Math.min(100,Math.floor((Number.isFinite(entry.downloadedBytes)?entry.downloadedBytes:0)/entry.totalBytes*100)));
}
export function downloadBytes(value:number){if(!Number.isFinite(value)||value<=0)return "0 MB";return value<1024*1024?Math.ceil(value/1024)+" KB":(value/1024/1024).toFixed(value>=10*1024*1024?0:1)+" MB";}
export function downloadActivityLabel(entry:DownloadEntry):string{
 const saved=entry.downloadedBytes>0?downloadBytes(entry.downloadedBytes)+" saved":"";
 if(entry.status==="failed")return "Save incomplete · Retry to finish";
 if(entry.status==="paused")return "Paused"+(saved?" · "+saved:"");
 if(entry.status==="prepared")return "Opening saved"+(saved?" · "+saved:"");
 if(entry.status==="queued")return saved?"Waiting its turn · "+saved:"Waiting its turn";
 if(entry.status==="resolving")return "Finding your recording";
 const percent=downloadPercent(entry);
 if(entry.status==="downloading"&&percent===100)return "Checking your saved song";
 return (percent===null?"Saving your song":percent+"% saved")+(entry.totalBytes?" · "+downloadBytes(entry.downloadedBytes)+" of "+downloadBytes(entry.totalBytes):"");
}
