import {getRebuildPool} from "./db";
import {getSettingsSnapshot} from "./settings";
import type {PoolClient} from "pg";
import {measureApiStage} from "../server/performance";

const description="Listening measurements use actual audible milliseconds. Genre tags come from published catalog metadata; deletion receipts only prevent erased history returning from another device.";
const metadataKeys=["title","artists","albumTitle","durationMs","genres","version","language","explicit","isrc","releaseDate"];
function safeMetadata(value:unknown){
  const raw=value&&typeof value==="object"?value as Record<string,unknown>:{};
  return Object.fromEntries(metadataKeys.filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
}
type Row=Record<string,unknown>;
interface ExportArray {name:string;sql:string;map?:(row:Row)=>Row}
const arrays:ExportArray[]=[
  {name:"tasteFeedback",sql:`SELECT f.target,f.target_id AS "targetId",f.kind,f.expires_at AS "expiresAt",
    to_char(f.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
    (f.expires_at IS NULL OR f.expires_at>now()) AS active,a.name,r.id AS recording_id,r.metadata
    FROM sakura_v2."TasteFeedback" f LEFT JOIN sakura_v2."Artist" a ON f.target='artist' AND a.id=f.target_id
    LEFT JOIN sakura_v2."Recording" r ON f.target='recording' AND r.id=f.target_id AND r.state='verified'
      AND EXISTS(SELECT 1 FROM sakura_v2."ExternalReference" e WHERE e.recording_id=r.id AND e.verified_at IS NOT NULL)
    WHERE f.account_id=$1::uuid ORDER BY f.updated_at DESC,f.target_id`,map:row=>{
    const {recording_id,metadata,...choice}=row;return {...choice,...(recording_id?{track:{id:recording_id,...safeMetadata(metadata)}}:{})};
  }},
  {name:"listeningHistory",sql:`SELECT l.event_id AS "eventId",l.recording_id AS "recordingId",l.audible_ms::text AS "audibleMs",
    l.completed,l.skipped,l.finished,l.started_at AS "startedAt",l.last_position_ms AS "positionMs",l.max_position_ms AS "maxPositionMs",
    COALESCE(to_jsonb(l)->>'context',h.context) AS context,
    CASE WHEN to_jsonb(l)->>'context' IS NOT NULL THEN to_jsonb(l)->>'context_id' ELSE h.context_id END AS "contextId"
    FROM sakura_v2."ListeningEventLedger" l LEFT JOIN sakura_v2."ListeningEvent" h ON h.account_id=l.account_id AND h.event_id=l.event_id
    WHERE l.account_id=$1::uuid ORDER BY l.started_at DESC,l.event_id`},
  {name:"recordingSummaries",sql:`SELECT recording_id AS "recordingId",audible_ms::text AS "audibleMs",play_count::text AS "playCount",
    completed_count::text AS "completedCount",skipped_count::text AS "skippedCount",last_played_at AS "lastPlayedAt"
    FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid ORDER BY audible_ms DESC,recording_id`},
  {name:"archivedListening",sql:`SELECT legacy_recording_id AS "legacyRecordingId",metadata_snapshot AS metadata,audible_ms::text AS "audibleMs",
    play_count::text AS "playCount",last_played_at AS "lastPlayedAt" FROM sakura_v2."ArchivedListeningRecording" WHERE account_id=$1::uuid`,
    map:row=>({...row,metadata:safeMetadata(row.metadata)})},
  {name:"deletionReceipts",sql:`SELECT period_start AS "periodStart",cleared_at AS "clearedAt"
    FROM sakura_v2."HistoryDeletion" WHERE account_id=$1::uuid ORDER BY cleared_at DESC`},
  {name:"listeningMeasurements",sql:`SELECT event_id AS "eventId",sequence,audible_ms::text AS "audibleMs",occurred_at AS "occurredAt",
    created_at AS "receivedAt",position_ms AS "positionMs",completed,skipped,finished FROM sakura_v2."ListeningChunk"
    WHERE account_id=$1::uuid ORDER BY COALESCE(occurred_at,created_at),event_id,sequence`},
  {name:"privacyPeriods",sql:`SELECT started_at AS "startedAt",ended_at AS "endedAt"
    FROM sakura_v2."ListeningPrivacyWindow" WHERE account_id=$1::uuid ORDER BY started_at`},
];

/** MVCC fixes one complete export snapshot without blocking account mutations.
 * Only one cursor batch and its encoded bytes are retained at a time. A slow
 * reader owns one pool connection; disconnect/timeout always closes its snapshot. */
export async function streamPersonalizationData(accountId:string,signal:AbortSignal,options:{batchSize?:number;timeoutMs?:number}={}):Promise<Response>{
  const started=performance.now();let generatedBytes=0,generatedRows=0,reported=false;
  const batchSize=options.batchSize??128;
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>512)throw new Error("Invalid export batch size");
  signal.throwIfAborted();
  const client=await measureApiStage("db_acquire",()=>getRebuildPool().connect());
  let released=false;
  const release=async(success:boolean)=>{
    if(released)return;released=true;let failure:Error|undefined;
    try{await client.query(success?"COMMIT":"ROLLBACK");}catch(error){failure=error instanceof Error?error:new Error("Export snapshot cleanup failed");if(success)throw error;}
    finally{client.release(failure);}
  };
  let preferences:Awaited<ReturnType<typeof getSettingsSnapshot>>,stats:Row;
  const exportedAt=new Date().toISOString();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    preferences=await getSettingsSnapshot(accountId,client);
    stats=(await client.query(`SELECT audible_ms::text AS "audibleMs",play_count::text AS "playCount",completed_count::text AS "completedCount",
      skipped_count::text AS "skippedCount" FROM sakura_v2."LifetimeListeningSummary" WHERE account_id=$1::uuid`,[accountId])).rows[0]
      ||{audibleMs:"0",playCount:"0",completedCount:"0",skippedCount:"0"};
    signal.throwIfAborted();
  }catch(error){await release(false);throw error;}
  const encoder=new TextEncoder();
  const encode=(text:string)=>{const bytes=encoder.encode(text);generatedBytes+=bytes.byteLength;return bytes;};
  async function* chunks(connection:PoolClient){
    let complete=false;
    try{
      yield encode(JSON.stringify({version:2,accountId,exportedAt,preferences,stats}).slice(0,-1));
      for(const [index,array]of arrays.entries()){
        signal.throwIfAborted();const cursor=`sakura_export_${index}`;
        await connection.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${array.sql}`,[accountId]);
        yield encode(`,${JSON.stringify(array.name)}:[`);
        let first=true;
        while(true){
          signal.throwIfAborted();
          const batch=await connection.query<Row>(`FETCH FORWARD ${batchSize} FROM ${cursor}`);
          if(!batch.rows.length)break;
          generatedRows+=batch.rows.length;
          const text=batch.rows.map(row=>JSON.stringify(array.map?array.map(row):row)).join(",");
          yield encode((first?"":",")+text);first=false;
        }
        await connection.query(`CLOSE ${cursor}`);
        yield encode("]");
      }
      signal.throwIfAborted();complete=true;
      // Commit before the terminating byte: a failed snapshot cannot look like
      // a successful, valid JSON file to the downloading client.
      await release(true);
      yield encode(`,"description":${JSON.stringify(description)}}`);
    }finally{if(!complete)await release(false);}
  }
  const iterator=chunks(client);let controller:ReadableStreamDefaultController<Uint8Array>|undefined,finished=false;
  const clean=(complete=false)=>{
    clearTimeout(timer);signal.removeEventListener("abort",abort);
    if(!reported&&process.env.SAKURA_PERFORMANCE_LOG==="1"){
      reported=true;console.info("[Sakura performance]",JSON.stringify({route:"/api/v2/personalization/data",phase:"export",streamMs:Number((performance.now()-started).toFixed(1)),generatedRows,generatedBytes,complete}));
    }
  };
  const abort=()=>{
    if(finished)return;finished=true;clean();controller?.error(signal.reason??new DOMException("Export canceled","AbortError"));
    void iterator.return(undefined).then(()=>release(false)).catch(()=>{});
  };
  const timer=setTimeout(()=>{
    if(finished)return;finished=true;clean();controller?.error(new Error("Export timed out"));
    void iterator.return(undefined).then(()=>release(false)).catch(()=>{});
  },options.timeoutMs??300000);
  timer.unref?.();
  const body=new ReadableStream<Uint8Array>({
    start(value){controller=value;signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();},
    async pull(value){
      if(finished)return;
      try{const next=await iterator.next();if(finished)return;if(next.done){finished=true;clean(true);value.close();}else value.enqueue(next.value);}
      catch(error){if(!finished){finished=true;clean();value.error(error);}await release(false);}
    },
    async cancel(){finished=true;clean();await iterator.return(undefined);await release(false);},
  });
  return new Response(body,{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="sakura-my-listening-data-${exportedAt.slice(0,10)}.json"`,"Cache-Control":"private, no-store"}});
}
