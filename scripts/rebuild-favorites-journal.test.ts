import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {portableTrack} from "../src/rebuild/app/sessionState";
import type {MusicTrack} from "../src/rebuild/app/types";
import type {FavoriteDraft,FavoriteIntent} from "../src/rebuild/app/favorites";

const compiled=ts.transpileModule(readFileSync("src/rebuild/app/favorites.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const track=(id:string):MusicTrack=>({id,title:id,artists:["Artist"],durationMs:180000,albumId:null,artistId:null,albumTitle:null,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id:"1"},references:[{provider:"deezer",id:"1"}]});
const intent=(id:string,liked=true,createdAt=1000):FavoriteIntent=>({track:track(id),liked,createdAt,operationId:randomUUID()});
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function fixture(){
 const disk=new Map<string,unknown>(),mirror=new Map<string,string>();let unavailable=false;
 function tab(){
  const exports:Record<string,unknown>={};
  vm.runInNewContext(compiled,{exports,Date:{now:()=>2000},localStorage:{get length(){return mirror.size;},key:(index:number)=>[...mirror.keys()][index]||null,getItem:(key:string)=>mirror.get(key)||null,setItem:(key:string,value:string)=>{if(unavailable)throw new Error("Storage unavailable");mirror.set(key,value);},removeItem:(key:string)=>mirror.delete(key)},require:(name:string)=>name==="./sessionState"?{portableTrack}:name==="./offline"?{
   localRead:async(account:string,key:string)=>plain(disk.get(account+":"+key)??null),
   localWrite:async(account:string,key:string,value:unknown)=>{if(unavailable)throw new Error("Storage unavailable");disk.set(account+":"+key,plain(value));},
   localDelete:async(account:string,key:string)=>disk.delete(account+":"+key),
   localEntries:async(account:string,prefix:string)=>[...disk].filter(([key])=>key.startsWith(account+":"+prefix)).map(([key,value])=>({name:key.slice(account.length+1),value:plain(value)})),
  }:{}});
  return exports as unknown as {
   writeFavoriteDraft:(account:string,liked:string[],pending:Record<string,FavoriteIntent>)=>Promise<void>;
   readFavoriteDraft:(account:string)=>Promise<FavoriteDraft|undefined>;
   acknowledgeFavoriteDraft:(account:string,operationId:string)=>Promise<void>;
  };
 }
 return {disk,mirror,tab,fail(){unavailable=true;}};
}

test("independent offline tabs preserve every song across complete draft writes",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=intent("first"),second=intent("second");
 await a.writeFavoriteDraft("owner",["first"],{first});await b.writeFavoriteDraft("owner",["second"],{second});
 const restored=await a.readFavoriteDraft("owner");assert.deepEqual(Object.keys(restored!.pending).sort(),["first","second"]);assert.deepEqual([...restored!.likedIds].sort(),["first","second"]);
 assert.equal(await a.readFavoriteDraft("another-account"),undefined);
});

test("a matching receipt prevents a stale tab from resurrecting an acknowledged operation",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=intent("first");await a.writeFavoriteDraft("owner",["first"],{first});
 await a.acknowledgeFavoriteDraft("owner",first.operationId);await b.writeFavoriteDraft("owner",["first"],{first});
 assert.deepEqual(plain((await a.readFavoriteDraft("owner"))!.pending),{});
});

test("acknowledging a like never clears a later unlike for the same song",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=intent("song",true,1000),later=intent("song",false,1001);
 await a.writeFavoriteDraft("owner",["song"],{song:first});await b.writeFavoriteDraft("owner",[],{song:later});await a.acknowledgeFavoriteDraft("owner",first.operationId);
 const restored=await a.readFavoriteDraft("owner");assert.equal(restored?.pending.song.operationId,later.operationId);assert.equal(restored?.pending.song.liked,false);assert.equal(restored?.likedIds.includes("song"),false);
});

test("a later whole draft cannot replace a newer deliberate same-song choice",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),old=intent("song",true,1000),later=intent("song",false,1001);
 await a.writeFavoriteDraft("owner",["song"],{song:old});await b.writeFavoriteDraft("owner",[],{song:later});await a.writeFavoriteDraft("owner",["song"],{song:old});
 const restored=await b.readFavoriteDraft("owner");assert.equal(restored?.pending.song.operationId,later.operationId);assert.equal(restored?.likedIds.includes("song"),false);
});

test("one-millisecond favorite writes keep monotonic draft ordering",async()=>{
 const f=fixture(),a=f.tab(),first=intent("song");await a.writeFavoriteDraft("owner",["song"],{song:first});const before=await a.readFavoriteDraft("owner");await a.writeFavoriteDraft("owner",["song"],{song:first});const after=await a.readFavoriteDraft("owner");assert.ok(after!.savedAt>before!.savedAt);
});

test("favorite changes report failure when neither journal nor mirror can persist",async()=>{
 const f=fixture(),a=f.tab();f.fail();await assert.rejects(a.writeFavoriteDraft("owner",["song"],{song:intent("song")}),/Storage unavailable/);
});

test("canonical recording migration updates one operation without duplicating its choice",async()=>{
 const f=fixture(),a=f.tab(),choice=intent("external");await a.writeFavoriteDraft("owner",["external"],{external:choice});await a.writeFavoriteDraft("owner",["canonical"],{canonical:{...choice,track:track("canonical")}});
 const restored=await a.readFavoriteDraft("owner");assert.deepEqual(Object.keys(restored!.pending),["canonical"]);assert.deepEqual(plain(restored!.likedIds),["canonical"]);
});
