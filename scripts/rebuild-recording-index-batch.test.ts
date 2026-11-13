import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { indexRecordingBatch } from "../src/rebuild/app/recordingIndexBatch";
import { musicTrack } from "../src/rebuild/app/types";
import type { ResolveRecordingInput } from "../src/rebuild/server/contracts";
import { InputError } from "../src/rebuild/server/contracts";
import { parseResolveInput, readRequestJson } from "../src/rebuild/server/input";

const track=(id:number,title="Song "+id)=>musicTrack({title,artists:["Artist"],reference:{provider:"deezer",id:String(id)}});
const recording=(input:ResolveRecordingInput)=>({recordingId:"11111111-1111-4111-8111-"+input.reference.id.padStart(12,"0"),metadata:input.expected,references:[input.reference]});

test("two thousand exact references use bounded ordered batches without dropping the candidate pool",async()=>{
 const tracks=Array.from({length:2000},(_,index)=>track(index+1));let calls=0,persisted=0;
 const result=await indexRecordingBatch(tracks,{accountId:"account",signal:new AbortController().signal,
  request:async(path,init)=>{assert.equal(path,"/api/v2/recordings/index/batch");calls++;const body=String(init.body);assert.ok(new TextEncoder().encode(body).byteLength<=32768);const {items}=JSON.parse(body) as {items:ResolveRecordingInput[]};assert.ok(items.length<=50);return {recordings:items.map(recording)};},
  onIndexed:pairs=>{assert.ok(pairs.length<=50);persisted+=pairs.length;},
 });
 assert.equal(calls,40);assert.equal(persisted,2000);assert.equal(result.length,2000);
 assert.deepEqual(result.map(item=>item.reference.id),tracks.map(item=>item.reference.id));
});

test("canonical/known identities skip HTTP and duplicates reuse only identical expected metadata",async()=>{
 const one=track(1),canonical={...track(2),id:"11111111-1111-4111-8111-000000000002"},known={...track(3),id:"11111111-1111-4111-8111-000000000003"};let submitted=0;
 const result=await indexRecordingBatch([one,one,track(1,"Other edition"),canonical,track(3)],{accountId:"account",signal:new AbortController().signal,known:item=>item.reference.id==="3"?known:undefined,
  request:async(_path,init)=>{const {items}=JSON.parse(String(init.body)) as {items:ResolveRecordingInput[]};submitted+=items.length;return {recordings:items.map(recording)};},
 });
 assert.equal(submitted,2);assert.equal(result[0].id,result[1].id);assert.equal(result[2].title,"Other edition");assert.equal(result[3],canonical);assert.equal(result[4],known);
});

test("Unicode-heavy valid metadata batches by bytes, not only item count",async()=>{
 const tracks=Array.from({length:50},(_,index)=>track(index+1,"歌".repeat(500)));let calls=0;
 await indexRecordingBatch(tracks,{accountId:"account",signal:new AbortController().signal,request:async(_path,init)=>{calls++;assert.ok(new TextEncoder().encode(String(init.body)).byteLength<=32768);const {items}=JSON.parse(String(init.body)) as {items:ResolveRecordingInput[]};return {recordings:items.map(recording)};}});
 assert.ok(calls>1);
});

test("cancellation after a batch prevents persistence and further provider work",async()=>{
 const controller=new AbortController();let calls=0,persisted=0;
 await assert.rejects(()=>indexRecordingBatch(Array.from({length:100},(_,index)=>track(index+1)),{accountId:"account",signal:controller.signal,
  request:async(_path,init)=>{calls++;const {items}=JSON.parse(String(init.body)) as {items:ResolveRecordingInput[]};controller.abort();return {recordings:items.map(recording)};},onIndexed:()=>{persisted++;},
 }),error=>error instanceof DOMException&&error.name==="AbortError");
 assert.equal(calls,1);assert.equal(persisted,0);
});

test("an incomplete batch does not silently shrink the selected collection",async()=>{
 await assert.rejects(()=>indexRecordingBatch([track(1),track(2)],{accountId:"account",signal:new AbortController().signal,request:async()=>({recordings:[]})}),/incomplete/);
});

test("batch route authenticates and validates every identity/body before any catalog work",async()=>{
 const code=ts.transpileModule(await readFile("src/app/api/v2/recordings/index/batch/route.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 let authenticated=true,calls=0;const exports:Record<string,unknown>={};
 class Conflict extends Error {reason="catalog-mismatch";candidates=[];rejections=[];}
 const modules:Record<string,unknown>={
  "@/rebuild/server/performance":{withApiTiming:(_path:string,_request:Request,work:()=>Promise<Response>)=>work()},
  "@/rebuild/auth":{requireRebuildAccount:async()=>authenticated?{id:"account"}:null},
  "@/rebuild/server/runtime":{getRebuildServices:()=>({ingestor:{ensureRecordings:async(items:ResolveRecordingInput[],signal:AbortSignal)=>{signal.throwIfAborted();calls++;return items.map(recording);}}})},
  "@/rebuild/server/input":{parseResolveInput,readRequestJson},
  "@/rebuild/server/ingestion":{RecordingIdentityConflict:Conflict},"@/rebuild/server/contracts":{InputError},
 };
 vm.runInNewContext(code,{exports,module:{exports},require:(name:string)=>{assert.ok(name in modules);return modules[name];},Response});
 const post=exports.POST as (request:Request)=>Promise<Response>;
 const request=(items:unknown,origin="https://sakura.invalid")=>new Request("https://sakura.invalid/api/v2/recordings/index/batch",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({items})});
 const valid={reference:{provider:"deezer",id:"1"},expected:{title:"Song",artists:["Artist"]}};
 authenticated=false;assert.equal((await post(request([valid]))).status,401);assert.equal(calls,0);
 authenticated=true;assert.equal((await post(request([valid,{reference:{provider:"unknown",id:"2"}}]))).status,400);assert.equal(calls,0);
 assert.equal((await post(request(Array(51).fill(valid)))).status,400);assert.equal(calls,0);
 assert.equal((await post(request([valid],"https://attacker.invalid"))).status,400);assert.equal(calls,0);
 assert.equal((await post(request([{...valid,expected:{title:"字".repeat(12000),artists:["Artist"]}}]))).status,400);assert.equal(calls,0);
 const response=await post(request([valid]));assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.headers.get("Cache-Control"),"private, no-store");
});
