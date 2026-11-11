/** Exercise the real lyric route over local HTTP with live OVH, after fixture primary misses. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { fetchVerifiedLyrics } from "../src/rebuild/lyrics/fallbacks";
import { createLyricsResolver } from "../src/rebuild/lyrics/service";
import * as parse from "../src/rebuild/lyrics/parse";
import * as request from "../src/rebuild/lyrics/request";
import * as versions from "../src/rebuild/lyrics/versions";

async function main(){
const upstreams: Array<{host:string; live:boolean; status:number}> = [];
const resolveVerifiedLyrics = createLyricsResolver({load: identity => fetchVerifiedLyrics(identity, {fetch: async (input, init) => {
  const url = new URL(String(input));
  if (["lrclib.net", "music.163.com", "wilooper-lyrica.hf.space"].includes(url.hostname)) {
    upstreams.push({host:url.hostname,live:false,status:404});
    return new Response(null,{status:404});
  }
  assert.equal(url.hostname,"api.lyrics.ovh");
  const response = await fetch(input,init);
  upstreams.push({host:url.hostname,live:true,status:response.status});
  return response;
}})});
const dependencies: Record<string,unknown> = {
  "next/server":{NextRequest,NextResponse},
  "@/rebuild/auth":{requireRebuildAccount:async()=>({id:"90000000-0000-4000-8000-000000000096"})},
  "@/rebuild/lyrics/parse":parse,
  "@/rebuild/lyrics/request":request,
  "@/rebuild/lyrics/service":{resolveVerifiedLyrics},
  "@/rebuild/lyrics/versions":versions,
};
const exports: {GET?:(request:NextRequest)=>Promise<NextResponse>} = {};
const source=await readFile("src/app/api/v2/lyrics/route.ts","utf8");
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
const server=createServer(async(req,res)=>{
  try{
    const result=await exports.GET!(new NextRequest(new URL(req.url!,"http://127.0.0.1")));
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
  }catch{res.writeHead(500);res.end();}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
try{
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const query=new URLSearchParams({title:"Yellow",artist:"Coldplay",duration:"269"});
  const response=await fetch(`http://127.0.0.1:${address.port}/api/v2/lyrics?${query}`,{signal:AbortSignal.timeout(35_000)});
  const result=await response.json();
  const report={date:new Date().toISOString(),mode:"Actual GET route over local HTTP; synthetic auth and primary-provider 404s; live unmodified OVH response",status:response.status,provider:result.provider,timing:result.timing,lines:result.lines?.length,reason:result.reason,upstreams};
  await mkdir(".local",{recursive:true});await writeFile(".local/lyrics-ovh-backend-live.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  assert.equal(response.status,200);assert.equal(result.provider,"lyrics.ovh");assert.equal(result.timing,"plain");
  assert.ok(result.lines.length>0);assert.ok(result.lines.every((line:{start:number})=>line.start===0));
  assert.deepEqual(new Set(upstreams.filter(item=>!item.live).map(item=>item.host)),new Set(["lrclib.net","music.163.com","wilooper-lyrica.hf.space"]));
}finally{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
