import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after,before,describe,it} from "node:test";
import {getRebuildPool,inTransaction} from "../src/rebuild/data/db";
import {syncCatalog,cardsForIds,cardsForRanking} from "../src/rebuild/data/catalog";
import {getSettings,patchSettings,refreshInitialTaste} from "../src/rebuild/data/settings";
import {previewInitialTaste} from "../src/rebuild/data/initialTaste";
import {getProfile} from "../src/rebuild/data/product";
import {getTasteState} from "../src/rebuild/data/tasteState";
import {initialTasteSignature} from "../src/rebuild/recommendations/initialTaste";
import {getPersonalizedFeed} from "../src/rebuild/recommendations/feed";

const actual=getRebuildPool(),prefix=randomUUID().replaceAll("-",""),schema=`sakura_initial_taste_test_${prefix}`,accounts=Array.from({length:4},()=>randomUUID()),recordings=Array.from({length:14},()=>randomUUID()).sort();
const rewrite=(sql:unknown)=>typeof sql==="string"?sql.replaceAll("sakura_v2",schema):sql;
const pool=new Proxy(actual,{get(target,key){
 if(key==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(sql),...args]);
 if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){if(property==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(sql),...args]);const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}});};
 const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
const choice=(name="Initial Artist",id="991001")=>({seedArtists:[name],seedArtistSelections:[{name,reference:{provider:"deezer",id}}]});

