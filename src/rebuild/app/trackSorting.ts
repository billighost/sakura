export type RoomSort = "kept" | "title" | "artist" | "duration" | "added" | "plays" | "album" | "recent";
export type RoomSortDirection = "asc" | "desc";

type SortableTrack = {title:string;artists:string[];durationMs:number;addedAt?:string|number|null;albumTitle?:string|null;playCount?:number;lastPlayedAt?:string|null};
const collator=new Intl.Collator(undefined,{sensitivity:"base",numeric:true});

function addedTime(track:SortableTrack):number|null {
 const value=typeof track.addedAt==="number"?track.addedAt:typeof track.addedAt==="string"?Date.parse(track.addedAt):NaN;
 return Number.isFinite(value)?value:null;
}

/** Reverse the displayed order without changing the collection or its saved positions. */
export function sortRoomTracks<T extends SortableTrack>(tracks:readonly T[],sort:RoomSort,direction:RoomSortDirection="asc"):T[] {
 const ordered=[...tracks];
 if(sort!=="kept")ordered.sort((a,b)=>{
  if(sort==="added"){
   const first=addedTime(a),second=addedTime(b);
   return first===null?(second===null?0:1):second===null?-1:second-first;
  }
  if(sort==="duration")return (Number.isFinite(a.durationMs)?a.durationMs:0)-(Number.isFinite(b.durationMs)?b.durationMs:0);
  if(sort==="plays")return (Number.isFinite(b.playCount)?b.playCount!:0)-(Number.isFinite(a.playCount)?a.playCount!:0);
  if(sort==="recent"){
   const first=a.lastPlayedAt?Date.parse(a.lastPlayedAt):NaN,second=b.lastPlayedAt?Date.parse(b.lastPlayedAt):NaN;
   return !Number.isFinite(first)?(!Number.isFinite(second)?0:1):!Number.isFinite(second)?-1:second-first;
  }
  if(sort==="album")return collator.compare(a.albumTitle||"",b.albumTitle||"")||collator.compare(a.title,b.title);
  return collator.compare(sort==="artist"?a.artists.join(" "):a.title,sort==="artist"?b.artists.join(" "):b.title)||collator.compare(a.title,b.title);
 });
 return direction==="desc"?ordered.reverse():ordered;
}
