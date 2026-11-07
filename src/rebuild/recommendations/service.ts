import { getRebuildPool,inTransaction } from "../data/db";
import { CARD_SELECT,VERIFIED,card,cardsForIds } from "../data/catalog";
import { getSettings } from "../data/settings";
import { ProductError,uuid,ids,object } from "../data/validation";
import { planMixes,type Candidate } from "./planner";
import { SITUATIONAL_MIXES,eligibleSituations,planOfflineMixes,type SituationHistory } from "./situations";
import type { ArtistSelection } from "../data/artistSelection";

const MIXES=SITUATIONAL_MIXES;
export async function listMixes(accountId:string) {
  const rows=(await getRebuildPool().query(`SELECT m.id,m.slot,m.kind,m.name,m.description,m.status,m.reason,
    m.eligible_count AS "eligibleCount",m.unique_artists AS "uniqueArtists",m.generated_at AS "generatedAt",m.expires_at AS "expiresAt",
    (SELECT jsonb_agg(r.metadata->>'coverUrl' ORDER BY x.position) FROM sakura_v2."MixRecording" x
      JOIN sakura_v2."Recording" r ON r.id=x.recording_id WHERE x.mix_id=m.id AND x.position<4) AS "coverUrls",
    (SELECT COUNT(*)::integer FROM sakura_v2."MixRecording" x WHERE x.mix_id=m.id) AS "trackCount"
    FROM sakura_v2."Mix" m WHERE m.account_id=$1::uuid ORDER BY CASE m.slot WHEN 'daily' THEN 0 WHEN 'discover' THEN 1 WHEN 'deep-cuts' THEN 2 ELSE 3 END`,[accountId])).rows;
  return rows.map(row=>{const definition=MIXES.find(m=>m.id===row.slot);return {...row,situation:definition?.situation,surfaces:definition?.surfaces||["discover"],rules:definition?.rules||[],coverUrls:(row.coverUrls||[]).filter(Boolean),playability:row.status==="ready"?"resolvable":"unavailable"};});
}

