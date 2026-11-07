import type { PoolClient } from "pg";
import { getRebuildPool,inTransaction } from "../data/db";
import { cardsForIds } from "../data/catalog";
import { getSettings } from "../data/settings";
import { ProductError,text } from "../data/validation";
import { bloomWindow,bloomWindows,validTimeZone,DEFAULT_BLOOM_TIME_ZONE,type BloomWindow,type BloomPeriod } from "./calendar";

import {buildBloomSnapshot,discloseBloomChapter,type BloomSnapshot,type SavedBloomChapter} from "./snapshot";
import {bloomDesignForMonth,legacyBloomDesignForMonth} from "./design";
export type BloomChapter = SavedBloomChapter;
async function zone(accountId:string){const settings=await getSettings(accountId);return validTimeZone(settings.timeZone)?settings.timeZone:DEFAULT_BLOOM_TIME_ZONE;}
function window(id:string,now:Date,timeZone:string){try{return bloomWindow(id,now,timeZone);}catch{throw new ProductError(400,"Invalid Bloom period");}}
function requireAvailable(item:BloomWindow){
  if(item.status==="locked")throw new ProductError(423,"This Bloom opens after the listening period ends");
  if(item.status==="expired")throw new ProductError(410,"This Bloom window has closed");
}
async function snapshot(accountId:string,item:BloomWindow,client:PoolClient):Promise<BloomSnapshot>{
  const args=[accountId,item.periodStart,item.periodEnd,item.timeZone];
  const recordings=(await client.query(`SELECT l.recording_id AS id,SUM(c.audible_ms)::bigint AS audible_ms,
    COUNT(DISTINCT c.event_id)::integer AS plays,COUNT(DISTINCT (COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $4)::date)::integer AS active_days,
    MIN(COALESCE(c.occurred_at,c.created_at)) AS first_in_period,
    (SELECT MIN(COALESCE(all_c.occurred_at,all_c.created_at)) FROM sakura_v2."ListeningChunk" all_c
      JOIN sakura_v2."ListeningEventLedger" all_l ON all_l.account_id=all_c.account_id AND all_l.event_id=all_c.event_id
      WHERE all_c.account_id=$1::uuid AND all_l.recording_id=l.recording_id AND all_c.audible_ms>0) AS first_ever
    FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
    WHERE c.account_id=$1::uuid AND c.audible_ms>0 AND COALESCE(c.occurred_at,c.created_at)>=$2::timestamptz
      AND COALESCE(c.occurred_at,c.created_at)<$3::timestamptz
    GROUP BY l.recording_id ORDER BY SUM(c.audible_ms) DESC,l.recording_id`,args)).rows;
  const days=(await client.query(`SELECT COUNT(DISTINCT (COALESCE(occurred_at,created_at) AT TIME ZONE $4)::date)::integer n
    FROM sakura_v2."ListeningChunk" WHERE account_id=$1::uuid AND audible_ms>0
      AND COALESCE(occurred_at,created_at)>=$2::timestamptz AND COALESCE(occurred_at,created_at)<$3::timestamptz`,args)).rows[0].n;
  const cards=await cardsForIds(accountId,recordings.map(r=>r.id),client);
  return buildBloomSnapshot(recordings,cards,Number(days),item);
}

