import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { topSongs } from "../src/rebuild/app/topSongs";
import { sortRoomTracks } from "../src/rebuild/app/trackSorting";
import { roomPresentation } from "../src/rebuild/app/collectionPresentation";
import { collectionView } from "../src/rebuild/data/collectionViews";
import { getListeningInsights } from "../src/rebuild/data/listeningInsights";

const cards=Array.from({length:55},(_,i)=>({id:`80000000-0000-4000-8000-${String(i+300).padStart(12,"0")}`,title:`Song ${i+1}`,artists:[`Artist ${55-i}`],albumTitle:`Album ${55-i}`,durationMs:180000,reference:{provider:"deezer",id:String(i+300)},audibleMs:(55-i)*60000,playCount:i+1,lastPlayedAt:new Date(Date.UTC(2026,10,i+1)).toISOString()}));

test("top songs retain real measurements and select the top 50 before other sorting",()=>{
 const tracks=topSongs([...cards].reverse());
 assert.equal(tracks.length,50);assert.equal(tracks[0].id,cards[0].id);assert.equal(tracks.at(-1)!.id,cards[49].id);
 assert.equal(sortRoomTracks(tracks,"plays")[0].id,cards[49].id);
 assert.equal(sortRoomTracks(tracks,"recent")[0].id,cards[49].id);
 assert.equal(sortRoomTracks(tracks,"artist")[0].id,cards[49].id);
 assert.equal(sortRoomTracks(tracks,"album")[0].id,cards[49].id);
 assert.equal(sortRoomTracks(tracks,"kept","desc")[0].id,cards[49].id);
 assert.equal(tracks[0].id,cards[0].id,"Sorting must preserve the ranked source");
});

test("malformed, duplicate and unheard cards never fill the personal mix",()=>{
 const result=topSongs([{...cards[0],audibleMs:"120000",playCount:"4",lastPlayedAt:"invalid"},cards[0],{...cards[1],audibleMs:Infinity},{...cards[2],audibleMs:0},{title:"No identity",audibleMs:120000}]);
 assert.equal(result.length,1);assert.equal(result[0].audibleMs,120000);assert.equal(result[0].playCount,4);assert.equal(result[0].lastPlayedAt,null);
});

test("listening sort preferences survive both client and account validation",()=>{
 for(const sort of ["plays","album","recent"] as const){
  const preference={layout:"compact" as const,sort,direction:"desc" as const};
  assert.deepEqual(roomPresentation(preference),preference);assert.deepEqual(collectionView(preference),preference);
 }
});

test("profile hydrates 50 ranked songs with metrics joined by recording identity",async()=>{
 const accountId="90000000-0000-4000-8000-000000000300";
 let requestedIds:string[]=[];
 const query=(async(statement:string,args:unknown[])=>{
  assert.equal(args[0],accountId,"Every projection stays scoped to its listener");
  if(statement.includes("WITH days AS"))return {rows:[{days:[],hours:[],genres:[],totals:{events:55,finished:0,completed:0,skipped:0,activeDays:1,uniqueRecordings:55}}]};
  if(statement.includes("hourly AS"))return {rows:cards.map(card=>({recordingId:card.id,audibleMs:String(card.audibleMs),playCount:String(card.playCount),completedCount:"0",skippedCount:"0",lastPlayedAt:card.lastPlayedAt,hourWeights:[]}))};
  if(statement.includes('"TasteFeedback"'))return {rows:[]};
  if(statement.startsWith("SELECT r.id")){
   requestedIds=args[1] as string[];
   return {rows:cards.filter(card=>requestedIds.includes(card.id)).reverse().map(card=>({id:card.id,metadata:{title:card.title,artists:card.artists,durationMs:card.durationMs},references:[card.reference],provenance:{},ready:false}))};
  }
  throw new Error("Unexpected projection query");
 }) as unknown as PoolClient["query"];
 const insights=await getListeningInsights(accountId,"Africa/Lagos",{query});
 assert.equal(requestedIds.length,50);assert.equal(insights.topSongs.length,50);assert.equal(insights.tasteEvidence.length,55);
 assert.deepEqual(insights.topSongs.map(song=>song.id),cards.slice(0,50).map(song=>song.id));
 for(const [i,song] of insights.topSongs.entries()){
  assert.equal(song.audibleMs,cards[i].audibleMs);assert.equal(song.playCount,cards[i].playCount);assert.equal(song.lastPlayedAt,cards[i].lastPlayedAt);
 }
});
