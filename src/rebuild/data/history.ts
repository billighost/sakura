import { createHash } from "node:crypto";
import { getRebuildPool,inIdempotentTransaction } from "./db";
import { CARD_SELECT,VERIFIED,card } from "./catalog";
import { ProductError,encodeCursor,integer,object,pageInput,text,uuid } from "./validation";

export function historyChunk(value:unknown) {
  const raw=object(value),eventId=uuid(raw.eventId,"event ID"),recordingId=uuid(raw.recordingId,"recording ID");
  const sequence=integer(raw.sequence,"event sequence",0,100000),msPlayed=integer(raw.msPlayed,"audible milliseconds",0,120000);
  const positionMs=raw.positionMs===undefined?0:integer(raw.positionMs,"playback position",0,21600000);
  const completed=raw.completed===undefined?false:raw.completed,skipped=raw.skipped===undefined?false:raw.skipped;
  const finished=raw.finished===undefined?completed||skipped:raw.finished;
  if(typeof completed!=="boolean"||typeof skipped!=="boolean"||typeof finished!=="boolean")throw new ProductError(400,"Invalid playback flags");
  if(completed&&skipped)throw new ProductError(400,"A play cannot be completed and skipped");
  if((completed||skipped)&&!finished)throw new ProductError(400,"A completed or skipped play must be finished");
  const context=raw.context===undefined?"direct":text(raw.context,"playback context",40);
  const contextId=raw.contextId===undefined||raw.contextId===null?null:text(raw.contextId,"context ID",120);
  let occurredAt:string|undefined;
  if(raw.occurredAt!==undefined){
    const stamp=text(raw.occurredAt,"listening timestamp",40),time=Date.parse(stamp);
    const calendar=Date.parse(stamp.slice(0,10)+"T00:00:00Z");
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)||!Number.isFinite(time)||!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==stamp.slice(0,10)||time>Date.now()+300000||time<Date.UTC(2000,0,1))throw new ProductError(400,"Invalid listening timestamp");
    occurredAt=new Date(time).toISOString();
  }
  // Omitting the new optional field keeps legacy retry hashes byte-identical.
  const payload={eventId,recordingId,sequence,msPlayed,positionMs,completed,skipped,finished,context,contextId,...(occurredAt?{occurredAt}:{})};
  return {...payload,payloadHash:createHash("sha256").update(JSON.stringify(payload)).digest("hex")};
}

/** Audible increments, receipt deduplication and all summaries commit together.
 * The receipt ledger is independent of raw history retention. */
