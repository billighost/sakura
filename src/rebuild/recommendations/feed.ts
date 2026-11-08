import {createHash,randomBytes} from "node:crypto";
import type {PoolClient} from "pg";
import {getRebuildPool,inTransaction} from "../data/db";
import {RANKING_CARD_SELECT,VERIFIED,card,cardsForIds,type RecordingCard} from "../data/catalog";
import {getSettings} from "../data/settings";
import {ProductError,ids,integer,object} from "../data/validation";
import {FEED_DEFAULTS} from "../app/feedPreferences";
import {rankPersonalizedTracks,orderPersonalizedTracks,planLocalQueue,recentRelease,tasteExcluded,
  type ListeningEvidence,type TasteFeedback,type TasteSettings,type RankedTrack} from "./personalization";
import {encodeFeedCursor,parseFeedCursor,verifyFeedCursor} from "./feedCursor";

type FeedCard=RecordingCard&{releaseDate:string|null};
interface FeedEntry {recordingId:string;reason:string;lane:RankedTrack<FeedCard>["lane"]}
interface FeedSection {id:string;title:string;description:string;tracks:FeedCard[]}
type Queryable=Pick<PoolClient,"query">;
const CANDIDATE_SELECT=RANKING_CARD_SELECT.replace("SELECT r.id,r.metadata,r.provenance,",()=>`SELECT r.id,r.metadata,r.provenance,
  (SELECT MIN(a.release_date) FROM sakura_v2."RecordingAlbum" ra JOIN sakura_v2."Album" a ON a.id=ra.album_id
    WHERE ra.recording_id=r.id AND a.release_date ~ '^\\d{4}-\\d{2}-\\d{2}$') AS "releaseDate",`);
const feedCard=(row:Parameters<typeof card>[0]):FeedCard=>({...card(row),releaseDate:typeof row.releaseDate==="string"?row.releaseDate:null});
const settingsKeys=[...Object.keys(FEED_DEFAULTS),"seedArtists","seedGenres","seedArtistSelections","explicitContent","timeZone"];
export function feedSettingsSignature(settings:TasteSettings):string{
  return createHash("sha256").update(JSON.stringify(settingsKeys.map(key=>[key,settings[key as keyof TasteSettings]]))).digest("hex");
}

