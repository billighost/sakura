import assert from "node:assert/strict";
import {describe,it} from "node:test";
import type {Pool} from "pg";
import {bloomWindow} from "../src/rebuild/bloom/calendar";
import {createBloomExperience} from "../src/rebuild/bloom/experience";
import {getBloom,listBloom,listBloomShelf,revealBloom,completeBloom,archivedBloom} from "../src/rebuild/bloom/service";
import {ProductError} from "../src/rebuild/data/validation";
import type {BloomSnapshot} from "../src/rebuild/bloom/snapshot";

type Stored={account_id:string;recap_id:string;time_zone:string;period_start:string;period_end:string;snapshot:BloomSnapshot;revealed_chapters:string[];completed_at:Date|null;created_at:Date};
const stored=new Map<string,Stored>(),timeZones=new Map<string,string>();
const key=(account:string,id:string)=>`${account}|${id}`;
const query=async(statement:string,args:unknown[]=[])=>{
 const result=(rows:unknown[])=>({rows,rowCount:rows.length});
 if(["BEGIN","COMMIT","ROLLBACK"].includes(statement)||statement.includes("pg_advisory_xact_lock"))return result([]);
 const account=String(args[0]),id=String(args[1]);
 if(statement.includes('FROM sakura_v2."AccountPreferences"'))return result(timeZones.has(account)?[{preferences:{timeZone:timeZones.get(account)}}]:[]);
 if(statement.startsWith("WITH measured"))return result(account==="source"?[{id:"source-recording",audible_ms:120000,plays:4,first_ever:"2026-10-10T12:00:00Z",previous_ms:0,previous_plays:0,known_before:false,unknown_history:false}]:[]);
 if(statement.includes("AS hour,")&&statement.includes('FROM sakura_v2."ListeningChunk" c'))return result([
  {hour:13,date:"2026-10-10",context:"playlist",audible_ms:"60000"},
  {hour:13,date:"2026-10-10",context:"mix",audible_ms:"30000"},
  {hour:13,date:"2026-10-10",context:null,audible_ms:"15000"},
  {hour:13,date:"2026-10-10",context:"custom-value",audible_ms:"15000"},
 ]);
 if(statement.includes('FROM sakura_v2."Recording" r'))return result([]);
 if(statement.includes("SELECT EXISTS("))return result([{present:false}]);
 if(statement.startsWith('INSERT INTO sakura_v2."BloomRecap"')){
  const row:Stored={account_id:account,recap_id:id,time_zone:String(args[2]),period_start:String(args[3]),period_end:String(args[4]),snapshot:JSON.parse(String(args[5])),revealed_chapters:[],completed_at:null,created_at:new Date("2026-11-07T10:00:00Z")};
  stored.set(key(account,id),row);return result([structuredClone(row)]);
 }
 if(statement.startsWith('UPDATE sakura_v2."BloomRecap"')){
  const row=stored.get(key(account,id));if(!row)return result([]);
  if(statement.includes("revealed_chapters="))row.revealed_chapters=[...(args[2] as string[])];
  else row.completed_at ||= args[2] as Date;
  return result([structuredClone(row)]);
 }
 if(statement.includes('FROM sakura_v2."BloomRecap"')){
  const rows=[...stored.values()].filter(row=>row.account_id===account);
  if(statement.includes("recap_id LIKE 'yearly-%'"))return result(rows.filter(row=>row.recap_id.startsWith("yearly-")&&row.completed_at&&(args[1]===null||row.recap_id===`yearly-${args[1]}`)).map(row=>structuredClone(row)));
  if(statement.includes("recap_id=ANY"))return result(rows.filter(row=>(args[1] as string[]).includes(row.recap_id)).map(row=>({recap_id:row.recap_id,time_zone:row.time_zone,world_id:row.snapshot.worldId,version:String(row.snapshot.version),chapter_count:row.snapshot.chapters.length,completed_at:row.completed_at,experience:row.snapshot.experience,listening:undefined})));
  const row=stored.get(key(account,id));return result(row?[structuredClone(row)]:[]);
 }
 throw new Error(`Unexpected fixture operation: ${statement.slice(0,100)}`);
};
(globalThis as unknown as {sakuraV2ProductPool:Pool}).sakuraV2ProductPool={connect:async()=>({query,release:()=>{}})} as unknown as Pool;
const now=new Date("2026-11-07T12:00:00Z"),id="monthly-2026-10";
function fixture(account:string,recapId=id,version=4){
 const item=bloomWindow(recapId,now,"Africa/Lagos");
 const row:Stored={account_id:account,recap_id:recapId,time_zone:item.timeZone,period_start:item.periodStart,period_end:item.periodEnd,
  snapshot:{version,worldId:version===1?"herbarium":"sakura",...(version===4?{experience:createBloomExperience(`${account}|${recapId}|${item.timeZone}`,"sakura")}:{}),summary:{audibleMs:120000,playCount:2,recordingCount:1,activeDays:1},chapters:[
   {id:"listening-time",kind:"time",title:"Your original listening time.",prompt:"Original prompt",stat:{label:"of listening",value:"2 min",unit:""},relatedRecording:null},
   {id:"song-count",kind:"breadth",title:"Your original songs.",prompt:"Original song prompt",stat:{label:"songs",value:1,unit:"song"},relatedRecording:null},
  ]},revealed_chapters:[],completed_at:null,created_at:new Date("2026-11-07T10:00:00Z")};
 stored.set(key(account,recapId),row);return row;
}

