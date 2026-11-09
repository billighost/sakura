import { inTransaction } from "./db";
import { getSettings } from "./settings";
import { getTaste } from "./taste";
import { ProductError, object } from "./validation";

export type ClearScope="history"|"feedback"|"all";
export type ClearPeriod="week"|"month"|"all";
export function clearDataInput(value:unknown) {
  const raw=object(value);
  if(Object.keys(raw).some(key=>!["scope","period"].includes(key)))throw new ProductError(400,"Unsupported data control");
  if(!["history","feedback","all"].includes(String(raw.scope)))throw new ProductError(400,"Choose which data to clear");
  const period=raw.period===undefined?"all":raw.period;
  if(!["week","month","all"].includes(String(period)))throw new ProductError(400,"Choose a data period");
  return {scope:raw.scope as ClearScope,period:period as ClearPeriod};
}
export function clearPeriodStart(period:ClearPeriod,now:Date):string|null {
  return period==="all"?null:new Date(now.getTime()-(period==="week"?7:30)*86400000).toISOString();
}

/** Explicit user erasure. Entire sessions touching the requested window are
 * removed, including their receipt measurements, to keep event totals coherent.
 * Minimal event/date tombstones prevent delayed device sync undoing the choice. */
export async function clearPersonalizationData(accountId:string,value:unknown) {
  const {scope,period}=clearDataInput(value);
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const cutoff=String((await client.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp`)).rows[0].stamp);
    const from=clearPeriodStart(period,new Date(cutoff));
    let clearedEvents=0,clearedFeedback=0;
    if(scope==="history"||scope==="all") {
      const selected=(await client.query(`SELECT l.event_id,l.recording_id,l.audible_ms,l.completed,l.skipped
        FROM sakura_v2."ListeningEventLedger" l WHERE l.account_id=$1::uuid AND ($2::timestamptz IS NULL OR
          l.started_at>=$2::timestamptz OR EXISTS(SELECT 1 FROM sakura_v2."ListeningChunk" c
            WHERE c.account_id=l.account_id AND c.event_id=l.event_id AND COALESCE(c.occurred_at,c.created_at)>=$2::timestamptz))
        FOR UPDATE`,[accountId,from])).rows;
      const eventIds=selected.map(row=>row.event_id);
      clearedEvents=eventIds.length;
      await client.query(`INSERT INTO sakura_v2."HistoryDeletion"(account_id,period_start,cleared_at) VALUES($1::uuid,$2::timestamptz,$3::timestamptz)`,[accountId,from,cutoff]);
      if(eventIds.length) {
        await client.query(`INSERT INTO sakura_v2."ClearedListeningEvent"(account_id,event_id,cleared_at)
          SELECT $1::uuid,x,$3::timestamptz FROM unnest($2::uuid[]) x ON CONFLICT DO NOTHING`,[accountId,eventIds,cutoff]);
        await client.query(`DELETE FROM sakura_v2."ListeningEventLedger" WHERE account_id=$1::uuid AND event_id=ANY($2::uuid[])`,[accountId,eventIds]);
      }
      if(period==="all") {
        // The listener owns imported totals too, including unmapped recordings.
        await client.query(`DELETE FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid`,[accountId]);
        await client.query(`DELETE FROM sakura_v2."LifetimeListeningSummary" WHERE account_id=$1::uuid`,[accountId]);
        await client.query(`DELETE FROM sakura_v2."ArchivedListeningRecording" WHERE account_id=$1::uuid`,[accountId]);
        await client.query(`DELETE FROM sakura_v2."ListeningImportSnapshot" WHERE account_id=$1::uuid`,[accountId]);
      } else {
        // Reconcile retained aggregates by subtracting exactly the erased events.
        // Preserved imports cannot be rebuilt from a ledger they predate.
        const removedByRecording=new Map<string,{audibleMs:number;plays:number;completed:number;skipped:number}>();
        for(const row of selected) {
          const previous=removedByRecording.get(row.recording_id)||{audibleMs:0,plays:0,completed:0,skipped:0};
          previous.audibleMs+=Number(row.audible_ms);previous.plays+=Number(Number(row.audible_ms)>0);
          previous.completed+=Number(row.completed);previous.skipped+=Number(row.skipped);removedByRecording.set(row.recording_id,previous);
        }
        if(removedByRecording.size)await client.query(`WITH removed AS (
            SELECT * FROM jsonb_to_recordset($2::jsonb) x("recordingId" uuid,"audibleMs" bigint,plays bigint,completed bigint,skipped bigint)
          ),latest AS (
            SELECT recording_id,MAX(started_at) AS stamp FROM sakura_v2."ListeningEventLedger" WHERE account_id=$1::uuid AND audible_ms>0 GROUP BY recording_id
          ) UPDATE sakura_v2."ListeningRecordingSummary" s SET audible_ms=GREATEST(0,s.audible_ms-d."audibleMs"),
            play_count=GREATEST(0,s.play_count-d.plays),completed_count=GREATEST(0,s.completed_count-d.completed),skipped_count=GREATEST(0,s.skipped_count-d.skipped),
            last_played_at=l.stamp FROM removed d LEFT JOIN latest l ON l.recording_id=d."recordingId"
            WHERE s.account_id=$1::uuid AND s.recording_id=d."recordingId"`,[accountId,JSON.stringify([...removedByRecording].map(([recordingId,removed])=>({recordingId,...removed})))]);
        const removed=selected.reduce((sum,row)=>({audibleMs:sum.audibleMs+Number(row.audible_ms),plays:sum.plays+Number(Number(row.audible_ms)>0),
          completed:sum.completed+Number(row.completed),skipped:sum.skipped+Number(row.skipped)}),{audibleMs:0,plays:0,completed:0,skipped:0});
        const archived=(await client.query(`DELETE FROM sakura_v2."ArchivedListeningRecording" WHERE account_id=$1::uuid AND last_played_at>=$2::timestamptz
          RETURNING audible_ms,play_count`,[accountId,from])).rows;
        for(const row of archived){removed.audibleMs+=Number(row.audible_ms);removed.plays+=Number(row.play_count);}
        await client.query(`UPDATE sakura_v2."LifetimeListeningSummary" SET audible_ms=GREATEST(0,audible_ms-$2),play_count=GREATEST(0,play_count-$3),
          completed_count=GREATEST(0,completed_count-$4),skipped_count=GREATEST(0,skipped_count-$5),updated_at=now() WHERE account_id=$1::uuid`,
          [accountId,removed.audibleMs,removed.plays,removed.completed,removed.skipped]);
        await client.query(`DELETE FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid AND audible_ms=0 AND play_count=0 AND completed_count=0 AND skipped_count=0`,[accountId]);
      }
      // Frozen stories must not keep measurements explicitly erased by their owner.
      await client.query(`DELETE FROM sakura_v2."BloomRecap" WHERE account_id=$1::uuid`,[accountId]);
    }
    if(scope==="feedback"||scope==="all") {
      const erased=await client.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND ($2::timestamptz IS NULL OR updated_at>=$2::timestamptz)`,[accountId,from]);
      clearedFeedback=erased.rowCount||0;
    }
    await client.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[accountId]);
    await client.query(`DELETE FROM sakura_v2."Mix" WHERE account_id=$1::uuid`,[accountId]);
    // This is the retained state under the same account lock as erasure. A
    // partial clear must not make offline devices forget older exclusions.
    const taste=await getTaste(accountId,client);
    return {scope,period,cutoff,clearedEvents,clearedFeedback,tasteFeedback:taste.feedback,feedbackAuthoritative:true as const,
      description:"Your selected data was cleared. Saved songs, playlists, settings and device downloads remain yours."};
  });
}

