import { Pool, type PoolClient, type QueryConfig } from "pg";
import { measureApiStage } from "../server/performance";

type AccountRow = { id:string;username:string;email:string;avatarUrl:string|null };
const runtime = globalThis as unknown as { sakuraV2ProductPool?: Pool;sakuraV2AccountReads?:Map<string,Promise<AccountRow|null>> };
const accountReads = runtime.sakuraV2AccountReads ||= new Map<string,Promise<AccountRow|null>>();

function connectionFailure(error:unknown):boolean {
  if(!(error instanceof Error))return false;
  const code=(error as {code?:string}).code||"";
  return code.startsWith("08")||["ECONNRESET","EPIPE","ETIMEDOUT","ECONNREFUSED","ENETUNREACH","EHOSTUNREACH","EAI_AGAIN","57P01","57P02","57P03"].includes(code)
    ||/Query read timeout|Connection terminated|Client was closed|not queryable|timeout exceeded when trying to connect/i.test(error.message);
}

/** A single server-only pool shared by the replacement product and audio services. */
export function getRebuildPool(): Pool {
  if (runtime.sakuraV2ProductPool) return runtime.sakuraV2ProductPool;
  const connectionString = process.env.SAKURA_REBUILD_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Database configuration is missing");
  const protocol = new URL(connectionString).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error("Invalid database configuration");
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000,keepAlive:true,keepAliveInitialDelayMillis:10000,
    connectionTimeoutMillis: 8000, statement_timeout: 15000, query_timeout: 20000 });
  pool.on("error", () => console.error("[Sakura v2] Database connection failed"));
  runtime.sakuraV2ProductPool = pool;
  return pool;
}

/** Only this fixed account SELECT is retried. Mutations and transactions never
 * enter this path; a missing account or a SQL error is returned immediately.
 * pg-pool destroys failed connections before rejecting pool.query, so a retry
 * can acquire another socket without disrupting other requests' transactions. */
export async function readAccountById(id:string):Promise<AccountRow|null> {
  const pending=accountReads.get(id);if(pending)return pending;
  const operation=(async()=>{
    for(let attempt=0;attempt<2;attempt++){
      try{
        const query:QueryConfig&{query_timeout:number}={
          text:'SELECT id, username, email, "avatarUrl" FROM public."User" WHERE id = $1::uuid',
          values:[id],query_timeout:6000,
        };
        const result=await getRebuildPool().query<AccountRow>(query);
        return result.rows[0]||null;
      }catch(error){
        if(attempt===1||!connectionFailure(error))throw error;
        await new Promise<void>(resolve=>setTimeout(resolve,150));
      }
    }
    throw new Error("Account lookup failed");
  })();
  accountReads.set(id,operation);
  try{return await operation;}finally{if(accountReads.get(id)===operation)accountReads.delete(id);}
}

export async function inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await measureApiStage("db_acquire",()=>getRebuildPool().connect());
  let releaseError:Error|undefined;
  try {
    await measureApiStage("db_control",()=>client.query("BEGIN"));
    const result = await operation(client);
    await measureApiStage("db_control",()=>client.query("COMMIT"));
    return result;
  } catch (error) {
    // A timed-out socket must leave the pool. Returning it as healthy makes the
    // next unrelated request inherit the same stalled connection.
    const failure=error instanceof Error?error:new Error("Transaction failed");
    if(connectionFailure(error))releaseError=failure;
    else await measureApiStage("db_control",()=>client.query("ROLLBACK")).catch(rollbackError=>{releaseError=rollbackError instanceof Error?rollbackError:failure;});
    throw error;
  } finally { client.release(releaseError); }
}

/** Retry only operations whose database contract is idempotent even when the
 * first COMMIT may have succeeded before its connection disappeared. */
export async function inIdempotentTransaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{
 for(let attempt=0;attempt<2;attempt++){
  try{return await inTransaction(operation);}
  catch(error){
   if(attempt===1||!connectionFailure(error))throw error;
   await new Promise<void>(resolve=>setTimeout(resolve,150));
  }
 }
 throw new Error("Idempotent transaction failed");
}
