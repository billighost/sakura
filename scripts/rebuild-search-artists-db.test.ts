import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after,before,describe,it} from "node:test";
import {getRebuildPool,inTransaction} from "../src/rebuild/data/db";
import {syncCatalog} from "../src/rebuild/data/catalog";
import {patchSettings} from "../src/rebuild/data/settings";
import {setFavorite} from "../src/rebuild/data/collections";
import {setTaste,removeTaste} from "../src/rebuild/data/taste";
import {recordHistory} from "../src/rebuild/data/history";
import {clearPersonalizationData} from "../src/rebuild/data/personalization";
import {getSearchSuggestions} from "../src/rebuild/recommendations/searchSuggestions";
import {buildInitialTasteProfile} from "../src/rebuild/recommendations/initialTaste";

const actual=getRebuildPool(),prefix=randomUUID().replaceAll("-",""),schema=`sakura_search_artists_test_${prefix}`,accounts=Array.from({length:5},()=>randomUUID()),recordings=Array.from({length:9},()=>randomUUID());
const rewrite=(sql:unknown)=>typeof sql==="string"?sql.replaceAll("sakura_v2",schema):sql;
const pool=new Proxy(actual,{get(target,key){
 if(key==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(sql),...args]);
 if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){if(property==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(sql),...args]);const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;}});};
 const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
const listening=(account:string,index:number)=>recordHistory(account,{eventId:randomUUID(),recordingId:recordings[index],sequence:0,msPlayed:60000,positionMs:60000,finished:true,occurredAt:new Date().toISOString()});
const artistId=async(index:number)=>(await pool.query(`SELECT id FROM sakura_v2."Artist" WHERE external_id=$1`,[`990001${index}`])).rows[0].id as string;

