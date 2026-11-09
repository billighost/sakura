import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after,before,describe,it} from "node:test";
import {Pool,type PoolClient} from "pg";
import {retainListeningOrigin} from "../src/rebuild/data/listeningOrigin";

describe("Durable playback origin compatibility",()=>{
 it("keeps legacy schemas usable without an unsupported-column write",async()=>{
  let checks=0,writes=0;
  const client={query:async(sql:string)=>{if(sql.includes("pg_attribute")){checks++;return {rows:[{ready:false}]};}writes++;throw new Error("Unsupported column write");}} as unknown as PoolClient;
  await retainListeningOrigin(client,"account","event","search",null);
  await retainListeningOrigin(client,"account","event","search",null);
  assert.equal(checks,1);assert.equal(writes,0);
 });
 it("retains the event source with account ownership and never changes an existing origin",async()=>{
  const writes:{sql:string;args:unknown[]}[]=[];
  const client={query:async(sql:string,args:unknown[]=[])=>{if(sql.includes("pg_attribute"))return {rows:[{ready:true}]};writes.push({sql,args});return {rows:[]};}} as unknown as PoolClient;
  await retainListeningOrigin(client,"account-one","event-one","playlist","playlist-id");
  assert.deepEqual(writes[0].args,["account-one","event-one","playlist","playlist-id"]);
  assert.match(writes[0].sql,/account_id=\$1::uuid AND event_id=\$2::uuid AND context IS NULL/);
 });
});

const database=process.env.SAKURA_LISTENING_ORIGIN_TEST_DATABASE_URL;
describe("Playback origin storage with isolated PostgreSQL",{skip:!database},()=>{
 const pool=new Pool({connectionString:database,max:1}),schema=`sakura_origin_${randomUUID().replaceAll("-","")}`;
 let client:PoolClient,rawClient:PoolClient;
 const account=randomUUID(),other=randomUUID(),event=randomUUID(),compacted=randomUUID(),unknown=randomUUID();
 before(async()=>{
  rawClient=await pool.connect();
  await rawClient.query(`CREATE SCHEMA "${schema}"`);
  await rawClient.query(`CREATE TABLE "${schema}"."ListeningEventLedger" (
    account_id uuid NOT NULL,event_id uuid NOT NULL,recording_id uuid NOT NULL,
    audible_ms bigint NOT NULL DEFAULT 0,completed boolean NOT NULL DEFAULT false,
    skipped boolean NOT NULL DEFAULT false,finished boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,event_id));
   CREATE TABLE "${schema}"."ListeningEvent" (
    account_id uuid NOT NULL,event_id uuid NOT NULL,context text NOT NULL,context_id text,
    FOREIGN KEY(account_id,event_id) REFERENCES "${schema}"."ListeningEventLedger" ON DELETE CASCADE);
   CREATE TABLE "${schema}"."ListeningChunk" (
    account_id uuid NOT NULL,event_id uuid NOT NULL,audible_ms bigint NOT NULL,
    FOREIGN KEY(account_id,event_id) REFERENCES "${schema}"."ListeningEventLedger" ON DELETE CASCADE)`);
  for(const id of [event,compacted,unknown])await rawClient.query(`INSERT INTO "${schema}"."ListeningEventLedger"(account_id,event_id,recording_id) VALUES($1,$2,$3)`,[account,id,randomUUID()]);
  await rawClient.query(`INSERT INTO "${schema}"."ListeningEvent"(account_id,event_id,context,context_id) VALUES($1,$2,'search',NULL)`,[account,event]);
  const full=await readFile(new URL("../src/rebuild/data/schema.sql",import.meta.url),"utf8");
  const migration=full.slice(full.indexOf('-- Playback origin belongs'),full.indexOf('ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS position_ms'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS context text'));
  await rawClient.query(migration.replaceAll("sakura_v2",schema));
  client=new Proxy(rawClient,{get(target,key){if(key==="query")return (sql:string,...args:unknown[])=>Reflect.apply(target.query,target,[sql.replaceAll("sakura_v2",schema),...args]);const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 });
 after(async()=>{if(rawClient){await rawClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);rawClient.release();}await pool.end();});
 it("backfills only sources actually retained before the additive migration",async()=>{
  const rows=(await rawClient.query(`SELECT event_id,context,context_id FROM "${schema}"."ListeningEventLedger" WHERE account_id=$1 ORDER BY event_id`,[account])).rows;
  assert.equal(rows.find(row=>row.event_id===event).context,"search");
  assert.equal(rows.find(row=>row.event_id===unknown).context,null);
 });
 it("keeps new origin after display compaction and rejects another account's update",async()=>{
  await retainListeningOrigin(client,other,compacted,"home",null);
  assert.equal((await rawClient.query(`SELECT context FROM "${schema}"."ListeningEventLedger" WHERE account_id=$1 AND event_id=$2`,[account,compacted])).rows[0].context,null);
  await retainListeningOrigin(client,account,compacted,"playlist","saved-playlist");
  await rawClient.query(`INSERT INTO "${schema}"."ListeningEvent"(account_id,event_id,context,context_id) VALUES($1,$2,'playlist','saved-playlist')`,[account,compacted]);
  await rawClient.query(`DELETE FROM "${schema}"."ListeningEvent" WHERE account_id=$1 AND event_id=$2`,[account,compacted]);
  await retainListeningOrigin(client,account,compacted,"home",null);
  const row=(await rawClient.query(`SELECT context,context_id FROM "${schema}"."ListeningEventLedger" WHERE account_id=$1 AND event_id=$2`,[account,compacted])).rows[0];
  assert.deepEqual(row,{context:"playlist",context_id:"saved-playlist"});
 });
 it("erases the origin together with its listening event and measurements",async()=>{
  await rawClient.query(`INSERT INTO "${schema}"."ListeningChunk"(account_id,event_id,audible_ms) VALUES($1,$2,60000)`,[account,compacted]);
  await rawClient.query(`DELETE FROM "${schema}"."ListeningEventLedger" WHERE account_id=$1 AND event_id=$2`,[account,compacted]);
  assert.equal((await rawClient.query(`SELECT COUNT(*)::integer n FROM "${schema}"."ListeningChunk" WHERE account_id=$1 AND event_id=$2`,[account,compacted])).rows[0].n,0);
 });
});
