import type {MusicTrack, QueueEntry} from "./types";

export const SESSION_QUEUE_LIMIT=80;
export function localId(){return typeof globalThis.crypto?.randomUUID==="function"?crypto.randomUUID():"00000000-0000-4000-8000-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);}
export interface ListeningSession {
 queue:QueueEntry[];
 currentEntryId:string|null;
 positionMs:number;
 sleepUntil:number|null;
}
export interface SessionRecord {state:ListeningSession;revision:number;deviceId:string;updatedAt:number;choiceAt?:number;queueKey?:string}
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

export const SESSION_BODY_LIMIT=1024*1024;
export const SESSION_KEEPALIVE_BUDGET=48*1024;
/** The server hashes this occurrence identity; artwork and position do not
 * change which acknowledged queue a checkpoint is permitted to update. */
export function sessionQueueIdentity(state:ListeningSession):string {
 return JSON.stringify(state.queue.map(entry=>[entry.entryId,entry.track.id,entry.priority??"automatic",entry.localOnly===true,entry.context??null,entry.contextId??null]));
}
export interface CompactSessionState {version:2;tracks:MusicTrack[];queue:Array<[string,number,string?,boolean?,string?,string?]>;currentEntryId:string|null;positionMs:number;sleepUntil:number|null}
export function compactSessionState(state:ListeningSession):CompactSessionState {
 const tracks:MusicTrack[]=[],indices=new Map<string,number>();
 const queue=state.queue.map(entry=>{const track=portableTrack(entry.track),key=JSON.stringify(track);let index=indices.get(key);if(index===undefined){index=tracks.length;indices.set(key,index);tracks.push(track);}
  return [entry.entryId,index,entry.priority,entry.localOnly,entry.context,entry.contextId] as CompactSessionState["queue"][number];});
 return {version:2,tracks,queue,currentEntryId:state.currentEntryId,positionMs:state.positionMs,sleepUntil:state.sleepUntil};
}
/** Expansion precedes the existing authoritative field validation. */
export function expandSessionState(value:unknown):unknown {
 const raw=value as Partial<CompactSessionState>|null;
 if(!raw||raw.version!==2||!Array.isArray(raw.tracks)||raw.tracks.length>SESSION_QUEUE_LIMIT||!Array.isArray(raw.queue)||raw.queue.length>SESSION_QUEUE_LIMIT)throw new Error("Invalid compact listening queue");
 const queue=raw.queue.map(entry=>{if(!Array.isArray(entry)||entry.length<2||entry.length>6||!Number.isInteger(entry[1])||entry[1]<0||entry[1]>=raw.tracks!.length)throw new Error("Invalid compact queue entry");
  const [entryId,index,priority,localOnly,context,contextId]=entry;return {entryId,track:raw.tracks![index],...(priority!=null?{priority}:{}),...(localOnly!=null?{localOnly}:{}),...(context!=null?{context}:{}),...(contextId!=null?{contextId}:{})};});
 return {queue,currentEntryId:raw.currentEntryId,positionMs:raw.positionMs,sleepUntil:raw.sleepUntil};
}
export interface SessionSendOptions {protocol?:number;queueKey?:string;checkpoint?:boolean;keepalive?:boolean;revision:number;deviceId:string;explicit:boolean;intentAt?:number}
/** Full choices remain durable locally if the browser's shared keepalive
 * quota cannot carry them. Ordinary foreground uploads have a separate,
 * explicit bound; passive checkpoints never resend acknowledged artwork. */
export async function sessionRequestBody(state:ListeningSession,options:SessionSendOptions):Promise<string|null> {
 const {protocol=1,queueKey,checkpoint=false,keepalive=false,...metadata}=options;
 let payload:Record<string,unknown>;
 if(protocol>=2&&checkpoint&&queueKey)payload={protocol:2,...metadata,checkpoint:{queueKey,currentEntryId:state.currentEntryId,positionMs:state.positionMs,sleepUntil:state.sleepUntil}};
 else if(protocol>=2){
  const compact=compactSessionState(state),source=JSON.stringify(compact),bytes=new TextEncoder().encode(source);
  if(bytes.byteLength>SESSION_BODY_LIMIT)throw new Error("The listening queue exceeds the supported storage envelope");
  payload={protocol:2,...metadata,state:compact};
  if(bytes.byteLength>4096&&typeof CompressionStream!=="undefined"){
   const compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
   let binary="";for(let offset=0;offset<compressed.length;offset+=16384)binary+=String.fromCharCode(...compressed.subarray(offset,offset+16384));
   const packed=btoa(binary);if(packed.length+64<source.length)payload={protocol:2,...metadata,packed};
  }
 }else payload={...metadata,state};
 const body=JSON.stringify(payload),length=new TextEncoder().encode(body).byteLength;
 if(length>SESSION_BODY_LIMIT)throw new Error("The listening queue exceeds the supported request envelope");
 return keepalive&&length>SESSION_KEEPALIVE_BUDGET?null:body;
}
