import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {integer,object,uuid,ProductError} from "../src/rebuild/data/validation";

const compiled=ts.transpileModule(readFileSync("src/rebuild/data/collections.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const owner=randomUUID(),other=randomUUID(),recordingId=randomUUID();
function fixture(triggers=false){
 const favorites=new Set<string>(),receipts=new Map<string,{recording_id:string;liked:boolean;conflict:boolean}>(),choices=new Map<string,{revision:number;liked:boolean;updated_at?:number}>();let tail:Promise<unknown>=Promise.resolve(),mutations=0,transactionTime=0;
 const triggerChoice=(key:string)=>choices.set(key,{revision:(choices.get(key)?.revision??0)+1,liked:favorites.has(key),updated_at:transactionTime});
 const client={async query(sql:string,args:unknown[]=[]){
  const key=args[0]+":"+args[1];let rows:unknown[]=[],rowCount=0;
  if(sql.includes("pg_advisory_xact_lock"))return {rows,rowCount};
  if(sql.startsWith("SELECT recording_id,liked,conflict FROM")){const receipt=receipts.get(key);return {rows:receipt?[receipt]:[],rowCount:receipt?1:0};}
  if(sql.startsWith("SELECT revision FROM")){const choice=choices.get(key);return {rows:choice?[choice]:[],rowCount:choice?1:0};}
  if(sql.startsWith("SELECT c.recording_id,c.revision,")){const prefix=String(args[0])+":";const ids=new Set([...choices.keys(),...favorites].filter(id=>id.startsWith(prefix)));return {rows:[...ids].map(id=>({recording_id:id.slice(prefix.length),liked:favorites.has(id),revision:choices.get(id)?.revision??1}))};}
  if(sql.startsWith("SELECT r.id")){const prefix=String(args[0])+":";return {rows:[...favorites].filter(id=>id.startsWith(prefix)).map(id=>({recordingId:id.slice(prefix.length),addedAt:"2026-11-11T00:00:00Z"}))};}
  if(sql.startsWith("SELECT p.id"))return {rows:[]};
  if(sql.startsWith("SELECT EXISTS"))return {rows:[{liked:favorites.has(key)}],rowCount:1};
  if(sql.startsWith("SELECT 1 FROM"))return {rows:favorites.has(key)?[{}]:[],rowCount:favorites.has(key)?1:0};
  if(sql.startsWith('INSERT INTO sakura_v2."Favorite"')){if(!favorites.has(key)){favorites.add(key);mutations++;rows=[{recording_id:args[1]}];rowCount=1;if(triggers)triggerChoice(key);}}
  else if(sql.startsWith('DELETE FROM sakura_v2."Favorite"')){rowCount=favorites.delete(key)?1:0;mutations+=rowCount;if(triggers&&rowCount)triggerChoice(key);}
  else if(sql.startsWith('INSERT INTO sakura_v2."FavoriteChoice"')){choices.set(key,{revision:Number(args[2]),liked:args[3] as boolean,updated_at:transactionTime});rowCount=1;}
  else if(sql.startsWith('INSERT INTO sakura_v2."FavoriteOperationReceipt"')){receipts.set(key,{recording_id:String(args[2]),liked:args[3] as boolean,conflict:args[5]===true});rowCount=1;const choiceKey=args[0]+":"+args[2];if(triggers&&args[4]==null&&args[5]!==true&&choices.get(choiceKey)?.updated_at!==transactionTime)triggerChoice(choiceKey);}
  else if(!sql.startsWith('UPDATE sakura_v2."Mix"')&&!sql.startsWith('DELETE FROM sakura_v2."FeedSession"'))throw new Error("Unexpected transaction query: "+sql);
  return {rows,rowCount};
 }};
 const transact=(operation:(connection:typeof client)=>Promise<unknown>)=>{
  const request=tail.catch(()=>{}).then(async()=>{transactionTime++;const beforeFavorites=new Set(favorites),beforeReceipts=new Map(receipts),beforeChoices=new Map(choices);try{return await operation(client);}catch(error){favorites.clear();for(const key of beforeFavorites)favorites.add(key);receipts.clear();for(const [key,value]of beforeReceipts)receipts.set(key,value);choices.clear();for(const [key,value]of beforeChoices)choices.set(key,value);throw error;}});tail=request;return request;
 };
 const exports:Record<string,unknown>={};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>name==="./validation"?{integer,object,uuid,ProductError,pageInput:()=>({limit:100,cursor:null})}:name==="./catalog"?{VERIFIED:"r.state='verified'",CARD_SELECT:'SELECT r.id FROM sakura_v2."Recording" r',card:(value:unknown)=>value}:name==="./db"?{getRebuildPool:()=>client,inIdempotentTransaction:transact,inTransaction:transact}:name==="node:crypto"?{randomUUID}:{}});
 return {favorites,receipts,choices,legacySet:(account:string,liked:boolean)=>transact(async connection=>{await connection.query(liked?'INSERT INTO sakura_v2."Favorite"(account_id,recording_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING':'DELETE FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid',[account,recordingId]);await connection.query('INSERT INTO sakura_v2."FavoriteOperationReceipt"(account_id,operation_id,recording_id,liked) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',[account,randomUUID(),recordingId,liked]);}),get mutations(){return mutations;},set:exports.setFavorite as (account:string,value:unknown)=>Promise<{liked:boolean;revision:number;accepted?:boolean;duplicate?:boolean;conflict?:boolean;operationId?:string}>,revisions:exports.getFavoriteRevisions as (account:string)=>Promise<Record<string,number>>,library:exports.getLibrary as (account:string,url:URL)=>Promise<{recordings:Array<{recordingId:string}>;favoriteRevisions:Record<string,number>;favoriteStates:Record<string,{liked:boolean;revision:number}>}>};
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

test("a first delivery of an older offline like cannot reverse a newer remote unlike",async()=>{
 const f=fixture(),oldId=randomUUID();const unlike=await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:0});assert.equal(unlike.revision,1);
 const old=await f.set(owner,{recordingId,liked:true,operationId:oldId,baseRevision:0});assert.equal(old.accepted,true);assert.equal(old.conflict,true);assert.equal(old.liked,false);assert.equal(old.revision,1);assert.equal(f.favorites.has(owner+":"+recordingId),false);
 const retry=await f.set(owner,{recordingId,liked:true,operationId:oldId,baseRevision:0});assert.equal(retry.duplicate,true);assert.equal(retry.conflict,true);assert.equal(retry.revision,1);
 await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:1});const after=await f.set(owner,{recordingId,liked:true,operationId:oldId,baseRevision:0});assert.equal(after.revision,2);assert.equal(after.liked,true);assert.equal(f.mutations,1);
});

