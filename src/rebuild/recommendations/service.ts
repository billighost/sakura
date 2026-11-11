import { getRebuildPool,inTransaction } from "../data/db";
import type {PoolClient} from "pg";
import { RANKING_CARD_SELECT,VERIFIED,card,cardsForIds } from "../data/catalog";
import { getSettings } from "../data/settings";
import { ProductError,uuid,ids,object } from "../data/validation";
import { planMixes,type Candidate } from "./planner";
import { SITUATIONAL_MIXES,eligibleSituations,planOfflineMixes,type SituationHistory } from "./situations";
import {rankPersonalizedTracks,orderPersonalizedTracks,tasteExcluded,type TasteFeedback,type ListeningEvidence,type TasteSettings} from "./personalization";
import {playlistArtworkSources} from "../app/playlistArtwork";
import {FEED_DEFAULTS} from "../app/feedPreferences";

const MIXES=SITUATIONAL_MIXES;
type Queryable=Pick<PoolClient,"query">;
export async function listMixes(accountId:string,sql:Queryable=getRebuildPool()) {
  const rows=(await sql.query(`SELECT m.id,m.slot,m.kind,m.name,m.description,m.status,m.reason,
    m.eligible_count AS "eligibleCount",m.unique_artists AS "uniqueArtists",m.generated_at AS "generatedAt",m.expires_at AS "expiresAt",
    (SELECT jsonb_agg(art.url ORDER BY art.position) FROM (
      SELECT r.metadata->>'coverUrl' AS url,MIN(x.position) AS position FROM sakura_v2."MixRecording" x
      JOIN sakura_v2."Recording" r ON r.id=x.recording_id WHERE x.mix_id=m.id AND NULLIF(r.metadata->>'coverUrl','') IS NOT NULL
      GROUP BY r.metadata->>'coverUrl' ORDER BY MIN(x.position) LIMIT 4) art) AS "coverUrls",
    (SELECT COUNT(*)::integer FROM sakura_v2."MixRecording" x WHERE x.mix_id=m.id) AS "trackCount"
    FROM sakura_v2."Mix" m WHERE m.account_id=$1::uuid ORDER BY CASE m.slot WHEN 'daily' THEN 0 WHEN 'discover' THEN 1 WHEN 'deep-cuts' THEN 2 ELSE 3 END`,[accountId])).rows;
  return rows.map(row=>{const definition=MIXES.find(m=>m.id===row.slot);return {...row,situation:definition?.situation,surfaces:definition?.surfaces||["discover"],rules:definition?.rules||[],coverUrls:(row.coverUrls||[]).filter(Boolean),playability:row.status==="ready"?"resolvable":"unavailable"};});
}

