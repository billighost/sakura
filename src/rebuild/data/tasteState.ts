import { inTransaction } from "./db";
import { getSettings } from "./settings";
import { getTaste } from "./taste";
import { getListeningEvidence } from "./listeningEvidence";

/** Device scoring refreshes this smaller projection when reconnecting/focusing.
 * A server deletion cutoff lets another device discard stale pending history. */
export async function getTasteState(accountId:string) {
  return inTransaction(async client=>{
    // A cutoff and its evidence belong to one state. Reading either side of a
    // concurrent clear would temporarily reintroduce erased local preferences.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const settings=await getSettings(accountId,client);
    const taste=await getTaste(accountId,client);
    const tasteEvidence=await getListeningEvidence(accountId,settings.timeZone,client);
    const deletions=await client.query(`SELECT period_start AS "periodStart",cleared_at AS "clearedAt"
      FROM sakura_v2."HistoryDeletion" WHERE account_id=$1::uuid ORDER BY cleared_at DESC,id DESC`,[accountId]);
    const historyDeletion=deletions.rows[0]||null;
    return {...taste,tasteEvidence,initialTasteProfile:settings.initialTasteProfile,historyClearedAt:historyDeletion?.clearedAt||null,historyDeletion,historyDeletions:deletions.rows,generatedAt:new Date().toISOString()};
  });
}