describe("Bloom service persistence and reveal contracts without network",()=>{
 it("saves measured playback sources, keeps unknown origins out of rankings, and reveals them only with their chapter",async()=>{
  let recap=await getBloom("source",id,now);
  const index=recap.chapters.findIndex(chapter=>chapter.id==="listening-source");
  assert.ok(index>=0);assert.equal(recap.listening,undefined);assert.equal(recap.chapters[index].stat,null);
  for(const chapter of recap.chapters.slice(0,index))recap=await revealBloom("source",id,chapter.id,now);
  assert.equal(recap.listening?.sources,undefined);assert.equal(recap.listening?.unknownSourceMs,undefined);
  recap=await revealBloom("source",id,"listening-source",now);
  assert.deepEqual(recap.listening?.sources,[{id:"playlist",name:"Playlists",audibleMs:60000,share:.5},{id:"mix",name:"Mixes",audibleMs:30000,share:.25}]);
  assert.equal(recap.listening?.unknownSourceMs,30000);
  assert.match(recap.chapters[index].detail||"",/25% has no recognised source/);
  assert.deepEqual(await getBloom("source",id,new Date("2026-11-08T12:00:00Z")),recap);
 });
 it("reopens the stored words and experience next day using the story's original time zone",async()=>{
  fixture("stable");const original=await getBloom("stable",id,now);
  timeZones.set("stable","Pacific/Honolulu");
  const nextDay=new Date("2026-11-08T12:00:00Z");
  assert.deepEqual(await getBloom("stable",id,nextDay),original);
  const listed=(await listBloom("stable","monthly",nextDay)).items.find(item=>item.id===id);
  const shelf=(await listBloomShelf("stable",nextDay)).items.find(item=>item.id===id);
  assert.equal(listed?.timeZone,"Africa/Lagos");assert.equal(shelf?.timeZone,"Africa/Lagos");
  assert.deepEqual(listed?.experience,original.experience);assert.deepEqual(shelf?.experience,original.experience);
  assert.equal(original.chapters[0].stat,null);
 });
 it("rejects skipped reveals and premature completion, then preserves repeat reveals and completion dates",async()=>{
  fixture("sequence");
  await assert.rejects(revealBloom("sequence",id,"song-count",now),error=>error instanceof ProductError&&error.status===409);
  await assert.rejects(completeBloom("sequence",id,now),error=>error instanceof ProductError&&error.status===409);
  const first=await revealBloom("sequence",id,"listening-time",now);
  assert.equal(first.chapters[0].stat?.value,"2 min");assert.equal(first.chapters[1].stat,null);
  assert.deepEqual(await revealBloom("sequence",id,"listening-time",now),first);
  await revealBloom("sequence",id,"song-count",now);
  const completed=await completeBloom("sequence",id,now);
  const later=await completeBloom("sequence",id,new Date("2026-11-08T12:00:00Z"));
  assert.equal(completed.completed,true);assert.deepEqual(later,completed);
 });
 it("enforces opening and closing boundaries and does not reuse another account's snapshot",async()=>{
  fixture("owner");
  await assert.rejects(getBloom("owner","monthly-2026-11",now),error=>error instanceof ProductError&&error.status===423);
  const closes=new Date(bloomWindow(id,now).expiresAt);
  await assert.rejects(getBloom("owner",id,closes),error=>error instanceof ProductError&&error.status===410);
  const other=await getBloom("other",id,now);
  assert.equal(other.status,"empty");assert.equal(other.summary.audibleMs,0);assert.equal(other.chapters.length,0);
  assert.equal(stored.has(key("other",id)),false);
 });
 it("returns completed legacy yearly archives unchanged and accepts the supported 2100 boundary",async()=>{
  const row=fixture("archive","yearly-2025",1);row.revealed_chapters=row.snapshot.chapters.map(chapter=>chapter.id);row.completed_at=now;
  const archive=await archivedBloom("archive","2025",new Date("2027-01-01T12:00:00Z"));
  assert.equal(archive.items[0].worldId,"herbarium");assert.equal(archive.items[0].experience,undefined);assert.equal(archive.items[0].chapters[0].title,row.snapshot.chapters[0].title);
  assert.deepEqual((await archivedBloom("other","2025",new Date("2027-01-01T12:00:00Z"))).items,[]);
  assert.deepEqual((await archivedBloom("archive","2100",new Date("2102-01-01T12:00:00Z"))).items,[]);
 });
});

describe("Bloom local calendar edges",()=>{
 it("retains local month boundaries through half-hour daylight saving and a skipped calendar day",()=>{
  const lordHowe=bloomWindow("monthly-2026-10",now,"Australia/Lord_Howe");
  assert.equal(lordHowe.periodStart,"2026-09-30T13:30:00.000Z");assert.equal(lordHowe.periodEnd,"2026-10-31T13:00:00.000Z");
  const apia=bloomWindow("monthly-2011-12",now,"Pacific/Apia");
  assert.equal(apia.periodStart,"2011-12-01T10:00:00.000Z");assert.equal(apia.periodEnd,"2011-12-31T10:00:00.000Z");
 });
});
