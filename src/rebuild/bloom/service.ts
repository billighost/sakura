import type { PoolClient } from "pg";
import { inTransaction } from "../data/db";
import { cardsForIds } from "../data/catalog";
import { getSettings } from "../data/settings";
import { ProductError,text } from "../data/validation";
import { bloomWindow,bloomWindows,validTimeZone,DEFAULT_BLOOM_TIME_ZONE,type BloomWindow,type BloomPeriod } from "./calendar";

import {buildBloomSnapshot,discloseBloomChapter,type BloomSnapshot,type SavedBloomChapter} from "./snapshot";
import {bloomDesignForItem,legacyBloomDesignForMonth} from "./design";
import {bloomArtistKey,discloseBloomListening} from "./listening";
import {createBloomExperience} from "./experience";
import type {BloomShelfItem} from "./uiTypes";
export type BloomChapter = SavedBloomChapter;
async function zone(accountId:string,client:PoolClient){const settings=await getSettings(accountId,client);return validTimeZone(settings.timeZone)?settings.timeZone:DEFAULT_BLOOM_TIME_ZONE;}
function window(id:string,now:Date,timeZone:string){try{return bloomWindow(id,now,timeZone);}catch{throw new ProductError(400,"Invalid Bloom period");}}
function requireAvailable(item:BloomWindow){
  if(item.status==="locked")throw new ProductError(423,"This Bloom opens after the listening period ends");
  if(item.status==="expired")throw new ProductError(410,"This Bloom window has closed");
}
function fallbackWorld(item:BloomWindow,version:number){return version===1?legacyBloomDesignForMonth(item.periodStart,item.timeZone):bloomDesignForItem({...item,version});}
const experienceIdentity=(accountId:string,item:BloomWindow)=>`${accountId}|${item.id}|${item.timeZone}`;
async function snapshot(accountId:string,item:BloomWindow,client:PoolClient):Promise<BloomSnapshot>{
  const previous=bloomWindows(item.period,new Date(item.periodStart),item.timeZone)[0];
  const args=[accountId,item.periodStart,item.periodEnd,previous.periodStart];
  // One retained-history scan replaces a correlated scan for every recording.
  // Receipt creation dates are not invented listening dates for old imports.
  const allRows=(await client.query(`WITH measured AS (
    SELECT l.recording_id AS id,SUM(c.audible_ms)::bigint AS all_ms,
      COALESCE(SUM(c.audible_ms) FILTER(WHERE c.occurred_at>=$2::timestamptz AND c.occurred_at<$3::timestamptz),0)::bigint AS audible_ms,
      COUNT(DISTINCT c.event_id) FILTER(WHERE c.occurred_at>=$2::timestamptz AND c.occurred_at<$3::timestamptz)::integer AS plays,
      COALESCE(SUM(c.audible_ms) FILTER(WHERE c.occurred_at>=$4::timestamptz AND c.occurred_at<$2::timestamptz),0)::bigint AS previous_ms,
      COUNT(DISTINCT c.event_id) FILTER(WHERE c.occurred_at>=$4::timestamptz AND c.occurred_at<$2::timestamptz)::integer AS previous_plays,
      MIN(c.occurred_at) AS first_ever,
      MIN(c.occurred_at) FILTER(WHERE c.occurred_at>=$2::timestamptz AND c.occurred_at<$3::timestamptz) AS first_in_period,
      BOOL_OR(c.occurred_at<$2::timestamptz) AS known_before,
      BOOL_OR(c.occurred_at IS NULL) AS unknown_date
    FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
    WHERE c.account_id=$1::uuid AND c.audible_ms>0 GROUP BY l.recording_id
  ) SELECT COALESCE(m.id,s.recording_id) AS id,COALESCE(m.audible_ms,0) AS audible_ms,COALESCE(m.plays,0) AS plays,
      COALESCE(m.previous_ms,0) AS previous_ms,COALESCE(m.previous_plays,0) AS previous_plays,m.first_ever,m.first_in_period,
      COALESCE(m.known_before,false) AS known_before,
      (COALESCE(m.unknown_date,false) OR COALESCE(s.audible_ms,0)>COALESCE(m.all_ms,0)) AS unknown_history,
      EXISTS(SELECT 1 FROM sakura_v2."ArchivedListeningRecording" WHERE account_id=$1::uuid AND audible_ms>0) AS incomplete_history
    FROM measured m FULL JOIN (SELECT * FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid AND audible_ms>0) s ON s.recording_id=m.id
    WHERE COALESCE(m.audible_ms,0)>0 OR COALESCE(m.known_before,false) OR COALESCE(s.audible_ms,0)>COALESCE(m.all_ms,0)`,args)).rows;
  const recordings=allRows.filter(row=>Number(row.audible_ms)>0);
  if(!recordings.length)return buildBloomSnapshot([],[],0,item,{experienceIdentity:experienceIdentity(accountId,item)});
  // Group the same retained chunks by local date and hour once. UTC dates and
  // fixed 24-hour arithmetic would split streaks incorrectly around DST.
  const timedRows=(await client.query(`SELECT EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $4)::integer AS hour,
      (c.occurred_at AT TIME ZONE $4)::date::text AS date,
      COALESCE(to_jsonb(l)->>'context',e.context) AS context,SUM(c.audible_ms)::text AS audible_ms
    FROM sakura_v2."ListeningChunk" c
      JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      LEFT JOIN sakura_v2."ListeningEvent" e ON e.account_id=l.account_id AND e.event_id=l.event_id
    WHERE c.account_id=$1::uuid AND c.audible_ms>0
      AND c.occurred_at>=$2::timestamptz AND c.occurred_at<$3::timestamptz GROUP BY 1,2,3 ORDER BY 2,1,3`,[accountId,item.periodStart,item.periodEnd,item.timeZone])).rows;
  // Read the durable source when present, falling back only to a retained
  // original event. Older compacted events remain unknown; no source is guessed.
  // to_jsonb also lets recaps stay readable before the additive migration.
  const daily=new Map<string,number>(),sources=new Map<string|null,number>();
  for(const row of timedRows){
    const audibleMs=Number(row.audible_ms),context=typeof row.context==="string"?row.context:null;
    daily.set(row.date,(daily.get(row.date)||0)+audibleMs);
    sources.set(context,(sources.get(context)||0)+audibleMs);
  }
  const days=daily.size;
  const cards=await cardsForIds(accountId,allRows.map(r=>r.id),client),byId=new Map(cards.map(card=>[card.id,card]));
  const keys=(rows:typeof allRows)=>rows.flatMap(row=>{const card=byId.get(row.id),key=card?bloomArtistKey(card):null;return key?[key]:[];});
  const priorRows=allRows.filter(row=>Number(row.previous_ms)>0).map(row=>({...row,audible_ms:row.previous_ms,plays:row.previous_plays}));
  return buildBloomSnapshot(recordings,cards,days,item,{hours:timedRows.map(row=>({hour:Number(row.hour),audibleMs:Number(row.audible_ms)})),
    days:[...daily].map(([date,audibleMs])=>({date,audibleMs})),sources:[...sources].map(([context,audibleMs])=>({context,audibleMs})),experienceIdentity:experienceIdentity(accountId,item),
    knownBeforeRecordingIds:allRows.filter(row=>row.known_before).map(row=>row.id),knownBeforeArtistKeys:keys(allRows.filter(row=>row.known_before)),
    discoveryUnknownIds:allRows.filter(row=>row.unknown_history).map(row=>row.id),discoveryUnknownArtistKeys:keys(allRows.filter(row=>row.unknown_history)),discoveryHistoryIncomplete:Boolean(allRows[0]?.incomplete_history),
    previous:{periodLabel:`Previous ${item.period==="weekly"?"week":item.period==="monthly"?"month":"year"}`,rows:priorRows,cards}});
}