/** All learning uses retained, measured evidence. Candidate acquisition remains the verified catalog's responsibility. */
async function tasteContext(accountId:string,pool:Queryable=getRebuildPool()){
  const settings=await getSettings(accountId,pool);
  const queries=[
    ()=>pool.query(`WITH known AS (
      SELECT r.id FROM sakura_v2."Recording" r WHERE ${VERIFIED} AND
        (EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=$1::uuid AND f.recording_id=r.id) OR
         ($2::boolean AND EXISTS(SELECT 1 FROM sakura_v2."ListeningRecordingSummary" s WHERE s.account_id=$1::uuid AND s.recording_id=r.id AND s.audible_ms>0)))
      ORDER BY EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=$1::uuid AND f.recording_id=r.id) DESC,
        CASE WHEN $2::boolean THEN COALESCE((SELECT s.audible_ms FROM sakura_v2."ListeningRecordingSummary" s WHERE s.account_id=$1::uuid AND s.recording_id=r.id),0) ELSE 0 END DESC,
        r.created_at DESC,r.id LIMIT 1000
    ), unexplored AS (
      SELECT r.id FROM sakura_v2."Recording" r WHERE ${VERIFIED}
        AND NOT EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=$1::uuid AND f.recording_id=r.id)
        AND (NOT $2::boolean OR NOT EXISTS(SELECT 1 FROM sakura_v2."ListeningRecordingSummary" s WHERE s.account_id=$1::uuid AND s.recording_id=r.id AND s.audible_ms>0))
      ORDER BY r.created_at DESC,r.id LIMIT 1500
    ) ${CANDIDATE_SELECT} WHERE ${VERIFIED} AND r.id IN (SELECT id FROM known UNION SELECT id FROM unexplored UNION SELECT unnest($3::uuid[])) ORDER BY r.id`,[accountId,settings.learnFromListening!==false,[...new Set((settings.initialTasteProfile?.artists||[]).flatMap((artist:{recordings:{id:string}[]})=>artist.recordings.map(recording=>recording.id)))]]),
    ()=>settings.learnFromListening===false?Promise.resolve({rows:[]}):pool.query(`SELECT recording_id,audible_ms,play_count,completed_count,skipped_count,last_played_at
      FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid ORDER BY audible_ms DESC,recording_id LIMIT 5000`,[accountId]),
    ()=>pool.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid`,[accountId]),
    ()=>pool.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND (expires_at IS NULL OR expires_at>now())`,[accountId]),
    ()=>settings.timeAware===false||settings.learnFromListening===false?Promise.resolve({rows:[]}):pool.query(`SELECT l.recording_id,
      EXTRACT(HOUR FROM c.occurred_at AT TIME ZONE $2)::integer AS local_hour,SUM(c.audible_ms)::text audible_ms
      FROM sakura_v2."ListeningChunk" c JOIN sakura_v2."ListeningEventLedger" l ON l.account_id=c.account_id AND l.event_id=c.event_id
      WHERE c.account_id=$1::uuid AND c.audible_ms>0 AND c.occurred_at>=now()-interval '90 days'
      GROUP BY l.recording_id,local_hour`,[accountId,settings.timeZone]),
  ];
  // pg transaction clients execute one query at a time; concurrent query calls are deprecated.
  const results=[];for(const query of queries)results.push(await query());
  const [recordings,listens,favorites,feedbackRows,hourRows]=results;
  const hours=new Map<string,{hour:number;audibleMs:number}[]>();
  for(const row of hourRows.rows){const values=hours.get(row.recording_id)||[];values.push({hour:Number(row.local_hour),audibleMs:Number(row.audible_ms)});hours.set(row.recording_id,values);}
  const history:ListeningEvidence[]=listens.rows.map(row=>({recordingId:row.recording_id,audibleMs:Number(row.audible_ms),playCount:Number(row.play_count),
    completedCount:Number(row.completed_count),skippedCount:Number(row.skipped_count),...(row.last_played_at?{lastPlayedAt:new Date(row.last_played_at).toISOString()}:{}),hourWeights:hours.get(row.recording_id)||[]}));
  const feedback:TasteFeedback[]=feedbackRows.rows.map(row=>({target:row.target,targetId:row.target_id,kind:row.kind,expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null}));
  return {settings:settings as TasteSettings,cards:recordings.rows.map(feedCard),history,feedback,likedIds:favorites.rows.map(row=>row.recording_id as string)};
}

function sectionsFor(ranked:RankedTrack<FeedCard>[],context:Awaited<ReturnType<typeof tasteContext>>,now:number):FeedSection[]{
  const sections:FeedSection[]=[];
  const add=(id:string,title:string,description:string,tracks:FeedCard[])=>{if(tracks.length)sections.push({id,title,description,tracks:tracks.slice(0,6)});};
  add("fresh-voices","From recent albums","Recent albums by artists you have chosen or heard here, where dates are available.",ranked.filter(item=>item.familiarArtist&&recentRelease(item.track.releaseDate,now)).map(item=>item.track));
  add("another-side","More from familiar artists","Songs you have not heard here, from artists in your listening or selected preferences.",ranked.filter(item=>item.familiarArtist&&!item.heard&&!context.likedIds.includes(item.track.id)).map(item=>item.track));
  const history=new Map(context.history.map(item=>[item.recordingId,item]));
  add("return-to","Favorites to revisit",context.settings.learnFromListening===false?"A mix from your liked songs.":"Liked songs with no saved listening in the last two weeks.",ranked.filter(item=>context.likedIds.includes(item.track.id)&&
    (!history.has(item.track.id)||Date.parse(String(history.get(item.track.id)?.lastPlayedAt))<now-14*86400000)).map(item=>item.track));
  add("familiar-world","Songs you know","Songs you have liked or played here.",ranked.filter(item=>item.heard||context.likedIds.includes(item.track.id)).map(item=>item.track));
  add("new-paths","Artists to discover","Songs from artists you have not listened to here.",ranked.filter(item=>!item.familiarArtist&&!item.heard).map(item=>item.track));
  return sections.slice(0,4);
}
function feedInput(url:URL):{surface:"home"|"discover";mode:"balanced"|"familiar"|"explore";limit:number;cursor:string|null}{
  const surface=url.searchParams.get("surface")||"home",mode=url.searchParams.get("mode")||"balanced";
  if(surface!=="home"&&surface!=="discover")throw new ProductError(400,"Invalid feed surface");
  if(mode!=="balanced"&&mode!=="familiar"&&mode!=="explore")throw new ProductError(400,"Invalid feed mode");
  const raw=url.searchParams.get("limit"),limit=raw===null?12:integer(Number(raw),"feed page size",1,40);
  return {surface,mode,limit,cursor:url.searchParams.get("cursor")};
}

