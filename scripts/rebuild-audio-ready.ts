import "dotenv/config";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {getRebuildServices} from "../src/rebuild/server/runtime";
import {getRebuildPool} from "../src/rebuild/data/db";

async function main(){
 const accountId=randomUUID(),services=getRebuildServices(),results=[];
 try{
  for(const reference of [{provider:"deezer" as const,id:"136336124"},{provider:"spotify" as const,id:"2lEl1iNGpz9r2B7R5BqXSD"},{provider:"deezer" as const,id:"444333332"},{provider:"deezer" as const,id:"3284976751"}]){
   const timings=[];let recordingId:string|undefined;
   for(let at=0;at<2;at++){
    const start=performance.now(),result=await services.resolver.resolve({reference},accountId,AbortSignal.timeout(15000));
    if(result.status!=="resolved"){console.log(JSON.stringify({reference,status:result.status,...(result.status==="unavailable"?{reason:result.reason}:{}),...(result.status==="review"?{reason:result.reason,candidates:result.candidates}:{} )}));throw new Error("Verified asset is not ready");}
    timings.push(Math.round(performance.now()-start));recordingId=result.recording.recordingId;
   }
   results.push({reference,recordingId,firstResolveMs:timings[0],warmResolveMs:timings[1],fullAudioReady:true});
  }
  const report={checkedAt:new Date().toISOString(),measurement:"Server-side ready resolver plus initial signing and warm signing cache. Excludes browser media decode, device/network first byte and cold Next compilation.",results};
  await writeFile("docs/rebuild/LIVE-READY-CHECK.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
 }finally{await getRebuildPool().end();}
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",errorCategory:error instanceof Error?error.name:"unknown"}));process.exitCode=1;});
