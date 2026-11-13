import assert from "node:assert/strict";
import {test,type TestContext} from "node:test";
import type {PoolClient} from "pg";
import {getSettings,getSettingsSnapshot} from "../src/rebuild/data/settings";
import {getTasteState} from "../src/rebuild/data/tasteState";
import {getListeningEvidence} from "../src/rebuild/data/listeningEvidence";
import {getPersonalizedFeed,getPersonalizedHero,personalizedFeedSettings} from "../src/rebuild/recommendations/feed";
import {refreshFeedCatalog} from "../src/rebuild/recommendations/catalog";
import {DEFAULT_SETTINGS} from "../src/rebuild/data/validation";

const account="11111111-1111-4111-8111-111111111111",now=Date.parse("2026-11-12T12:00:00Z");
const uuid=(index:number)=>`55555555-5555-4555-8555-${String(index).padStart(12,"0")}`;
function fixture(t:TestContext,count=632){
 const runtime=globalThis as unknown as {sakuraV2ProductPool?:unknown},previous=runtime.sakuraV2ProductPool;
 const statements:{text:string;args:unknown[]}[]=[],sessions=new Map<string,Record<string,unknown>>();let seeds:string[]=[],boost:string|undefined;
 const recordings=Array.from({length:40},(_,index)=>({id:uuid(index+1),metadata:{title:`Song ${index}`,artists:[`Artist ${index%9}`],artistsComplete:true,durationMs:180000,genres:[index%2?"Jazz":"Pop"]},provenance:{},references:[{provider:"deezer",id:String(index+1)}],ready:true}));
 const deletions=Array.from({length:725},(_,index)=>({periodStart:`2026-10-${String(index%28+1).padStart(2,"0")}T00:00:00Z`,clearedAt:`2026-11-12T${String(index%24).padStart(2,"0")}:00:00Z`}));
 const evidence=Array.from({length:count},(_,index)=>({recordingId:uuid(index+1),audibleMs:String((count-index)*1000),playCount:"2",completedCount:"1",skippedCount:"0",lastPlayedAt:"2026-11-11T12:00:00Z",hourWeights:[{hour:12,audibleMs:1000}]}));
 const feedback=[{target:"recording",targetId:uuid(1),kind:"less",expiresAt:"2026-11-01T00:00:00Z",updatedAt:"2026-10-31T00:00:00.000001Z",active:false}];
 const sql={async query(text:string,args:unknown[]=[]){
  statements.push({text,args});let rows:unknown[]=[];
  if(text.includes('FROM sakura_v2."AccountPreferences"'))rows=[{preferences:{},seed_artists:seeds,seed_genres:[],onboarded:true,revision:8,field_revisions:{}}];
  else if(text.includes("SELECT songs.recording_id"))rows=[];
  else if(text.startsWith('UPDATE sakura_v2."AccountPreferences"'))rows=[{account_id:account}];
  else if(text.startsWith("WITH selected AS")){
   const ordered=evidence.map(row=>row.recordingId===boost?{...row,audibleMs:"999999999"}:row).sort((a,b)=>Number(b.audibleMs)-Number(a.audibleMs)||a.recordingId.localeCompare(b.recordingId));
   rows=args[2]===null?ordered:ordered.slice(0,Number(args[2]));
  }else if(text.includes('FROM sakura_v2."HistoryDeletion"'))rows=deletions;
  else if(text.startsWith("WITH known AS"))rows=recordings;
  else if(text.startsWith("SELECT\n    CASE WHEN"))rows=[{listens:[],favorites:[uuid(2)],feedback:[],hours:[]}];
  else if(text.includes('FROM sakura_v2."TasteFeedback"'))rows=feedback;
  else if(text.startsWith("SELECT r.id"))rows=recordings.filter(row=>(args[1] as string[]).includes(row.id));
  else if(text.startsWith('INSERT INTO sakura_v2."FeedSession"')){
   const id=uuid(1000+sessions.size);const row={id,entries:JSON.parse(String(args[3])),cursor_secret:args[4],settings_signature:args[5],generated_at:new Date(now),expires_at:new Date(now+6*3600000),surface:args[1],mode:args[2],personalized:args[6]};sessions.set(id,row);rows=[row];
  }else if(text.includes('FROM sakura_v2."FeedSession"')&&text.startsWith("SELECT")){const row=sessions.get(String(args[1]));if(row)rows=[row];}
  return{rows:structuredClone(rows),rowCount:rows.length};
 },async connect(){return{query:this.query,release(){}};}};
 runtime.sakuraV2ProductPool=sql;t.after(()=>{runtime.sakuraV2ProductPool=previous;});
 return{sql:sql as unknown as {query:PoolClient["query"]},statements,recordings,deletions,evidence,setSeeds:(value:string[])=>{seeds=value;},boost:(id:string)=>{boost=id;}};
}

