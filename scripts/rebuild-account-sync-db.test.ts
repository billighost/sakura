import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after,before,test} from "node:test";
import {getRebuildPool,readAccountById} from "../src/rebuild/data/db";
import {getSession,putSession} from "../src/rebuild/data/session";
import {getSettings,patchSettings} from "../src/rebuild/data/settings";
import {createPlaylist,listPlaylists,getPlaylist,mutatePlaylistTracks,updatePlaylist} from "../src/rebuild/data/collections";
import {recordHistory,getHistory} from "../src/rebuild/data/history";

const accounts=[randomUUID(),randomUUID()],deviceA=randomUUID(),deviceB=randomUUID(),schema="sakura_sync_test_"+randomUUID().replaceAll("-","");
const pool=getRebuildPool(),rewrite=(text:unknown)=>typeof text==="string"?text.replaceAll("sakura_v2",schema):text;
const scoped=new Proxy(pool,{get(target,key){
 if(key==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(statement),...args]);
 if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,key){if(key==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(statement),...args]);const value=Reflect.get(connection,key);return typeof value==="function"?value.bind(connection):value;}});};
 const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=scoped;
before(async()=>{
 // Warm a cold remote connection through the app's bounded read-only retry.
 await readAccountById(accounts[0]);
 for(const path of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])await pool.query((await readFile(path,"utf8")).replaceAll("sakura_v2",schema));
 for(const id of accounts)await pool.query('INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,\'test-only\',now())',[id,"sync_"+id.slice(0,16),id+"@example.invalid"]);
});
after(async()=>{try{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.query('DELETE FROM public."User" WHERE id=ANY($1::uuid[])',[accounts]);}finally{await pool.end();}});
const state={queue:[],currentEntryId:null,positionMs:0,sleepUntil:null};
test("account session compare-and-swap rejects stale devices and accepts exact retries",async()=>{
 assert.equal((await getSession(accounts[0])).session,null);
 const first=await putSession(accounts[0],{state,deviceId:deviceA,revision:0});assert.equal(first.accepted,true);assert.equal(first.session?.revision,1);
 const retry=await putSession(accounts[0],{state,deviceId:deviceA,revision:0});assert.equal(retry.accepted,true);assert.equal(retry.session?.revision,1);
 const changed={...state,sleepUntil:Date.now()+60000};const second=await putSession(accounts[0],{state:changed,deviceId:deviceB,revision:1});assert.equal(second.accepted,true);assert.equal(second.session?.revision,2);
 const stale=await putSession(accounts[0],{state,deviceId:deviceA,revision:1});assert.equal(stale.accepted,false);assert.equal(stale.session?.deviceId,deviceB);assert.equal(stale.session?.state.sleepUntil,changed.sleepUntil);
 assert.equal((await getSession(accounts[1])).session,null);
});
test("simultaneous session writes have one winner",async()=>{
 const results=await Promise.all([deviceA,deviceB].map(deviceId=>putSession(accounts[1],{state,deviceId,revision:0})));assert.equal(results.filter(result=>result.accepted).length,1);assert.equal((await getSession(accounts[1])).session?.revision,1);
});
test("account playback settings persist independently",async()=>{
 await patchSettings(accounts[0],{volume:.27,shuffle:true,repeat:"all",previewLoop:false,previewVolume:.41,sleepTimerMinutes:60});const saved=await getSettings(accounts[0]);assert.equal(saved.volume,.27);assert.equal(saved.shuffle,true);assert.equal(saved.repeat,"all");assert.equal(saved.previewLoop,false);assert.equal((await getSettings(accounts[1])).volume,.8);
});
test("retried playlist creation creates one account-owned collection",async()=>{
 const requestId=randomUUID();const results=await Promise.all(Array.from({length:4},()=>createPlaylist(accounts[0],{name:"A shared device",requestId})));assert.equal(new Set(results.map(p=>p.id)).size,1);assert.equal((await listPlaylists(accounts[0])).length,1);await assert.rejects(()=>createPlaylist(accounts[1],{name:"A shared device",requestId}));
});
test("a full playlist accepts repeated additions and only changes revision for new state",async()=>{
 const ids=Array.from({length:2001},()=>randomUUID());
 const fixtures=ids.map((id,index)=>({id,metadata:{title:"Sync fixture "+index,artists:["Synthetic Artist"],durationMs:180000}}));
 await scoped.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified' FROM jsonb_to_recordset($1::jsonb) x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
 await scoped.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer',x.id::text,x.id,now() FROM unnest($1::uuid[]) x(id)`,[ids]);
 const playlist=await createPlaylist(accounts[0],{name:"Full collection"});
 await scoped.query(`INSERT INTO sakura_v2."PlaylistRecording"(playlist_id,recording_id,position) SELECT $1::uuid,x.id,x.position-1 FROM unnest($2::uuid[]) WITH ORDINALITY x(id,position)`,[playlist.id,ids.slice(0,2000)]);
 const before=await getPlaylist(accounts[0],playlist.id);
 const repeated=await Promise.all(Array.from({length:4},()=>mutatePlaylistTracks(accounts[0],playlist.id,{recordingIds:ids.slice(0,4)})));
 assert.ok(repeated.every(result=>result.trackCount===2000&&result.revision===before.revision));
 await assert.rejects(()=>mutatePlaylistTracks(accounts[0],playlist.id,{recordingIds:[ids[0],ids[2000]]}),{status:400});
 const same=await updatePlaylist(accounts[0],playlist.id,{name:"Full collection",recordingIds:ids.slice(0,2000)});
 assert.equal(same.revision,before.revision);
 const removed=await mutatePlaylistTracks(accounts[0],playlist.id,{recordingId:ids[1]},true);
 const retried=await mutatePlaylistTracks(accounts[0],playlist.id,{recordingId:ids[1]},true);
 assert.equal(retried.revision,removed.revision);
 assert.equal(retried.trackCount,1999);
 await assert.rejects(()=>mutatePlaylistTracks(accounts[1],playlist.id,{recordingId:ids[0]}),{status:404});
});
test("two devices deliver history chunks exactly once and retain account ownership",async()=>{
 const row=await scoped.query('SELECT id FROM sakura_v2."Recording" ORDER BY id LIMIT 1');
 const recordingId=row.rows[0].id,eventId=randomUUID();
 const chunk={eventId,recordingId,sequence:0,msPlayed:4000,positionMs:4000,occurredAt:new Date(Date.now()-20000).toISOString()};
 const results=await Promise.all(Array.from({length:4},()=>recordHistory(accounts[0],chunk)));
 assert.equal(results.filter(result=>"duplicate" in result&&result.duplicate).length,3);
 await recordHistory(accounts[0],{...chunk,sequence:1,msPlayed:2500,positionMs:6500,finished:true});
 const history=await getHistory(accounts[0],new URL("http://localhost/api?limit=10"));
 assert.equal(history.events.length,1);assert.equal(history.events[0].audibleMs,6500);
 assert.equal((await getHistory(accounts[1],new URL("http://localhost/api"))).events.length,0);
 await assert.rejects(()=>recordHistory(accounts[0],{...chunk,msPlayed:4500}),{status:409});
});