export async function ensureMixes(accountId:string,refresh=false) {
  const existing=await listMixes(accountId);
  if(!refresh&&existing.length===MIXES.length&&existing.every(m=>new Date(m.expiresAt).getTime()>Date.now()))return existing;
  const settings=await getSettings(accountId);
  await inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-mixes:${accountId}`]);
    if(!refresh){
      const current=(await client.query(`SELECT COUNT(*)::integer n FROM sakura_v2."Mix" WHERE account_id=$1::uuid AND expires_at>now()`,[accountId])).rows[0];
      if(current.n===MIXES.length)return;
    }
    const rows=(await client.query(`${CARD_SELECT} WHERE ${VERIFIED} ORDER BY r.created_at DESC LIMIT 2500`,[accountId])).rows;
    const cards=rows.map(card).filter(c=>settings.explicitContent||c.metadata.explicit!=="explicit");
    const listens=(await client.query(`SELECT recording_id,audible_ms,play_count,completed_count,skipped_count,last_played_at
      FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid`,[accountId])).rows;
    const favoriteIds=new Set((await client.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid`,[accountId])).rows.map(r=>r.recording_id));
    const feedback=(await client.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid`,[accountId])).rows;
    const heard=new Set(listens.filter(l=>Number(l.audible_ms)>=30000).map(l=>l.recording_id));
    const occurrence=(await client.query(`SELECT l.recording_id,MIN(COALESCE(c.occurred_at,c.created_at)) first_played_at,
      BOOL_OR(EXTRACT(HOUR FROM COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)>=22 OR
        EXTRACT(HOUR FROM COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $2)<4) late_night
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      WHERE c.account_id=$1::uuid AND c.audible_ms>0 GROUP BY l.recording_id`,[accountId,settings.timeZone])).rows;
    const occurrenceById=new Map(occurrence.map(r=>[r.recording_id,r]));
    const familiarity=new Set<string>();
    const seedArtists=(settings.seedArtists as string[]).map(a=>a.normalize("NFKC").toLowerCase());
    const seedSelections=settings.seedArtistSelections as ArtistSelection[];
    const normalizedGenres=(settings.seedGenres as string[]).map(g=>g.normalize("NFKC").toLowerCase());
    // A conservative display-diversity bucket prevents different provider
    // appearances of the same primary credit from bypassing the artist cap.
    // It never merges durable artist or recording identities.
    const artistBucket=(c:{artists:string[]})=>`credit:${c.artists[0].normalize("NFKC").trim().toLowerCase()}`;
    const discovery=Math.max(0,Math.min(1,Number(settings.discovery)||0));
    const deliberate=new Map(feedback.map(f=>[`${f.target}:${f.target_id}`,f.kind]));
    for(const c of cards)if(heard.has(c.recordingId)||favoriteIds.has(c.recordingId)||
      (seedSelections.length?c.artistCredits.some(credit=>seedSelections.some(s=>credit.reference?.provider===s.reference.provider&&credit.reference.id===s.reference.id)):
        c.artists.some(a=>seedArtists.includes(a.normalize("NFKC").toLowerCase()))||seedArtists.includes(c.artistId||"")))familiarity.add(artistBucket(c));
    const byId=new Map(listens.map(l=>[l.recording_id,l]));
    const candidates:Candidate[]=cards.map(c=>{
      const listened=byId.get(c.recordingId),artistId=artistBucket(c);
      const skipRate=listened?Number(listened.skipped_count)/Math.max(1,Number(listened.play_count)):0;
      const occurrence=occurrenceById.get(c.recordingId);
      const history={audibleMs:Number(listened?.audible_ms||0),lastPlayedAt:listened?new Date(listened.last_played_at).getTime():undefined,
        firstPlayedAt:occurrence?new Date(occurrence.first_played_at).getTime():undefined,lateNight:Boolean(occurrence?.late_night)};
      return {recordingId:c.recordingId,artistId,genres:c.genres,popularity:c.popularity,durationMs:c.durationMs,
        eligibleMixIds:eligibleSituations({...c,liked:favoriteIds.has(c.recordingId)},history),
        affinity:(favoriteIds.has(c.recordingId)?1.5:0)+(familiarity.has(artistId)?(1-discovery)*1.4:discovery*0.6)+
          (c.genres.some(g=>normalizedGenres.includes(g.normalize("NFKC").toLowerCase()))?0.6:0)+
          Math.min(0.5,Math.log1p(Number(listened?.audible_ms||0)/60000)/8)-skipRate*0.6+
          (deliberate.get(`recording:${c.recordingId}`)==="love"?0.8:0)-
          (deliberate.get(`recording:${c.recordingId}`)==="less"||deliberate.get(`artist:${c.artistId}`)==="less"?0.7:0)};
    });
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
    const planned=planMixes(MIXES,candidates,{seed:`${accountId}:${day}`,nowMs:now,heardRecordings:heard,familiarArtists:familiarity,
      blockedRecordings:new Set(feedback.filter(f=>f.target==="recording"&&f.kind==="block").map(f=>f.target_id)),
      blockedArtists:new Set(cards.filter(c=>deliberate.get(`artist:${c.artistId}`)==="block").map(artistBucket)),
      snoozedUntil:new Map(feedback.filter(f=>f.target==="recording"&&f.kind==="snooze"&&f.expires_at).map(f=>[f.target_id,new Date(f.expires_at).getTime()])),
      recentPlays:new Map(listens.map(l=>[l.recording_id,new Date(l.last_played_at).getTime()])),recentWindowMs:3*60*60*1000});
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
  });
  return listMixes(accountId);
}
export async function getMix(accountId:string,rawId:string) {
  const id=uuid(rawId,"mix ID");
  const mix=(await getRebuildPool().query(`SELECT id,slot,kind,name,description,status,reason,generated_at AS "generatedAt",expires_at AS "expiresAt"
    FROM sakura_v2."Mix" WHERE account_id=$1::uuid AND id=$2::uuid`,[accountId,id])).rows[0];
  if(!mix)throw new ProductError(404,"Mix not found");
  const membership=(await getRebuildPool().query(`SELECT recording_id FROM sakura_v2."MixRecording" WHERE mix_id=$1::uuid ORDER BY position`,[id])).rows.map(r=>r.recording_id);
  const recordings=await cardsForIds(accountId,membership);
  return {...mix,recordings,tracks:recordings,trackCount:recordings.length,
    playability:mix.status==="ready"&&recordings.length?"resolvable":"unavailable",durationMs:recordings.reduce((s,r)=>s+(r.durationMs||0),0)};
}
export async function offlineMixes(accountId:string,value:unknown){
  const requested=ids(object(value).recordingIds,2000),settings=await getSettings(accountId),cards=await cardsForIds(accountId,requested);
  const pool=getRebuildPool();
  const favorites=new Set((await pool.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=ANY($2::uuid[])`,[accountId,requested])).rows.map(r=>r.recording_id));
  const rows=(await pool.query(`SELECT s.recording_id,s.audible_ms,s.last_played_at,
    MIN(COALESCE(c.occurred_at,c.created_at)) first_played_at,
    BOOL_OR(EXTRACT(HOUR FROM COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $3)>=22 OR EXTRACT(HOUR FROM COALESCE(c.occurred_at,c.created_at) AT TIME ZONE $3)<4) late_night
    FROM sakura_v2."ListeningRecordingSummary" s LEFT JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=s.account_id AND l.recording_id=s.recording_id
    LEFT JOIN sakura_v2."ListeningChunk" c ON c.account_id=l.account_id AND c.event_id=l.event_id AND c.audible_ms>0
    WHERE s.account_id=$1::uuid AND s.recording_id=ANY($2::uuid[]) GROUP BY s.recording_id,s.audible_ms,s.last_played_at`,[accountId,requested,settings.timeZone])).rows;
  const history=new Map<string,SituationHistory>(rows.map(r=>[r.recording_id,{audibleMs:Number(r.audible_ms),lastPlayedAt:new Date(r.last_played_at).getTime(),firstPlayedAt:r.first_played_at?new Date(r.first_played_at).getTime():undefined,lateNight:Boolean(r.late_night)}]));
  const feedback=(await pool.query(`SELECT target,target_id FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid
    AND (kind='block' OR (kind='snooze' AND expires_at>now()))`,[accountId])).rows;
  const allowed=cards.filter(c=>!feedback.some(f=>f.target==="recording"?f.target_id===c.id:c.artistCredits.some(a=>a.artistId===f.target_id)));
  return {mixes:planOfflineMixes(allowed.map(c=>({...c,liked:favorites.has(c.id)})),{history,explicitContent:settings.explicitContent}),recordings:allowed,
    constraint:"Only requested canonical recordings; verify local blobs before playback."};
}
