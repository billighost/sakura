/** Local user audio + the real authenticated lyric GET handler with fixture auth.
 * Model weights are downloaded, audio is never uploaded. Emissions are saved in
 * ignored .local to repeat alignment/gates without repeated model or audio IO.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseFile } from "music-metadata";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedLyrics } from "../src/rebuild/lyrics/service";
import * as parse from "../src/rebuild/lyrics/parse";
import * as request from "../src/rebuild/lyrics/request";
import * as versions from "../src/rebuild/lyrics/versions";
import { alignWhisperLyrics, WHISPER_SYNC_ENGINE, LyricAlignmentError, type RecognizedWord } from "../src/rebuild/lyrics/whisperSync";

async function main(){
  const file=process.argv[2]||"bad-guy",audioPath=`C:/Users/bb201/Downloads/${file}.mp3`;
  const metadata=await parseFile(audioPath);assert.ok(metadata.common.title&&metadata.common.artist&&metadata.format.duration);
  const query=new URLSearchParams({title:metadata.common.title,artist:metadata.common.artist,duration:String(metadata.format.duration)});
  if(metadata.common.album)query.set("album",metadata.common.album);
  const exports:{GET?:(request:NextRequest)=>Promise<NextResponse>}={};
  const dependencies:Record<string,unknown>={"next/server":{NextRequest,NextResponse},"@/rebuild/auth":{requireRebuildAccount:async()=>({id:"90000000-0000-4000-8000-000000000096"})},"@/rebuild/lyrics/parse":parse,"@/rebuild/lyrics/request":request,"@/rebuild/lyrics/service":{resolveVerifiedLyrics},"@/rebuild/lyrics/versions":versions};
  const source=await readFile("src/app/api/v2/lyrics/route.ts","utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
  const response=await exports.GET!(new NextRequest(`http://127.0.0.1/api/v2/lyrics?${query}`));
  const body=await response.json();assert.equal(response.status,200);assert.ok(Array.isArray(body.lines)&&body.lines.length);
  const providerLines=body.lines as parse.TimedLyric[];
  const plain=providerLines.map(line=>({text:line.text,start:0}));
  await mkdir(".local",{recursive:true});
  const prefix=`.local/autosync-${file}`;
  await writeFile(prefix+"-source.json",JSON.stringify(providerLines));
  if(process.argv.includes("--lyrics-only")){console.log(JSON.stringify({file,provider:body.provider,lineCount:providerLines.length}));return;}
  const unsupported=[...new Set(plain.map(line=>line.text).join(" ").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’‘]/g,"'").toUpperCase().replace(/[A-Z'\p{P}\p{Z}\s]/gu,""))];
  if(unsupported.length)console.log("Nonalphabet lyric characters:",unsupported.map(char=>char.codePointAt(0)));
  const inference=JSON.parse(await readFile(prefix+"-native.json","utf8")) as {words:RecognizedWord[];elapsedMs:number;model:string;durationSeconds:number;localFileSha256:string};
  assert.equal(inference.localFileSha256,createHash("sha256").update(await readFile(audioPath)).digest("hex"),"The benchmark audio changed after inference");
  assert.ok(Math.abs(inference.durationSeconds-metadata.format.duration)<.1,"Inference must use the full local recording");
  const unchangedSource=JSON.stringify(plain);
  let result,error,alignmentFailure:LyricAlignmentError|undefined;
  const alignStart=performance.now();
  try{result=alignWhisperLyrics(plain,inference.words,inference.durationSeconds);}catch(failure){error=failure instanceof Error?failure.message:String(failure);if(failure instanceof LyricAlignmentError)alignmentFailure=failure;}
  const alignMs=Math.round(performance.now()-alignStart);
  const reference=providerLines.filter(line=>line.text.trim());
  const deviations=result?.lines.filter(line=>line.text.trim()).map((line,index)=>Math.abs(line.start-reference[index].start));
  const report={at:new Date().toISOString(),mode:"Real user Downloads audio; real GET handler and live lyric providers; fixture account auth; native Whisper CPU inference (hosted ZeroGPU speed not measured)",file,title:metadata.common.title,artist:metadata.common.artist,durationSeconds:inference.durationSeconds,provider:body.provider,providerTiming:body.timing,engine:WHISPER_SYNC_ENGINE,model:inference.model,inferenceMs:inference.elapsedMs,alignMs,accepted:Boolean(result),error,confidence:result?.confidence,recognizedWordCoverage:result?.recognizedWordCoverage??alignmentFailure?.coverage,uncertainLines:alignmentFailure?.uncertainLines,lineCount:result?.lines.length,sourceUnchanged:JSON.stringify(plain)===unchangedSource&&(!result||result.lines.every((line,i)=>line.text===plain[i].text)),medianLineStartDeviationSeconds:deviations?.sort((a,b)=>a-b)[Math.floor(deviations.length/2)],maximumLineStartDeviationSeconds:deviations?Math.max(...deviations):null};
  await writeFile(prefix+"-report.json",JSON.stringify(report,null,2));
  if(result)await writeFile(prefix+"-result.json",JSON.stringify({plain,result,reference:providerLines},null,2));
  console.log(JSON.stringify(report,null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
