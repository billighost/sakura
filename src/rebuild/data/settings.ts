import type { PoolClient } from "pg";
import { getRebuildPool,inTransaction } from "./db";
import { DEFAULT_SETTINGS, preferencesPatch } from "./validation";

export async function getSettings(accountId:string) {
  const row=(await getRebuildPool().query(`SELECT preferences,seed_artists,seed_genres,onboarded,revision
    FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
  return { ...DEFAULT_SETTINGS,...row?.preferences,seedArtists:row?.seed_artists||[],seedGenres:row?.seed_genres||[],
    onboarded:Boolean(row?.onboarded),revision:Number(row?.revision||0) };
}
export async function patchSettings(accountId:string,value:unknown) {
  const patch=preferencesPatch(value);
  const {seedArtists,seedGenres,onboarded,...preferences}=patch;
  await inTransaction(async(client:PoolClient)=>{
    await client.query(`INSERT INTO sakura_v2."AccountPreferences"(account_id) VALUES($1::uuid) ON CONFLICT DO NOTHING`,[accountId]);
    await client.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences||$2::jsonb,
      seed_artists=COALESCE($3::jsonb,seed_artists),seed_genres=COALESCE($4::text[],seed_genres),
      onboarded=COALESCE($5::boolean,onboarded),revision=revision+1,updated_at=now() WHERE account_id=$1::uuid`,
      [accountId,JSON.stringify(preferences),seedArtists===undefined?null:JSON.stringify(seedArtists),seedGenres??null,onboarded??null]);
    if(seedArtists!==undefined||seedGenres!==undefined||preferences.seedArtistSelections!==undefined||preferences.discovery!==undefined||preferences.explicitContent!==undefined) {
      await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
    }
  });
  return getSettings(accountId);
}
