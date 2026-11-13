import { inTransaction } from "./db";
import { getSettingsSnapshot } from "./settings";
import { getTaste } from "./taste";
import { getListeningEvidence } from "./listeningEvidence";

/** Device scoring refreshes this smaller projection when reconnecting/focusing.
 * A server deletion cutoff lets another device discard stale pending history. */
export async function getTasteState(accountId:string,options:{sync?:boolean}={}) {
  return inTransaction(async client=>{
    // A cutoff and its evidence belong to one state. Reading either side of a
    // concurrent clear would temporarily reintroduce erased local preferences.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const settings=await getSettingsSnapshot(accountId,client);
    const taste=options.sync?{feedback:(await client.query(`SELECT target,target_id AS "targetId",kind,expires_at AS "expiresAt",
      to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
      (expires_at IS NULL OR expires_at>now()) AS active FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid ORDER BY updated_at DESC,target_id`,[accountId])).rows}:await getTaste(accountId,client);
    const tasteEvidence=await getListeningEvidence(accountId,settings.timeZone,client,{limit:options.sync?500:undefined});
    const deletions=await client.query(`SELECT period_start AS "periodStart",cleared_at AS "clearedAt"
      FROM sakura_v2."HistoryDeletion" WHERE account_id=$1::uuid ORDER BY cleared_at DESC,id DESC`,[accountId]);
    const historyDeletion=deletions.rows[0]||null;
    return {...taste,tasteEvidence,initialTasteProfile:settings.initialTasteProfile,historyClearedAt:historyDeletion?.clearedAt||null,historyDeletion,historyDeletions:deletions.rows,generatedAt:new Date().toISOString()};
  });
}
