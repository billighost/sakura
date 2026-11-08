import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {sessionPatch} from "../src/rebuild/data/session";
import {sessionState,SESSION_QUEUE_LIMIT} from "../src/rebuild/app/sessionState";
import {preferencesPatch,ProductError,DEFAULT_SETTINGS} from "../src/rebuild/data/validation";
import type {MusicTrack} from "../src/rebuild/app/types";
import {settingsFields,unacknowledgedPreferences} from "../src/rebuild/app/preferences";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {favoriteOverlay,acknowledgeFavorite,type FavoriteIntent} from "../src/rebuild/app/favorites";

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
test("malformed cached preferences cannot break player hydration or leak unsupported state",()=>{
 assert.deepEqual(settingsFields({theme:"unknown",volume:2,previewVolume:NaN,shuffle:"false",onboarded:"true",seedArtists:[null],sleepTimerMinutes:-1,openingAnimation:7,timeZone:"invalid",downloads:[track],revision:99}),{});
 assert.deepEqual(settingsFields({theme:"dark",volume:0,onboarded:true,shuffle:false,previewLoop:false,sleepTimerMinutes:180,timeZone:"Africa/Lagos"}),{theme:"dark",timeZone:"Africa/Lagos",onboarded:true,volume:0,shuffle:false,previewLoop:false,sleepTimerMinutes:180});
});
test("Sakura opening defaults on only when the preference is unset",()=>{
 assert.equal(DEFAULT_SETTINGS.openingAnimation,1);
 assert.deepEqual(settingsFields({openingAnimation:0}),{openingAnimation:0});
 assert.deepEqual({...DEFAULT_SETTINGS,...settingsFields({openingAnimation:0})},{...DEFAULT_SETTINGS,openingAnimation:0});
});
test("preference acknowledgement removes sent fields while preserving newer edits",()=>{
 assert.deepEqual(unacknowledgedPreferences({volume:.2,theme:"dark",repeat:"all"},{volume:.8,theme:"dark"}),{volume:.2,repeat:"all"});
 assert.deepEqual(unacknowledgedPreferences({seedArtists:["Rihanna"]},{seedArtists:["Rihanna"]}),{});
});
test("first-paint theme uses only the active account cache and tolerates storage damage",()=>{
 const source=readFileSync("src/app/layout.tsx","utf8").match(/const themeScript = `([^`]+)`;/)?.[1];assert.ok(source);
 const render=(values:Record<string,string>,deviceDark=false,blocked=false)=>{const document={documentElement:{dataset:{} as Record<string,string>}};vm.runInNewContext(source,{document,localStorage:{getItem:(key:string)=>{if(blocked)throw new Error("blocked");return values[key]||null;}},matchMedia:()=>({matches:deviceDark})});return document.documentElement.dataset.inkTheme;};
 const cache={"sakura-v2-active-account":"a","sakura-v2-preferences:a":JSON.stringify({settings:{theme:"dark"}})};
 assert.equal(render(cache),"dark");assert.equal(render({...cache,"sakura-v2-preferences:a":JSON.stringify({settings:{theme:"light"}})},true),"light");
 assert.equal(render({"sakura-v2-active-account":"b","sakura-v2-theme":"dark"}),"light");
 assert.equal(render({...cache,"sakura-v2-preferences:a":"{"}),"light");assert.equal(render({},true,true),"dark");
});
test("offline favorite intentions overlay remote reads and follow resolved recording identity",()=>{
 const intent:FavoriteIntent={track,liked:true,operationId:randomUUID()};
 assert.deepEqual([...favoriteOverlay([], {[track.id]:intent})],[track.id]);
 assert.deepEqual([...favoriteOverlay([track.id],{[track.id]:{...intent,liked:false}})],[]);
 const canonical=randomUUID();assert.deepEqual([...favoriteOverlay([track.id],{[track.id]:intent},()=>canonical)],[canonical]);
});
test("favorite acknowledgement never clears a newer offline intention",()=>{
 const intent:FavoriteIntent={track,liked:true,operationId:randomUUID()},newer={...intent,liked:false,operationId:randomUUID()};
 assert.deepEqual(acknowledgeFavorite({[track.id]:intent},track.id,intent.operationId),{});
 assert.deepEqual(acknowledgeFavorite({[track.id]:newer},track.id,intent.operationId),{[track.id]:newer});
});
