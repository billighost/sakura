import { musicTrack, type MusicTrack } from "./types";

export interface TopSong extends MusicTrack {
 audibleMs:number;
 playCount:number;
 lastPlayedAt:string|null;
}
const positive=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

/** Keep listening measurements beside the playable card at the API boundary. */
export function topSongs(values:readonly Record<string,unknown>[]):TopSong[] {
 const songs=new Map<string,TopSong>();
 for(const value of values){
  try{
   const track=musicTrack(value),audibleMs=positive(value.audibleMs);
   if(!audibleMs||songs.has(track.id))continue;
   songs.set(track.id,{...track,audibleMs,playCount:Math.floor(positive(value.playCount)),lastPlayedAt:typeof value.lastPlayedAt==="string"&&Number.isFinite(Date.parse(value.lastPlayedAt))?value.lastPlayedAt:null});
  }catch{/* A card without a catalog reference cannot be played. */}
 }
 return [...songs.values()].sort((a,b)=>b.audibleMs-a.audibleMs).slice(0,50);
}

export function topSongListeningTime(ms:number):string {
 const seconds=Math.floor(positive(ms)/1000),minutes=Math.floor(seconds/60);
 if(minutes>=60)return `${Math.floor(minutes/60)}h${minutes%60?` ${minutes%60}m`:""}`;
 return minutes?`${minutes}m`:seconds?`${seconds}s`:"<1s";
}
