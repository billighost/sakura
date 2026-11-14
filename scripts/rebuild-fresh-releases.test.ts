import assert from "node:assert/strict";
import {test,type TestContext} from "node:test";
import {DeezerCatalogService} from "../src/rebuild/server/catalog";
import {getRebuildServices} from "../src/rebuild/server/runtime";
import {seedCandidateCatalog,refreshFeedCatalog,feedCatalogRefreshStatus,invalidateFeedCatalog} from "../src/rebuild/recommendations/catalog";
import {getSettingsSnapshot} from "../src/rebuild/data/settings";
import {DEFAULT_SETTINGS} from "../src/rebuild/data/validation";
import {getRebuildPool} from "../src/rebuild/data/db";
import type {ProviderReference} from "../src/rebuild/core/types";
import type {SpotifyCatalogProvider} from "../src/rebuild/server/providers";
import {planArtistCatalogRefresh} from "../src/rebuild/recommendations/artistRefresh";

const now=Date.parse("2026-11-14T12:00:00Z"),artist={id:884659,name:"Alec Benjamin"};
const account="11111111-1111-4111-8111-111111111111";
const selection={name:artist.name,reference:{provider:"deezer" as const,id:String(artist.id)},selectionKey:`artist:deezer:${artist.id}`};
const rawTrack=(id:number,title:string)=>({id,title,duration:180,artist,contributors:[{...artist,role:"Main"}]});
const release=(id:number,title:string,date:string)=>({id,title,release_date:date,artist,tracks:{data:[rawTrack(id+1,title)]}});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test("new singles after the old-album first page are expanded newest first with published dates",async()=>{
 const paths:string[]=[];
 const albums=Array.from({length:100},(_,i)=>({id:i+1,title:`Old album ${i}`,release_date:"2024-01-01"}));
 const catalog=new DeezerCatalogService((async input=>{
  const url=new URL(String(input));paths.push(url.pathname+url.search);
  if(url.pathname===`/artist/${artist.id}/albums`)return Response.json(url.searchParams.get("index")==="0"?{data:albums,total:103,next:"https://untrusted.invalid/not-followed"}:{data:[{id:1138031901,title:"Without My Strings",release_date:"2026-11-13"},{id:1117533712,title:"Follow Me",release_date:"2026-10-09"},{id:777,title:"Future song",release_date:"2026-12-01"}],total:103});
  if(url.pathname==="/album/1138031901")return Response.json(release(1138031901,"Without My Strings","2026-11-13"));
  if(url.pathname==="/album/1117533712")return Response.json(release(1117533712,"Follow Me","2026-10-09"));
  throw new Error(`Unexpected provider read ${url.pathname}`);
 }) as typeof fetch);
 const result=await catalog.recentArtistReleases(selection.reference,undefined,now);
 assert.deepEqual(result.map(item=>[item.title,item.releaseDate]),[["Without My Strings","2026-11-13"],["Follow Me","2026-10-09"]]);
 assert.equal(result[0].tracks[0].metadata.title,"Without My Strings");
 assert.deepEqual(paths.slice(0,2),[`/artist/${artist.id}/albums?limit=100&index=0`,`/artist/${artist.id}/albums?limit=100&index=100`]);
 assert.equal(paths.some(path=>path.includes("untrusted")),false);
});

test("release discovery rejects invalid/future dates and same-name artist identities",async()=>{
 const catalog=new DeezerCatalogService((async input=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith("/albums"))return Response.json({data:[{id:10,release_date:"2026-11-13"},{id:20,release_date:"2026-02-30"},{id:30,release_date:"2026"},{id:40,release_date:"2026-12-01"}]});
  const value=release(10,"Same name, different artist","2026-11-13");value.tracks.data[0].artist={...artist,id:99};return Response.json(value);
 }) as typeof fetch);
 assert.deepEqual(await catalog.recentArtistReleases(selection.reference,undefined,now),[]);
 await assert.rejects(catalog.recentArtistReleases({provider:"deezer",id:"../other"},undefined,now),/Invalid artist/);
 const stop=new AbortController();stop.abort();await assert.rejects(catalog.recentArtistReleases(selection.reference,stop.signal,now),{name:"AbortError"});
});

