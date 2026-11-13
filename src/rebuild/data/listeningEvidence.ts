import { getRebuildPool } from "./db";
import type { PoolClient } from "pg";

/** The same retained evidence powers live and device-only ranking. Aggregate
 * all hour weights once, rather than rescanning the event ledger per recording. */
export async function getListeningEvidence(accountId:string,timeZone:string,pool:{query:PoolClient["query"]}=getRebuildPool(),options:{limit?:number}={}) {
  if(options.limit!==undefined&&(!Number.isInteger(options.limit)||options.limit<1||options.limit>5000))throw new RangeError("Invalid evidence projection size");
  const rows=(await pool.query(`WITH selected AS (
      SELECT s.recording_id,s.audible_ms,s.play_count,s.completed_count,s.skipped_count,s.last_played_at
      FROM sakura_v2."ListeningRecordingSummary" s WHERE s.account_id=$1::uuid
      ORDER BY s.audible_ms DESC,s.recording_id LIMIT $3::integer
    ),hourly AS (
      SELECT l.recording_id,EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $2)::integer AS hour,
        SUM(c.audible_ms)::double precision AS audible_ms
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      JOIN selected included ON included.recording_id=l.recording_id
      WHERE c.account_id=$1::uuid AND c.audible_ms>0 AND c.occurred_at>=now()-interval '90 days' GROUP BY 1,2
    ),weights AS (
      SELECT recording_id,jsonb_agg(jsonb_build_object('hour',hour,'audibleMs',audible_ms) ORDER BY hour) AS hour_weights
      FROM hourly GROUP BY recording_id
    ) SELECT s.recording_id AS "recordingId",s.audible_ms::text AS "audibleMs",s.play_count::text AS "playCount",
      s.completed_count::text AS "completedCount",s.skipped_count::text AS "skippedCount",s.last_played_at AS "lastPlayedAt",
      COALESCE(w.hour_weights,'[]'::jsonb) AS "hourWeights"
      FROM selected s LEFT JOIN weights w ON w.recording_id=s.recording_id
      ORDER BY s.audible_ms DESC,s.recording_id`,[accountId,timeZone,options.limit??null])).rows;
  return rows.map(row=>({...row,audibleMs:Number(row.audibleMs)||0,playCount:Number(row.playCount)||0,
    completedCount:Number(row.completedCount)||0,skippedCount:Number(row.skippedCount)||0,lastPlayedAt:row.lastPlayedAt?new Date(row.lastPlayedAt).toISOString():null}));
}
