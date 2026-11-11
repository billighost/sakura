/** Read-only real catalogue/provider evidence. No audio traffic or publication. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { fetchVerifiedLyrics } from "../src/rebuild/lyrics/fallbacks";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import * as parse from "../src/rebuild/lyrics/parse";
import * as request from "../src/rebuild/lyrics/request";
import * as versions from "../src/rebuild/lyrics/versions";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";
import { lyricReadingLanguage } from "../src/rebuild/lyrics/language";

async function main(){
const cases=[
  {q:'Here Comes The Sun The Beatles',artist:'The Beatles'},
  {q:'Heroes David Bowie',artist:'David Bowie'},
  {q:'Dont Stop Me Now Queen',artist:'Queen'},
  {q:'Tian Mi Mi Teresa Teng',artist:'Teresa Teng'},
  {q:'We Dont Talk Anymore Charlie Puth',artist:'Charlie Puth'},
  {q:'See You Again Wiz Khalifa',artist:'Wiz Khalifa'},
  {q:'夜に駆ける YOASOBI',artist:'YOASOBI'},
  {q:'봄날 BTS',artist:'BTS'},
];
const upstreams:{host:string;path:string;status:number}[]=[];
const loader=(identity:import("../src/rebuild/lyrics/provider").LyricIdentity)=>fetchVerifiedLyrics(identity,{fetch:async(url,init)=>{
  const response=await fetch(url,init),u=new URL(String(url));
  upstreams.push({host:u.hostname,path:u.pathname,status:response.status});return response;
}});
// The installed route executes unchanged. Only auth is isolated from real accounts.
const dependencies:Record<string,unknown>={"next/server":{NextRequest,NextResponse},"@/rebuild/auth":{requireRebuildAccount:async()=>({id:"fixture"})},"@/rebuild/lyrics/parse":parse,"@/rebuild/lyrics/request":request,"@/rebuild/lyrics/versions":versions,"@/rebuild/lyrics/service":{resolveVerifiedLyrics:createLyricsResolver({load:loader})}};
const exported:{GET?:(input:NextRequest)=>Promise<NextResponse>}={};
vm.runInNewContext(ts.transpileModule(await readFile("src/app/api/v2/lyrics/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,console,require:(name:string)=>dependencies[name]});
const report:{checkedAt:string;scope:string;cases:unknown[];upstreams:unknown[]}={checkedAt:new Date().toISOString(),scope:"Actual GET handler, synthetic auth, unmodified live catalogue/providers, no audio or writes",cases:[],upstreams};
await mkdir(".local",{recursive:true});
for(const item of cases){
  try{
    const response=await fetch(`https://api.deezer.com/search?${new URLSearchParams({q:item.q,limit:"10"})}`,{signal:AbortSignal.timeout(15000)});
    const data=await response.json() as {data?:{id:number;title:string;duration:number;artist:{name:string};album:{title:string}}[]};
    const track=data.data?.find(track=>track.artist.name.toLowerCase()===item.artist.toLowerCase())||data.data?.[0];
    if(!track){report.cases.push({query:item.q,limitation:"Catalogue returned no result"});continue;}
    const query=new URLSearchParams({title:track.title,artist:track.artist.name,album:track.album.title,duration:String(track.duration),recordingId:`deezer:${track.id}`});
    const start=Date.now(),result=await exported.GET!(new NextRequest(`http://fixture/api/v2/lyrics?${query}`));
    const payload=await result.json();
    const language=payload.lines?lyricReadingLanguage(payload.lines.map((line:{text:string})=>line.text).join("\n")):null;
    const readings=language&&payload.lines?.length<=400?await romanizeLyricLines(payload.lines,language):[];
    report.cases.push({query:item.q,identity:{title:track.title,artist:track.artist.name,album:track.album.title,duration:track.duration,catalogId:track.id},httpStatus:result.status,provider:payload.provider,timing:payload.timing,matchedRecording:payload.matchedRecording,lines:payload.lines?.length,reason:payload.reason,elapsedMs:Date.now()-start,readingLanguage:language,readingSample:readings.find(line=>line.romanized!==line.text)?.romanized?.slice(0,100)});
    await writeFile(`.local/lyrics-route-live-${report.cases.length}.json`,JSON.stringify(payload));
  }catch(error){report.cases.push({query:item.q,error:error instanceof Error?error.message:String(error)});}
  await new Promise(resolve=>setTimeout(resolve,300));
}
await writeFile(".local/lyrics-interactions-live.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