test("a failed newest release detail remains retryable instead of a completed empty release scan",async()=>{
 const catalog=new DeezerCatalogService((async input=>new URL(String(input)).pathname.endsWith("/albums")?Response.json({data:[{id:10,release_date:"2026-11-13"}]}):Response.json({error:{code:4}},{status:503})) as typeof fetch);
 await assert.rejects(catalog.recentArtistReleases(selection.reference,undefined,now),/Recent release details/);
});

test("recent artist discovery bounds unending pagination and expands Spotify singles by exact artist reference",async()=>{
 let pages=0;
 const endless=new DeezerCatalogService((async()=>{pages++;return Response.json({data:Array.from({length:100},(_,index)=>({id:index+1,release_date:"2020-01-01"})),next:"https://untrusted.invalid/next",total:100000});}) as typeof fetch);
 assert.deepEqual(await endless.recentArtistReleases(selection.reference,undefined,now),[]);assert.equal(pages,4);
 const artistId="B".repeat(22),albumId="A".repeat(22),trackId="C".repeat(22);
 const spotify={async getMetadata(path:string){
  if(path.startsWith(`/artists/${artistId}/albums`))return {items:[{id:albumId,release_date:"2026-11-13"}],total:1};
  if(path===`/albums/${albumId}`)return {id:albumId,name:"A new single",release_date:"2026-11-13",artists:[{id:artistId,name:"Chosen artist"}],tracks:{items:[{id:trackId,name:"A new single",duration_ms:180000,artists:[{id:artistId,name:"Chosen artist"}],external_ids:{}}]}};
  if(path===`/artists/${artistId}`)return {id:artistId,name:"Chosen artist",images:[]};
  throw new Error("Unexpected Spotify metadata request");
 }} as unknown as SpotifyCatalogProvider;
 const catalog=new DeezerCatalogService((async()=>{throw new Error("Deezer should not be queried for a Spotify artist");}) as typeof fetch,spotify);
 const releases=await catalog.recentArtistReleases({provider:"spotify",id:artistId},undefined,now);
 assert.equal(releases[0].tracks[0].reference.id,trackId);assert.equal(releases[0].releaseDate,"2026-11-13");
});

function fixture(t:TestContext){
 const runtime=globalThis as unknown as {sakuraV2ProductPool?:unknown;sakuraV2Services?:unknown;sakuraV2ServicesKey?:string;sakuraV2Generation?:symbol;sakuraFeedCatalogRefreshes?:Map<string,unknown>;sakuraFeedCatalogActive?:Map<string,Promise<void>>};
 const previous={pool:runtime.sakuraV2ProductPool,services:runtime.sakuraV2Services,key:runtime.sakuraV2ServicesKey,generation:runtime.sakuraV2Generation,checks:runtime.sakuraFeedCatalogRefreshes,active:runtime.sakuraFeedCatalogActive};
 let marker:Record<string,unknown>|undefined,clock=now,interestedRows:Record<string,unknown>[]=[];
 const statements:{text:string;args:unknown[]}[]=[],indexed:string[]=[];
 const sql={async query(text:string,args:unknown[]=[]){
  statements.push({text,args});let rows:unknown[]=[];
  if(text.startsWith("SELECT preferences->'feedCatalogRefresh'"))rows=[{marker}];
  else if(text.startsWith("SELECT a.provider"))rows=interestedRows;
  else if(text.startsWith("SELECT preferences,seed_artists"))rows=[{preferences:{feedCatalogRefresh:marker},seed_artists:[artist.name],seed_genres:[],onboarded:true,revision:7,field_revisions:{theme:7}}];
  else if(text.startsWith('INSERT INTO sakura_v2."AccountPreferences"')&&text.includes("feedCatalogRefresh")){
   const incoming=JSON.parse(String(args[1])),at=Number(args[3]);
   if(!marker||marker.signature!==incoming.signature||Number(marker.pendingUntil||0)<=at&&Number(marker.completedAt||0)<=Number(args[4])&&Number(marker.retryAt||0)<=at){marker=incoming;rows=[{account_id:account}];}
  }else if(text.startsWith('UPDATE sakura_v2."AccountPreferences"')&&text.includes("claimId")){
   if(marker?.claimId===args[2]){marker=JSON.parse(String(args[1]));rows=[{account_id:account}];}
  }else if(text.includes("preferences-'feedCatalogRefresh'")){marker=undefined;}
  else if(text.startsWith('UPDATE sakura_v2."AccountPreferences"'))rows=[{account_id:account}];
  return {rows:structuredClone(rows),rowCount:rows.length};
 },async connect(){return {query:this.query,release(){}};}};
 runtime.sakuraV2ProductPool=sql;runtime.sakuraV2ServicesKey=undefined;runtime.sakuraFeedCatalogRefreshes=new Map();runtime.sakuraFeedCatalogActive=new Map();
 t.after(()=>{runtime.sakuraV2ProductPool=previous.pool;runtime.sakuraV2Services=previous.services;runtime.sakuraV2ServicesKey=previous.key;runtime.sakuraV2Generation=previous.generation;runtime.sakuraFeedCatalogRefreshes=previous.checks;runtime.sakuraFeedCatalogActive=previous.active;});
 t.mock.method(Date,"now",()=>clock);
 t.mock.method(globalThis,"fetch",async()=>{throw new Error("External network is forbidden in this fixture");});
 const services=getRebuildServices();
 t.mock.method(services.catalog,"detail",async()=>({tracks:[{reference:{provider:"deezer",id:"1"},metadata:{title:"Old hit",artists:[artist.name]}}]}));
 t.mock.method(services.catalog,"search",async()=>({tracks:[]}));
 t.mock.method(services.catalog,"charts",async()=>({tracks:[]}));
 t.mock.method(services.catalog,"recentArtistReleases",async()=>[{reference:{provider:"deezer",id:"1138031901"},title:"Without My Strings",releaseDate:"2026-11-13",genres:["Pop"],tracks:[{reference:{provider:"deezer",id:"1138031902"},metadata:{title:"Without My Strings",artists:[artist.name]}}]}]);
 t.mock.method(services.ingestor,"ensureRecording",async (reference:ProviderReference)=>{indexed.push(reference.id);return {} as never;});
 const settings={...DEFAULT_SETTINGS,seedArtists:[artist.name],seedGenres:[],seedArtistSelections:[selection],revision:7,fieldRevisions:{theme:7},onboarded:true};
 return {runtime,services,sql,indexed,statements,settings,marker:()=>marker,advance:(ms:number)=>{clock+=ms;},setInterested:(rows:Record<string,unknown>[])=>{interestedRows=rows;}};
}