describe("Artist-based onboarding with isolated PostgreSQL accounts",()=>{
 before(async()=>{
  for(const filename of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])await actual.query((await readFile(filename,"utf8")).replaceAll("sakura_v2",schema));
  await inTransaction(async client=>{
   for(const id of accounts)await client.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,'fixture',now())`,[id,`initial_${id.slice(0,14)}`,`${id}@example.invalid`]);
   const fixtures=recordings.map((id,index)=>({id,metadata:{title:`Initial taste fixture ${index}`,artists:[index<12?"Initial Artist":"Second Artist"],durationMs:180000,genres:index<10?["Jazz","jazz"]:index<12?["Folk"]:[],explicit:index<10?"explicit":"clean",artistReference:{provider:"deezer",id:index<12?"991001":"991002"}}}));
   await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified' FROM jsonb_to_recordset($1::jsonb) AS x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
   await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer','initial-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[recordings,prefix]);
   await syncCatalog(client);
  });
 });
 after(async()=>{try{await actual.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await actual.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[accounts]);}finally{await actual.end();}});
 it("persists initial taste while leaving genre choices, measured charts, and listening evidence untouched",async()=>{
  const settings=await patchSettings(accounts[0],{...choice(),onboarded:true});
  assert.equal(settings.initialTasteProfile.origin,"chosen-artists");assert.deepEqual(settings.initialTasteProfile.genres.map((genre:{name:string})=>genre.name),["Jazz"]);assert.deepEqual(settings.seedGenres,[]);
  const full=await cardsForIds(accounts[0],[recordings[0]]),ranking=await cardsForRanking(accounts[0],[recordings[0]]);
  for(const key of ["id","metadata","reference","references","artistId","artistCredits","genres","popularity"] as const)assert.deepEqual(ranking[0][key],full[0][key]);
  const profile=await getProfile(accounts[0]),taste=await getTasteState(accounts[0]);assert.equal(profile.stats.audibleMs,0);assert.equal(profile.stats.playCount,0);assert.deepEqual(taste.tasteEvidence,[]);assert.ok(taste.initialTasteProfile);
  for(const table of ["ListeningEvent","ListeningEventLedger","ListeningChunk","ListeningRecordingSummary","BloomRecap"])assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM sakura_v2."${table}" WHERE account_id=$1::uuid`,[accounts[0]])).rows[0].count),0);
  assert.ok(!((await getSettings(accounts[1])).initialTasteProfile));
 });
 it("previews without creating account preferences and searches past explicit candidates for clean tags",async()=>{
  const before=Number((await pool.query(`SELECT COUNT(*) FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accounts[1]])).rows[0].count);
  assert.deepEqual((await previewInitialTaste(accounts[1],choice())).genres,["Jazz"]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accounts[1]])).rows[0].count),before);
  const settings=await patchSettings(accounts[2],{...choice(),explicitContent:false});assert.equal(settings.initialTasteProfile.recordingCount,2);assert.deepEqual(settings.initialTasteProfile.genres.map((genre:{name:string})=>genre.name),["Folk"]);
  assert.deepEqual((await previewInitialTaste(accounts[2],choice())).genres,["Folk"]);
 });
 it("rejects client-derived data and stale edits before changing generated choices",async()=>{
  const old=await getSettings(accounts[0]);await assert.rejects(patchSettings(accounts[0],{initialTasteProfile:old.initialTasteProfile}),/Unsupported/);
  const next=await patchSettings(accounts[0],{...choice("Second Artist","991002"),expectedRevision:old.revision});
  await assert.rejects(patchSettings(accounts[0],{...choice(),expectedRevision:old.revision}),/another device/);
  const actual=await getSettings(accounts[0]);assert.equal(actual.revision,next.revision);assert.equal(actual.initialTasteProfile.signature,initialTasteSignature(actual));assert.deepEqual(actual.initialTasteProfile.genres,[]);
 });
 it("enriches a previously empty recipe for current choices without stamping a new listener preference",async()=>{
  const before=await patchSettings(accounts[3],{...choice("Second Artist","991002"),learnFromListening:false});assert.deepEqual(before.initialTasteProfile.genres,[]);
  await pool.query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{genres}','["Soul"]'::jsonb) WHERE id=ANY($1::uuid[])`,[recordings.slice(12)]);
  await refreshInitialTaste(accounts[3]);const after=await getSettings(accounts[3]);assert.equal(after.revision,before.revision);assert.deepEqual(after.fieldRevisions,before.fieldRevisions);assert.equal(after.learnFromListening,false);assert.deepEqual(after.initialTasteProfile.genres.map((genre:{name:string})=>genre.name),["Soul"]);
  assert.deepEqual(after.seedGenres,[]);assert.deepEqual((await getTasteState(accounts[3])).tasteEvidence,[]);
 });
 it("lazily connects existing artist preferences under the account lock",async()=>{
  await pool.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences-'initialTasteProfile' WHERE account_id=$1::uuid`,[accounts[3]]);
  const settings=await getSettings(accounts[3]);assert.equal(settings.initialTasteProfile.signature,initialTasteSignature(settings));assert.deepEqual(settings.initialTasteProfile.genres.map((genre:{name:string})=>genre.name),["Soul"]);
  assert.ok((await pool.query(`SELECT preferences->'initialTasteProfile' AS profile FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accounts[3]])).rows[0].profile);
 });
 it("keeps older chosen artist recordings ahead of a full recent-catalog reservoir",async()=>{
  const ids=Array.from({length:1502},()=>randomUUID());
  await inTransaction(async client=>{
   await client.query(`UPDATE sakura_v2."Recording" SET created_at=now()-interval '7 days' WHERE id=ANY($1::uuid[])`,[recordings]);
   await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id,jsonb_build_object('title','Recent catalog fixture','artists',jsonb_build_array('Recent Artist'),'durationMs',180000,'genres',jsonb_build_array('Metal'),'artistReference',jsonb_build_object('provider','deezer','id','991003')),'verified' FROM unnest($1::uuid[]) id`,[ids]);
   await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer','recent-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[ids,prefix]);
   await syncCatalog(client);
  });
  const started=performance.now(),page=await getPersonalizedFeed(accounts[2],new URL("https://fixture.invalid/api/v2/feed?surface=home&limit=40"));
  console.log(JSON.stringify({fixture:"1502 newer catalog recordings",feedMs:Math.round(performance.now()-started),totalCandidates:page.totalCandidates,visibleSongs:page.items.length}));
  assert.ok(page.items.some(item=>recordings.slice(10,12).some(id=>id===item.track.id)));assert.equal(page.personalized,true);assert.equal((await getProfile(accounts[2])).stats.audibleMs,0);
 });
});