/** Account-only JSON export is bounded by the same ownership predicates as the
 * profile. It contains no credentials, audio locators or another account's data. */
export async function exportPersonalizationData(accountId:string) {
  return inTransaction(async pool=>{
  await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const preferences=await getSettings(accountId,pool),taste=await getTaste(accountId,pool);
  const listening=await pool.query(`SELECT l.event_id AS "eventId",l.recording_id AS "recordingId",l.audible_ms::text AS "audibleMs",
      l.completed,l.skipped,l.finished,l.started_at AS "startedAt",l.last_position_ms AS "positionMs",l.max_position_ms AS "maxPositionMs",
      COALESCE(to_jsonb(l)->>'context',h.context) AS context,
      CASE WHEN to_jsonb(l)->>'context' IS NOT NULL THEN to_jsonb(l)->>'context_id' ELSE h.context_id END AS "contextId" FROM sakura_v2."ListeningEventLedger" l
      LEFT JOIN sakura_v2."ListeningEvent" h ON h.account_id=l.account_id AND h.event_id=l.event_id
      WHERE l.account_id=$1::uuid ORDER BY l.started_at DESC,l.event_id`,[accountId]);
  const recordings=await pool.query(`SELECT recording_id AS "recordingId",audible_ms::text AS "audibleMs",play_count::text AS "playCount",
      completed_count::text AS "completedCount",skipped_count::text AS "skippedCount",last_played_at AS "lastPlayedAt"
      FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid ORDER BY audible_ms DESC,recording_id`,[accountId]);
  const totals=await pool.query(`SELECT audible_ms::text AS "audibleMs",play_count::text AS "playCount",completed_count::text AS "completedCount",skipped_count::text AS "skippedCount"
      FROM sakura_v2."LifetimeListeningSummary" WHERE account_id=$1::uuid`,[accountId]);
  const archived=await pool.query(`SELECT legacy_recording_id AS "legacyRecordingId",metadata_snapshot AS metadata,audible_ms::text AS "audibleMs",play_count::text AS "playCount",last_played_at AS "lastPlayedAt"
      FROM sakura_v2."ArchivedListeningRecording" WHERE account_id=$1::uuid`,[accountId]);
  const resets=await pool.query(`SELECT period_start AS "periodStart",cleared_at AS "clearedAt" FROM sakura_v2."HistoryDeletion" WHERE account_id=$1::uuid ORDER BY cleared_at DESC`,[accountId]);
  const measurements=await pool.query(`SELECT event_id AS "eventId",sequence,audible_ms::text AS "audibleMs",occurred_at AS "occurredAt",created_at AS "receivedAt",position_ms AS "positionMs",completed,skipped,finished
      FROM sakura_v2."ListeningChunk" WHERE account_id=$1::uuid ORDER BY COALESCE(occurred_at,created_at),event_id,sequence`,[accountId]);
  const privacy=await pool.query(`SELECT started_at AS "startedAt",ended_at AS "endedAt" FROM sakura_v2."ListeningPrivacyWindow" WHERE account_id=$1::uuid ORDER BY started_at`,[accountId]);
  // Imported catalog objects may contain a cached source or a signed URL.
  // Exports retain descriptive music metadata only.
  const safeMetadata=(value:unknown):Record<string,unknown>=>{
    const raw=value&&typeof value==="object"?value as Record<string,unknown>:{};
    const keys=["title","artists","albumTitle","durationMs","genres","version","language","explicit","isrc","releaseDate"];
    return Object.fromEntries(keys.filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  };
  return {version:2,accountId,exportedAt:new Date().toISOString(),preferences,tasteFeedback:taste.feedback.map(({track,...choice})=>({...choice,...(track?{track:{id:track.id,...safeMetadata(track.metadata)}}:{})})),listeningHistory:listening.rows,
    recordingSummaries:recordings.rows,stats:totals.rows[0]||{audibleMs:"0",playCount:"0",completedCount:"0",skippedCount:"0"},
    archivedListening:archived.rows.map(row=>({...row,metadata:safeMetadata(row.metadata)})),deletionReceipts:resets.rows,listeningMeasurements:measurements.rows,privacyPeriods:privacy.rows,
    description:"Listening measurements use actual audible milliseconds. Genre tags come from published catalog metadata; deletion receipts only prevent erased history returning from another device."};
  });
}
