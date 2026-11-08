import assert from "node:assert/strict";
import test from "node:test";
import {sortRoomTracks,type RoomSort} from "../src/rebuild/app/trackSorting";

const tracks=Object.freeze([
 {id:"first",title:"Song 10",artists:["Beta"],durationMs:3000,addedAt:"2026-01-01T00:00:00Z"},
 {id:"second",title:"song 2",artists:["Alpha"],durationMs:1000,addedAt:Date.parse("2026-01-03T00:00:00Z")},
 {id:"third",title:"Another song",artists:["Alpha"],durationMs:2000,addedAt:"2026-01-02T00:00:00Z"},
]);
const ids=(items:{id:string}[])=>items.map(item=>item.id);

test("title and artist use natural text order, with song title breaking artist ties",()=>{
 assert.deepEqual(ids(sortRoomTracks(tracks,"title")),["third","second","first"]);
 assert.deepEqual(ids(sortRoomTracks(tracks,"artist")),["third","second","first"]);
 assert.deepEqual(ids(sortRoomTracks(tracks,"duration")),["second","third","first"]);
});
test("collection order and all sorted views reverse exactly without changing the source",()=>{
 for(const sort of ["kept","title","artist","duration","added"] satisfies RoomSort[]){
  const normal=sortRoomTracks(tracks,sort);
  assert.notEqual(normal,tracks);
  assert.deepEqual(sortRoomTracks(tracks,sort,"desc"),[...normal].reverse());
 }
 assert.deepEqual(ids([...tracks]),["first","second","third"]);
});
test("date order uses actual ISO or millisecond timestamps, newest first",()=>{
 assert.deepEqual(ids(sortRoomTracks(tracks,"added")),["second","third","first"]);
 assert.deepEqual(ids(sortRoomTracks(tracks,"added","desc")),["first","third","second"]);
});
test("missing and invalid dates preserve their collection order after dated songs",()=>{
 const undated=[{...tracks[0],id:"missing",addedAt:undefined},{...tracks[1],id:"invalid",addedAt:"invalid"},{...tracks[2],id:"infinite",addedAt:Infinity}];
 assert.deepEqual(ids(sortRoomTracks([...undated,...tracks],"added")),["second","third","first","missing","invalid","infinite"]);
 const sameDate=tracks.map(track=>({...track,addedAt:"2026-01-01T00:00:00Z"}));
 assert.deepEqual(sortRoomTracks(sameDate,"added"),sameDate);
});