export async function ensureMixes(accountId:string,refresh=false,sql?:PoolClient) {
  if(sql)return ensureMixesFor(accountId,refresh,sql);
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return ensureMixesFor(accountId,refresh,client);
  });
}
async function ensureMixesFor(accountId:string,refresh:boolean,client:PoolClient){
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-mixes:${accountId}`]);
  const existing=await listMixes(accountId,client);
  if(!refresh&&existing.length===MIXES.length&&existing.every(m=>new Date(m.expiresAt).getTime()>Date.now()))return existing;
    const settings=await getSettings(accountId,client);
    const startingIds=[...new Set((settings.initialTasteProfile?.artists||[]).flatMap((artist:{recordings:{id:string}[]})=>artist.recordings.map(recording=>recording.id)))];
    const rows=(await client.query(`${RANKING_CARD_SELECT} WHERE ${VERIFIED} ORDER BY (r.id=ANY($2::uuid[])) DESC,r.created_at DESC,r.id LIMIT 2500`,[accountId,startingIds])).rows;
    const allCards=rows.map(card).filter(c=>settings.explicitContent||c.metadata.explicit!=="explicit");
    const listens=settings.learnFromListening===false?[]:(await client.query(`SELECT recording_id,audible_ms,play_count,completed_count,skipped_count,last_played_at
      FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid`,[accountId])).rows;
    const favoriteIds=new Set((await client.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid`,[accountId])).rows.map(r=>r.recording_id));
    const feedback=(await client.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND (expires_at IS NULL OR expires_at>now())`,[accountId])).rows;
    const normalizedFeedback:TasteFeedback[]=feedback.map(f=>({target:f.target,targetId:f.target_id,kind:f.kind,expiresAt:f.expires_at?new Date(f.expires_at).toISOString():null}));
    const history:ListeningEvidence[]=listens.map(l=>({recordingId:l.recording_id,audibleMs:Number(l.audible_ms),playCount:Number(l.play_count),completedCount:Number(l.completed_count),skippedCount:Number(l.skipped_count),...(l.last_played_at?{lastPlayedAt:new Date(l.last_played_at).toISOString()}:{} )}));
    const ranked=rankPersonalizedTracks(allCards,{settings:settings as TasteSettings,history,feedback:normalizedFeedback,likedIds:[...favoriteIds] as string[],seed:accountId});
    const heard=new Set(ranked.filter(item=>item.heard).map(item=>item.track.id));
    const occurrence=settings.learnFromListening===false?[]:(await client.query(`SELECT l.recording_id,MIN(c.occurred_at) first_played_at,
      BOOL_OR(EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $2)>=22 OR
        EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $2)<4) late_night
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      WHERE c.account_id=$1::uuid AND c.audible_ms>0 GROUP BY l.recording_id`,[accountId,settings.timeZone])).rows;
    const occurrenceById=new Map(occurrence.map(r=>[r.recording_id,r]));
    // A conservative display-diversity bucket prevents different provider
    // appearances of the same primary credit from bypassing the artist cap.
    // It never merges durable artist or recording identities.
    const artistBucket=(c:{artists:string[];id:string})=>`credit:${(c.artists[0]||c.id).normalize("NFKC").trim().toLowerCase()}`;
    const familiarity=new Set(ranked.filter(item=>item.familiarArtist).map(item=>artistBucket(item.track)));
    const byId=new Map(listens.map(l=>[l.recording_id,l]));
    const candidates:Candidate[]=ranked.map(item=>{
      const c=item.track;
      const listened=byId.get(c.recordingId),artistId=artistBucket(c);
      const occurrence=occurrenceById.get(c.recordingId);
      const history={audibleMs:Number(listened?.audible_ms||0),lastPlayedAt:listened?.last_played_at?new Date(listened.last_played_at).getTime():undefined,
        firstPlayedAt:occurrence?.first_played_at?new Date(occurrence.first_played_at).getTime():undefined,lateNight:Boolean(occurrence?.late_night)};
      return {recordingId:c.recordingId,artistId,genres:c.genres,popularity:c.popularity,durationMs:c.durationMs,
        eligibleMixIds:eligibleSituations({...c,liked:favoriteIds.has(c.recordingId)},history),
        affinity:item.score};
    });
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
    const planned=planMixes(MIXES,candidates,{seed:`${accountId}:${day}`,nowMs:now,heardRecordings:heard,familiarArtists:familiarity,
      blockedRecordings:new Set(),blockedArtists:new Set(),snoozedUntil:new Map(),
      recentPlays:new Map(listens.filter(l=>l.last_played_at).map(l=>[l.recording_id,new Date(l.last_played_at).getTime()])),recentWindowMs:(1-Number(settings.repeatTolerance??FEED_DEFAULTS.repeatTolerance))*3*60*60*1000});
    // Empty pools retry in five minutes; ordinary mixes stay stable for the day.
    const nextDay=new Date(`${day}T00:00:00.000Z`).getTime()+24*60*60*1000;
    // One atomic batch avoids paying a remote database round-trip four times
    // per shelf. Distinctness has already been checked across all definitions.
    const writes=planned.map((plan,i)=>({slot:MIXES[i].id,kind:MIXES[i].kind,name:MIXES[i].name,description:MIXES[i].description,
      status:plan.status,reason:plan.reason||null,eligible_count:plan.eligibleCount,unique_artists:plan.uniqueArtists,
      expires_at:new Date(plan.status==="ready"?nextDay:Math.min(nextDay,now+5*60*1000)).toISOString()}));
    const mixes=(await client.query(`INSERT INTO sakura_v2."Mix"(account_id,slot,kind,name,description,status,reason,eligible_count,unique_artists,expires_at)
      SELECT $1::uuid,x.slot,x.kind,x.name,x.description,x.status,x.reason,x.eligible_count,x.unique_artists,x.expires_at
      FROM jsonb_to_recordset($2::jsonb) x(slot text,kind text,name text,description text,status text,reason text,eligible_count integer,unique_artists integer,expires_at timestamptz)
      ON CONFLICT(account_id,slot) DO UPDATE SET
        status=EXCLUDED.status,reason=EXCLUDED.reason,eligible_count=EXCLUDED.eligible_count,unique_artists=EXCLUDED.unique_artists,
        name=EXCLUDED.name,description=EXCLUDED.description,generated_at=now(),expires_at=EXCLUDED.expires_at RETURNING id,slot`,[accountId,JSON.stringify(writes)])).rows;
    const idsBySlot=new Map(mixes.map(m=>[m.slot,m.id]));
    await client.query(`DELETE FROM sakura_v2."MixRecording" WHERE mix_id=ANY($1::uuid[])`,[mixes.map(m=>m.id)]);
    const membership=planned.flatMap(plan=>plan.recordingIds.map((recordingId,position)=>({mixId:idsBySlot.get(plan.id),recordingId,position})));
    if(membership.length)await client.query(`INSERT INTO sakura_v2."MixRecording"(mix_id,recording_id,position)
      SELECT x.mix_id::uuid,x.recording_id::uuid,x.position FROM jsonb_to_recordset($1::jsonb) x(mix_id text,recording_id text,position integer)`,
      [JSON.stringify(membership.map(m=>({mix_id:m.mixId,recording_id:m.recordingId,position:m.position})))]);
  return listMixes(accountId,client);
}
export async function getMix(accountId:string,rawId:string) {
  const id=uuid(rawId,"mix ID");
  return inTransaction(async sql=>{
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const mix=(await sql.query(`SELECT id,slot,kind,name,description,status,reason,generated_at AS "generatedAt",expires_at AS "expiresAt"
    FROM sakura_v2."Mix" WHERE account_id=$1::uuid AND id=$2::uuid`,[accountId,id])).rows[0];
  if(!mix)throw new ProductError(404,"Mix not found");
  const membership=(await sql.query(`SELECT recording_id FROM sakura_v2."MixRecording" WHERE mix_id=$1::uuid ORDER BY position`,[id])).rows.map(r=>r.recording_id);
  const settings=await getSettings(accountId,sql);
  const feedbackRows=await sql.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND (expires_at IS NULL OR expires_at>now())`,[accountId]);
  const retained=await cardsForIds(accountId,membership,sql);
  const feedback:TasteFeedback[]=feedbackRows.rows.map(f=>({target:f.target,targetId:f.target_id,kind:f.kind,expiresAt:f.expires_at?new Date(f.expires_at).toISOString():null}));
  const recordings=retained.filter(recording=>(settings.explicitContent!==false||recording.metadata.explicit!=="explicit")&&!tasteExcluded(recording,feedback));
  return {...mix,recordings,tracks:recordings,coverUrls:playlistArtworkSources(null,recordings.map(recording=>recording.coverUrl)),trackCount:recordings.length,
    playability:mix.status==="ready"&&recordings.length?"resolvable":"unavailable",durationMs:recordings.reduce((s,r)=>s+(r.durationMs||0),0)};
  });
}
export async function offlineMixes(accountId:string,value:unknown){
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return offlineMixesFor(accountId,value,client);
  });
}
async function offlineMixesFor(accountId:string,value:unknown,pool:Pick<PoolClient,"query">){
  const requested=ids(object(value).recordingIds,2000),settings=await getSettings(accountId,pool),cards=await cardsForIds(accountId,requested,pool);
  const favorites=new Set((await pool.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=ANY($2::uuid[])`,[accountId,requested])).rows.map(r=>r.recording_id));
  const rows=settings.learnFromListening===false?[]:(await pool.query(`SELECT s.recording_id,s.audible_ms,s.last_played_at,s.play_count,s.completed_count,s.skipped_count,
    MIN(c.occurred_at) first_played_at,
    BOOL_OR(EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $3)>=22 OR EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $3)<4) late_night
    FROM sakura_v2."ListeningRecordingSummary" s LEFT JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=s.account_id AND l.recording_id=s.recording_id
    LEFT JOIN sakura_v2."ListeningChunk" c ON c.account_id=l.account_id AND c.event_id=l.event_id AND c.audible_ms>0
    WHERE s.account_id=$1::uuid AND s.recording_id=ANY($2::uuid[]) GROUP BY s.recording_id,s.audible_ms,s.last_played_at,s.play_count,s.completed_count,s.skipped_count`,[accountId,requested,settings.timeZone])).rows;
  const history=new Map<string,SituationHistory>(rows.map(r=>[r.recording_id,{audibleMs:Number(r.audible_ms),...(r.last_played_at?{lastPlayedAt:new Date(r.last_played_at).getTime()}:{}),firstPlayedAt:r.first_played_at?new Date(r.first_played_at).getTime():undefined,lateNight:Boolean(r.late_night)}]));
  const feedbackRows=(await pool.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid
    AND (expires_at IS NULL OR expires_at>now())`,[accountId])).rows;
  const feedback:TasteFeedback[]=feedbackRows.map(f=>({target:f.target,targetId:f.target_id,kind:f.kind,expiresAt:f.expires_at?new Date(f.expires_at).toISOString():null}));
  const allowed=cards.filter(c=>!tasteExcluded(c,feedback));
  const evidence:ListeningEvidence[]=rows.map(row=>({recordingId:row.recording_id,audibleMs:Number(row.audible_ms),playCount:Number(row.play_count),completedCount:Number(row.completed_count),skippedCount:Number(row.skipped_count),...(row.last_played_at?{lastPlayedAt:new Date(row.last_played_at).toISOString()}:{} )}));
  const ranked=rankPersonalizedTracks(allowed,{history:evidence,feedback,likedIds:[...favorites] as string[],settings:settings as TasteSettings}),byId=new Map(allowed.map(track=>[track.id,track]));
  const mixes=planOfflineMixes(allowed.map(c=>({...c,liked:favorites.has(c.id)})),{history,explicitContent:settings.explicitContent}).map(mix=>{
    const membership=new Set(mix.recordingIds),ordered=orderPersonalizedTracks(ranked.filter(item=>membership.has(item.track.id)),settings as TasteSettings).map(item=>item.track.id);
    return {...mix,recordingIds:ordered,coverUrls:playlistArtworkSources(null,ordered.map(id=>byId.get(id)?.coverUrl))};
  });
  return {mixes,recordings:allowed,
    constraint:"Only requested canonical recordings; verify local blobs before playback."};
}
