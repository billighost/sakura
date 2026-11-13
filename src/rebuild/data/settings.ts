import type { PoolClient } from "pg";
import { inTransaction } from "./db";
import { DEFAULT_SETTINGS, preferencesPatch,object,integer,ProductError } from "./validation";
import { FEED_NUMERIC_FIELDS, FEED_BOOLEAN_FIELDS } from "../app/feedPreferences";
import {generateInitialTaste} from "./initialTaste";
import {initialTasteArtists,initialTasteSignature,normalizeInitialTasteProfile} from "../recommendations/initialTaste";

export async function getSettings(accountId:string,sql?:{query:PoolClient["query"]}) {
  if(sql)return readSettings(accountId,sql);
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    return readSettings(accountId,client);
  });
}
/** A coherent caller-owned snapshot can derive an old recipe without writing
 * it. Explicit settings/catalog maintenance retains the legacy durable repair. */
export function getSettingsSnapshot(accountId:string,sql:{query:PoolClient["query"]}){
  return readSettings(accountId,sql,false);
}
async function readSettings(accountId:string,sql:{query:PoolClient["query"]},persistDerived=true) {
  const row=(await sql.query(`SELECT preferences,seed_artists,seed_genres,onboarded,revision,field_revisions
    FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
  const settings={ ...DEFAULT_SETTINGS,...row?.preferences,seedArtists:row?.seed_artists||[],seedGenres:row?.seed_genres||[],
    onboarded:Boolean(row?.onboarded),revision:Number(row?.revision||0),fieldRevisions:(row?.field_revisions||{}) as Record<string,number> };
  const stored=normalizeInitialTasteProfile(settings.initialTasteProfile);
  settings.initialTasteProfile=stored?.signature===initialTasteSignature(settings)?stored:undefined;
  if(row&&!settings.initialTasteProfile&&initialTasteArtists(settings).length){
    const generated=await generateInitialTaste(accountId,settings,sql);
    if(!persistDerived){settings.initialTasteProfile=generated;return settings;}
    const saved=await sql.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences||jsonb_build_object('initialTasteProfile',$2::jsonb)
      WHERE account_id=$1::uuid AND revision=$3 RETURNING account_id`,[accountId,JSON.stringify(generated),settings.revision]);
    // Supplied SQL normally owns the account lock. A revision guard also keeps
    // a caller without that lock from publishing a recipe for an older choice.
    if(!saved.rowCount)return readSettings(accountId,sql);
    settings.initialTasteProfile=generated;
  }
  return settings;
}

/** Run after optional catalog enrichment, never while making provider calls. */
export async function refreshInitialTaste(accountId:string){
  return inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const settings=await getSettings(accountId,client);
    if(!initialTasteArtists(settings).length)return;
    const generated=await generateInitialTaste(accountId,settings,client);
    if(JSON.stringify(settings.initialTasteProfile)===JSON.stringify(generated))return;
    await client.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences||jsonb_build_object('initialTasteProfile',$2::jsonb)
      WHERE account_id=$1::uuid AND revision=$3`,[accountId,JSON.stringify(generated),settings.revision]);
    await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
  });
}
export async function patchSettings(accountId:string,value:unknown) {
  const {expectedRevision,...changes}=object(value);
  const expected=expectedRevision===undefined?undefined:integer(expectedRevision,"settings revision",0,Number.MAX_SAFE_INTEGER);
  const patch=preferencesPatch(changes);
  const {seedArtists,seedGenres,onboarded,...preferences}=patch;
  return inTransaction(async(client:PoolClient)=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const before=(await client.query(`SELECT preferences,seed_artists,seed_genres,onboarded,updated_at,revision FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
    if(expected!==undefined&&expected!==Number(before?.revision||0))throw new ProductError(409,"Your settings changed on another device. Refresh to use the latest choices.");
    await client.query(`INSERT INTO sakura_v2."AccountPreferences"(account_id) VALUES($1::uuid) ON CONFLICT DO NOTHING`,[accountId]);
    const previous=before?.preferences||{},next={...previous,...preferences};
    const nextSettings={...DEFAULT_SETTINGS,...next,seedArtists:seedArtists??before?.seed_artists??[],seedGenres:seedGenres??before?.seed_genres??[],onboarded:onboarded??Boolean(before?.onboarded)};
    const recipe=normalizeInitialTasteProfile(next.initialTasteProfile);
    if(!recipe||recipe.signature!==initialTasteSignature(nextSettings))preferences.initialTasteProfile=await generateInitialTaste(accountId,nextSettings,client);
    const wasPaused=previous.privateSession===true||previous.learnFromListening===false;
    const isPaused=next.privateSession===true||next.learnFromListening===false;
    if(wasPaused!==isPaused){
      const stamp=(await client.query("SELECT clock_timestamp() AS stamp")).rows[0].stamp;
      if(isPaused)await client.query(`INSERT INTO sakura_v2."ListeningPrivacyWindow"(account_id,started_at) VALUES($1::uuid,$2::timestamptz) ON CONFLICT DO NOTHING`,[accountId,stamp]);
      else {
        // Accounts already paused before this additive migration still have a
        // trustworthy lower bound: the last persisted preference change.
        const closed=await client.query(`UPDATE sakura_v2."ListeningPrivacyWindow" SET ended_at=$2::timestamptz WHERE account_id=$1::uuid AND ended_at IS NULL`,[accountId,stamp]);
        if(!closed.rowCount)await client.query(`INSERT INTO sakura_v2."ListeningPrivacyWindow"(account_id,started_at,ended_at) VALUES($1::uuid,$2::timestamptz,$3::timestamptz)`,[accountId,before?.updated_at||stamp,stamp]);
      }
    }
    await client.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences||$2::jsonb,
      seed_artists=COALESCE($3::jsonb,seed_artists),seed_genres=COALESCE($4::text[],seed_genres),
      onboarded=COALESCE($5::boolean,onboarded),field_revisions=field_revisions||COALESCE((SELECT jsonb_object_agg(key,revision+1) FROM unnest($6::text[]) key),'{}'::jsonb),
      revision=revision+1,updated_at=now() WHERE account_id=$1::uuid`,
      [accountId,JSON.stringify(preferences),seedArtists===undefined?null:JSON.stringify(seedArtists),seedGenres??null,onboarded??null,Object.keys(patch)]);
    if(seedArtists!==undefined||seedGenres!==undefined||preferences.seedArtistSelections!==undefined||preferences.explicitContent!==undefined||[...FEED_NUMERIC_FIELDS,...FEED_BOOLEAN_FIELDS].some(key=>preferences[key]!==undefined)) {
      await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
      await client.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[accountId]);
    }
    return getSettings(accountId,client);
  });
}
