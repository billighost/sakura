import { getRebuildPool,inTransaction } from "./db";
import { CARD_SELECT,VERIFIED,card,cardsForIds } from "./catalog";
import { getSettings } from "./settings";
import { listPlaylists } from "./collections";
import { ensureMixes } from "../recommendations/service";
import { ProductError,object,text } from "./validation";
import { artistEntity,albumEntity } from "./entities";
import { groupArtistCards } from "./artistSelection";
import { getListeningInsights } from "./listeningInsights";
import {initialTasteGenreWeights} from "../recommendations/initialTaste";

export async function getHome(accountId:string) {
  return inTransaction(async pool=>{
  await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const settings=await getSettings(accountId,pool);
  const mixes=await ensureMixes(accountId,false,pool);
  const recentRows=await pool.query(`SELECT recording_id FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid AND audible_ms>0 AND last_played_at IS NOT NULL ORDER BY last_played_at DESC,recording_id LIMIT 12`,[accountId]);
  const favorites=await pool.query(`SELECT recording_id FROM sakura_v2."Favorite" WHERE account_id=$1::uuid ORDER BY created_at DESC,recording_id LIMIT 12`,[accountId]);
  const featuredRows=await pool.query(`${CARD_SELECT} WHERE ${VERIFIED} AND ($2::boolean OR COALESCE(r.metadata->>'explicit','unknown')<>'explicit')
      ORDER BY COALESCE((r.metadata->>'popularity')::numeric,0.5) DESC,r.created_at DESC,r.id LIMIT 24`,[accountId,settings.explicitContent]);
  const playlists=await listPlaylists(accountId,pool);
  const recent=await cardsForIds(accountId,recentRows.rows.map(r=>r.recording_id),pool),liked=await cardsForIds(accountId,favorites.rows.map(r=>r.recording_id),pool);
  return {recent,liked,mixes,featured:featuredRows.rows.map(card),playlists,needsOnboarding:!settings.onboarded,
    generatedAt:new Date().toISOString(),schemaVersion:2};
  });
}

export async function getProfile(accountId:string) {
  return inTransaction(async pool=>{
  await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const user=await pool.query(`SELECT id,username,email,"avatarUrl",bio,"createdAt" FROM public."User" WHERE id=$1::uuid`,[accountId]);
  const summary=await pool.query(`SELECT audible_ms,play_count,completed_count,skipped_count FROM sakura_v2."LifetimeListeningSummary" WHERE account_id=$1::uuid`,[accountId]);
  const counts=await pool.query(`SELECT (SELECT COUNT(*) FROM sakura_v2."Favorite" WHERE account_id=$1::uuid)::integer AS liked,
      (SELECT COUNT(*) FROM sakura_v2."Playlist" WHERE account_id=$1::uuid)::integer AS playlists,
      (SELECT COUNT(*) FROM sakura_v2."ListeningRecordingSummary" WHERE account_id=$1::uuid AND audible_ms>0)::integer AS "uniqueRecordings"`,[accountId]);
  const artists=await pool.query(`SELECT a.id,a.name,a.image_url AS "imageUrl",SUM(s.audible_ms)::text AS "audibleMs" FROM sakura_v2."ListeningRecordingSummary" s
      JOIN sakura_v2."RecordingArtist" ra ON ra.recording_id=s.recording_id AND ra.position=0 JOIN sakura_v2."Artist" a ON a.id=ra.artist_id
      WHERE s.account_id=$1::uuid AND s.audible_ms>0 GROUP BY a.id ORDER BY SUM(s.audible_ms) DESC,a.id LIMIT 10`,[accountId]);
  const settings=await getSettings(accountId,pool);
  if(!user.rows[0])throw new ProductError(401,"Unauthorized");
  const totals=summary.rows[0];
  const stats={audibleMs:Number(totals?.audible_ms||0),listeningHours:Number(totals?.audible_ms||0)/3600000,
    playCount:Number(totals?.play_count||0),completedCount:Number(totals?.completed_count||0),skippedCount:Number(totals?.skipped_count||0),...counts.rows[0]};
  const insights=await getListeningInsights(accountId,settings.timeZone,pool);
  return {profile:user.rows[0],stats,topArtists:artists.rows.map(a=>({...a,audibleMs:Number(a.audibleMs)})),insights,
    tasteEvidence:insights.tasteEvidence,tasteFeedback:insights.tasteFeedback,
    onboarding:{onboarded:settings.onboarded,seedArtists:settings.seedArtists,seedGenres:settings.seedGenres,initialTasteGenres:initialTasteGenreWeights(settings,insights.tasteFeedback).map(genre=>genre.name)}};
  });
}
export async function patchProfile(accountId:string,value:unknown) {
  const raw=object(value);
  if(Object.keys(raw).some(k=>!["username","bio"].includes(k)))throw new ProductError(400,"Unsupported profile field");
  const username=raw.username===undefined?null:text(raw.username,"username",30).toLowerCase(),bio=raw.bio===undefined?null:text(raw.bio,"bio",300,true);
  if(username&&!/^[a-z0-9_]{3,30}$/.test(username))throw new ProductError(400,"Use 3–30 letters, numbers or underscores for the username");
  try{await getRebuildPool().query(`UPDATE public."User" SET username=COALESCE($2,username),bio=COALESCE($3,bio) WHERE id=$1::uuid`,[accountId,username,bio]);}
  catch(error){if((error as {code?:string}).code==="23505")throw new ProductError(409,"Username is already taken");throw error;}
  return getProfile(accountId);
}

export async function listArtists() {
  return {artists:groupArtistCards((await getRebuildPool().query(`SELECT a.id,a.name,a.image_url AS "imageUrl",a.provider,a.external_id AS "externalId",COUNT(ra.recording_id)::integer AS "trackCount"
    FROM sakura_v2."Artist" a JOIN sakura_v2."RecordingArtist" ra ON ra.artist_id=a.id JOIN sakura_v2."Recording" r ON r.id=ra.recording_id AND r.state='verified'
    GROUP BY a.id ORDER BY COUNT(ra.recording_id) DESC,a.name LIMIT 100`,[])).rows),accountScoped:true};
}
export async function getArtist(accountId:string,rawId:string) {
  return artistEntity(accountId,rawId);
}
export async function listAlbums() {
  return {albums:(await getRebuildPool().query(`SELECT a.id,a.title,a.cover_url AS "coverUrl",a.artist_id AS "artistId",ar.name AS "artistName",a.release_date AS "releaseDate"
    FROM sakura_v2."Album" a LEFT JOIN sakura_v2."Artist" ar ON ar.id=a.artist_id ORDER BY a.updated_at DESC LIMIT 100`,[])).rows,accountScoped:true};
}
export async function getAlbum(accountId:string,rawId:string) {
  return albumEntity(accountId,rawId);
}
