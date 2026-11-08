import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeMetadataText } from "../src/rebuild/core/identity";
import { parseTrustedRecordingMetadata } from "../src/rebuild/server/input";
import { readMetadataJson, DeezerCatalogProvider, SpotifyCatalogProvider } from "../src/rebuild/server/providers";
import { WorkerAudioDiscovery } from "../src/rebuild/server/sources";
import { SourceAudioTransport } from "../src/rebuild/server/gateway";
import { readTinyAudio } from "./rebuild-download-start";
import type { CatalogRecording } from "../src/rebuild/server/contracts";
import type { CanonicalRecording } from "../src/rebuild/core/types";

const CASES=[
 {key:"east-west",requested:"文明開化 (East West)",queries:["文明開化 Tomonari Sora","文明開化 友成空","East West Tomonari Sora"],titles:["文明開化","East West","文明開化 (East West)"],id:"3609044902"},
 {key:"hoko",requested:"咆哮 (HOKO)",queries:["咆哮 Tomonari Sora"],titles:["咆哮 - HOKO"],id:"1fPkUiufkRpzdYcBKXUP3s"},
 {key:"niramekko",requested:"睨めっ娘",queries:["睨めっ娘 Tomonari Sora"],titles:["睨めっ娘"],id:"3dPrNa7YVisbRaBBr3xdBj"},
 {key:"onino-utage",requested:"鬼ノ宴",queries:["鬼ノ宴 Tomonari Sora"],titles:["鬼ノ宴"],id:"096KHkONhQm4MQNH35mU22"},
];
const option=(name:string,fallback:string)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1]||fallback;};
type Row={target:typeof CASES[number];status:string;queries:{query:string;resultCount:number;matches:CatalogRecording[]}[];selected?:CatalogRecording;canonical?:CanonicalRecording;workerObservations:Record<string,unknown>[];source?:Awaited<ReturnType<WorkerAudioDiscovery["discover"]>>;audio?:{bytes:number;sizeBytes:number;messageId?:string;chatScope?:string;documentId?:string};reason?:unknown;elapsedMs?:number};
async function main(){
 if(!process.argv.includes("--live"))throw new Error("Pass --live for real search-first metadata regression checks.");
 if(process.argv.includes("--full"))throw new Error("Full transfers are disabled for this low-data regression.");
 const metadataOnly=process.argv.includes("--metadata-only"),base=new URL(option("--base","http://127.0.0.1:3015")),output=resolve(".local/tomonari-review");await mkdir(output,{recursive:true});
 const session=JSON.parse(await readFile(option("--session-file",".local/download-api-session.json"),"utf8")) as {cookie:string};const api=async(path:string,init:RequestInit={})=>{const url=new URL(path,base);if(url.origin!==base.origin||init.method==="POST"&&url.pathname!=="/api/v2/recordings/index")throw new Error("invalid-api-operation");const response=await fetch(url,{...init,headers:{Cookie:session.cookie,Origin:base.origin,...init.headers},signal:AbortSignal.timeout(30000)});const body=await readMetadataJson(response) as Record<string,unknown>;if(!response.ok)throw new Error(`api-status-${response.status}`);return body;};
 const worker={url:process.env.TELEGRAM_WORKER_URL!,secret:process.env.WORKER_SECRET!,primaryBot:process.env.TELEGRAM_BOT_USERNAME||"musicshuntersbot",fallbackBots:(process.env.TELEGRAM_FALLBACK_BOTS||"").split(",").map(x=>x.trim()).filter(Boolean)};
 if(!worker.url||!worker.secret)throw new Error("worker-configuration-missing");
 const providers=[new DeezerCatalogProvider(),...(process.env.SPOTIFY_CLIENT_ID&&process.env.SPOTIFY_CLIENT_SECRET?[new SpotifyCatalogProvider(process.env.SPOTIFY_CLIENT_ID,process.env.SPOTIFY_CLIENT_SECRET)]:[])];
 const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{...worker,chatScope:worker.primaryBot},headerTimeoutMs:15000}),budgetPath=resolve(output,"budget.json");let reservedBytes=0,receivedBytes=0;try{const previous=JSON.parse(await readFile(budgetPath,"utf8")) as {reservedBytes:number;receivedBytes:number};reservedBytes=previous.reservedBytes||0;receivedBytes=previous.receivedBytes||0;}catch{}
 const results:Row[]=[];const persist=async()=>{const report={checkedAt:new Date().toISOString(),mode:metadataOnly?"search-api-metadata-only":"search-api-startup-only",base:base.origin,targets:4,maxAudioBytes:4*4096,audioReservedBytes:reservedBytes,audioReceivedBytes:receivedBytes,method:"Actual Sakura search API selects exact user-named song and artist; metadata-only indexing hydrates canonical references and credits; source discovery captures raw rejection tuples. Optional startup is one exactly4KiB range with immediate body cancellation. No resolve jobs, promotions or full audio transfers.",results};await writeFile(resolve(output,metadataOnly?"metadata-report.json":"startup-report.json"),JSON.stringify(report,null,2)+"\n");await writeFile("docs/rebuild/TOMONARI-"+(metadataOnly?"METADATA":"STARTUP")+"-ACCEPTANCE.json",JSON.stringify(report,null,2)+"\n");};
 for(const target of CASES){const start=Date.now(),row:Row={target,status:"pending",queries:[],workerObservations:[]};results.push(row);try{
  for(const query of target.queries){const body=await api("/api/v2/search?kind=tracks&q="+encodeURIComponent(query)),tracks=(Array.isArray(body.tracks)?body.tracks:[]) as CatalogRecording[],matches=tracks.filter(track=>track.metadata&&target.titles.some(title=>normalizeMetadataText(track.metadata.title)===normalizeMetadataText(title))&&["Tomonari Sora","友成空"].some(artist=>normalizeMetadataText(track.metadata.artists?.[0]||"")===normalizeMetadataText(artist)));row.queries.push({query,resultCount:tracks.length,matches});row.selected=matches.find(track=>track.reference.id===target.id)||matches[0];if(row.selected)break;}
  if(!row.selected){row.status="search-miss";row.reason="No exact requested title/artist appeared in Sakura search results.";continue;}
  const indexed=await api("/api/v2/recordings/index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:row.selected.reference,expected:row.selected.metadata})});row.canonical=indexed.recording as CanonicalRecording;if(!row.canonical?.recordingId)throw new Error("index-response-invalid");
  const observe:typeof fetch=async(input,init)=>{const response=await fetch(input,init);if(response.headers.get("Content-Type")?.includes("application/json")){try{const payload=await readMetadataJson(response.clone());row.workerObservations.push({path:new URL(String(input)).pathname,status:response.status,payload});}catch{/* Original source adapter classifies invalid metadata. */}}return response;};
  row.source=await new WorkerAudioDiscovery(worker,observe,providers).discover({...row.canonical,metadata:parseTrustedRecordingMetadata(row.canonical.metadata)},AbortSignal.timeout(65000));
  if(row.source.status!=="ready"){row.status=row.source.status;row.reason=row.source.status==="review"?row.source.candidates:row.source.reason;continue;}
  if(metadataOnly){row.status="metadata-ready";continue;}
  if(reservedBytes+4096>4*4096){row.status="budget-exhausted";continue;}
  reservedBytes+=4096;await writeFile(budgetPath,JSON.stringify({reservedBytes,receivedBytes},null,2)+"\n");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await transport.open(row.source.asset,"bytes=0-4095",controller.signal),bytes=await readTinyAudio(response,row.source.asset.sizeBytes,row.source.asset.mimeType);receivedBytes+=bytes;const locator=row.source.asset.locator;row.audio={bytes,sizeBytes:row.source.asset.sizeBytes,...(locator.kind==="telegram-worker"?{messageId:locator.messageId,chatScope:locator.chatScope,documentId:locator.documentId}:{})};row.status="started";}finally{controller.abort();clearTimeout(timer);await writeFile(budgetPath,JSON.stringify({reservedBytes,receivedBytes},null,2)+"\n");}
 }catch(error){row.status="failed";row.reason=error instanceof Error?error.name:"unknown";}finally{row.elapsedMs=Date.now()-start;await persist();console.log(JSON.stringify({target:target.key,status:row.status,selected:row.selected?.reference,metadata:row.canonical?.metadata,reason:row.reason,bytes:row.audio?.bytes,elapsedMs:row.elapsedMs}));}}
 if(results.some(row=>row.status!==(metadataOnly?"metadata-ready":"started")))process.exitCode=1;
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",error:error instanceof Error?error.name:"unknown"}));process.exitCode=1;});