test("pure settings snapshots derive missing initial taste without UPDATE while legacy repair remains durable",async t=>{
 const f=fixture(t);f.setSeeds(["Artist"]);
 const snapshot=await getSettingsSnapshot(account,f.sql);assert.ok(snapshot.initialTasteProfile);assert.equal(snapshot.initialTasteProfile?.artists.length,1);
 assert.equal(f.statements.some(row=>row.text.startsWith("UPDATE")),false);
 f.statements.length=0;const durable=await getSettings(account,f.sql);assert.equal(durable.initialTasteProfile?.signature,snapshot.initialTasteProfile?.signature);
 assert.equal(f.statements.filter(row=>row.text.startsWith('UPDATE sakura_v2."AccountPreferences"')).length,1);
});

test("taste sync selects exactly the retained top 500 before hourly work and keeps every erasure receipt",async t=>{
 const f=fixture(t),sync=await getTasteState(account,{sync:true});
 assert.equal(sync.tasteEvidence.length,500);assert.equal(sync.tasteEvidence[499].recordingId,uuid(500));assert.equal(sync.historyDeletions.length,725);
 assert.deepEqual(sync.historyDeletions,f.deletions);assert.equal(sync.feedback[0].active,false);assert.equal("track" in sync.feedback[0],false);
 assert.equal(f.statements.some(row=>row.text.startsWith("SELECT r.id")),false);
 const bounded=f.statements.find(row=>row.text.startsWith("WITH selected AS"))!;assert.equal(bounded.args[2],500);
 assert.ok(bounded.text.indexOf("LIMIT $3::integer")<bounded.text.indexOf("hourly AS"));assert.match(bounded.text,/JOIN selected included ON included.recording_id=l.recording_id/);
 f.boost(uuid(632));const updated=await getTasteState(account,{sync:true});assert.equal(updated.tasteEvidence[0].recordingId,uuid(632));assert.equal(updated.tasteEvidence.some(row=>row.recordingId===uuid(500)),false);
 f.statements.length=0;const full=await getTasteState(account);assert.equal(full.tasteEvidence.length,632);assert.equal("track" in full.feedback[0],true);assert.deepEqual(full.historyDeletions,f.deletions);
 assert.equal(f.statements.find(row=>row.text.startsWith("WITH selected AS"))!.args[2],null);
 assert.ok(f.statements.every(row=>!/^(?:INSERT|UPDATE|DELETE)/.test(row.text)));
 await assert.rejects(getListeningEvidence(account,"UTC",f.sql,{limit:0}),RangeError);
});

test("combined initial hero is identical to standalone and acquires context and card hydration once",async t=>{
 const f=fixture(t);t.mock.method(Date,"now",()=>now);
 for(const surface of ["home","discover"]){
  const url=new URL(`https://example.test/api/v2/feed?surface=${surface}&limit=12&includeHero=1`);f.statements.length=0;
  const page=await getPersonalizedFeed(account,url),initial=f.statements.slice();assert.ok(page.hero);assert.ok(personalizedFeedSettings(page));
  assert.equal(initial.filter(row=>row.text.startsWith("WITH known AS")).length,1);assert.equal(initial.filter(row=>row.text.startsWith("SELECT\n    CASE WHEN")).length,1);
  assert.equal(initial.filter(row=>row.text.startsWith("SELECT r.id")).length,1);
  const hero=await getPersonalizedHero(account,url);assert.deepEqual(page.hero,hero);
  assert.ok(page.nextCursor);const cursor=new URL(url);cursor.searchParams.set("cursor",page.nextCursor!);f.statements.length=0;
  const continued=await getPersonalizedFeed(account,cursor);assert.equal("hero" in continued,false);assert.equal(continued.sessionId,page.sessionId);
  assert.equal(f.statements.some(row=>row.text.startsWith("WITH known AS")),false);assert.equal(f.statements.some(row=>row.text.startsWith('INSERT INTO sakura_v2."FeedSession"')),false);
 }
});

test("an after-response compatible settings snapshot bypasses all SQL on a warm catalog cooldown",async t=>{
 const f=fixture(t),settings={...DEFAULT_SETTINGS,seedArtists:[],seedGenres:[],revision:1,fieldRevisions:{},onboarded:true};
 const runtime=globalThis as unknown as {sakuraFeedCatalogRefreshes?:Map<string,{at:number;signature:string}>},previous=runtime.sakuraFeedCatalogRefreshes;
 runtime.sakuraFeedCatalogRefreshes=new Map([[account,{at:Date.now(),signature:JSON.stringify([settings.seedArtists,settings.seedGenres,settings.seedArtistSelections,settings.learnFromListening])}]]);
 t.after(()=>{runtime.sakuraFeedCatalogRefreshes=previous;});
 await refreshFeedCatalog(account,settings);assert.equal(f.statements.length,0);
});
