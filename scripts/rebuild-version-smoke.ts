import "dotenv/config";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {DeezerCatalogProvider} from "../src/rebuild/server/providers";
import {WorkerAudioDiscovery} from "../src/rebuild/server/sources";
import {SourceAudioTransport} from "../src/rebuild/server/gateway";
import {getRebuildServices} from "../src/rebuild/server/runtime";
import {getRebuildPool} from "../src/rebuild/data/db";
import {assessAudioCandidate} from "../src/rebuild/core/matching";

async function main(){
 if(!process.argv.includes("--live"))throw new Error("Pass --live to check the existing single-owner audio worker.");
 const worker={url:process.env.TELEGRAM_WORKER_URL!,secret:process.env.WORKER_SECRET!,primaryBot:process.env.TELEGRAM_BOT_USERNAME||"musicshuntersbot"};
 if(!worker.url||!worker.secret)throw new Error("Audio worker configuration is missing");
 const discovery=new WorkerAudioDiscovery(worker),transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{...worker,chatScope:worker.primaryBot},headerTimeoutMs:15000});
 const provider=new DeezerCatalogProvider(),results:Record<string,unknown>[]=[];
 try{
  for(const target of [{name:"finesse-original",id:"136336124"},{name:"finesse-cardi-b-remix",id:"444333332"},{name:"inertia-sawano-rei",id:"3284976751"}]){
   const started=Date.now();
   try{
    const catalog=await provider.getExact({provider:"deezer",id:target.id});if(!catalog)throw new Error("Exact song was removed");
    const recording=await getRebuildServices().ingestor.ensureCatalog(catalog);
    const source=await discovery.discover(recording,AbortSignal.timeout(65000));
    if(source.status!=="ready"){const result={target:target.name,recordingId:recording.recordingId,status:source.status,...(source.status==="review"?{candidates:source.candidates}:{reason:source.reason})};results.push(result);console.log(JSON.stringify(result));continue;}
    const response=await transport.open(source.asset,null,AbortSignal.timeout(90000)),file=Buffer.from(await response.arrayBuffer());
    if(response.status!==200||file.length!==source.asset.sizeBytes)throw new Error("Full file transfer is incomplete");
    await mkdir(".local/rebuild-audio-check",{recursive:true});const path=`.local/rebuild-audio-check/${target.name}.mp3`;await writeFile(path,file);
    const probe=spawnSync("ffprobe",["-v","error","-show_entries","format=duration:format_tags=title,artist","-of","json",path],{encoding:"utf8",windowsHide:true});
    if(probe.status!==0)throw new Error("Audio decoder rejected the full source file");
    const format=JSON.parse(probe.stdout).format as {duration:string;tags?:{title?:string;artist?:string}};
    const decoded={title:format.tags?.title||"",artists:[format.tags?.artist||""],durationMs:Math.round(Number(format.duration)*1000)};
    const check=assessAudioCandidate(recording,{candidateId:"decoded",metadata:decoded,audioKind:"full"});
    if(!check.acceptable){const result={target:target.name,status:"decoded-review",decoded,reasons:check.reasons};results.push(result);console.log(JSON.stringify(result));continue;}
    source.asset.sha256=createHash("sha256").update(file).digest("hex");await getRebuildServices().ingestor.persistAudio(recording,source.asset);
    const result={target:target.name,recordingId:recording.recordingId,reference:catalog.reference,status:"verified-full-file",metadata:catalog.metadata,artistCredits:catalog.artistCredits,source:source.asset.candidate.metadata,bytes:file.length,sha256:source.asset.sha256,decoded,elapsedMs:Date.now()-started};
    results.push(result);console.log(JSON.stringify(result));
   }catch(error){const result={target:target.name,status:"failed",errorCategory:error instanceof Error?error.name:"unknown",elapsedMs:Date.now()-started};results.push(result);console.log(JSON.stringify(result));}
  }
  await writeFile("docs/rebuild/LIVE-VERSION-CHECK.json",JSON.stringify({checkedAt:new Date().toISOString(),verification:"Separate exact catalogue IDs, strict source/decoded artist+version checks and full-file integrity. No personal account rows mutated.",results},null,2)+"\n");
  if(results.some(result=>result.status!=="verified-full-file"))process.exitCode=1;
 }finally{await getRebuildPool().end();}
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",errorCategory:error instanceof Error?error.name:"unknown"}));process.exitCode=1;});
