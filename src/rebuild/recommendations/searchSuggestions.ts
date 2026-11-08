import {inTransaction} from "../data/db";
import {VERIFIED,cardsForRanking} from "../data/catalog";
import {getSettings} from "../data/settings";
import {getTaste} from "../data/taste";
import {activeTasteFeedback,tasteExcluded,type ListeningEvidence,type TasteFeedback} from "./personalization";
import {rankSearchArtists,searchPrimaryArtistId} from "./searchArtists";
import {initialTasteGenreWeights,initialTasteSignature,normalizeInitialTasteProfile} from "./initialTaste";
import {isUuid} from "../server/input";

/** Bounded local-catalog query. Search suggestions do not contact providers. */
export async function getSearchSuggestions(accountId:string){
 return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const settings=await getSettings(accountId,client),taste=await getTaste(accountId,client),feedback:TasteFeedback[]=taste.feedback.map(row=>({...row,expiresAt:row.expiresAt instanceof Date?row.expiresAt.toISOString():row.expiresAt}));
  const history:ListeningEvidence[]=settings.learnFromListening===false?[]:(await client.query(`SELECT recording_id AS "recordingId",audible_ms::double precision AS "audibleMs",play_count AS "playCount",completed_count AS "completedCount",skipped_count AS "skippedCount",last_played_at AS "lastPlayedAt" FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid AND audible_ms>0 ORDER BY audible_ms DESC,recording_id LIMIT 1000`,[accountId])).rows.map(row=>({...row,playCount:Number(row.playCount)||0,completedCount:Number(row.completedCount)||0,skippedCount:Number(row.skippedCount)||0,lastPlayedAt:row.lastPlayedAt instanceof Date?row.lastPlayedAt.toISOString():row.lastPlayedAt}));
  const likedIds:string[]=(await client.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid ORDER BY created_at DESC,recording_id LIMIT 1000`,[accountId])).rows.map(row=>row.recording_id);
  const selections=settings.seedArtistSelections||[],selectedNames=new Set(selections.map((selection:{name:string})=>selection.name.toLocaleLowerCase("en"))),legacy=(settings.seedArtists||[]).map((name:string)=>name.toLocaleLowerCase("en")).filter((name:string)=>!selectedNames.has(name));
  const requestedArtistIds=activeTasteFeedback(feedback).filter(row=>row.target==="artist"&&row.kind==="love").slice(0,20).map(row=>row.targetId);
  // Reserve primary recordings for both onboarding choices and deliberate
  // requests. New guest appearances cannot crowd an older lead artist out.
  const selectedIds:string[]=legacy.length||selections.length||requestedArtistIds.length?(await client.query(`SELECT songs.recording_id FROM sakura_v2."Artist" a CROSS JOIN LATERAL (
    SELECT ra.recording_id FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Recording" r ON r.id=ra.recording_id WHERE ra.artist_id=a.id AND ra.position=0 AND ${VERIFIED} ORDER BY r.created_at DESC,r.id LIMIT 8
  ) songs WHERE lower(a.name)=ANY($1::text[]) OR EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS chosen(reference jsonb) WHERE chosen.reference->>'provider'=a.provider AND chosen.reference->>'id'=a.external_id) OR a.id=ANY($3::uuid[]) ORDER BY a.id,songs.recording_id LIMIT 320`,[legacy,JSON.stringify(selections),requestedArtistIds])).rows.map(row=>row.recording_id):[];
  const recipe=normalizeInitialTasteProfile(settings.initialTasteProfile),recipeIds=recipe?.signature===initialTasteSignature(settings)?recipe.artists.flatMap(artist=>artist.recordings.map(recording=>recording.id)).filter(isUuid):[];
  const knownIds=[...new Set([...history.map(row=>row.recordingId),...likedIds,...selectedIds,...recipeIds,...taste.feedback.filter(row=>row.target==="recording").map(row=>row.targetId)])];
  const known=await cardsForRanking(accountId,knownIds,client);
  const genres=[...new Set([...(settings.seedGenres||[]),...initialTasteGenreWeights(settings,feedback).map(genre=>genre.name),...known.filter(track=>!tasteExcluded(track,feedback)&&(settings.explicitContent!==false||track.metadata.explicit!=="explicit")).flatMap(track=>track.genres)])].slice(0,80);
  // Select the bounded reservoir before projecting references and credits. A
  // catalog sort must not execute every card's identity subqueries or JIT them.
  const candidateIds:string[]=(await client.query(`SELECT r.id FROM sakura_v2."Recording" r WHERE ${VERIFIED} AND NOT(r.id=ANY($1::uuid[])) ORDER BY
    EXISTS(SELECT 1 FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Artist" a ON a.id=ra.artist_id WHERE ra.recording_id=r.id AND ra.position=0 AND (lower(a.name)=ANY($2::text[]) OR EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS chosen(reference jsonb) WHERE chosen.reference->>'provider'=a.provider AND chosen.reference->>'id'=a.external_id))) DESC,
    EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.metadata->'genres')='array' THEN r.metadata->'genres' ELSE '[]'::jsonb END) AS tag(value) WHERE lower(tag.value)=ANY($4::text[])) DESC,
    r.created_at DESC,r.id LIMIT 600`,[knownIds,legacy,JSON.stringify(selections),genres.map(genre=>genre.toLocaleLowerCase("en"))])).rows.map(row=>row.id);
  const candidates=await cardsForRanking(accountId,candidateIds,client);
  const tracks=[...known,...candidates],artistIds=[...new Set(tracks.flatMap(track=>{const id=searchPrimaryArtistId(track);return id?[id]:[];}))];
  const artists=(await client.query(`SELECT id,name,jsonb_build_object('provider',provider,'id',external_id) AS reference FROM sakura_v2."Artist" WHERE id=ANY($1::uuid[])`,[artistIds])).rows;
  const suggestions=rankSearchArtists(artists,tracks,{settings,history,likedIds,feedback});
  return {artists:suggestions,learningEnabled:settings.learnFromListening!==false,accountScoped:true};
 });
}
