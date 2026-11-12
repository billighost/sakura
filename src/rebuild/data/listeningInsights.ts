import { inTransaction } from "./db";
import type { PoolClient } from "pg";
import { cardsForIds } from "./catalog";
import { getTaste } from "./taste";
import { getListeningEvidence } from "./listeningEvidence";

export interface DailyMeasurement {date:string;audibleMs:number}
export interface HourMeasurement {hour:number;name:string|null;audibleMs:number}
export interface GenreMeasurement {name:string;audibleMs:number}
export interface InsightTotals {events:number;finished:number;completed:number;skipped:number;activeDays:number;uniqueRecordings:number}
const positive=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
export function localCalendarDays(timeZone:string,now=new Date(),count=30):string[] {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)!.value;
  const today=Date.UTC(Number(part("year")),Number(part("month"))-1,Number(part("day")));
  return Array.from({length:count},(_,index)=>new Date(today-(count-index-1)*86400000).toISOString().slice(0,10));
}
export function buildListeningInsights(days:readonly DailyMeasurement[],hours:readonly HourMeasurement[],genres:readonly GenreMeasurement[],totals:InsightTotals,timeZone:string,now=new Date()) {
  const dayMap=new Map(days.map(day=>[day.date,positive(day.audibleMs)]));
  const calendar=localCalendarDays(timeZone,now);
  const hourRows=Array.from({length:24},(_,hour)=>{
    const rows=hours.filter(item=>item.hour===hour),byGenre=new Map<string,number>();
    for(const row of rows)if(row.name)byGenre.set(row.name,(byGenre.get(row.name)||0)+positive(row.audibleMs));
    return {hour,audibleMs:rows.reduce((sum,row)=>sum+positive(row.audibleMs),0),genres:[...byGenre].map(([name,audibleMs])=>({name,audibleMs})).sort((a,b)=>b.audibleMs-a.audibleMs||a.name.localeCompare(b.name)).slice(0,3)};
  });
  const genreTotal=genres.reduce((sum,genre)=>sum+positive(genre.audibleMs),0);
  const established=totals.events>=50&&totals.activeDays>=7&&totals.uniqueRecordings>=10;
  const growing=totals.events>=5&&totals.uniqueRecordings>=3;
  const confidence={level:established?"established" as const:growing?"growing" as const:"starting" as const,
    label:established?"A fuller listening history":growing?"Your listening history is growing":"A new listening history",
    evidence:`${totals.events} ${totals.events===1?"play":"plays"} across ${totals.uniqueRecordings} ${totals.uniqueRecordings===1?"song":"songs"} and ${totals.activeDays} ${totals.activeDays===1?"day":"days"}.`};
  const peakHour=[...hourRows].sort((a,b)=>b.audibleMs-a.audibleMs||a.hour-b.hour)[0];
  return {days:calendar.map(date=>({date,audibleMs:dayMap.get(date)||0})),hours:hourRows,
    genres:genres.filter(genre=>positive(genre.audibleMs)>0).map(genre=>({...genre,audibleMs:positive(genre.audibleMs),share:genreTotal?positive(genre.audibleMs)/genreTotal:0})).sort((a,b)=>b.audibleMs-a.audibleMs||a.name.localeCompare(b.name)),
    completionRate:totals.finished?totals.completed/totals.finished:0,skipRate:totals.finished?totals.skipped/totals.finished:0,
    activeDays:totals.activeDays,finishedEvents:totals.finished,confidence,timeZone,
    peakHour:peakHour?.audibleMs?peakHour.hour:null,
    retention:{description:"Time charts use listening with saved dates and times. All-time totals can also include older listening imported into your account.",
      historyEvents:totals.events,genreDescription:"Listening time is shared evenly across each song's published genres. Songs without genre information are counted separately.",
      rateDescription:"Based on listens that ended or were skipped. Paused and unfinished listens are left out."}};
}