test("concurrent first deliveries against one baseline produce one choice and one conflict receipt",async()=>{
 const f=fixture(),results=await Promise.all([true,false].map(liked=>f.set(owner,{recordingId,liked,operationId:randomUUID(),baseRevision:0})));
 assert.equal(results.filter(receipt=>receipt.conflict===false).length,1);assert.equal(results.filter(receipt=>receipt.conflict===true).length,1);assert.equal(f.choices.get(owner+":"+recordingId)?.revision,1);assert.equal(f.receipts.size,2);
});

test("unlike tombstone revisions remain visible to the account after the Favorite row disappears",async()=>{
 const f=fixture();await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:0});await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:1});
 assert.equal(f.favorites.has(owner+":"+recordingId),false);assert.equal((await f.revisions(owner))[recordingId],2);assert.equal(Object.keys(await f.revisions(other)).length,0);
});

test("legacy favorites without a choice row expose a conservative first revision",async()=>{
 const f=fixture();f.favorites.add(owner+":"+recordingId);assert.equal((await f.revisions(owner))[recordingId],1);
 const refused=await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:0});assert.equal(refused.conflict,true);assert.equal(refused.liked,true);
 const accepted=await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:1});assert.equal(accepted.revision,2);assert.equal(accepted.liked,false);
});

test("favorite baselines reject malformed revisions without a mutation or receipt",async()=>{
 const f=fixture();for(const baseRevision of [-1,1.5,NaN,null,Number.MAX_SAFE_INTEGER+1])await assert.rejects(f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision}),ProductError);
 assert.equal(f.receipts.size,0);assert.equal(f.choices.size,0);assert.equal(f.mutations,0);
});

test("library favorites and revision baselines stay coherent while another device changes the song",async()=>{
 const f=fixture();await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:0});
 const [snapshot]=await Promise.all([f.library(owner,new URL("https://sakura.example/api/v2/library?kind=liked")),f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:1})]);
 assert.equal(snapshot.recordings[0].recordingId,recordingId);assert.equal(snapshot.favoriteRevisions[recordingId],1);assert.equal((await f.revisions(owner))[recordingId],2);assert.equal(f.favorites.has(owner+":"+recordingId),false);
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot.favoriteStates[recordingId])),{liked:true,revision:1});
});

