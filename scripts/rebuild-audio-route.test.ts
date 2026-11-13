import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {InputError} from "../src/rebuild/server/contracts";
import {RecordingIdentityConflict} from "../src/rebuild/server/ingestion";

type Handler=(request:Request,context:{params:Promise<Record<string,string>>})=>Promise<Response>;
const routes=[
 {path:"src/app/api/v2/recordings/index/route.ts",methods:["POST"]},
 {path:"src/app/api/v2/recordings/resolve/route.ts",methods:["POST"]},
 {path:"src/app/api/v2/recordings/jobs/[jobId]/route.ts",methods:["GET"]},
 {path:"src/app/api/v2/recordings/[recordingId]/audio/route.ts",methods:["GET","HEAD"]},
];
/** Run the real compiled handlers while replacing unavailable account/service boundaries. */
function handlerModule(path:string,accountRead:()=>Promise<null|{id:string}>,services?:()=>unknown){
 const exports:Record<string,Handler>={};let bodyReads=0,serviceReads=0;
 const compiled=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const dependency=(name:string)=>{
  if(name==="@/rebuild/server/performance")return{withApiTiming:async(_route:string,_request:Request,operation:()=>Promise<Response>)=>operation()};
  if(name==="@/rebuild/auth")return{requireRebuildAccount:accountRead};
  if(name==="@/rebuild/server/runtime")return{getRebuildServices(){serviceReads++;if(services)return services();throw new Error("An unauthenticated route must not reach recording services");}};
  if(name==="@/rebuild/server/input")return{readResolveInput(){bodyReads++;throw new Error("An unauthenticated route must not read a recording mutation");},isUuid:()=>true};
  if(name==="@/rebuild/server/contracts")return{InputError};
  if(name==="@/rebuild/server/ingestion")return{RecordingIdentityConflict};
  if(name==="next/server")return{after(){throw new Error("An unauthenticated route must not schedule a job");}};
  throw new Error("Unexpected route dependency: "+name);
 };
 new Function("require","module","exports",compiled)(dependency,{exports},exports);
 return{exports,counts:()=>({bodyReads,serviceReads})};
}
for(const unavailable of [false,true])test(unavailable?"audio route account-read failures return private503 without leaking auth errors":"unauthenticated audio routes return private401 before metadata or media work",async()=>{
 for(const route of routes){
  const fixture=handlerModule(route.path,async()=>{if(unavailable)throw new Error("private-account-diagnostic");return null;});
  for(const method of route.methods){
   const result=await fixture.exports[method](new Request("http://localhost:3003/api/v2/recordings/test",{method}),{params:Promise.resolve({recordingId:"11111111-1111-4111-8111-111111111111",jobId:"22222222-2222-4222-8222-222222222222"})});
   assert.equal(result.status,unavailable?503:401,route.path+" "+method);
   assert.equal(result.headers.get("Cache-Control"),"private, no-store");
   assert.ok(!(await result.text()).includes("private-account-diagnostic"));
  }
  assert.deepEqual(fixture.counts(),{bodyReads:0,serviceReads:0});
 }
});

test("authenticated audio route recognizes exact playback hints and native audio destinations",async()=>{
 const calls:Array<Record<string,unknown>>=[],accountId="33333333-3333-4333-8333-333333333333",recordingId="11111111-1111-4111-8111-111111111111";
 const fixture=handlerModule("src/app/api/v2/recordings/[recordingId]/audio/route.ts",async()=>({id:accountId}),()=>({gateway:{async serve(input:Record<string,unknown>){calls.push(input);return new Response(null,{status:200});}}}));
 for(const [method,hint,playback,destination] of [["GET","1",true,"empty"],["GET","true",false,"empty"],["GET","",false,"empty"],["GET","",true,"audio"],["HEAD","1",false,"audio"]] as const){
  const request=new Request("https://app.example.test/api/v2/recordings/"+recordingId+"/audio?assetId=22222222-2222-4222-8222-222222222222",{method,headers:{Range:"bytes=262144-524287","X-Sakura-Playback":hint,"Sec-Fetch-Dest":destination}});
  assert.equal((await fixture.exports[method](request,{params:Promise.resolve({recordingId})})).status,200);
  const call=calls.at(-1)!;assert.equal(call.playback,playback);assert.equal(call.accountId,accountId);assert.equal(call.range,"bytes=262144-524287");assert.equal(call.signal,request.signal);
 }
 assert.equal(fixture.counts().serviceReads,5);
});
