import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {after,before,describe,it} from "node:test";
import {getRebuildPool} from "../src/rebuild/data/db";
import {recordHistory,compactHistory} from "../src/rebuild/data/history";
import {syncCatalog} from "../src/rebuild/data/catalog";
import {patchSettings} from "../src/rebuild/data/settings";
import {setTaste} from "../src/rebuild/data/taste";
import {clearPersonalizationData} from "../src/rebuild/data/personalization";
import {getBloom,listBloom,listBloomShelf,revealBloom,completeBloom,archivedBloom} from "../src/rebuild/bloom/service";
import {bloomShelfItems} from "../src/rebuild/bloom/shelf";
import {ProductError} from "../src/rebuild/data/validation";
import type {BloomListeningProfile} from "../src/rebuild/bloom/uiTypes";

const accounts=Array.from({length:7},()=>randomUUID()),[first,second,unknown,legacy,revealRace,completeRace,unmapped]=accounts;
const ids=Array.from({length:4},()=>randomUUID()),prefix=randomUUID().replaceAll("-",""),schema=`sakura_bloom_test_${prefix}`;
const actual=getRebuildPool();
const journal=`.local/bloom-db-fixture-${prefix}.json`;
const recordFixture=(status:string)=>writeFile(journal,JSON.stringify({schema,accounts,status},null,2));
let beforeQuery:((statement:string,args:unknown[])=>Promise<void>)|undefined;
const rewrite=(statement:unknown)=>typeof statement==="string"?statement.replaceAll("sakura_v2",schema):statement;
const pool=new Proxy(actual,{get(target,key){
 if(key==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(statement),...args]);
 if(key==="connect")return async()=>{const connection=await target.connect();return new Proxy(connection,{get(client,property){
  if(property==="query")return async(statement:unknown,...args:unknown[])=>{if(typeof statement==="string"&&beforeQuery)await beforeQuery(statement,args);return Reflect.apply(client.query,client,[rewrite(statement),...args]);};
  const value=Reflect.get(client,property);return typeof value==="function"?value.bind(client):value;
 }});};
 const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
const now=new Date("2026-11-07T12:00:00Z"),recapId="monthly-2026-10";
const play=(accountId:string,recordingId:string,occurredAt:string,msPlayed=60000,eventId=randomUUID())=>recordHistory(accountId,{eventId,recordingId,occurredAt,msPlayed,positionMs:msPlayed,sequence:0,finished:true,context:"playlist"});

describe("Bloom retained data and erasure with isolated PostgreSQL",()=>{
 before(async()=>{
  await mkdir(".local",{recursive:true});await recordFixture("starting");
  for(const path of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])await actual.query((await readFile(path,"utf8")).replaceAll("sakura_v2",schema));
  for(const id of accounts)await actual.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,'invalid-test-hash',now())`,[id,`bloom_${id.slice(0,16)}`,`${id}@example.invalid`]);
  for(let index=0;index<ids.length;index++){
   const metadata={title:`Bloom fixture ${index}`,artists:[`Bloom fixture artist ${index<2?0:index}`],durationMs:180000,genres:index===0?["Jazz","Soul","jazz"]:index===1?["Soul"]:index===2?[]:["Ambient"],artistReference:{provider:"deezer",id:`bloom-${prefix}-${index<2?0:index}`}};
   await pool.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) VALUES($1::uuid,$2::jsonb,'verified')`,[ids[index],JSON.stringify(metadata)]);
   await pool.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) VALUES('deezer',$1,$2::uuid,now())`,[`bloom-${prefix}-song-${index}`,ids[index]]);
  }
  await syncCatalog(pool);
  await play(first,ids[0],"2026-09-20T22:00:00Z");
  await play(first,ids[0],"2026-10-10T22:00:00Z",120000);await play(first,ids[1],"2026-10-10T22:05:00Z");await play(first,ids[2],"2026-10-11T07:00:00Z");
  await play(unknown,ids[3],"2026-10-10T22:00:00Z");
  await pool.query(`UPDATE sakura_v2."ListeningRecordingSummary" SET audible_ms=audible_ms+30000 WHERE account_id=$1::uuid`,[unknown]);
  // An old chunk has a receipt date but no recoverable listening date.
  await recordHistory(legacy,{eventId:randomUUID(),recordingId:ids[3],msPlayed:30000,positionMs:30000,sequence:0,context:"legacy"});
  await pool.query(`UPDATE sakura_v2."ListeningChunk" SET created_at='2026-10-10T12:00:00Z' WHERE account_id=$1::uuid`,[legacy]);
  for(const account of [revealRace,completeRace])await play(account,ids[0],"2026-10-10T12:00:00Z");
  await play(unmapped,ids[3],"2026-10-10T12:00:00Z");
  await pool.query(`INSERT INTO sakura_v2."ArchivedListeningRecording"(account_id,legacy_recording_id,metadata_snapshot,audible_ms,play_count,source_snapshot_id) VALUES($1::uuid,'unmapped-fixture','{"title":"Unmapped fixture"}'::jsonb,30000,1,$2::uuid)`,[unmapped,randomUUID()]);
  // The history UI can discard these rows. Bloom must still keep their actual
  // playlist origin from the retained ledger, together with audible chunks.
  assert.equal((await compactHistory(first,new Date("2100-01-01T00:00:00Z"))).compacted,4);
  await recordFixture("active");
 });
 after(async()=>{
  beforeQuery=undefined;
  try{
   await actual.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
   await actual.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[accounts]);
   await recordFixture("cleaned");
  }catch(error){await recordFixture("cleanup-failed");throw error;}finally{await actual.end();}
 });
 it("offers ready and upcoming Home cards across periods without creating derived stories",async()=>{
  const sunday=new Date("2026-11-08T12:00:00Z"),shelf=await listBloomShelf(first,sunday);
  assert.equal(shelf.items.length,6);
  assert.deepEqual(bloomShelfItems(shelf.items,sunday).map(item=>item.id),["monthly-2026-10","weekly-2026-11-02"]);
  assert.ok(shelf.items.every(item=>item.listening===undefined));
  assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid`,[first])).rows[0].n,0);
 });
 it("keeps undated imports and another account's music out of Home readiness",async()=>{
  for(const account of [second,legacy]){
   const shelf=await listBloomShelf(account,now);
   assert.ok(!shelf.items.some(item=>item.status==="available"));
   assert.ok(shelf.items.some(item=>item.status==="locked"));
   assert.equal(shelf.items.find(item=>item.id===recapId)?.status,"empty");
  }
 });
 it("keeps listening history independent of recommendation exclusions and discloses progressively",async()=>{
  await setTaste(first,{target:"recording",targetId:ids[0],kind:"block"});
  let recap=await getBloom(first,recapId,now);
  assert.equal(recap.version,4);assert.equal(recap.summary.audibleMs,240000);assert.equal(recap.summary.activeDays,2);assert.equal(recap.listening,undefined);
  assert.ok(recap.experience);assert.equal(recap.experience.version,1);
  assert.equal((await getBloom(second,recapId,now)).status,"empty");
  recap=await revealBloom(first,recapId,recap.chapters[0].id,now);
  const firstReveal:BloomListeningProfile={timeZone:"Africa/Lagos",audibleMs:240000};
  assert.deepEqual(recap.listening,firstReveal);
  for(const chapter of recap.chapters)recap=await revealBloom(first,recapId,chapter.id,now);
  assert.equal(recap.listening?.genreCount,2);assert.equal(recap.listening?.unknownGenreMs,60000);assert.equal(recap.listening?.peakHour,23);
  assert.equal(recap.listening?.returningRecordingCount,1);assert.equal(recap.listening?.returningArtistCount,1);
  assert.equal(recap.listening?.discoveredRecordingCount,2);assert.equal(recap.listening?.discoveredArtistCount,1);
  assert.equal(recap.listening?.comparison?.audibleMs,60000);assert.equal(recap.listening?.comparison?.sharedRecordingCount,1);assert.equal(recap.listening?.comparison?.sharedArtistCount,1);
  assert.equal(recap.listening?.genres?.reduce((sum,row)=>sum+row.audibleMs,0),180000);
  assert.deepEqual(recap.listening?.peakDay,{date:"2026-10-10",audibleMs:180000});
  assert.deepEqual(recap.listening?.longestStreak,{days:2,startDate:"2026-10-10",endDate:"2026-10-11"});
  assert.deepEqual(recap.listening?.sources,[{id:"playlist",name:"Playlists",audibleMs:240000,share:1}]);
  assert.equal(recap.listening?.unknownSourceMs,0);
  assert.equal((await completeBloom(first,recapId,now)).completed,true);
 });
 it("uses completed listening details for Home covers without leaking them to another account",async()=>{
  const item=(await listBloomShelf(first,now)).items.find(value=>value.id===recapId);
  assert.equal(item?.completed,true);assert.equal(item?.listening?.audibleMs,240000);
  assert.equal((await listBloomShelf(second,now)).items.find(value=>value.id===recapId)?.listening,undefined);
 });
 it("keeps a created Bloom unchanged after late history arrives and the account changes time zone",async()=>{
  const original=await getBloom(first,recapId,now);
  const stored=(await pool.query(`SELECT snapshot FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[first,recapId])).rows[0].snapshot;
  await play(first,ids[3],"2026-10-12T12:00:00Z");
  await patchSettings(first,{timeZone:"Pacific/Honolulu"});
  try{
   const nextDay=new Date("2026-11-08T12:00:00Z"),reopened=await getBloom(first,recapId,nextDay);
   assert.deepEqual(reopened,original);
   assert.deepEqual((await pool.query(`SELECT snapshot FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[first,recapId])).rows[0].snapshot,stored);
   const listed=(await listBloom(first,"monthly",nextDay)).items.find(item=>item.id===recapId);
   const shelf=(await listBloomShelf(first,nextDay)).items.find(item=>item.id===recapId);
   assert.equal(listed?.timeZone,"Africa/Lagos");assert.equal(shelf?.timeZone,"Africa/Lagos");
   assert.deepEqual(listed?.experience,original.experience);assert.deepEqual(shelf?.experience,original.experience);
  }finally{await patchSettings(first,{timeZone:"Africa/Lagos"});}
 });
 it("uses a stable personal experience from the teaser through the saved story",async()=>{
  const teased=(await listBloom(unknown,"monthly",now)).items.find(item=>item.id===recapId);
  const shelf=(await listBloomShelf(unknown,now)).items.find(item=>item.id===recapId);
  const recap=await getBloom(unknown,recapId,now);
  assert.deepEqual(teased?.experience,recap.experience);assert.deepEqual(shelf?.experience,recap.experience);
  assert.notEqual(recap.experience?.seed,(await getBloom(first,recapId,now)).experience?.seed);
  assert.deepEqual((await getBloom(unknown,recapId,new Date("2026-11-08T12:00:00Z"))).experience,recap.experience);
 });
 it("preserves prior journal measurements when learning pauses and rejects new recorded plays",async()=>{
  await patchSettings(first,{learnFromListening:false});
  assert.equal((await play(first,ids[3],"2026-10-12T12:00:00Z") as {accepted:boolean}).accepted,false);
  assert.equal((await getBloom(first,recapId,now)).summary.audibleMs,240000);
 });
 it("does not assign receipt dates to old listening or freeze an empty period",async()=>{
  assert.equal((await getBloom(legacy,recapId,now)).status,"empty");
  assert.equal((await listBloom(legacy,"monthly",now)).items[0].status,"empty");
  assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid`,[legacy])).rows[0].n,0);
  await play(legacy,ids[3],"2026-10-13T12:00:00Z");
  const recap=await getBloom(legacy,recapId,now);assert.equal(recap.summary.audibleMs,60000);assert.ok(!recap.chapters.some(chapter=>chapter.id==="discoveries"));
 });
 it("does not label a dated first play as new when retained imported time has an unknown date",async()=>{
  const recap=await getBloom(unknown,recapId,now);
  assert.equal(recap.summary.audibleMs,60000);assert.ok(!recap.chapters.some(chapter=>chapter.id==="discoveries"));
 });
 it("keeps discoveries unknown when imported songs cannot be matched to current recordings",async()=>{
  const recap=await getBloom(unmapped,recapId,now);assert.equal(recap.summary.audibleMs,60000);assert.ok(!recap.chapters.some(chapter=>chapter.id==="discoveries"));
  const row=(await pool.query(`SELECT snapshot FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[unmapped,recapId])).rows[0];
  assert.equal(row.snapshot.listening.discoveredRecordingCount,undefined);assert.equal(row.snapshot.listening.discoveredArtistCount,undefined);
 });
 it("keeps legacy archived snapshots readable without creating richer measurements",async()=>{
  const snapshot={version:1,worldId:"herbarium",summary:{audibleMs:30000,playCount:1,recordingCount:1,activeDays:1},chapters:[{id:"listening-time",title:"Original title",prompt:"Original prompt",stat:{label:"listening",value:"30 sec",unit:""},relatedRecording:null}]};
  await pool.query(`INSERT INTO sakura_v2."BloomRecap"(account_id,recap_id,time_zone,period_start,period_end,snapshot,revealed_chapters,completed_at) VALUES($1::uuid,'yearly-2025','Africa/Lagos','2024-12-31T23:00:00Z','2025-12-31T23:00:00Z',$2::jsonb,ARRAY['listening-time'],'2026-01-01T00:00:00Z')`,[second,JSON.stringify(snapshot)]);
  const archive=await archivedBloom(second,"2025",new Date("2027-01-01T12:00:00Z"));
  assert.equal(archive.items.length,1);assert.equal(archive.items[0].worldId,"herbarium");assert.equal(archive.items[0].listening,undefined);assert.equal(archive.items[0].chapters[0].title,"Original title");
  assert.equal((await archivedBloom(first,"2025",new Date("2027-01-01T12:00:00Z"))).items.length,0);
  const cover=(await listBloomShelf(second,now)).items.find(value=>value.id==="yearly-2025");
  assert.equal(cover?.worldId,"herbarium");assert.equal(cover?.listening,undefined);assert.equal(cover?.completed,true);
 });
 async function eraseInMutationGap(accountId:string,action:"reveal"|"complete"){
  let recap=await getBloom(accountId,recapId,now);
  if(action==="complete")for(const chapter of recap.chapters)recap=await revealBloom(accountId,recapId,chapter.id,now);
  let arrived!:()=>void,release!:()=>void;const paused=new Promise<void>(resolve=>{arrived=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});let lockCalls=0;
  beforeQuery=async(statement,args)=>{if(statement.includes("pg_advisory_xact_lock")&&JSON.stringify(args).includes(`sakura-v2-history:${accountId}`)&&++lockCalls===2){beforeQuery=undefined;arrived();await resume;}};
  const result=action==="reveal"?revealBloom(accountId,recapId,recap.chapters[0].id,now):completeBloom(accountId,recapId,now);
  const settled=result.then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  await Promise.race([paused,settled.then(outcome=>{throw outcome.error||new Error("The mutation completed before its test gate opened");})]);
  let clearError:unknown;
  try{await clearPersonalizationData(accountId,{scope:"history",period:"all"});}catch(error){clearError=error;}finally{release();}
  const outcome=await settled;
  if(clearError)throw clearError;
  assert.ok(outcome.error instanceof ProductError&&outcome.error.status===404);
  assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid`,[accountId])).rows[0].n,0);
  assert.equal((await getBloom(accountId,recapId,now)).status,"empty");
  assert.equal((await listBloomShelf(accountId,now)).items.find(item=>item.id===recapId)?.status,"empty");
 }
 it("cannot reveal a story erased between reading and mutation",async()=>{await eraseInMutationGap(revealRace,"reveal");});
 it("cannot complete or recreate a story erased between reading and mutation",async()=>{await eraseInMutationGap(completeRace,"complete");});
});
