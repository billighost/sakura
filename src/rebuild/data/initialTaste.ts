import type {PoolClient} from "pg";
import {cardsForRanking,VERIFIED} from "./catalog";
import {buildInitialTasteProfile,initialTasteArtists} from "../recommendations/initialTaste";
import type {TasteSettings} from "../recommendations/personalization";
import {inTransaction} from "./db";
import {object,preferencesPatch,ProductError} from "./validation";

/** At most eight verified primary recordings per chosen artist, without provider calls. */
export async function generateInitialTaste(accountId:string,settings:TasteSettings,sql:Pick<PoolClient,"query">){
 const artists=initialTasteArtists(settings),exact=artists.filter(artist=>artist.reference),legacy=artists.filter(artist=>!artist.reference).map(artist=>artist.name.toLocaleLowerCase("en"));
 if(!artists.length)return buildInitialTasteProfile([],settings);
 const result=await sql.query(`SELECT songs.recording_id FROM sakura_v2."Artist" a CROSS JOIN LATERAL (
  SELECT ra.recording_id FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Recording" r ON r.id=ra.recording_id
  WHERE ra.artist_id=a.id AND ra.position=0 AND ${VERIFIED} AND ($3::boolean OR COALESCE(r.metadata->>'explicit','unknown')<>'explicit') ORDER BY r.id LIMIT 8
 ) songs WHERE lower(a.name)=ANY($1::text[]) OR EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) chosen(reference jsonb)
  WHERE chosen.reference->>'provider'=a.provider AND chosen.reference->>'id'=a.external_id)
 ORDER BY a.id,songs.recording_id LIMIT 160`,[legacy,JSON.stringify(exact),settings.explicitContent!==false]);
 return buildInitialTasteProfile(await cardsForRanking(accountId,[...new Set(result.rows.map(row=>String(row.recording_id)))],sql),settings);
}

/** Preview artist choices against published catalog tags without saving them. */
export async function previewInitialTaste(accountId:string,value:unknown){
 const raw=object(value);if(Object.keys(raw).some(key=>key!=="seedArtists"&&key!=="seedArtistSelections"))throw new ProductError(400,"Choose artists to preview your recommendations.");
 const patch=preferencesPatch(raw);
 return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const row=(await client.query(`SELECT preferences->'explicitContent' AS explicit FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
  const profile=await generateInitialTaste(accountId,{...patch,explicitContent:row?.explicit!==false},client);
  return {genres:profile.genres.slice(0,4).map(genre=>genre.name),matchedArtists:profile.artists.filter(artist=>artist.recordings.length).length,selectedArtists:profile.artists.length};
 });
}