test("fresh singles absent from top tracks are exactly indexed before top hits and retain release metadata",async t=>{
 const f=fixture(t);
 const result=await seedCandidateCatalog({artistSelections:[selection],perArtist:2,includeCharts:false,includeRecentReleases:true});
 assert.deepEqual(f.indexed,["1138031902","1"]);assert.equal(result.indexed,2);assert.equal(result.failed,0);
 const dateWrite=f.statements.find(item=>item.text.startsWith('UPDATE sakura_v2."Album" a SET release_date'))!;
 assert.deepEqual(JSON.parse(String(dateWrite.args[0])),[{provider:"deezer",id:"1138031901",releaseDate:"2026-11-13",genres:["Pop"]}]);
});

test("catalog completion persists across instances and status never projects candidates or changes setting revisions",async t=>{
 const f=fixture(t),gate=deferred();
 t.mock.method(f.services.catalog,"recentArtistReleases",async()=>{await gate.promise;return [];});
 assert.equal((await feedCatalogRefreshStatus(account,f.settings)).pending,true);
 const first=refreshFeedCatalog(account,f.settings),second=refreshFeedCatalog(account,f.settings);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal((await feedCatalogRefreshStatus(account,f.settings)).pending,true);gate.resolve();await Promise.all([first,second]);
 assert.equal(f.statements.filter(item=>item.text.startsWith('INSERT INTO sakura_v2."AccountPreferences"')&&item.text.includes("feedCatalogRefresh")).length,1);
 assert.ok(f.statements.some(item=>item.text.startsWith('UPDATE sakura_v2."Mix" SET expires_at=now()')),"Catalog completion expires persisted mixes so new release membership can regenerate");
 assert.equal((await feedCatalogRefreshStatus(account,f.settings)).pending,false);
 f.runtime.sakuraFeedCatalogRefreshes=new Map();f.runtime.sakuraFeedCatalogActive=new Map();f.statements.length=0;
 const anotherInstance=await feedCatalogRefreshStatus(account,f.settings);
 assert.deepEqual(anotherInstance,{pending:false,completedAt:now,retryAfterMs:2000});
 assert.equal(f.statements.length,1);assert.ok(f.statements[0].text.startsWith("SELECT preferences->'feedCatalogRefresh'"));
 const settings=await getSettingsSnapshot(account,getRebuildPool());
 assert.equal(settings.revision,7);assert.deepEqual(settings.fieldRevisions,{theme:7});assert.equal("feedCatalogRefresh" in settings,false);
 assert.ok(f.statements.every(item=>!item.text.includes("WITH known AS")));
 // A favorite on another instance removes the durable marker while this
 // instance still has a warm completion cache.
 await invalidateFeedCatalog(account,getRebuildPool());
 f.runtime.sakuraFeedCatalogRefreshes=new Map([[account,{at:now,signature:JSON.stringify([f.settings.seedArtists,f.settings.seedGenres,f.settings.seedArtistSelections,f.settings.learnFromListening])}]]);
 assert.equal((await feedCatalogRefreshStatus(account,f.settings)).pending,true);
});