export async function getPersonalizedFeed(accountId:string,url:URL){
  return inTransaction(async client=>{
    // Data clearing, deliberate taste updates and evidence generation share this lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return personalizedFeedPage(accountId,url,client);
  });
}
async function personalizedFeedPage(accountId:string,url:URL,pool:Queryable){
  const {surface,mode,limit,cursor}=feedInput(url);
  let session:{id:string;entries:FeedEntry[];cursor_secret:string;settings_signature:string;generated_at:Date;expires_at:Date;surface:string;mode:string;personalized:boolean};
  let offset=0,sections:FeedSection[]=[],personalized=false;
  if(cursor){
    const parsed=parseFeedCursor(cursor);
    const row=(await pool.query(`SELECT id,entries,cursor_secret,settings_signature,generated_at,expires_at,surface,mode,personalized FROM sakura_v2."FeedSession"
      WHERE account_id=$1::uuid AND id=$2::uuid`,[accountId,parsed.sessionId])).rows[0];
    if(!row)throw new ProductError(410,"This selection has expired. Refresh it for current recommendations.");
    verifyFeedCursor(parsed,row.cursor_secret);
    if(row.surface!==surface||row.mode!==mode)throw new ProductError(400,"The cursor belongs to another feed");
    if(new Date(row.expires_at).getTime()<=Date.now())throw new ProductError(410,"This selection has expired. Refresh it for current recommendations.");
    const settings=await getSettings(accountId,pool);
    if(feedSettingsSignature(settings as TasteSettings)!==row.settings_signature)throw new ProductError(409,"Your feed settings changed. Refresh to grow a new feed.");
    if(parsed.offset>row.entries.length)throw new ProductError(400,"Invalid feed position");
    session=row;offset=parsed.offset;personalized=row.personalized;
  }else{
    const context=await tasteContext(accountId,pool),now=Date.now();
    const ranked=rankPersonalizedTracks(context.cards,{...context,settings:context.settings,surface,mode,nowMs:now,seed:`${accountId}:${now}`});
    const ordered=orderPersonalizedTracks(ranked,context.settings);
    sections=sectionsFor(ordered,context,now);
    const visibleCards=new Map((await cardsForIds(accountId,[...new Set(sections.flatMap(section=>section.tracks.map(track=>track.id)))],pool)).map(track=>[track.id,track]));
    sections=sections.map(section=>({...section,tracks:section.tracks.flatMap(track=>{const full=visibleCards.get(track.id);return full?[{...full,releaseDate:track.releaseDate}]:[];})})).filter(section=>section.tracks.length);
    const entries=ordered.map(item=>({recordingId:item.track.id,reason:item.reason,lane:item.lane})),secret=randomBytes(32).toString("hex");
    const eligibleIds=new Set(ranked.map(item=>item.track.id));
    personalized=context.history.some(item=>item.audibleMs>0&&eligibleIds.has(item.recordingId))||context.likedIds.some(id=>eligibleIds.has(id))||
      context.feedback.some(item=>item.kind==="love"&&item.target==="recording"&&eligibleIds.has(item.targetId))||Boolean(context.settings.seedArtists?.length||context.settings.seedGenres?.length||context.settings.seedArtistSelections?.length);
    // The account lock keeps at most eight live snapshots, including concurrent refreshes.
    await pool.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid AND (expires_at<=now() OR id IN
      (SELECT id FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid ORDER BY generated_at DESC,id DESC OFFSET 7))`,[accountId]);
    session=(await pool.query(`INSERT INTO sakura_v2."FeedSession"(account_id,surface,mode,entries,cursor_secret,settings_signature,personalized,expires_at)
      VALUES($1::uuid,$2,$3,$4::jsonb,$5,$6,$7,now()+interval '6 hours') RETURNING id,entries,cursor_secret,settings_signature,generated_at,expires_at,surface,mode,personalized`,
      [accountId,surface,mode,JSON.stringify(entries),secret,feedSettingsSignature(context.settings),personalized])).rows[0];
  }
  // Feedback can change while scrolling. Recheck it before projecting any retained snapshot entry.
  const settings=await getSettings(accountId,pool),feedbackRows=(await pool.query(`SELECT target,target_id,kind,expires_at FROM sakura_v2."TasteFeedback"
    WHERE account_id=$1::uuid AND (expires_at IS NULL OR expires_at>now())`,[accountId])).rows;
  const feedback:TasteFeedback[]=feedbackRows.map(row=>({target:row.target,targetId:row.target_id,kind:row.kind,expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null}));
  const items:{track:RecordingCard;reason:string;lane:FeedEntry["lane"]}[]=[];
  while(offset<session.entries.length&&items.length<limit){
    const chunk=session.entries.slice(offset,offset+Math.min(100,Math.max(limit-items.length,12)));
    const cards=await cardsForIds(accountId,chunk.map(item=>item.recordingId),pool);
    const available=new Map(cards.map(track=>[track.id,track]));
    for(const entry of chunk){
      offset++;
      const track=available.get(entry.recordingId);
      if(track&&(settings.explicitContent!==false||track.metadata.explicit!=="explicit")&&!tasteExcluded(track,feedback))items.push({track,reason:entry.reason,lane:entry.lane});
      if(items.length===limit)break;
    }
  }
  sections=sections.map(section=>({...section,tracks:section.tracks.filter(track=>!tasteExcluded(track,feedback)&&(settings.explicitContent!==false||track.metadata.explicit!=="explicit"))})).filter(section=>section.tracks.length);
  return {items,sections,nextCursor:offset<session.entries.length?encodeFeedCursor(session.id,offset,session.cursor_secret):null,
    sessionId:session.id,generatedAt:new Date(session.generated_at).toISOString(),totalCandidates:session.entries.length,personalized,
    learning:settings.learnFromListening!==false,exhausted:offset>=session.entries.length};
}

export async function generateSmartQueue(accountId:string,value:unknown){
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return smartQueueFor(accountId,value,client);
  });
}
async function smartQueueFor(accountId:string,value:unknown,pool:Queryable){
  const raw=object(value),scope=raw.scope||"all";
  if(!["all","liked","downloads","collection"].includes(String(scope)))throw new ProductError(400,"Invalid queue source");
  if(Object.keys(raw).some(key=>!["scope","recordingIds","limit"].includes(key)))throw new ProductError(400,"Unsupported queue option");
  const limit=raw.limit===undefined?30:integer(raw.limit,"queue size",1,80);
  const requested=raw.recordingIds===undefined?undefined:ids(raw.recordingIds,2000);
  if((scope==="downloads"||scope==="collection")&&!requested)throw new ProductError(400,"Choose recordings for this queue");
  if(scope==="all"&&requested)throw new ProductError(400,"Use a collection source for a restricted queue");
  const context=await tasteContext(accountId,pool),now=Date.now();
  let candidates=context.cards;
  if(requested){
    const rows=(await pool.query(`${CANDIDATE_SELECT} WHERE ${VERIFIED} AND r.id=ANY($2::uuid[])`,[accountId,requested])).rows;
    candidates=rows.map(feedCard);
  }
  if(scope==="liked"){
    if(!requested){const rows=(await pool.query(`${CANDIDATE_SELECT} WHERE ${VERIFIED} AND EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=$1::uuid AND f.recording_id=r.id) ORDER BY r.id LIMIT 5000`,[accountId])).rows;candidates=rows.map(feedCard);}
    else {const liked=new Set(context.likedIds);candidates=candidates.filter(track=>liked.has(track.id));}
  }
  const tracks=planLocalQueue(candidates,{...context,evidenceTracks:context.cards,settings:context.settings,nowMs:now,seed:`${accountId}:queue:${now}`,limit});
  const selected=new Set(candidates.map(track=>track.id));
  const retainedHistory=context.history.filter(item=>!tasteExcluded(context.cards.find(track=>track.id===item.recordingId)||{id:item.recordingId,artists:[]},context.feedback,now));
  const history=[...retainedHistory.filter(item=>selected.has(item.recordingId)),...retainedHistory.filter(item=>!selected.has(item.recordingId))].slice(0,500);
  return {tracks:await cardsForIds(accountId,tracks.map(track=>track.id),pool),scope,generatedAt:new Date(now).toISOString(),reason:scope==="downloads"?"A mix from songs downloaded on this device":scope==="liked"?"A mix from your liked songs":scope==="collection"?"A mix from this collection":"A soundtrack based on your listening preferences",
    taste:{history,feedback:context.feedback},constraint:scope==="downloads"?"The device must verify saved audio before playback":undefined};
}