export async function recordHistory(accountId:string,value:unknown) {
  const chunk=historyChunk(value);
  return inIdempotentTransaction(async client=>{
    // Clearing data and recording increments serialize on the same account lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const prefs=(await client.query(`SELECT preferences FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
    if(prefs?.preferences?.privateSession)return {accepted:false,privateSession:true};
    if(prefs?.preferences?.learnFromListening===false)return {accepted:false,learningPaused:true};
    const privateInterval=(await client.query(`SELECT EXISTS(SELECT 1 FROM sakura_v2."ListeningPrivacyWindow" WHERE account_id=$1::uuid AND
      ($2::timestamptz IS NULL OR ($2::timestamptz>=started_at AND (ended_at IS NULL OR $2::timestamptz<ended_at)))) AS paused`,[accountId,chunk.occurredAt||null])).rows[0];
    if(privateInterval?.paused)return {accepted:false,learningPaused:true};
    const erased=(await client.query(`SELECT
      EXISTS(SELECT 1 FROM sakura_v2."ClearedListeningEvent" WHERE account_id=$1::uuid AND event_id=$2::uuid) OR
      EXISTS(SELECT 1 FROM sakura_v2."HistoryDeletion" WHERE account_id=$1::uuid AND
        ($3::timestamptz IS NULL OR ($3::timestamptz<=cleared_at AND (period_start IS NULL OR $3::timestamptz>=period_start)))) AS erased`,
      [accountId,chunk.eventId,chunk.occurredAt||null])).rows[0];
    if(erased?.erased)return {accepted:false,cleared:true};
    const recording=(await client.query(`SELECT r.id,r.metadata FROM sakura_v2."Recording" r WHERE r.id=$1::uuid AND ${VERIFIED}`,[chunk.recordingId])).rows[0];
    if(!recording)throw new ProductError(404,"Recording not found");
    const duration=Number(recording.metadata.durationMs)||21600000;
    if(chunk.positionMs>duration+5000)throw new ProductError(400,"Playback position exceeds recording duration");
    await client.query(`INSERT INTO sakura_v2."ListeningEventLedger"(account_id,event_id,recording_id,started_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,COALESCE($4::timestamptz,now())) ON CONFLICT DO NOTHING`,[accountId,chunk.eventId,chunk.recordingId,chunk.occurredAt||null]);
    const ledger=(await client.query(`SELECT * FROM sakura_v2."ListeningEventLedger" WHERE account_id=$1::uuid AND event_id=$2::uuid FOR UPDATE`,[accountId,chunk.eventId])).rows[0];
    if(ledger.recording_id!==chunk.recordingId)throw new ProductError(409,"Playback event belongs to another recording");
    const previous=(await client.query(`SELECT payload_hash FROM sakura_v2."ListeningChunk" WHERE account_id=$1::uuid AND event_id=$2::uuid AND sequence=$3`,[accountId,chunk.eventId,chunk.sequence])).rows[0];
    if(previous){
      if(previous.payload_hash!==chunk.payloadHash)throw new ProductError(409,"A retried sequence must keep the original payload");
      return {accepted:true,duplicate:true,eventId:chunk.eventId,sequence:chunk.sequence,audibleMs:Number(ledger.audible_ms)};
    }
    if(Number(ledger.audible_ms)+chunk.msPlayed>21600000)throw new ProductError(400,"Playback event exceeds maximum duration");
    // A finished event may receive delayed earlier chunks, but its terminal flags
    // cannot switch from completed to skipped or vice versa.
    if((ledger.completed&&chunk.skipped)||(ledger.skipped&&chunk.completed))throw new ProductError(409,"Conflicting playback completion");
    const playDelta=Number(ledger.audible_ms)===0&&chunk.msPlayed>0?1:0;
    const completeDelta=chunk.completed&&!ledger.completed?1:0,skipDelta=chunk.skipped&&!ledger.skipped?1:0;
    await client.query(`INSERT INTO sakura_v2."ListeningChunk"(account_id,event_id,sequence,audible_ms,payload_hash,occurred_at,position_ms,completed,skipped,finished)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10)`,
      [accountId,chunk.eventId,chunk.sequence,chunk.msPlayed,chunk.payloadHash,chunk.occurredAt||null,chunk.positionMs,chunk.completed,chunk.skipped,chunk.finished]);
    await client.query(`UPDATE sakura_v2."ListeningEventLedger" SET audible_ms=audible_ms+$3,completed=completed OR $4,skipped=skipped OR $5,
      finished=finished OR $6,started_at=LEAST(started_at,COALESCE($7::timestamptz,started_at)),
      last_position_ms=CASE WHEN $8>=last_sequence THEN $9 ELSE last_position_ms END,
      max_position_ms=GREATEST(max_position_ms,$9),last_sequence=GREATEST(last_sequence,$8),updated_at=now()
      WHERE account_id=$1::uuid AND event_id=$2::uuid`,
      [accountId,chunk.eventId,chunk.msPlayed,chunk.completed,chunk.skipped,chunk.finished,chunk.occurredAt||null,chunk.sequence,chunk.positionMs]);
    await client.query(`INSERT INTO sakura_v2."ListeningEvent"(account_id,event_id,context,context_id) VALUES($1::uuid,$2::uuid,$3,$4) ON CONFLICT DO NOTHING`,
      [accountId,chunk.eventId,chunk.context,chunk.contextId]);
    await client.query(`INSERT INTO sakura_v2."LifetimeListeningSummary"(account_id,audible_ms,play_count,completed_count,skipped_count)
      VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(account_id) DO UPDATE SET
      audible_ms=sakura_v2."LifetimeListeningSummary".audible_ms+EXCLUDED.audible_ms,
      play_count=sakura_v2."LifetimeListeningSummary".play_count+EXCLUDED.play_count,
      completed_count=sakura_v2."LifetimeListeningSummary".completed_count+EXCLUDED.completed_count,
      skipped_count=sakura_v2."LifetimeListeningSummary".skipped_count+EXCLUDED.skipped_count,updated_at=now()`,
      [accountId,chunk.msPlayed,playDelta,completeDelta,skipDelta]);
    await client.query(`INSERT INTO sakura_v2."ListeningRecordingSummary"(account_id,recording_id,audible_ms,play_count,completed_count,skipped_count,last_played_at)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,COALESCE($7::timestamptz,now())) ON CONFLICT(account_id,recording_id) DO UPDATE SET
      audible_ms=sakura_v2."ListeningRecordingSummary".audible_ms+EXCLUDED.audible_ms,
      play_count=sakura_v2."ListeningRecordingSummary".play_count+EXCLUDED.play_count,
      completed_count=sakura_v2."ListeningRecordingSummary".completed_count+EXCLUDED.completed_count,
      skipped_count=sakura_v2."ListeningRecordingSummary".skipped_count+EXCLUDED.skipped_count,
      last_played_at=GREATEST(sakura_v2."ListeningRecordingSummary".last_played_at,EXCLUDED.last_played_at)`,
      [accountId,chunk.recordingId,chunk.msPlayed,playDelta,completeDelta,skipDelta,chunk.occurredAt||null]);
    return {accepted:true,duplicate:false,eventId:chunk.eventId,sequence:chunk.sequence,audibleMs:Number(ledger.audible_ms)+chunk.msPlayed};
  });
}

