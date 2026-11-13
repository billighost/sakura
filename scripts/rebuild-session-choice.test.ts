import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import * as stateTransport from "../src/rebuild/app/sessionState";
import type {ListeningSession} from "../src/rebuild/app/sessionState";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {integer,object,ProductError,text,uuid} from "../src/rebuild/data/validation";
import {musicTrack} from "../src/rebuild/app/types";

const compiled=ts.transpileModule(readFileSync("src/rebuild/data/session.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const accountId=randomUUID(),writerA=randomUUID(),writerB=randomUUID();
const state=(positionMs=0)=>({queue:[],currentEntryId:null,positionMs,sleepUntil:null});
type Receipt={accepted:boolean;session:{state:ReturnType<typeof state>;revision:number;deviceId:string;updatedAt:number;choiceAt:number};serverTime:number};
function fixture(){
 const rows=new Map<string,Record<string,unknown>>();let stamp=1000,tail:Promise<unknown>=Promise.resolve(),writes=0;
 const client={async query(sql:string,args:unknown[]=[]){
  const owner=String(args[0]);
  if(sql.includes("pg_advisory_xact_lock"))return {rows:[]};
  if(sql.startsWith('SELECT * FROM sakura_v2."ListeningSession"'))return {rows:rows.has(owner)?[rows.get(owner)]:[]};
  if(sql.startsWith('INSERT INTO sakura_v2."ListeningSession"')){const row={account_id:owner,state:JSON.parse(String(args[1])),device_id:args[2],revision:Number(rows.get(owner)?.revision||0)+1,updated_at:new Date(stamp).toISOString()};rows.set(owner,row);writes++;return {rows:[row]};}
  throw new Error("Unexpected session query: "+sql);
 }};
 class FixtureDate extends Date {static now(){return stamp;}}
 const exports:Record<string,unknown>={};
 // Database JSON and route JSON share one realm in production; normalize the
 // isolated adapter's JSON prototypes before exercising the same comparison.
 vm.runInNewContext(compiled,{exports,Date:FixtureDate,Buffer,require:(name:string)=>name==="./db"?{getRebuildPool:()=>client,inIdempotentTransaction:(operation:(connection:typeof client)=>Promise<unknown>)=>{const result=tail.catch(()=>{}).then(()=>operation(client));tail=result;return result;}}:name==="./validation"?{integer,object,ProductError,text,uuid}:name==="node:crypto"?crypto:name==="node:zlib"?zlib:name==="node:util"?{isDeepStrictEqual:(left:unknown,right:unknown)=>isDeepStrictEqual(JSON.parse(JSON.stringify(left)),JSON.parse(JSON.stringify(right)))}:name==="../app/sessionState"?stateTransport:name==="../app/types"?{musicTrack}:{}});
 return {rows,now:(value:number)=>{stamp=value;},get writes(){return writes;},put:exports.putSession as (owner:string,value:unknown)=>Promise<Receipt>,get:exports.getSession as (owner:string)=>Promise<{session:Receipt["session"];serverTime:number}>};
}

test("compact large queues preserve every occurrence and exact offline card metadata",async()=>{
 const f=fixture(),track={id:randomUUID(),title:"音楽の時間",artists:["Artist"],durationMs:180000,albumId:null,artistId:null,albumTitle:"Album",coverUrl:"https://example.org/"+"a".repeat(1800),versionLabel:"Original",reference:{provider:"deezer" as const,id:"1"},references:[{provider:"deezer" as const,id:"1"}]},queue=Array.from({length:80},()=>({entryId:randomUUID(),track})),full:ListeningSession={queue,currentEntryId:queue[40].entryId,positionMs:1000,sleepUntil:null};
 assert.ok(Buffer.byteLength(JSON.stringify({state:full}))>98304);const body=await stateTransport.sessionRequestBody(full,{protocol:2,revision:0,deviceId:writerA,explicit:true,intentAt:900});assert.ok(body);assert.ok(Buffer.byteLength(body!)<stateTransport.SESSION_KEEPALIVE_BUDGET);const saved=await f.put(accountId,JSON.parse(body!)),restored=saved.session.state as ListeningSession;assert.equal(restored.queue.length,80);assert.equal(restored.currentEntryId,queue[40].entryId);assert.equal(restored.queue[79].track.coverUrl,track.coverUrl);assert.equal(restored.queue[0].track.title,track.title);
});
test("acknowledged queue checkpoints are small, retain choice time and retry idempotently",async()=>{
 const f=fixture(),first=await f.put(accountId,{state:state(10),deviceId:writerA,revision:0,explicit:true,intentAt:900}),key=(first.session as unknown as {queueKey:string}).queueKey;
 const body=await stateTransport.sessionRequestBody(state(15),{protocol:2,queueKey:key,checkpoint:true,keepalive:true,revision:1,deviceId:writerA,explicit:false});assert.ok(body&&Buffer.byteLength(body)<512);f.now(4000);const saved=await f.put(accountId,JSON.parse(body!));assert.equal(saved.session.choiceAt,900);assert.equal(saved.session.state.positionMs,15);const retry=await f.put(accountId,JSON.parse(body!));assert.equal(retry.accepted,true);assert.equal(retry.session.revision,2);assert.equal(f.writes,2);
 const mismatch=await f.put(accountId,{protocol:2,checkpoint:{queueKey:"0".repeat(64),currentEntryId:null,positionMs:70,sleepUntil:null},deviceId:writerA,revision:2});assert.equal(mismatch.accepted,false);assert.equal(mismatch.session.state.positionMs,15);
});
test("invalid compressed payloads and inflation bombs cannot bypass the bounded envelope",async()=>{
 const f=fixture();for(const packed of ["not-base64!",Buffer.from("not gzip").toString("base64"),zlib.gzipSync(Buffer.alloc(stateTransport.SESSION_BODY_LIMIT+1,32)).toString("base64")])await assert.rejects(f.put(accountId,{protocol:2,packed,deviceId:writerA,revision:0}),ProductError);assert.equal(f.writes,0);
});

test("late passive playback checkpoints advance progress without renewing song ownership",async()=>{
 const f=fixture();const first=await f.put(accountId,{state:state(10),deviceId:writerA,revision:0,explicit:true,intentAt:900});
 f.now(4000);const checkpoint=await f.put(accountId,{state:state(15),deviceId:writerA,revision:1,explicit:false,intentAt:4000});
 assert.equal(first.session.choiceAt,900);assert.equal(checkpoint.session.choiceAt,900);assert.equal(checkpoint.session.updatedAt,4000);assert.equal(checkpoint.session.state.positionMs,15);
 const conflict=await f.put(accountId,{state:state(70),deviceId:writerB,revision:1,explicit:true,intentAt:2000});assert.equal(conflict.accepted,false);assert.equal(conflict.session.choiceAt,900);
 const takeover=await f.put(accountId,{state:state(70),deviceId:writerB,revision:2,explicit:true,intentAt:2000});assert.equal(takeover.accepted,true);assert.equal(takeover.session.choiceAt,2000);
});

test("private choice metadata stays in storage and cannot be injected through public state",async()=>{
 const f=fixture();const result=await f.put(accountId,{state:{...state(10),__sakuraSession:{choiceAt:999999}},deviceId:writerA,revision:0,explicit:true,intentAt:900});
 assert.equal(result.session.choiceAt,900);assert.equal("__sakuraSession" in result.session.state,false);
 assert.equal((f.rows.get(accountId)?.state as {__sakuraSession:{choiceAt:number}}).__sakuraSession.choiceAt,900);
 const read=await f.get(accountId);assert.equal(read.session.choiceAt,900);assert.equal("__sakuraSession" in read.session.state,false);
});

test("lost-response retries remain idempotent after storing private choice metadata",async()=>{
 const f=fixture(),request={state:state(10),deviceId:writerA,revision:0,explicit:true,intentAt:900};await f.put(accountId,request);
 f.now(4000);const retry=await f.put(accountId,request);assert.equal(retry.accepted,true);assert.equal(retry.session.revision,1);assert.equal(retry.session.choiceAt,900);assert.equal(f.writes,1);
});

test("legacy stored sessions and legacy callers retain deliberate update behavior",async()=>{
 const f=fixture();f.rows.set(accountId,{state:state(10),revision:1,device_id:writerA,updated_at:new Date(1000).toISOString()});
 assert.equal((await f.get(accountId)).session.choiceAt,1000);
 f.now(3000);const result=await f.put(accountId,{state:state(70),deviceId:writerB,revision:1});assert.equal(result.session.choiceAt,3000);assert.equal(result.session.updatedAt,3000);
});

test("future client times are bounded and malformed choice metadata is rejected",async()=>{
 const f=fixture();const result=await f.put(accountId,{state:state(10),deviceId:writerA,revision:0,explicit:true,intentAt:999999});assert.equal(result.session.choiceAt,1000);
 for(const metadata of [{explicit:"yes"},{intentAt:-1},{intentAt:NaN},{intentAt:1.5}])await assert.rejects(f.put(accountId,{state:state(10),deviceId:writerA,revision:1,...metadata}),ProductError);
});

test("simultaneous explicit and passive writes preserve compare-and-swap and account isolation",async()=>{
 const f=fixture();await f.put(accountId,{state:state(10),deviceId:writerA,revision:0,explicit:true,intentAt:900});f.now(3000);
 const results=await Promise.all([f.put(accountId,{state:state(15),deviceId:writerA,revision:1,explicit:false}),f.put(accountId,{state:state(70),deviceId:writerB,revision:1,explicit:true,intentAt:2000})]);
 assert.equal(results.filter(result=>result.accepted).length,1);assert.equal((await f.get(accountId)).session.revision,2);
 const other=await f.put(randomUUID(),{state:state(90),deviceId:writerB,revision:0,explicit:true,intentAt:2500});assert.equal(other.session.choiceAt,2500);assert.equal((await f.get(accountId)).session.choiceAt,900);
});
