import {getRebuildPool,inIdempotentTransaction} from "./db";
import {integer,object,ProductError,text,uuid} from "./validation";
import {isDeepStrictEqual} from "node:util";
import type {ListeningSession,SessionRecord} from "../app/sessionState";
import {SESSION_QUEUE_LIMIT} from "../app/sessionState";
import {musicTrack} from "../app/types";

export function sessionPatch(value:unknown){
 const raw=object(value),state=object(raw.state);
 const deviceId=uuid(raw.deviceId,"device ID"),revision=integer(raw.revision,"session revision",0,Number.MAX_SAFE_INTEGER);
 if(!Array.isArray(state.queue)||state.queue.length>SESSION_QUEUE_LIMIT)throw new ProductError(400,"Invalid listening queue");
 const seen=new Set<string>();
 const queue=state.queue.map(value=>{
  const entry=object(value),entryId=uuid(entry.entryId,"queue entry");
  if(seen.has(entryId))throw new ProductError(400,"Duplicate queue entry");seen.add(entryId);
  const card=object(entry.track),reference=object(card.reference);
  if(!["deezer","spotify","musicbrainz","isrc","telegram","legacy"].includes(String(reference.provider)))throw new ProductError(400,"Invalid song reference");
  text(reference.id,"song reference",150);text(card.id,"song ID",160);text(card.title,"song title",300);
  if(!Array.isArray(card.artists)||card.artists.length>30||card.artists.some(name=>typeof name!=="string"||name.length>200))throw new ProductError(400,"Invalid song artists");
  integer(card.durationMs,"song duration",0,21600000);
  if(card.coverUrl!=null&&(typeof card.coverUrl!=="string"||card.coverUrl.length>2000||!/^https?:\/\//.test(card.coverUrl)))throw new ProductError(400,"Invalid cover URL");
  if(entry.priority!==undefined&&entry.priority!=="manual"&&entry.priority!=="automatic")throw new ProductError(400,"Invalid queue priority");
  const track=musicTrack({...card,explicit:card.explicit===true?"explicit":card.explicit,readyPlayback:undefined,audioUrl:undefined});
  return {entryId,track,priority:entry.priority as "manual"|"automatic"|undefined};
 });
 const currentEntryId=state.currentEntryId===null?null:uuid(state.currentEntryId,"current entry");
 if(currentEntryId&&!seen.has(currentEntryId))throw new ProductError(400,"Current song is missing from queue");
 const positionMs=integer(state.positionMs,"playback position",0,21600000);
 const current=queue.find(entry=>entry.entryId===currentEntryId);
 if(current&&current.track.durationMs&&positionMs>current.track.durationMs+5000)throw new ProductError(400,"Playback position exceeds song duration");
 const sleepUntil=state.sleepUntil==null?null:integer(state.sleepUntil,"sleep timer",0,Date.now()+86400000);
 return {deviceId,revision,state:{queue,currentEntryId,positionMs,sleepUntil} satisfies ListeningSession};
}
function record(row:Record<string,unknown>|undefined):SessionRecord|null {
 return row?{state:row.state as ListeningSession,revision:Number(row.revision),deviceId:String(row.device_id),updatedAt:new Date(String(row.updated_at)).getTime()}:null;
}
export async function getSession(accountId:string){
 return {session:record((await getRebuildPool().query('SELECT * FROM sakura_v2."ListeningSession" WHERE account_id=$1::uuid',[accountId])).rows[0])};
}
/** Compare-and-swap stops a sleeping device or a retry overwriting a newer session. */
export async function putSession(accountId:string,value:unknown){
 const patch=sessionPatch(value);
 return inIdempotentTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('listening-session:'||$1))",[accountId]);
  const previous=record((await client.query('SELECT * FROM sakura_v2."ListeningSession" WHERE account_id=$1::uuid',[accountId])).rows[0]);
  if((previous?.revision||0)!==patch.revision){
   if(previous?.deviceId===patch.deviceId&&isDeepStrictEqual(previous.state,JSON.parse(JSON.stringify(patch.state))))return {accepted:true,session:previous};
   return {accepted:false,session:previous};
  }
  const result=await client.query(`INSERT INTO sakura_v2."ListeningSession"(account_id,state,device_id,revision)
   VALUES($1::uuid,$2::jsonb,$3::uuid,1) ON CONFLICT(account_id) DO UPDATE SET state=EXCLUDED.state,
   device_id=EXCLUDED.device_id,revision=sakura_v2."ListeningSession".revision+1,updated_at=now() RETURNING *`,[accountId,JSON.stringify(patch.state),patch.deviceId]);
  return {accepted:true,session:record(result.rows[0])};
 });
}