export async function getHistory(accountId:string,url:URL) {
  const {limit,cursor}=pageInput(url);
  const rows=await getRebuildPool().query(`${CARD_SELECT.replace('FROM sakura_v2."Recording" r',`,l.event_id AS "eventId",l.started_at AS "playedAt",
    l.audible_ms AS "audibleMs",l.completed,l.skipped,l.last_position_ms AS "positionMs",l.max_position_ms AS "maxPositionMs",
    l.finished,h.context,h.context_id AS "contextId" FROM sakura_v2."Recording" r`)}
    JOIN sakura_v2."ListeningEventLedger" l ON l.recording_id=r.id AND l.account_id=$1::uuid
    JOIN sakura_v2."ListeningEvent" h ON h.account_id=l.account_id AND h.event_id=l.event_id
    WHERE ${VERIFIED} AND l.audible_ms>0 AND ($2::timestamptz IS NULL OR (l.started_at,l.event_id)<($2::timestamptz,$3::uuid))
    ORDER BY l.started_at DESC,l.event_id DESC LIMIT $4`,[accountId,cursor?.timestamp??null,cursor?.id??null,limit+1]);
  const selected=rows.rows.slice(0,limit),last=selected.at(-1);
  const events=selected.map(row=>({eventId:row.eventId,playedAt:row.playedAt,audibleMs:Number(row.audibleMs),completed:row.completed,
    skipped:row.skipped,finished:row.finished,positionMs:Number(row.positionMs||0),maxPositionMs:Number(row.maxPositionMs||0),
    context:row.context,contextId:row.contextId,recording:card(row),track:card(row)}));
  return {events,history:events,nextCursor:rows.rows.length>limit&&last?encodeCursor(last.playedAt,last.eventId):null};
}

/** Raw display compaction needs no summary update: the same event transaction
 * already committed totals. Retained receipts prevent replay double counting. */
export async function compactHistory(accountId:string,before:Date) {
  const result=await getRebuildPool().query(`DELETE FROM sakura_v2."ListeningEvent" e USING sakura_v2."ListeningEventLedger" l
    WHERE e.account_id=l.account_id AND e.event_id=l.event_id AND l.account_id=$1::uuid AND l.finished AND l.started_at<$2`,[accountId,before]);
  return {compacted:result.rowCount||0};
}