test("failed indexing has no success cooldown and a short retry backoff; deliberate interest clears it",async t=>{
 const f=fixture(t);
 t.mock.method(f.services.ingestor,"ensureRecording",async()=>{throw new Error("Provider unavailable");});
 await assert.rejects(refreshFeedCatalog(account,f.settings),/could not be refreshed/);
 assert.equal(f.marker()?.completedAt,null);assert.equal(f.marker()?.retryAt,now+60000);
 assert.deepEqual(await feedCatalogRefreshStatus(account,f.settings),{pending:true,completedAt:null,retryAfterMs:60000});
 const attempts=f.statements.filter(item=>item.text.startsWith('INSERT INTO sakura_v2."AccountPreferences"')).length;
 await refreshFeedCatalog(account,f.settings);
 assert.equal(f.statements.filter(item=>item.text.startsWith('INSERT INTO sakura_v2."AccountPreferences"')).length,attempts,"Backoff does not claim or restart provider indexing");
 await invalidateFeedCatalog(account,getRebuildPool());
 assert.equal(f.marker(),undefined);assert.equal((await feedCatalogRefreshStatus(account,f.settings)).pending,true);
});

test("an open feed can retry a failed catalog refresh after its backoff and observe actual completion",async t=>{
 const f=fixture(t);let fail=true;
 t.mock.method(f.services.ingestor,"ensureRecording",async()=>{if(fail)throw new Error("Temporary catalog outage");return {} as never;});
 await assert.rejects(refreshFeedCatalog(account,f.settings));
 f.advance(60001);fail=false;
 assert.deepEqual(await feedCatalogRefreshStatus(account,f.settings),{pending:true,completedAt:null,retryAfterMs:2000});
 await refreshFeedCatalog(account,f.settings);
 assert.deepEqual(await feedCatalogRefreshStatus(account,f.settings),{pending:false,completedAt:now+60001,retryAfterMs:2000});
});

test("twenty onboarding choices cannot starve a newly liked artist and later batches cover every chosen tail",async t=>{
 const f=fixture(t),chosen=Array.from({length:20},(_,index)=>({name:`Chosen ${index}`,reference:{provider:"deezer" as const,id:String(index+700)},selectionKey:`artist:deezer:${index+700}`}));
 f.settings.seedArtistSelections=chosen;f.settings.seedArtists=chosen.map(artist=>artist.name);
 f.setInterested([{name:artist.name,provider:"deezer",externalId:String(artist.id)}]);
 const captured:string[]=[];
 t.mock.method(f.services.catalog,"recentArtistReleases",async (reference:ProviderReference)=>{captured.push(reference.id);return [];});
 await refreshFeedCatalog(account,f.settings);
 assert.ok(captured.includes(selection.reference.id));assert.ok(captured.length<=20);
 const covered=new Set<string>();
 for(let cycle=0;cycle<5;cycle++){
  const batch=planArtistCatalogRefresh(chosen,chosen.map(artist=>artist.name),[selection],now+cycle*30*60*1000);
  assert.ok(batch.artistSelections.some(artist=>artist.reference.id===selection.reference.id));assert.ok(batch.artistSelections.length+batch.artists.length<=20);
  for(const artist of batch.artistSelections)covered.add(artist.reference.id);
 }
 assert.ok(chosen.every(artist=>covered.has(artist.reference.id)));
});