describe("Search artist suggestions with isolated PostgreSQL accounts",()=>{
 before(async()=>{
  for(const filename of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])await actual.query((await readFile(filename,"utf8")).replaceAll("sakura_v2",schema));
  await inTransaction(async client=>{
   for(const id of accounts)await client.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,'fixture',now())`,[id,`search_${id.slice(0,14)}`,`${id}@example.invalid`]);
   const fixtures=recordings.map((id,index)=>({id,metadata:{title:`Search artist fixture ${index}`,artists:[`Search Artist ${index}`],durationMs:180000,genres:[index<3?"Jazz":"Pop"],artistReference:{provider:"deezer",id:`990001${index}`}}}));
   await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified' FROM jsonb_to_recordset($1::jsonb) AS x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
   await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer','search-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[recordings,prefix]);
   await syncCatalog(client);
  });
 });
 after(async()=>{try{await actual.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await actual.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[accounts]);}finally{await actual.end();}});
 it("returns exact chosen artists and observed artists only for their owner",async()=>{
  await patchSettings(accounts[0],{seedArtists:["Search Artist 0"],seedArtistSelections:[{name:"Search Artist 0",reference:{provider:"deezer",id:"9900010"}}]});
  await listening(accounts[0],1);await listening(accounts[0],1);
  const first=await getSearchSuggestions(accounts[0]),other=await getSearchSuggestions(accounts[1]);
  assert.equal(first.artists[0].id,await artistId(0));assert.equal(first.artists[0].source,"chosen");
  const repeated=first.artists.find(row=>row.id!==first.artists[0].id&&row.source==="listening");assert.ok(repeated);assert.equal(repeated.reason,"From songs you heard again");
  assert.ok(other.artists.every(row=>row.source==="catalog"));assert.equal(new Set(first.artists.map(row=>row.id)).size,first.artists.length);
 });
 it("learning paused keeps liked songs and ignores retained audible history",async()=>{
  await listening(accounts[2],2);await setFavorite(accounts[2],{recordingId:recordings[3],liked:true});await patchSettings(accounts[2],{learnFromListening:false});
  const result=await getSearchSuggestions(accounts[2]);assert.equal(result.learningEnabled,false);assert.equal(result.artists[0].id,await artistId(3));assert.equal(result.artists[0].source,"saved");assert.ok(result.artists.every(row=>row.source!=="listening"));
 });
 it("exclusions remove artist entry points and undo restores measured influence",async()=>{
  await listening(accounts[3],4);const id=await artistId(4);
  await setTaste(accounts[3],{target:"artist",targetId:id,kind:"snooze",duration:"day"});assert.ok(!(await getSearchSuggestions(accounts[3])).artists.some(row=>row.id===id));
  await removeTaste(accounts[3],{target:"artist",targetId:id});assert.equal((await getSearchSuggestions(accounts[3])).artists[0].id,id);
  await setTaste(accounts[3],{target:"recording",targetId:recordings[4],kind:"block"});assert.ok(!(await getSearchSuggestions(accounts[3])).artists.some(row=>row.id===id));
 });
 it("clearing history removes measured suggestions and preserves liked-song entry points",async()=>{
  await listening(accounts[4],5);await setFavorite(accounts[4],{recordingId:recordings[6],liked:true});
  await clearPersonalizationData(accounts[4],{scope:"history",period:"all"});const result=await getSearchSuggestions(accounts[4]);
  assert.ok(result.artists.every(row=>row.source!=="listening"));assert.equal(result.artists[0].id,await artistId(6));assert.equal(result.artists[0].source,"saved");
 });
 it("waits for a concurrent history clear before reading suggestions",async()=>{
  const account=accounts[0],blocker=await pool.connect(),lockKey=`sakura-v2-history:${account}`;
  const outcomes:Promise<unknown>[]=[];let committed=false,clearFinished=false,readFinished=false;
  // Attach rejection handlers immediately. Even a failed queue assertion must
  // release the blocker and settle every started operation before fixture teardown.
  function observe<T>(operation:Promise<T>,finished:()=>void){
   const outcome=operation.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
   const tracked=outcome.then(result=>{finished();return result;});outcomes.push(tracked);return tracked;
  }
  async function waitForQueue(count:number){
   const deadline=Date.now()+12000;
   while(Date.now()<deadline){
    if(clearFinished||count>1&&readFinished)return false;
    // Use the already-connected blocker to observe this exact account key.
    // Connection arrival order and a fixed sleep cannot establish lock ordering.
    const result=await blocker.query(`SELECT COUNT(*)::integer AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted
      AND classid::bigint=CASE WHEN hashtext($1)<0 THEN 4294967295::bigint ELSE 0::bigint END
      AND objid::bigint=(hashtext($1)::bigint & 4294967295::bigint)`,[lockKey]);
    if(Number(result.rows[0].waiting)>=count)return true;
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   return false;
  }
  try{
   await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))",[lockKey]);
   const clearing=observe(clearPersonalizationData(account,{scope:"history",period:"all"}),()=>{clearFinished=true;});
   assert.equal(await waitForQueue(1),true,"The clear must be queued at PostgreSQL before the read begins");
   const pending=observe(getSearchSuggestions(account),()=>{readFinished=true;});
   assert.equal(await waitForQueue(2),true,"Suggestions must queue behind their account erasure lock");
   await blocker.query("COMMIT");committed=true;
   const cleared=await clearing;if(!cleared.ok)throw cleared.error;
   const read=await pending;if(!read.ok)throw read.error;
   assert.ok(read.value.artists.every(row=>row.source!=="listening"));
  }finally{
   let releaseError:Error|undefined;
   if(!committed)await blocker.query("ROLLBACK").catch(error=>{releaseError=error instanceof Error?error:new Error("Fixture rollback failed");});
   blocker.release(releaseError);await Promise.allSettled(outcomes);
  }
 });
 it("keeps an older chosen or requested lead artist when more than 600 newer recordings credit them as a guest",async()=>{
  // More than 600 remain even after the former eight guest reservations.
  const lead=randomUUID(),guests=Array.from({length:620},()=>randomUUID()),choice={name:"Search Chosen Lead",reference:{provider:"deezer",id:"9900030"}};
  await inTransaction(async client=>{
   const fixtures=[{id:lead,metadata:{title:"Older lead recording",artists:[choice.name],durationMs:180000,genres:["Folk"],artistReference:choice.reference,artistCredits:[{name:choice.name,role:"primary",reference:choice.reference}]}},
    ...guests.map((id,index)=>({id,metadata:{title:`New guest appearance ${index}`,artists:["Search Guest Lead",choice.name],durationMs:180000,genres:["Pop"],artistReference:{provider:"deezer",id:"9900040"},artistCredits:[{name:"Search Guest Lead",role:"primary",reference:{provider:"deezer",id:"9900040"}},{name:choice.name,role:"featured",reference:choice.reference}]}}))];
   await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified' FROM jsonb_to_recordset($1::jsonb) AS x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
   await client.query(`UPDATE sakura_v2."Recording" SET created_at=now()-interval '7 days' WHERE id=$1::uuid`,[lead]);
   await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer','search-guest-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[[lead,...guests],prefix]);
   await syncCatalog(client);
   await client.query(`INSERT INTO sakura_v2."RecordingArtist"(recording_id,artist_id,position) SELECT guest.recording_id,a.id,1 FROM unnest($1::uuid[]) AS guest(recording_id) CROSS JOIN sakura_v2."Artist" a WHERE a.provider='deezer' AND a.external_id=$2 ON CONFLICT DO NOTHING`,[guests,choice.reference.id]);
  });
  const settings=await patchSettings(accounts[1],{seedArtists:[choice.name],seedArtistSelections:[choice],seedGenres:[]});
  // An initially empty recipe can precede catalog enrichment. Its valid saved
  // signature must not hide the need to reserve fresh primary artist evidence.
  await pool.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=jsonb_set(preferences,'{initialTasteProfile}',$2::jsonb) WHERE account_id=$1::uuid`,[accounts[1],JSON.stringify(buildInitialTasteProfile([],settings))]);
  const result=await getSearchSuggestions(accounts[1]);
  assert.equal(result.artists[0].name,choice.name);assert.equal(result.artists[0].source,"chosen");
  await patchSettings(accounts[1],{seedArtists:[],seedArtistSelections:[],seedGenres:[],learnFromListening:false});
  const requestedId=(await pool.query(`SELECT id FROM sakura_v2."Artist" WHERE provider=$1 AND external_id=$2`,[choice.reference.provider,choice.reference.id])).rows[0].id;
  await setTaste(accounts[1],{target:"artist",targetId:requestedId,kind:"love"});
  const requested=await getSearchSuggestions(accounts[1]);
  assert.equal(requested.artists[0].name,choice.name);assert.equal(requested.artists[0].source,"chosen");
  assert.equal(requested.learningEnabled,false,"An explicit artist request works while learning is paused");
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid`,[accounts[1]])).rows[0].count),0,"Catalog choices must not become measured listening");
 });
});
