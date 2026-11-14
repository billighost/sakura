import type {PoolClient} from "pg";

/** Deliberate interest changes make the next feed check the artist's catalog.
 * This derived marker never advances the listener's preference revisions. */
export async function invalidateFeedCatalog(accountId:string,sql:Pick<PoolClient,"query">){
  await sql.query(`UPDATE sakura_v2."AccountPreferences" SET preferences=preferences-'feedCatalogRefresh' WHERE account_id=$1::uuid AND preferences ? 'feedCatalogRefresh'`,[accountId]);
}
