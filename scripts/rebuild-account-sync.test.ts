import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {sessionPatch} from "../src/rebuild/data/session";
import {sessionState,SESSION_QUEUE_LIMIT} from "../src/rebuild/app/sessionState";
import {preferencesPatch,ProductError} from "../src/rebuild/data/validation";
import type {MusicTrack} from "../src/rebuild/app/types";

const track:MusicTrack={id:randomUUID(),title:"Ye",artists:["Burna Boy"],durationMs:180000,albumId:null,artistId:null,albumTitle:null,coverUrl:null,versionLabel:"Original recording",reference:{provider:"deezer",id:"1"},references:[{provider:"deezer",id:"1"}],audioUrl:"blob:device-only",explicit:true};
const first={entryId:randomUUID(),track,priority:"automatic" as const},second={entryId:randomUUID(),track:{...track,id:randomUUID(),title:"Work",artists:["Rihanna"]},priority:"manual" as const};
const payload=()=>({deviceId:randomUUID(),revision:0,state:sessionState([first,second],second.entryId,24000,null)});

test("portable listening session keeps the previous song and exact queue occurrences",()=>{
 const parsed=sessionPatch(payload());assert.equal(parsed.state.queue[0].track.title,"Ye");assert.equal(parsed.state.queue[1].track.title,"Work");assert.equal(parsed.state.currentEntryId,second.entryId);assert.equal(parsed.state.positionMs,24000);assert.equal(parsed.state.queue[0].track.audioUrl,undefined);assert.equal(parsed.state.queue[0].track.readyPlayback,undefined);assert.equal(parsed.state.queue[0].track.explicit,true);
});
test("bounded sessions retain the current song, earlier history, and future picks",()=>{
 const queue=Array.from({length:140},()=>({...first,entryId:randomUUID()}));const state=sessionState(queue,queue[100].entryId,1500,null);assert.equal(state.queue.length,SESSION_QUEUE_LIMIT);assert.equal(state.queue.findIndex(e=>e.entryId===state.currentEntryId),40);assert.equal(state.queue[39].entryId,queue[99].entryId);
});
test("session rejects malformed identities, duplicate occurrences, and invalid position",()=>{
 const raw=payload();assert.throws(()=>sessionPatch({...raw,revision:-1}),ProductError);assert.throws(()=>sessionPatch({...raw,deviceId:"wrong"}),ProductError);
 assert.throws(()=>sessionPatch({...raw,state:{...raw.state,queue:[first,first]}}),ProductError);
 assert.throws(()=>sessionPatch({...raw,state:{...raw.state,currentEntryId:randomUUID()}}),ProductError);
 assert.throws(()=>sessionPatch({...raw,state:{...raw.state,positionMs:999999}}),ProductError);
 assert.throws(()=>sessionPatch({...raw,state:{...raw.state,queue:[{...first,track:{...track,reference:{provider:"bad",id:"1"}}}]}}),ProductError);
});
test("all persisted playback preferences validate and device downloads are excluded",()=>{
 assert.deepEqual(preferencesPatch({volume:0,shuffle:true,repeat:"one",previewVolume:.35,previewLoop:false,sleepTimerMinutes:30}),{repeat:"one",shuffle:true,previewLoop:false,volume:0,previewVolume:.35,sleepTimerMinutes:30});
 for(const value of [{volume:NaN},{volume:1.1},{previewVolume:-1},{shuffle:1},{repeat:"forever"},{sleepTimerMinutes:0},{downloads:[]}])assert.throws(()=>preferencesPatch(value),ProductError);
});
