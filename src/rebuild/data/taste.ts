import { getRebuildPool, inTransaction } from "./db";
import type { PoolClient } from "pg";
import { cardsForIds, VERIFIED } from "./catalog";
import { ProductError, object, uuid } from "./validation";

export type TasteKind = "love" | "less" | "block" | "snooze";
export type TasteDuration = "day" | "week" | "month" | "forever";
const durationMs: Record<Exclude<TasteDuration,"forever">,number> = {day:86400000,week:7*86400000,month:30*86400000};
export function tasteInput(value: unknown) {
  const raw=object(value);
  if(Object.keys(raw).some(key=>!["target","targetId","kind","duration"].includes(key)))throw new ProductError(400,"Unsupported taste preference");
  if(raw.target!=="recording"&&raw.target!=="artist")throw new ProductError(400,"Invalid taste target");
  if(!["love","less","block","snooze"].includes(String(raw.kind)))throw new ProductError(400,"Invalid taste preference");
  const duration=raw.duration===undefined?(raw.kind==="snooze"?"week":"forever"):raw.duration;
  if(!["day","week","month","forever"].includes(String(duration)))throw new ProductError(400,"Invalid taste duration");
  if(raw.kind==="snooze"&&duration==="forever")throw new ProductError(400,"Choose a temporary duration, or exclude this song forever");
  return {target:raw.target,targetId:uuid(raw.targetId,"taste target ID"),kind:raw.kind as TasteKind,duration:duration as TasteDuration};
}
export function tasteExpiry(duration:TasteDuration,now=new Date()):string|null {
  return duration==="forever"?null:new Date(now.getTime()+durationMs[duration]).toISOString();
}
export async function getTaste(accountId:string,pool:{query:PoolClient["query"]}=getRebuildPool()) {
  const rows=(await pool.query(`SELECT f.target,f.target_id AS "targetId",f.kind,f.expires_at AS "expiresAt",f.updated_at AS "updatedAt",
    (f.expires_at IS NULL OR f.expires_at>now()) AS active,a.name
    FROM sakura_v2."TasteFeedback" f LEFT JOIN sakura_v2."Artist" a ON f.target='artist' AND a.id=f.target_id
    WHERE f.account_id=$1::uuid ORDER BY f.updated_at DESC,f.target_id`,[accountId])).rows;
  const tracks=await cardsForIds(accountId,rows.filter(row=>row.target==="recording").map(row=>row.targetId),pool);
  const byId=new Map(tracks.map(track=>[track.id,track]));
  return {feedback:rows.map(row=>({...row,...(byId.has(row.targetId)?{track:byId.get(row.targetId)}:{})})),
    description:"Your deliberate taste choices. Expired pauses no longer affect recommendations."};
}
export async function setTaste(accountId:string,value:unknown) {
  const input=tasteInput(value),expiresAt=tasteExpiry(input.duration);
  await inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const exists=input.target==="recording"
      ?(await client.query(`SELECT r.id FROM sakura_v2."Recording" r WHERE r.id=$1::uuid AND ${VERIFIED}`,[input.targetId])).rowCount
      :(await client.query(`SELECT a.id FROM sakura_v2."Artist" a WHERE a.id=$1::uuid AND EXISTS(
        SELECT 1 FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Recording" r ON r.id=ra.recording_id
        WHERE ra.artist_id=a.id AND ${VERIFIED})`,[input.targetId])).rowCount;
    if(!exists)throw new ProductError(404,"That song or artist is unavailable");
    await client.query(`INSERT INTO sakura_v2."TasteFeedback"(account_id,target,target_id,kind,expires_at)
      VALUES($1::uuid,$2,$3::uuid,$4,$5::timestamptz) ON CONFLICT(account_id,target,target_id)
      DO UPDATE SET kind=EXCLUDED.kind,expires_at=EXCLUDED.expires_at,updated_at=now()`,
      [accountId,input.target,input.targetId,input.kind,expiresAt]);
    await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
    await client.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[accountId]);
  });
  return {...input,expiresAt,saved:true};
}
export async function removeTaste(accountId:string,value:unknown) {
  const raw=object(value);
  if(Object.keys(raw).some(key=>!["target","targetId"].includes(key)))throw new ProductError(400,"Unsupported taste preference");
  if(raw.target!=="recording"&&raw.target!=="artist")throw new ProductError(400,"Invalid taste target");
  const targetId=uuid(raw.targetId,"taste target ID");
  await inTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    await client.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND target=$2 AND target_id=$3::uuid`,[accountId,raw.target,targetId]);
    await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
    await client.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[accountId]);
  });
  return {removed:true,target:raw.target,targetId};
}
