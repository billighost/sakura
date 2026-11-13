import assert from "node:assert/strict";
import {test} from "node:test";
import {gzipSync} from "node:zlib";
import {normalizeProductDto} from "../src/rebuild/app/productDto";
import {readBoundedRequestText,RequestBodyError} from "../src/rebuild/server/request-body";
import {consumeRegistrationAttempt} from "../src/rebuild/registration";
import {getLibrary,createPlaylistReceipt,updatePlaylistReceipt,mutatePlaylistTracksReceipt} from "../src/rebuild/data/collections";
import {patchProfileReceipt} from "../src/rebuild/data/product";
import {ProductError,encodeCursor} from "../src/rebuild/data/validation";
import {MusicCollectionImporter,type ImportPreview} from "../src/rebuild/server/import";
import type {RecordingIngestor,SqlTransaction} from "../src/rebuild/server/ingestion";
import type {DeezerCatalogService} from "../src/rebuild/server/catalog";
import {streamPersonalizationData} from "../src/rebuild/data/personalizationExport";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const account=id(9000),other=id(9001),playlistId=id(9002);
const runtime=globalThis as typeof globalThis&{sakuraV2ProductPool?:unknown};
async function withPool<T>(pool:unknown,operation:()=>Promise<T>){const previous=runtime.sakuraV2ProductPool;runtime.sakuraV2ProductPool=pool;try{return await operation();}finally{runtime.sakuraV2ProductPool=previous;}}

test("canonical DTO normalizes old offline wrappers once without duplicating cards or losing choice tombstones",()=>{
 const card={id:id(1),title:"Song"},states={[id(1)]:{liked:false,revision:9}};
 const legacy={recordings:[card],tracks:[card],favoriteStates:states,favoriteRevisions:{[id(1)]:9}};
 const canonical=normalizeProductDto(legacy);
 assert.notEqual(canonical,legacy);assert.equal(canonical.recordings,legacy.recordings);assert.equal(canonical.favoriteStates,states);
 assert.equal("tracks" in canonical,false);assert.equal("favoriteRevisions" in canonical,false);assert.equal("tracks" in legacy,true);
 assert.equal(normalizeProductDto(canonical),canonical);
 const history=normalizeProductDto({history:[{eventId:id(2),track:card}]}) as unknown as {events:{recording:typeof card}[]};
 assert.equal(history.events[0].recording,card);assert.equal("history" in history,false);assert.equal("track" in history.events[0],false);
 const profile=normalizeProductDto({insights:{days:[],tasteEvidence:[card],tasteFeedback:[]},tasteEvidence:[card]});
 assert.equal("tasteEvidence" in profile,false);assert.equal("tasteEvidence" in profile.insights,false);
 // Search and smart queue use tracks as their canonical field, not recordings.
 const queue={tracks:[card],scope:"all"};assert.equal(normalizeProductDto(queue),queue);
});

test("request body bounds count UTF-8 bytes and cancel before reading a complete rejected stream",async()=>{
 let canceled=false,pulls=0;
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(5000));},cancel(){canceled=true;}});
 await assert.rejects(readBoundedRequestText(new Request("https://example.test",{method:"POST",body,duplex:"half"} as RequestInit),4096),error=>error instanceof RequestBodyError&&error.status===413);
 assert.equal(canceled,true);assert.ok(pulls<=2);
 await assert.rejects(readBoundedRequestText(new Request("https://example.test",{method:"POST",body:"😀".repeat(1500)}),4096),error=>error instanceof RequestBodyError&&error.status===413);
 assert.equal(await readBoundedRequestText(new Request("https://example.test",{method:"POST",body:"曲"}),3),"曲");
});

test("stalled/aborted bodies release their streams",async()=>{
 let canceled=0;
 const body=()=>new ReadableStream<Uint8Array>({cancel(){canceled++;}});
 await assert.rejects(readBoundedRequestText(new Request("https://example.test",{method:"POST",body:body(),duplex:"half"} as RequestInit),100,5),error=>error instanceof RequestBodyError&&error.status===408);
 const controller=new AbortController();
 const pending=readBoundedRequestText(new Request("https://example.test",{method:"POST",body:body(),signal:controller.signal,duplex:"half"} as RequestInit),100);
 controller.abort();await assert.rejects(pending,{name:"AbortError"});assert.equal(canceled,2);
});

test("registration flood bounds do not evict active rate limits",()=>{
 const now=Date.now()+1000000;
 for(let n=0;n<2000;n++)assert.equal(consumeRegistrationAttempt(`fixture-${n}`,now),true);
 assert.equal(consumeRegistrationAttempt("overflow",now),false);
 for(let n=1;n<8;n++)assert.equal(consumeRegistrationAttempt("fixture-0",now),true);
 assert.equal(consumeRegistrationAttempt("fixture-0",now),false);
 assert.equal(consumeRegistrationAttempt("fresh",now+900001),true);
});

