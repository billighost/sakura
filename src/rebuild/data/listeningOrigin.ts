import type {PoolClient} from "pg";

const schemas=new WeakMap<PoolClient,{ready:boolean;checkedAt:number}>();

/** The additive migration may land just after a server deploy. Keep recording
 * audible listening on older schemas; their display row still retains origin.
 * Read pg_attribute through the table's regclass so isolated schemas work too. */
export async function retainListeningOrigin(client:PoolClient,accountId:string,eventId:string,context:string,contextId:string|null){
 let schema=schemas.get(client);
 if(!schema||(!schema.ready&&Date.now()-schema.checkedAt>=60000)){
  const ready=Boolean((await client.query(`SELECT COUNT(*)=2 AS ready FROM pg_attribute
    WHERE attrelid='sakura_v2."ListeningEventLedger"'::regclass AND attname IN ('context','context_id') AND NOT attisdropped`)).rows[0]?.ready);
  schema={ready,checkedAt:Date.now()};schemas.set(client,schema);
 }
 if(!schema.ready)return;
 // The original context is immutable even when delayed/retried chunks arrive
 // after the history display row was compacted. No origin is guessed for old
 // imports, and erasing the ledger cascades to its per-play evidence normally.
 await client.query(`UPDATE sakura_v2."ListeningEventLedger" SET context=$3,context_id=$4
   WHERE account_id=$1::uuid AND event_id=$2::uuid AND context IS NULL`,[accountId,eventId,context,contextId]);
}
