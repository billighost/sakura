import { getRebuildPool, inTransaction } from "./db";
import { object, ProductError, text } from "./validation";

const layouts=new Set(["list","cards","compact"]);
const sorts=new Set(["kept","title","artist","duration","added"]);
const directions=new Set(["asc","desc"]);
export interface CollectionView {layout:"list"|"cards"|"compact";sort:"kept"|"title"|"artist"|"duration"|"added";direction:"asc"|"desc";updatedAt:string}

export function collectionRoom(value:unknown){return text(value,"collection room",180);}
export function collectionView(value:unknown):Omit<CollectionView,"updatedAt"> {
 const raw=object(value),layout=String(raw.layout||""),sort=String(raw.sort||""),direction=String(raw.direction||"");
 if(!layouts.has(layout)||!sorts.has(sort)||!directions.has(direction))throw new ProductError(400,"Invalid collection view");
 return {layout:layout as CollectionView["layout"],sort:sort as CollectionView["sort"],direction:direction as CollectionView["direction"]};
}
function storedView(value:unknown):CollectionView|null {
 try{
  const parsed=collectionView(value),updatedAt=(value as {updatedAt?:unknown}).updatedAt;
  return typeof updatedAt==="string"&&Number.isFinite(Date.parse(updatedAt))?{...parsed,updatedAt}:null;
 }catch{return null;}
}
function storedViews(value:unknown):Record<string,CollectionView>{
 if(!value||typeof value!=="object"||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).flatMap(([room,value])=>{const view=storedView(value);return view?[[room,view]]:[];}));
}
export async function getCollectionView(accountId:string,room:string){
 const result=await getRebuildPool().query(`SELECT preferences->'collectionViews'->$2 AS view FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId,room]);
 return storedView(result.rows[0]?.view);
}
export async function patchCollectionView(accountId:string,roomValue:unknown,value:unknown){
 const room=collectionRoom(roomValue),view=collectionView(value);
 return inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  await client.query(`INSERT INTO sakura_v2."AccountPreferences"(account_id) VALUES($1::uuid) ON CONFLICT DO NOTHING`,[accountId]);
  const row=(await client.query(`SELECT preferences->'collectionViews' AS views,clock_timestamp() AS stamp FROM sakura_v2."AccountPreferences" WHERE account_id=$1::uuid`,[accountId])).rows[0];
  const accepted={...view,updatedAt:new Date(row.stamp).toISOString()},views={...storedViews(row.views),[room]:accepted};
  const retained=Object.fromEntries(Object.entries(views).sort((a,b)=>Date.parse(b[1].updatedAt)-Date.parse(a[1].updatedAt)).slice(0,160));
  await client.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=jsonb_set(preferences,'{collectionViews}',$2::jsonb,true),updated_at=now() WHERE account_id=$1::uuid`,[accountId,JSON.stringify(retained)]);
  return accepted;
 });
}