function view(item:BloomWindow,row:{snapshot:BloomSnapshot;revealed_chapters:string[];completed_at:Date|null}) {
  const revealed=new Set(row.revealed_chapters);
  return {...item,version:row.snapshot.version||1,worldId:row.snapshot.worldId||(row.snapshot.version===2?bloomDesignForMonth:legacyBloomDesignForMonth)(item.periodStart,item.timeZone),status:row.snapshot.chapters.length?item.status:"empty",summary:row.snapshot.summary,chapterCount:row.snapshot.chapters.length,
    chapters:row.snapshot.chapters.map(c=>discloseBloomChapter(c,revealed.has(c.id))),
    completedAt:row.completed_at,completed:Boolean(row.completed_at)};
}
export async function listBloom(accountId:string,rawPeriod:string|null,now=new Date()){
  const period=(rawPeriod||"weekly") as BloomPeriod;if(!["weekly","monthly","yearly"].includes(period))throw new ProductError(400,"Invalid Bloom period");
  const timeZone=await zone(accountId),items=[];
  for(const item of bloomWindows(period,now,timeZone)){
    const saved=(await getRebuildPool().query(`SELECT snapshot,revealed_chapters,completed_at,time_zone FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2`,[accountId,item.id])).rows[0];
    const effective=saved?window(item.id,now,saved.time_zone):item;
    let count=saved?.snapshot?.chapters?.length||0,status=effective.status as string;
    if(status==="available"&&!saved){
      const amount=(await getRebuildPool().query(`SELECT COALESCE(SUM(audible_ms),0)::bigint n FROM sakura_v2."ListeningChunk"
        WHERE account_id=$1::uuid AND COALESCE(occurred_at,created_at)>=$2::timestamptz AND COALESCE(occurred_at,created_at)<$3::timestamptz`,[accountId,item.periodStart,item.periodEnd])).rows[0].n;
      if(Number(amount)===0)status="empty";
      else count=(await inTransaction(client=>snapshot(accountId,item,client))).chapters.length;
    }else if(status==="available"&&!count)status="empty";
    items.push({...effective,version:saved?saved.snapshot.version||1:2,worldId:saved?.snapshot?.worldId||(saved&&(saved.snapshot.version||1)===1?legacyBloomDesignForMonth:bloomDesignForMonth)(effective.periodStart,effective.timeZone),status,chapterCount:count,completed:Boolean(saved?.completed_at),teaser:status==="locked"?"Your next listening story is still growing.":status==="empty"?"No listening was recorded during this period.":"A story made from the music you actually heard."});
  }
  return {items,schedule:{timeZone,weekStartsOn:"monday",weeklyAvailableThrough:"saturday",monthlyClosesDaysBeforeNextMonth:7}};
}
export async function getBloom(accountId:string,id:string,now=new Date()){
  const timeZone=await zone(accountId);
  return inTransaction(async client=>{
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
export async function revealBloom(accountId:string,id:string,rawChapterId:unknown,now=new Date()){
  const chapterId=text(rawChapterId,"Bloom chapter",80);const existing=await getBloom(accountId,id,now);
  if(existing.status==="empty")throw new ProductError(409,"This Bloom has no listening story yet");
  return inTransaction(async client=>{
    const row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2 FOR UPDATE`,[accountId,id])).rows[0];
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
    const row=(await client.query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id=$2 FOR UPDATE`,[accountId,id])).rows[0];
    const item=window(id,now,row.time_zone);requireAvailable(item);
    if(!row.snapshot.chapters.length)throw new ProductError(409,"This Bloom has no listening story yet");
    if(row.snapshot.chapters.some((c:BloomChapter)=>!row.revealed_chapters.includes(c.id)))throw new ProductError(409,"Reveal every chapter before completing this Bloom");
    const updated=(await client.query(`UPDATE sakura_v2."BloomRecap" SET completed_at=COALESCE(completed_at,$3::timestamptz)
      WHERE account_id=$1::uuid AND recap_id=$2 RETURNING *`,[accountId,id,now])).rows[0];return view(item,updated);
  });
}
/** Only a completed yearly recap survives its opening window in the archive. */
export async function archivedBloom(accountId:string,year:string|null,now=new Date()){
  if(year!==null&&!/^20\d{2}$/.test(year))throw new ProductError(400,"Invalid archive year");
  const rows=(await getRebuildPool().query(`SELECT * FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid AND recap_id LIKE 'yearly-%'
    AND completed_at IS NOT NULL AND ($2::text IS NULL OR recap_id='yearly-'||$2) ORDER BY recap_id DESC`,[accountId,year])).rows;
  const items=rows.flatMap(row=>{const item=window(row.recap_id,now,row.time_zone);return item.status==="expired"?[{...view(item,row),status:"archived"}]:[];});
  return {items};
}
