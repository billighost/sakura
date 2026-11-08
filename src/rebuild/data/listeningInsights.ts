import { getRebuildPool } from "./db";
import { cardsForIds } from "./catalog";
import { getTaste } from "./taste";
import { getListeningEvidence } from "./listeningEvidence";

export interface DailyMeasurement {date:string;audibleMs:number}
export interface HourMeasurement {hour:number;name:string|null;audibleMs:number}
export interface GenreMeasurement {name:string;audibleMs:number}
export interface InsightTotals {events:number;finished:number;completed:number;skipped:number;activeDays:number;uniqueRecordings:number}
const positive=(value:unknown)=>Math.max(0,Number(value)||0);
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
    evidence:`${totals.events} song plays across ${totals.uniqueRecordings} songs and ${totals.activeDays} active days. More listening gives Sakura more evidence; this is not a prediction accuracy score.`};
  const peakHour=[...hourRows].sort((a,b)=>b.audibleMs-a.audibleMs||a.hour-b.hour)[0];
  return {days:calendar.map(date=>({date,audibleMs:dayMap.get(date)||0})),hours:hourRows,
    genres:genres.filter(genre=>positive(genre.audibleMs)>0).map(genre=>({...genre,audibleMs:positive(genre.audibleMs),share:genreTotal?positive(genre.audibleMs)/genreTotal:0})).sort((a,b)=>b.audibleMs-a.audibleMs||a.name.localeCompare(b.name)),
    completionRate:totals.finished?totals.completed/totals.finished:0,skipRate:totals.finished?totals.skipped/totals.finished:0,
    activeDays:totals.activeDays,finishedEvents:totals.finished,confidence,timeZone,
    peakHour:peakHour?.audibleMs?peakHour.hour:null,
    retention:{description:"Charts use your retained Sakura listening measurements. Lifetime totals can also include preserved imported listening.",
      historyEvents:totals.events,genreDescription:"Genres use each recording's first published genre tag. Untagged listening is not assigned an invented genre.",
      rateDescription:"Completion and skip rates use finalized listening events. Paused or unfinished events are excluded."}};
}

export async function getListeningInsights(accountId:string,timeZone:string) {
  const pool=getRebuildPool(),now=new Date(),firstDay=localCalendarDays(timeZone,now)[0];
  const [days,hours,genreRows,totalRows,evidenceRows,taste]=await Promise.all([
    pool.query(`SELECT (COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)::date::text AS date,SUM(c.audible_ms)::text AS "audibleMs"
      FROM sakura_v2."ListeningChunk" c WHERE c.account_id=$1::uuid AND
      (COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)::date>=$3::date
      GROUP BY 1 ORDER BY 1`,[accountId,timeZone,firstDay]),
    pool.query(`SELECT EXTRACT(HOUR FROM COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)::integer AS hour,
      NULLIF(r.metadata->'genres'->>0,'') AS name,SUM(c.audible_ms)::text AS "audibleMs"
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      JOIN sakura_v2."Recording" r ON r.id=l.recording_id WHERE c.account_id=$1::uuid AND c.audible_ms>0 GROUP BY 1,2`,[accountId,timeZone]),
    pool.query(`SELECT NULLIF(r.metadata->'genres'->>0,'') AS name,SUM(s.audible_ms)::text AS "audibleMs"
      FROM sakura_v2."ListeningRecordingSummary" s JOIN sakura_v2."Recording" r ON r.id=s.recording_id
      WHERE s.account_id=$1::uuid AND s.audible_ms>0 AND NULLIF(r.metadata->'genres'->>0,'') IS NOT NULL GROUP BY 1`,[accountId]),
    pool.query(`SELECT COUNT(*) FILTER(WHERE l.audible_ms>0)::integer AS events,
      COUNT(*) FILTER(WHERE l.finished AND l.audible_ms>0)::integer AS finished,
      COUNT(*) FILTER(WHERE l.finished AND l.completed AND l.audible_ms>0)::integer AS completed,
      COUNT(*) FILTER(WHERE l.finished AND l.skipped AND l.audible_ms>0)::integer AS skipped,
      COUNT(DISTINCT l.recording_id) FILTER(WHERE l.audible_ms>0)::integer AS "uniqueRecordings",
      (SELECT COUNT(DISTINCT (COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)::date)::integer
        FROM sakura_v2."ListeningChunk" c WHERE c.account_id=$1::uuid AND c.audible_ms>0) AS "activeDays"
      FROM sakura_v2."ListeningEventLedger" l WHERE l.account_id=$1::uuid`,[accountId,timeZone]),
    getListeningEvidence(accountId,timeZone),
    getTaste(accountId)
  ]);
  const totals=totalRows.rows[0] as InsightTotals;
  const base=buildListeningInsights(days.rows.map(row=>({date:row.date,audibleMs:positive(row.audibleMs)})),
    hours.rows.map(row=>({hour:Number(row.hour),name:row.name,audibleMs:positive(row.audibleMs)})),
    genreRows.rows.map(row=>({name:row.name,audibleMs:positive(row.audibleMs)})),totals,timeZone,now);
  const evidence=evidenceRows;
  const topCards=await cardsForIds(accountId,evidence.filter(row=>row.audibleMs>0).slice(0,8).map(row=>row.recordingId));
  const byId=new Map(evidence.map(row=>[row.recordingId,row]));
  return {...base,topSongs:topCards.map(track=>({...track,audibleMs:byId.get(track.id)?.audibleMs||0,playCount:byId.get(track.id)?.playCount||0})),tasteEvidence:evidence,tasteFeedback:taste.feedback};
}
