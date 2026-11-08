import type {MusicTrack, QueueEntry} from "./types";

export const SESSION_QUEUE_LIMIT=80;
export function localId(){return typeof globalThis.crypto?.randomUUID==="function"?crypto.randomUUID():"00000000-0000-4000-8000-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);}
export interface ListeningSession {
 queue:QueueEntry[];
 currentEntryId:string|null;
 positionMs:number;
 sleepUntil:number|null;
}
export interface SessionRecord {state:ListeningSession;revision:number;deviceId:string;updatedAt:number}
export interface SessionDraft extends SessionRecord {pending:boolean;savedAt:number;intent?:boolean;intentAt?:number;clockOffset?:number}

/** Persist catalog identity, never expiring stream addresses or device blob URLs. */
export function portableTrack(track:MusicTrack):MusicTrack {
 const {audioUrl:_,readyPlayback:__,...card}=track;
 void _;void __;
 return card;
}
export function sessionState(queue:QueueEntry[],currentEntryId:string|null,positionMs:number,sleepUntil:number|null):ListeningSession {
 const index=Math.max(0,queue.findIndex(entry=>entry.entryId===currentEntryId));
 const start=Math.max(0,index-Math.floor(SESSION_QUEUE_LIMIT/2));
 const entries=queue.slice(start,start+SESSION_QUEUE_LIMIT).map(entry=>({...entry,track:portableTrack(entry.track)}));
 return {queue:entries,currentEntryId:entries.some(entry=>entry.entryId===currentEntryId)?currentEntryId:null,positionMs:Math.max(0,Math.floor(positionMs)),sleepUntil};
}