function libraryPool(){
 const statements:string[]=[];
 const songs=Array.from({length:50},(_,n)=>({id:id(n+1),metadata:{title:`Song ${n}`,artists:[`Artist ${n%12}`],durationMs:180000,coverUrl:`https://example.test/${n}.jpg`},provenance:{},references:[{provider:"deezer",id:String(n+1)}],addedAt:new Date(1700000000000-n),ready:false}));
 const choices=Array.from({length:1000},(_,n)=>({recording_id:id(n+1),revision:2,liked:n%2===0}));
 const playlists=Array.from({length:30},(_,n)=>({id:id(n+2000),name:`Playlist ${n}`,revision:1,trackCoverUrls:[]}));
 const client={async query(sql:string){statements.push(sql);return {rows:sql.startsWith("SELECT r.id")?songs:sql.startsWith("SELECT c.recording_id")?choices:sql.startsWith("SELECT p.id")?playlists:[]};},release(){}};
 return {pool:{async connect(){return client;}},statements};
}
test("compact library membership skips global state and playlists; legacy remains causal and compatible",async()=>{
 const fixture=libraryPool();await withPool(fixture.pool,async()=>{
  const url=new URL("https://example.test/api?kind=liked&limit=50");
  const legacy=await getLibrary(account,url);const legacyQueries=fixture.statements.length;
  assert.equal(legacy.recordings,legacy.tracks);assert.equal(legacy.favoriteStates?.[id(2)].liked,false);
  fixture.statements.length=0;const compact=await getLibrary(account,url,true);
  assert.equal(fixture.statements.length,4);assert.equal(legacyQueries,6);
  assert.equal("favoriteStates" in compact,false);assert.equal("playlists" in compact,false);assert.equal("tracks" in compact,false);
  assert.deepEqual(compact.recordings,legacy.recordings);
  assert.ok(gzipSync(JSON.stringify(compact)).length<gzipSync(JSON.stringify(legacy)).length/2);
  fixture.statements.length=0;const first=await getLibrary(account,new URL("https://example.test/api?kind=all&limit=50"),true);
  assert.equal(first.playlists?.length,30);assert.equal(fixture.statements.length,5);
  fixture.statements.length=0;const cursor=encodeCursor(new Date(1700000000000),id(1));
  const next=await getLibrary(account,new URL(`https://example.test/api?kind=all&limit=50&cursor=${encodeURIComponent(cursor)}`),true);
  assert.equal("playlists" in next,false);assert.equal(fixture.statements.length,4);
 });
});

function mutationPool(){
 const statements:string[]=[];let revision=7;const members=[id(1),id(2)];
 const client={async query(sql:string,args:unknown[]=[]){
  statements.push(sql);let rows:Record<string,unknown>[]=[];let rowCount=0;
  if(sql.startsWith("SELECT id,name,description,revision")||sql.startsWith("SELECT id,revision")){
   if(args[0]===account){rows=[{id:playlistId,name:"Existing",description:"",revision}];rowCount=1;}
  }else if(sql.startsWith("SELECT recording_id")){rows=members.map(recording_id=>({recording_id}));rowCount=rows.length;}
  else if(sql.startsWith("SELECT r.id")){rows=(args[0] as string[]).map(id=>({id}));rowCount=rows.length;}
  else if(sql.startsWith('INSERT INTO sakura_v2."Playlist"')){rows=[{id:args[0],name:args[2],description:args[3],revision:1,createdAt:new Date(),updatedAt:new Date()}];rowCount=1;}
  else if(sql.startsWith('UPDATE public."User"')){rows=[{id:account,username:args[1],email:"fixture@example.test",bio:args[2],avatarUrl:null}];rowCount=1;}
  else if(sql.startsWith('UPDATE sakura_v2."Playlist"')){revision++;rowCount=1;}
  else if(sql.startsWith('INSERT INTO sakura_v2."PlaylistRecording"'))rowCount=1;
  return {rows,rowCount};
 },release(){}};
 return {pool:{async connect(){return client;},query:client.query},statements};
}
test("compact rename/create/add/profile receipts avoid unrelated collection and analytics projection",async()=>{
 const fixture=mutationPool();await withPool(fixture.pool,async()=>{
  const rename=await updatePlaylistReceipt(account,playlistId,{name:"Renamed"});
  assert.equal(rename.baseRevision,7);assert.equal(rename.revision,8);assert.equal(rename.name,"Renamed");assert.equal(fixture.statements.length,4);
  assert.ok(!fixture.statements.some(sql=>sql.includes('AudioAsset')||sql.includes('LifetimeListeningSummary')));
  fixture.statements.length=0;const created=await createPlaylistReceipt(account,{name:"New",requestId:id(99),recordingIds:[id(1),id(2)]});
  assert.equal(created.trackCount,2);assert.equal(created.id,id(99));assert.equal(fixture.statements.length,5);
  fixture.statements.length=0;const added=await mutatePlaylistTracksReceipt(account,playlistId,{recordingIds:[id(3)]});
  assert.equal(added.changed,true);assert.equal(added.revision,9);assert.ok(!fixture.statements.some(sql=>sql.includes('AudioAsset')));
  fixture.statements.length=0;const profile=await patchProfileReceipt(account,{username:"fixture",bio:""});
  assert.equal(profile.profile.bio,"");assert.equal(fixture.statements.length,1);
  await assert.rejects(updatePlaylistReceipt(other,playlistId,{name:"Other"}),error=>error instanceof ProductError&&error.status===404);
  await assert.rejects(updatePlaylistReceipt(account,playlistId,{recordingIds:[id(1)]}),error=>error instanceof ProductError&&error.status===409);
 });
});

