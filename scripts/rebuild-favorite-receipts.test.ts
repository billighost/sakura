import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {object,uuid,ProductError} from "../src/rebuild/data/validation";

const compiled=ts.transpileModule(readFileSync("src/rebuild/data/collections.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const owner=randomUUID(),other=randomUUID(),recordingId=randomUUID();
function fixture(){
 const favorites=new Set<string>(),receipts=new Map<string,{recording_id:string;liked:boolean}>();let tail:Promise<unknown>=Promise.resolve(),mutations=0;
 const client={async query(sql:string,args:unknown[]=[]){
  const key=args[0]+":"+args[1];let rows:unknown[]=[],rowCount=0;
  if(sql.includes("pg_advisory_xact_lock"))return {rows,rowCount};
  if(sql.startsWith("SELECT recording_id,liked FROM")){const receipt=receipts.get(key);return {rows:receipt?[receipt]:[],rowCount:receipt?1:0};}
  if(sql.startsWith("SELECT EXISTS"))return {rows:[{liked:favorites.has(key)}],rowCount:1};
  if(sql.startsWith("SELECT 1 FROM"))return {rows:favorites.has(key)?[{}]:[],rowCount:favorites.has(key)?1:0};
  if(sql.startsWith('INSERT INTO sakura_v2."Favorite"')){if(!favorites.has(key)){favorites.add(key);mutations++;rows=[{recording_id:args[1]}];rowCount=1;}}
  else if(sql.startsWith('DELETE FROM sakura_v2."Favorite"')){rowCount=favorites.delete(key)?1:0;mutations+=rowCount;}
  else if(sql.startsWith('INSERT INTO sakura_v2."FavoriteOperationReceipt"')){receipts.set(key,{recording_id:String(args[2]),liked:args[3] as boolean});rowCount=1;}
  else if(!sql.startsWith('UPDATE sakura_v2."Mix"')&&!sql.startsWith('DELETE FROM sakura_v2."FeedSession"'))throw new Error("Unexpected transaction query: "+sql);
  return {rows,rowCount};
 }};
 const exports:Record<string,unknown>={};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>name==="./validation"?{object,uuid,ProductError}:name==="./catalog"?{VERIFIED:"r.state='verified'"}:name==="./db"?{inIdempotentTransaction:(operation:(connection:typeof client)=>Promise<unknown>)=>{
  const request=tail.catch(()=>{}).then(async()=>{const beforeFavorites=new Set(favorites),beforeReceipts=new Map(receipts);try{return await operation(client);}catch(error){favorites.clear();for(const key of beforeFavorites)favorites.add(key);receipts.clear();for(const [key,value]of beforeReceipts)receipts.set(key,value);throw error;}});tail=request;return request;
 }}:name==="node:crypto"?{randomUUID}:{}});
 return {favorites,receipts,get mutations(){return mutations;},set:exports.setFavorite as (account:string,value:unknown)=>Promise<{liked:boolean;accepted?:boolean;duplicate?:boolean;operationId?:string}>};
}

test("simultaneous retries of one favorite operation commit one choice and one receipt",async()=>{
 const f=fixture(),operationId=randomUUID(),results=await Promise.all(Array.from({length:4},()=>f.set(owner,{recordingId,liked:true,operationId})));
 assert.equal(f.mutations,1);assert.equal(f.receipts.size,1);assert.equal(results.filter(receipt=>receipt.duplicate).length,3);assert.ok(results.every(receipt=>receipt.accepted&&receipt.operationId===operationId));
});

test("a lost like response retried after a newer unlike cannot resurrect the song",async()=>{
 const f=fixture(),likeId=randomUUID();await f.set(owner,{recordingId,liked:true,operationId:likeId});await f.set(owner,{recordingId,liked:false,operationId:randomUUID()});
 const receipt=await f.set(owner,{recordingId,liked:true,operationId:likeId});assert.equal(receipt.duplicate,true);assert.equal(receipt.liked,false);assert.equal(f.favorites.has(owner+":"+recordingId),false);assert.equal(f.mutations,2);
});

test("an operation ID cannot be reused to replace its original choice",async()=>{
 const f=fixture(),operationId=randomUUID();await f.set(owner,{recordingId,liked:true,operationId});
 await assert.rejects(f.set(owner,{recordingId,liked:false,operationId}),error=>error instanceof ProductError&&error.status===409);
 assert.equal(f.favorites.has(owner+":"+recordingId),true);assert.equal(f.receipts.size,1);
});

test("favorite receipts and choices remain isolated between accounts",async()=>{
 const f=fixture(),operationId=randomUUID();await f.set(owner,{recordingId,liked:true,operationId});await f.set(other,{recordingId,liked:false,operationId});
 assert.equal(f.favorites.has(owner+":"+recordingId),true);assert.equal(f.favorites.has(other+":"+recordingId),false);assert.equal(f.receipts.size,2);
});

test("legacy favorite callers retain explicit set behavior",async()=>{
 const f=fixture();assert.equal((await f.set(owner,{recordingId,liked:true})).liked,true);assert.equal((await f.set(owner,{recordingId,liked:false})).liked,false);assert.equal(f.receipts.size,0);
});
