import type {MusicTrack,QueueEntry} from "./types";

/** A generated continuation cannot remove intentional choices or repeat queued songs. */
export function smartContinuation(existing:readonly QueueEntry[],tracks:readonly MusicTrack[],identify:(track:MusicTrack)=>string,entryId:()=>string,limit=80,localOnly=false):QueueEntry[] {
 const seen=new Set(existing.map(entry=>identify(entry.track)));
 const additions:QueueEntry[]=[];
 for(const track of tracks){const id=identify(track);if(seen.has(id))continue;seen.add(id);if(existing.length+additions.length>=limit)break;additions.push({entryId:entryId(),track,priority:"automatic",...(localOnly?{localOnly:true}:{})});}
 return [...existing,...additions];
}