function importerFixture(support=true,count=8){
 const receipts=new Map<string,{account_id:string;source_key:string;result:unknown}>(),playlists=new Map<string,string>();
 const statements:string[]=[];let tail=Promise.resolve();let previews=0,ingestions=0;let saved:string[]=[];
 const query=async(sql:string,args:readonly unknown[]=[])=>{
  statements.push(sql);
  if(sql.includes("to_regclass"))return [{relation:support?'sakura_v2."ImportReceipt"':null}];
  if(sql.startsWith("SELECT account_id,source_key"))return receipts.has(String(args[0]))?[structuredClone(receipts.get(String(args[0]))!)]:[];
  if(sql.startsWith("SELECT account_id FROM"))return playlists.has(String(args[0]))?[{account_id:playlists.get(String(args[0]))}]:[];
  if(sql.startsWith('INSERT INTO sakura_v2."Playlist"'))playlists.set(String(args[0]),String(args[1]));
  if(sql.startsWith('INSERT INTO sakura_v2."PlaylistRecording"'))saved=[...(args[1] as string[])];
  if(sql.startsWith('INSERT INTO sakura_v2."ImportReceipt"'))receipts.set(String(args[0]),{account_id:String(args[1]),source_key:String(args[2]),result:JSON.parse(String(args[3]))});
  return [];
 };
 const transaction:SqlTransaction=operation=>{
  const pending=tail.then(()=>operation(query as Parameters<Parameters<SqlTransaction>[0]>[0]));tail=pending.then(()=>{},()=>{});return pending;
 };
 const ingestor={async ensureRecording(reference:{id:string},_metadata:unknown,signal?:AbortSignal){signal?.throwIfAborted();ingestions++;return {recordingId:id(Number(reference.id))};}} as unknown as RecordingIngestor;
 const importer=new MusicCollectionImporter({} as DeezerCatalogService,ingestor,transaction);
 importer.preview=async()=>{previews++;return {provider:"deezer",sourceId:"123",name:"Fixture",items:Array.from({length:count},(_,n)=>({reference:{provider:"deezer",id:String(n+1)},title:`Song ${n}`,artist:"Artist",status:"matched"})),total:count,truncated:false} as ImportPreview;};
 return {importer,ingestor,receipts,playlists,statements,get previews(){return previews;},get ingestions(){return ingestions;},get saved(){return saved;}};
}
test("source-bound import receipt returns exact lost-response result without preview/indexing and survives deletion",async()=>{
 const f=importerFixture(),request=id(80),url="https://deezer.com/playlist/123";
 const first=await f.importer.confirm(account,url,request);f.playlists.delete(request);
 first.added=999;
 const retry=await f.importer.confirm(account,"https://www.deezer.com/en/playlist/123",request);
 assert.equal(retry.added,8);assert.equal(f.previews,1);assert.equal(f.ingestions,8);assert.equal(f.playlists.size,0);
 await assert.rejects(f.importer.confirm(account,"https://deezer.com/playlist/124",request),error=>error instanceof ProductError&&error.status===409);
 await assert.rejects(f.importer.confirm(other,url,request),error=>error instanceof ProductError&&error.status===409);
});
test("concurrent import retries commit one playlist/receipt and pre-migration schemas remain usable",async()=>{
 const f=importerFixture();const results=await Promise.all([f.importer.confirm(account,"https://deezer.com/playlist/123",id(80)),f.importer.confirm(account,"https://deezer.com/playlist/123",id(80))]);
 assert.deepEqual(results[0],results[1]);assert.equal(f.playlists.size,1);assert.equal(f.receipts.size,1);
 const legacy=importerFixture(false);await legacy.importer.confirm(account,"https://deezer.com/playlist/123",id(80));await legacy.importer.confirm(account,"https://deezer.com/playlist/123",id(80));
 assert.equal(legacy.playlists.size,1);assert.equal(legacy.receipts.size,0);
});
test("import worker pool bypasses a straggler while retaining source order and abort never starts commit",async()=>{
 const f=importerFixture();let release!:()=>void,allStarted!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{allStarted=resolve;});let calls=0;
 f.ingestor.ensureRecording=async reference=>{calls++;if(calls===8)allStarted();if(reference.id==="1")await gate;return {recordingId:id(Number(reference.id))} as Awaited<ReturnType<RecordingIngestor["ensureRecording"]>>;};
 const pending=f.importer.confirm(account,"https://deezer.com/playlist/123",id(80));
 await started;assert.equal(calls,8);release();await pending;assert.deepEqual(f.saved,Array.from({length:8},(_,n)=>id(n+1)));
 const aborted=importerFixture(),controller=new AbortController();
 aborted.ingestor.ensureRecording=async()=>{controller.abort();throw controller.signal.reason;};
 await assert.rejects(aborted.importer.confirm(account,"https://deezer.com/playlist/123",id(81),controller.signal),{name:"AbortError"});
 assert.equal(aborted.playlists.size,0);assert.equal(aborted.receipts.size,0);
});