function view(item:BloomWindow,row:{snapshot:BloomSnapshot;revealed_chapters:string[];completed_at:Date|null;created_at?:Date|string}) {
  const revealed=new Set(row.revealed_chapters);
  const kinds=new Set(row.snapshot.chapters.filter(chapter=>revealed.has(chapter.id)).flatMap(chapter=>[chapter.kind||"",chapter.id]));
  return {...item,version:row.snapshot.version||1,worldId:row.snapshot.worldId||fallbackWorld(item,row.snapshot.version||1),experience:row.snapshot.experience,status:row.snapshot.chapters.length?item.status:"empty",summary:row.snapshot.summary,chapterCount:row.snapshot.chapters.length,
    snapshotCreatedAt:row.created_at?new Date(row.created_at).toISOString():undefined,
    listening:discloseBloomListening(row.snapshot.listening,kinds,Boolean(row.completed_at)),
    chapters:row.snapshot.chapters.map(c=>discloseBloomChapter(c,revealed.has(c.id))),
    completedAt:row.completed_at,completed:Boolean(row.completed_at)};
}
export async function listBloom(accountId:string,rawPeriod:string|null,now=new Date()){
  const period=(rawPeriod||"weekly") as BloomPeriod;if(!["weekly","monthly","yearly"].includes(period))throw new ProductError(400,"Invalid Bloom period");
  return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const timeZone=await zone(accountId,client),items=[];
  for(const item of bloomWindows(period,now,timeZone)){
    const saved=(await client.query(`SELECT snapshot,revealed_chapters,completed_at,time_zone FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[accountId,item.id])).rows[0];
    const effective=saved?window(item.id,now,saved.time_zone):item;
    let count=saved?.snapshot?.chapters?.length||0,status=effective.status as string;
    if(status==="available"&&!saved){
      count=(await snapshot(accountId,item,client)).chapters.length;
      if(!count)status="empty";
    }else if(status==="available"&&!count)status="empty";
    const version=saved?saved.snapshot.version||1:4;
    const worldId=saved?.snapshot?.worldId||fallbackWorld(effective,version);
    const experience=saved?saved.snapshot.experience:createBloomExperience(experienceIdentity(accountId,effective),worldId);
    items.push({...effective,version,worldId,experience,status,chapterCount:count,completed:Boolean(saved?.completed_at),listening:saved?.completed_at?saved.snapshot.listening:undefined,teaser:status==="locked"?"Your next music story is taking shape. The reveal is coming.":status==="empty"?"No dated listening was recorded during this period.":"The songs you loved. The moments you made. Your Bloom is ready."});
  }
  return {items,schedule:{timeZone,weekStartsOn:"monday",weeklyAvailableThrough:"saturday",monthlyClosesDaysBeforeNextMonth:7}};
  });
}
/** Home needs calendar readiness and completed cover details, not fresh stories.
 * Checking for dated audible chunks avoids rebuilding three period snapshots. */
export async function listBloomShelf(accountId:string,now=new Date()){
 return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const timeZone=await zone(accountId,client);
  const windows=(["weekly","monthly","yearly"] as const).flatMap(period=>bloomWindows(period,now,timeZone));
  const saved=(await client.query(`SELECT recap_id,time_zone,snapshot->>'worldId' AS world_id,snapshot->>'version' AS version,
   jsonb_array_length(snapshot->'chapters') AS chapter_count,completed_at,snapshot->'experience' AS experience,
   CASE WHEN completed_at IS NOT NULL THEN snapshot->'listening' END AS listening
   FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=ANY($2::text[])`,[accountId,windows.map(item=>item.id)])).rows;
  const items:BloomShelfItem[]=[];
  for(const item of windows){
   const row=saved.find(value=>value.recap_id===item.id),effective=row?window(item.id,now,row.time_zone):item;
   let status:BloomShelfItem["status"]=effective.status;
   if(status==="available"){
    const hasListening=row?Number(row.chapter_count)>0:(await client.query(`SELECT EXISTS(
     SELECT 1 FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l
      ON l.account_id=c.account_id AND l.event_id=c.event_id
     WHERE c.account_id=$1::uuid AND c.occurred_at>=$2::timestamptz AND c.occurred_at<$3::timestamptz AND c.audible_ms>0) AS present`,[accountId,effective.periodStart,effective.periodEnd])).rows[0].present;
    if(!hasListening)status="empty";
   }
   const version=row?Number(row.version)||1:4,worldId=row?.world_id||fallbackWorld(effective,version);
   items.push({...effective,status,version,worldId,
    experience:row?row.experience||undefined:createBloomExperience(experienceIdentity(accountId,effective),worldId),
    completed:Boolean(row?.completed_at),listening:row?.listening||undefined});
  }
  return {items,schedule:{timeZone}};
 });
}
export async function getBloom(accountId:string,id:string,now=new Date()){
  return inTransaction(async client=>{
    // A story cannot persist measurements while their owner is erasing them.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const timeZone=await zone(accountId,client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-bloom:${accountId}:${id}`]);
    let row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[accountId,id])).rows[0];
    const item=window(id,now,row?.time_zone||timeZone);requireAvailable(item);
    if(!row){
      const data=await snapshot(accountId,item,client);
      // A late offline sync can still contribute until someone starts a real
      // story. Empty periods must not be frozen permanently by opening the page.
      if(!data.chapters.length)return view(item,{snapshot:data,revealed_chapters:[],completed_at:null});
      row=(await client.query(`INSERT INTO sakura_v2."BloomRecap"(account_id,recap_id,time_zone,period_start,period_end,snapshot)
        VALUES($1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb) RETURNING *`,[accountId,id,item.timeZone,item.periodStart,item.periodEnd,JSON.stringify(data)])).rows[0];
    }
    return view(item,row);
  });
}
/** Explicit story entry may stage its immutable facts ahead of navigation.
 * Keep the ordinary view concealed and never advance the saved reveal frontier
 * or completion date merely because the browser prepared the next scenes. */
