import "dotenv/config";
import { seedCandidateCatalog } from "../src/rebuild/recommendations/catalog";
import { getRebuildPool } from "../src/rebuild/data/db";

async function main(){try {
  const result=await seedCandidateCatalog({signal:AbortSignal.timeout(180000)});
  const count=(await getRebuildPool().query(`SELECT COUNT(*)::integer AS recordings,COUNT(DISTINCT metadata->'artistReference'->>'id')::integer AS artists
    FROM sakura_v2."Recording" WHERE state='verified'`)).rows[0];
  console.log(JSON.stringify({...result,verifiedCatalog:count,audioDownloadsCreated:0,oldDataImported:false}));
  if(count.recordings<40)process.exitCode=1;
} catch(error) {
  console.error(JSON.stringify({status:"catalog-seed-failed",code:error instanceof Error?error.name:"UnknownError"}));process.exitCode=1;
} finally {await getRebuildPool().end();}}
void main();