function exportPool(count:number){
 const statements:string[]=[];let released=0,offset=0,measurement=false,maximum=0,snapshot=1;
 const client={async query(sql:string,args:unknown[]=[]){
  statements.push(sql);let rows:Record<string,unknown>[]=[];
  if(sql.startsWith("BEGIN"))snapshot=1;
  else if(sql.startsWith("SELECT preferences"))rows=[{preferences:{},seed_artists:[],seed_genres:[],revision:1,field_revisions:{}}];
  else if(sql.startsWith("SELECT audible_ms"))rows=[{audibleMs:"5000",playCount:"1",completedCount:"0",skippedCount:"0"}];
  else if(sql.startsWith("DECLARE")){assert.equal(args[0],account);measurement=sql.includes('FROM sakura_v2."ListeningChunk"');offset=0;}
  else if(sql.startsWith("FETCH")&&measurement){const size=Math.min(Number(/FORWARD (\d+)/.exec(sql)![1]),count-offset);maximum=Math.max(maximum,size);rows=Array.from({length:size},(_,n)=>({eventId:id(offset+n+1),sequence:n,audibleMs:"5000",occurredAt:null,receivedAt:"2026-11-11",positionMs:5000,completed:false,skipped:false,finished:false,snapshot}));offset+=size;}
  return {rows};
 },release(){released++;}};
 return {pool:{async connect(){return client;}},statements,get released(){return released;},get maximum(){return maximum;}};
}
test("streamed export preserves all 10k rows/null dates in a read-only snapshot with bounded batches",async()=>{
 const f=exportPool(10000);await withPool(f.pool,async()=>{
  const response=await streamPersonalizationData(account,new AbortController().signal,{batchSize:128});
  const data=await response.json();assert.equal(data.listeningMeasurements.length,10000);assert.equal(data.listeningMeasurements[9999].eventId,id(10000));
  assert.equal(data.listeningMeasurements[0].occurredAt,null);assert.equal(data.listeningMeasurements[0].receivedAt,"2026-11-11");
  assert.equal(f.maximum,128);assert.equal(f.released,1);assert.ok(f.statements[0].includes("REPEATABLE READ READ ONLY"));
  assert.ok(!f.statements.some(sql=>sql.includes("pg_advisory")||sql.startsWith("UPDATE")||sql.startsWith("INSERT")));
  assert.equal(f.statements.at(-1),"COMMIT");assert.equal(response.headers.get("cache-control"),"private, no-store");
 });
});
test("export body disconnect, request abort and timeout roll back/release once",async()=>{
 for(const mode of ["body","request","timeout"]){
  const f=exportPool(1000);await withPool(f.pool,async()=>{
   const controller=new AbortController();const response=await streamPersonalizationData(account,controller.signal,{batchSize:4,timeoutMs:mode==="timeout"?5:300000});
   const reader=response.body!.getReader();await reader.read();
   if(mode==="body")await reader.cancel();else if(mode==="request"){controller.abort();await assert.rejects(reader.read(),{name:"AbortError"});}else{await new Promise(resolve=>setTimeout(resolve,15));await assert.rejects(reader.read(),/Export timed out/);}
   await new Promise(resolve=>setImmediate(resolve));assert.equal(f.released,1);assert.equal(f.statements.at(-1),"ROLLBACK");
  });
 }
});