type Queryable={query:PoolClient["query"]};
// A recording contributes its actual time once, divided among distinct tags.
const GENRE_JOIN=`LEFT JOIN LATERAL (
  SELECT MIN(trim(value #>> '{}')) AS name,COUNT(*) OVER() AS tag_count
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.metadata->'genres')='array' THEN r.metadata->'genres' ELSE '[]'::jsonb END) tag(value)
  WHERE jsonb_typeof(value)='string' AND trim(value #>> '{}')<>'' GROUP BY lower(normalize(trim(value #>> '{}'),NFKC))
) tags ON true`;
export async function getListeningInsights(accountId:string,timeZone:string,sql?:Queryable) {
  if(sql)return readListeningInsights(accountId,timeZone,sql);
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return readListeningInsights(accountId,timeZone,client);
  });
}
async function readListeningInsights(accountId:string,timeZone:string,pool:Queryable) {
  const now=new Date(),firstDay=localCalendarDays(timeZone,now)[0];
  // Independent aggregates share one PostgreSQL round trip and one snapshot.
  const projection=(await pool.query(`WITH days AS (
    SELECT (c.occurred_at AT TIME ZONE $2)::date::text AS date,SUM(c.audible_ms)::text AS "audibleMs"
      FROM sakura_v2."ListeningChunk" c WHERE c.account_id=$1::uuid AND
      (c.occurred_at AT TIME ZONE $2)::date>=$3::date
      GROUP BY 1
    ), hours AS (
    SELECT EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $2)::integer AS hour,
      tags.name,SUM(c.audible_ms::double precision/COALESCE(tags.tag_count,1)) AS "audibleMs"
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      JOIN sakura_v2."Recording" r ON r.id=l.recording_id ${GENRE_JOIN} WHERE c.account_id=$1::uuid AND c.audible_ms>0 AND c.occurred_at IS NOT NULL GROUP BY 1,2
    ), genres AS (
    SELECT tags.name,SUM(s.audible_ms::double precision/COALESCE(tags.tag_count,1)) AS "audibleMs"
      FROM sakura_v2."ListeningRecordingSummary" s JOIN sakura_v2."Recording" r ON r.id=s.recording_id
      ${GENRE_JOIN} WHERE s.account_id=$1::uuid AND s.audible_ms>0 GROUP BY 1
    ), totals AS (
    SELECT COUNT(*) FILTER(WHERE l.audible_ms>0)::integer AS events,
      COUNT(*) FILTER(WHERE l.finished AND l.audible_ms>0)::integer AS finished,
      COUNT(*) FILTER(WHERE l.finished AND l.completed AND l.audible_ms>0)::integer AS completed,
      COUNT(*) FILTER(WHERE l.finished AND l.skipped AND l.audible_ms>0)::integer AS skipped,
      COUNT(DISTINCT l.recording_id) FILTER(WHERE l.audible_ms>0)::integer AS "uniqueRecordings",
      (SELECT COUNT(DISTINCT (c.occurred_at AT TIME ZONE $2)::date)::integer
        FROM sakura_v2."ListeningChunk" c WHERE c.account_id=$1::uuid AND c.audible_ms>0) AS "activeDays"
      FROM sakura_v2."ListeningEventLedger" l WHERE l.account_id=$1::uuid
    ) SELECT COALESCE((SELECT jsonb_agg(days ORDER BY date) FROM days),'[]'::jsonb) AS days,
      COALESCE((SELECT jsonb_agg(hours) FROM hours),'[]'::jsonb) AS hours,
      COALESCE((SELECT jsonb_agg(genres) FROM genres),'[]'::jsonb) AS genres,
      (SELECT to_jsonb(totals) FROM totals) AS totals`,[accountId,timeZone,firstDay])).rows[0];
  const days=projection.days as Array<{date:string;audibleMs:string}>,hours=projection.hours as Array<{hour:number;name:string|null;audibleMs:number}>,genreRows=projection.genres as Array<{name:string|null;audibleMs:number}>;
  const evidenceRows=await getListeningEvidence(accountId,timeZone,pool);
  const taste=await getTaste(accountId,pool);
  const totals=projection.totals as InsightTotals;
  const base=buildListeningInsights(days.map(row=>({date:row.date,audibleMs:positive(row.audibleMs)})),
    hours.map(row=>({hour:Number(row.hour),name:row.name,audibleMs:positive(row.audibleMs)})),
    genreRows.flatMap(row=>row.name?[{name:row.name,audibleMs:positive(row.audibleMs)}]:[]),totals,timeZone,now);
  const evidence=evidenceRows;
  const topCards=await cardsForIds(accountId,evidence.filter(row=>row.audibleMs>0).slice(0,50).map(row=>row.recordingId),pool);
  const byId=new Map(evidence.map(row=>[row.recordingId,row]));
  return {...base,untaggedAudibleMs:genreRows.filter(row=>!row.name).reduce((sum,row)=>sum+positive(row.audibleMs),0),topSongs:topCards.map(track=>({...track,audibleMs:byId.get(track.id)?.audibleMs||0,playCount:byId.get(track.id)?.playCount||0,lastPlayedAt:byId.get(track.id)?.lastPlayedAt||null})),tasteEvidence:evidence,tasteFeedback:taste.feedback};
}
