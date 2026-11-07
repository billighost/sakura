/** Sanitized HTTP source timing; never opens a second Telegram session. */
import "dotenv/config";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3003";
if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("Use an isolated local QA origin.");
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const targets=[{name:"finesse-remix",provider:"deezer",id:"444333332"},{name:"inertia",provider:"deezer",id:"3284976751"}];
const report={checkedAt:new Date().toISOString(),origin:base,method:"Existing synthetic account; real signed-worker and authenticated gateway HTTP timing, metadata-only public evidence",results:[]};
async function probe(label,url,options={},limitMs=30000){
 const started=performance.now(),result={label,limitMs,bytes:0};
 try{
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(limitMs)});result.headersMs=Math.round(performance.now()-started);result.status=response.status;result.mime=response.headers.get("Content-Type");result.contentRange=response.headers.get("Content-Range");result.contentLength=response.headers.get("Content-Length");
  const reader=response.body?.getReader(),hash=createHash("sha256");if(reader){while(true){const {value,done}=await reader.read();if(done)break;if(result.firstByteMs===undefined)result.firstByteMs=Math.round(performance.now()-started);result.bytes+=value.length;hash.update(value);}}
  result.totalMs=Math.round(performance.now()-started);result.sha256=result.bytes?hash.digest("hex"):undefined;result.complete=true;
 }catch(error){result.totalMs=Math.round(performance.now()-started);result.errorCategory=error.name;result.complete=false;}
 console.log(JSON.stringify(result));return result;
}
for(const target of targets){
 const response=await fetch(base+"/api/v2/recordings/resolve",{method:"POST",headers:{Cookie:fixture.cookie,Origin:base,"Content-Type":"application/json"},body:JSON.stringify({reference:{provider:target.provider,id:target.id}}),signal:AbortSignal.timeout(20000)});
 const value=await response.json();if(value.status!=="resolved")throw new Error("Expected previously verified ready source");
 const direct=value.playback.url,gateway=base+value.playback.fallbackUrl;
 const result={target:target.name,recordingId:value.recording.recordingId,expectedBytes:value.playback.sizeBytes,samples:[]};report.results.push(result);
 result.samples.push(await probe("signed-head",direct,{method:"HEAD"}));
 result.samples.push(await probe("signed-first4096",direct,{headers:{Range:"bytes=0-4095"}}));
 result.samples.push(await probe("signed-full",direct));
 result.samples.push(await probe("gateway-first4096",gateway,{headers:{Cookie:fixture.cookie,Range:"bytes=0-4095"}}));
 await fs.writeFile("docs/rebuild/LIVE-SOURCE-TIMING.json",JSON.stringify(report,null,2)+"\n");
}
console.log(JSON.stringify({checked:report.results.length,report:"docs/rebuild/LIVE-SOURCE-TIMING.json"}));
