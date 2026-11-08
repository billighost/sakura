export type RoomSort = "kept" | "title" | "artist" | "duration" | "added";
export type RoomSortDirection = "asc" | "desc";

type SortableTrack = {title:string;artists:string[];durationMs:number;addedAt?:string|number|null};
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
  return collator.compare(sort==="artist"?a.artists.join(" "):a.title,sort==="artist"?b.artists.join(" "):b.title)||collator.compare(a.title,b.title);
 });
 return direction==="desc"?ordered.reverse():ordered;
}
