/** Publish only already-verified local files through the existing configured CDN. */
import "dotenv/config";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {getRebuildServices} from "../src/rebuild/server/runtime";
import {AudioPromotionError} from "../src/rebuild/server/promotion";
import {getRebuildPool} from "../src/rebuild/data/db";
import {PostgresRecordingRepository,type ReadonlySql} from "../src/rebuild/server/repository";
async function main(){
 if(!process.argv.includes("--live"))throw new Error("Pass --live to publish the four previously verified audio files using the existing CDN account.");
 const pool=getRebuildPool(),services=getRebuildServices(),publisher=services.publisher;if(!publisher)throw new Error("Existing Cloudinary audio configuration is missing");
 const query:ReadonlySql=async<Row>(statement:string,parameters:readonly unknown[])=>(await pool.query(statement,[...parameters])).rows as Row[];
 const repository=new PostgresRecordingRepository(query),report:{checkedAt:string;quota:unknown;results:Record<string,unknown>[]}={checkedAt:new Date().toISOString(),quota:await publisher.usage(),results:[]};
 try{for(const target of [{name:"finesse-original",provider:"deezer" as const,id:"136336124",file:"finesse-original"},{name:"finesse-cardi-b-remix",provider:"deezer" as const,id:"444333332",file:"finesse-cardi-b-remix"},{name:"inertia-sawano-rei",provider:"deezer" as const,id:"3284976751",file:"inertia-sawano-rei"},{name:"ye-burna-boy",provider:"spotify" as const,id:"2lEl1iNGpz9r2B7R5BqXSD",file:"ye"}]){
  const started=Date.now();let phase="find-recording";try{
   const recording=await repository.findByReference({provider:target.provider,id:target.id});if(!recording)throw new Error("Previously checked canonical recording is missing");
   phase="read-verified-local-file";
   const bytes=await readFile(`.local/rebuild-audio-check/${target.file}.mp3`),sha256=createHash("sha256").update(bytes).digest("hex");
   phase="find-verified-source";const source=(await repository.listAudio(recording.recordingId,randomUUID())).find(asset=>asset.locator.kind==="telegram-worker"&&asset.sha256===sha256&&asset.sizeBytes===bytes.length);if(!source)throw new Error("Local file no longer matches the full verified worker asset");
   phase="publish-and-check-cdn";
   const asset=await publisher.publish(recording,source,bytes,AbortSignal.timeout(90000));await services.ingestor.persistAudio(recording,asset);
   const result={target:target.name,status:"verified-cdn",recordingId:recording.recordingId,assetId:asset.assetId,sourceAssetId:source.assetId,bytes:asset.sizeBytes,sha256:asset.sha256,elapsedMs:Date.now()-started};report.results.push(result);console.log(JSON.stringify(result));
  }catch(error){const result={target:target.name,status:"failed",phase,errorCategory:error instanceof Error?error.name:"unknown",...(error instanceof AudioPromotionError?{reason:error.reason}:{}),elapsedMs:Date.now()-started};report.results.push(result);console.log(JSON.stringify(result));}
  await writeFile("docs/rebuild/LIVE-CDN-CHECK.json",JSON.stringify(report,null,2)+"\n");
 }}finally{await pool.end();}
 if(report.results.some(item=>item.status!=="verified-cdn"))process.exitCode=1;
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",errorCategory:error instanceof Error?error.name:"unknown"}));process.exitCode=1;});