test("every library page includes exact favorite choices so an unlike between pages repairs earlier liked rows",async()=>{
 const f=fixture();await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:0});
 const first=await f.library(owner,new URL("https://sakura.example/api/v2/library?kind=liked"));
 await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:1});
 const next=await f.library(owner,new URL("https://sakura.example/api/v2/library?kind=liked"));
 const states={...first.favoriteStates};for(const [id,state]of Object.entries(next.favoriteStates))if(!states[id]||state.revision>states[id].revision)states[id]=state;
 const liked=new Set(first.recordings.map(item=>item.recordingId));for(const [id,state]of Object.entries(states)){if(state.liked)liked.add(id);else liked.delete(id);}
 assert.equal(liked.has(recordingId),false);assert.deepEqual(JSON.parse(JSON.stringify(states[recordingId])),{liked:false,revision:2});assert.equal(Object.keys((await f.library(other,new URL("https://sakura.example/api/v2/library?kind=liked"))).favoriteStates).length,0);
});

test("a deployed legacy unlike advances its migrated baseline and blocks the older offline like",async()=>{
 const f=fixture(true),key=owner+":"+recordingId;f.favorites.add(key);f.choices.set(key,{liked:true,revision:1,updated_at:0});
 await f.legacySet(owner,false);assert.equal(f.choices.get(key)?.revision,2);assert.equal(f.choices.get(key)?.liked,false);
 const snapshot=await f.library(owner,new URL("https://sakura.example/api/v2/library?kind=liked"));assert.equal(snapshot.favoriteStates[recordingId].liked,false);assert.equal(snapshot.favoriteStates[recordingId].revision,2);
 const stale=await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:1});assert.equal(stale.conflict,true);assert.equal(stale.liked,false);assert.equal(f.favorites.has(key),false);
});

test("a legacy no-op receipt advances the choice once without a Favorite membership mutation",async()=>{
 const f=fixture(true),key=owner+":"+recordingId;f.choices.set(key,{liked:false,revision:1,updated_at:0});
 await f.legacySet(owner,false);assert.equal(f.mutations,0);assert.equal(f.choices.get(key)?.revision,2);
 const stale=await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:1});assert.equal(stale.conflict,true);assert.equal(stale.revision,2);assert.equal(f.mutations,0);
});

test("legacy choices that change and return to the same liked state still invalidate older baselines",async()=>{
 const f=fixture(true),key=owner+":"+recordingId;await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:0});
 await f.legacySet(owner,false);await f.legacySet(owner,true);assert.equal(f.choices.get(key)?.revision,3);
 const stale=await f.set(owner,{recordingId,liked:false,operationId:randomUUID(),baseRevision:1});assert.equal(stale.conflict,true);assert.equal(stale.liked,true);assert.equal(f.favorites.has(key),true);
});

test("compatibility triggers preserve the new setter's planned revision without double increments",async()=>{
 const f=fixture(true),key=owner+":"+recordingId,firstId=randomUUID();
 for(const [liked,baseRevision,operationId]of [[true,0,firstId],[true,1,randomUUID()],[false,2,randomUUID()],[false,undefined,randomUUID()]]as const){
  const before=f.choices.get(key)?.revision??0,receipt=await f.set(owner,{recordingId,liked,operationId,...(baseRevision===undefined?{}:{baseRevision})});assert.equal(receipt.revision,before+1);assert.equal(f.choices.get(key)?.revision,receipt.revision);
 }
 const duplicate=await f.set(owner,{recordingId,liked:true,operationId:firstId,baseRevision:0});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.revision,4);assert.equal(f.choices.get(key)?.revision,4);
 const conflict=await f.set(owner,{recordingId,liked:true,operationId:randomUUID(),baseRevision:0});assert.equal(conflict.conflict,true);assert.equal(f.choices.get(key)?.revision,4);
});

test("the additive rollout locks tables in setter order and repairs stale states before installing guarded triggers",()=>{
 const schema=readFileSync("src/rebuild/data/schema.sql","utf8"),favoriteLock=schema.indexOf('LOCK TABLE sakura_v2."Favorite" IN SHARE ROW EXCLUSIVE MODE'),receiptLock=schema.indexOf('LOCK TABLE sakura_v2."FavoriteOperationReceipt" IN SHARE ROW EXCLUSIVE MODE'),receiptAlter=schema.indexOf('ALTER TABLE sakura_v2."FavoriteOperationReceipt"'),repair=schema.indexOf('UPDATE sakura_v2."FavoriteChoice" choice SET revision=choice.revision+1'),membershipTrigger=schema.indexOf('CREATE OR REPLACE TRIGGER favorite_membership_choice');
 assert.ok(favoriteLock>=0&&favoriteLock<receiptLock&&receiptLock<receiptAlter&&receiptAlter<repair&&repair<membershipTrigger);
 assert.match(schema,/IF NOT EXISTS\(SELECT 1 FROM public\."User" WHERE id=target_account\)/);assert.match(schema,/IF NEW\.base_revision IS NOT NULL OR NEW\.conflict THEN RETURN NULL/);assert.match(schema,/WHERE choice\.updated_at IS DISTINCT FROM now\(\)/);
});