export async function prepareBloom(accountId:string,id:string,now=new Date()){
  const existing=await getBloom(accountId,id,now);
  if(existing.status==="empty")throw new ProductError(409,"This Bloom has no listening story yet");
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2 FOR SHARE`,[accountId,id])).rows[0];
    if(!row)throw new ProductError(404,"This listening story was removed. Refresh Bloom to continue.");
    const item=window(id,now,row.time_zone);requireAvailable(item);
    return {story:view(item,row),chapters:row.snapshot.chapters as SavedBloomChapter[],listening:row.snapshot.listening};
  });
}
export async function revealBloom(accountId:string,id:string,rawChapterId:unknown,now=new Date()){
  const chapterId=text(rawChapterId,"Bloom chapter",80);const existing=await getBloom(accountId,id,now);
  if(existing.status==="empty")throw new ProductError(409,"This Bloom has no listening story yet");
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2 FOR UPDATE`,[accountId,id])).rows[0];
    if(!row)throw new ProductError(404,"This listening story was removed. Refresh Bloom to continue.");
    const item=window(id,now,row.time_zone);requireAvailable(item);
    const chapters=row.snapshot.chapters as BloomChapter[],index=chapters.findIndex(c=>c.id===chapterId);
    if(index<0)throw new ProductError(404,"Bloom chapter not found");
    const revealed=new Set<string>(row.revealed_chapters);
    if(chapters.slice(0,index).some(c=>!revealed.has(c.id)))throw new ProductError(409,"Reveal the previous Bloom chapters first");
    revealed.add(chapterId);
    await client.query(`UPDATE sakura_v2."BloomRecap" SET revealed_chapters=$3::text[] WHERE account_id=$1::uuid AND recap_id=$2`,[accountId,id,[...revealed]]);
    return view(item,{...row,revealed_chapters:[...revealed]});
  });
}
export async function completeBloom(accountId:string,id:string,now=new Date()){
  const existing=await getBloom(accountId,id,now);
  if(existing.status==="empty")throw new ProductError(409,"This Bloom has no listening story yet");
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2 FOR UPDATE`,[accountId,id])).rows[0];
    if(!row)throw new ProductError(404,"This listening story was removed. Refresh Bloom to continue.");
    const item=window(id,now,row.time_zone);requireAvailable(item);
    if(!row.snapshot.chapters.length)throw new ProductError(409,"This Bloom has no listening story yet");
    if(row.snapshot.chapters.some((c:BloomChapter)=>!row.revealed_chapters.includes(c.id)))throw new ProductError(409,"Reveal every chapter before completing this Bloom");
    const updated=(await client.query(`UPDATE sakura_v2."BloomRecap" SET completed_at=COALESCE(completed_at,$3::timestamptz)
      WHERE account_id=$1::uuid AND recap_id=$2 RETURNING *`,[accountId,id,now])).rows[0];return view(item,updated);
  });
}
/** Only a completed yearly recap survives its opening window in the archive. */
export async function archivedBloom(accountId:string,year:string|null,now=new Date()){
  if(year!==null&&!/^(?:20\d{2}|2100)$/.test(year))throw new ProductError(400,"Invalid archive year");
  return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const rows=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id LIKE 'yearly-%'
    AND completed_at IS NOT NULL AND ($2::text IS NULL OR recap_id='yearly-'||$2) ORDER BY recap_id DESC`,[accountId,year])).rows;
  const items=rows.flatMap(row=>{const item=window(row.recap_id,now,row.time_zone);return item.status==="expired"?[{...view(item,row),status:"archived"}]:[];});
  return {items};
  });
}
