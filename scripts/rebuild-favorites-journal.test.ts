import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {localId,portableTrack} from "../src/rebuild/app/sessionState";
import type {MusicTrack} from "../src/rebuild/app/types";
import {mergeFavoriteRevisions,type FavoriteConfirmation,type FavoriteDraft,type FavoriteIntent} from "../src/rebuild/app/favorites";

const compiled=ts.transpileModule(readFileSync("src/rebuild/app/favorites.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const track=(id:string):MusicTrack=>({id,title:id,artists:["Artist"],durationMs:180000,albumId:null,artistId:null,albumTitle:null,coverUrl:null,versionLabel:"Original",reference:{provider:"deezer",id:"1"},references:[{provider:"deezer",id:"1"}]});
const intent=(id:string,liked=true,createdAt=1000):FavoriteIntent=>({track:track(id),liked,createdAt,operationId:randomUUID()});
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function fixture(){
 const disk=new Map<string,unknown>(),mirror=new Map<string,string>();let blockedDisk=false,blockedMirror=false,stamp=2000,transactionTail:Promise<void>=Promise.resolve();
 function transaction(){
  const ready=transactionTail;let complete:()=>void=()=>{},pending=0,generation=0;
  const done=new Promise<void>(resolve=>{complete=resolve;});transactionTail=done;
  const request=async<T>(action:()=>T):Promise<T>=>{pending++;generation++;try{await ready;if(blockedDisk)throw new Error("Storage unavailable");return action();}finally{pending--;const captured=generation;setImmediate(()=>{if(!pending&&captured===generation)complete();});}};
  const diskKey=(key:string)=>key.replace(/^account:/,"");
  return {done,store:{get:(key:string)=>request(()=>plain(disk.get(diskKey(key))??null)),put:(value:unknown,key:string)=>request(()=>disk.set(diskKey(key),plain(value))),delete:(key:string)=>request(()=>disk.delete(diskKey(key))),getAll:()=>request(()=>[...disk.values()].map(plain))}};
 }
 function tab(){
  const exports:Record<string,unknown>={};
  vm.runInNewContext(compiled,{exports,Date:{now:()=>stamp},localStorage:{get length(){return mirror.size;},key:(index:number)=>[...mirror.keys()][index]||null,getItem:(key:string)=>mirror.get(key)||null,setItem:(key:string,value:string)=>{if(blockedMirror)throw new Error("Storage unavailable");mirror.set(key,value);},removeItem:(key:string)=>{if(blockedMirror)throw new Error("Storage unavailable");mirror.delete(key);}},require:(name:string)=>name==="./sessionState"?{localId,portableTrack}:name==="./offline"?{
   offlineDatabase:async()=>{if(blockedDisk)throw new Error("Storage unavailable");return {transaction};},
   localRead:async(account:string,key:string)=>plain(disk.get(account+":"+key)??null),
   localWrite:async(account:string,key:string,value:unknown)=>{if(blockedDisk)throw new Error("Storage unavailable");disk.set(account+":"+key,plain(value));},
   localDelete:async(account:string,key:string)=>disk.delete(account+":"+key),
   localEntries:async(account:string,prefix:string)=>[...disk].filter(([key])=>key.startsWith(account+":"+prefix)).map(([key,value])=>({name:key.slice(account.length+1),value:plain(value)})),
  }:{}});
  return exports as unknown as {
   writeFavoriteDraft:(account:string,liked:string[],pending:Record<string,FavoriteIntent>,revisions?:Record<string,number>,serverSnapshot?:{likedIds?:Iterable<string>;revisions?:Record<string,number>;states?:Record<string,{liked:boolean;revision:number}>})=>Promise<void>;
   readFavoriteDraft:(account:string)=>Promise<FavoriteDraft|undefined>;
   acknowledgeFavoriteDraft:(account:string,operationId:string,confirmation?:FavoriteConfirmation)=>Promise<void>;
   createFavoriteIntent:(account:string,track:MusicTrack,liked:boolean,baseRevision?:number)=>FavoriteIntent;
  };
 }
 return {disk,mirror,tab,now(value:number){stamp=value;},failMirror(){blockedMirror=true;},failDisk(){blockedDisk=true;},fail(){blockedDisk=true;blockedMirror=true;}};
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

test("favorite baselines survive reopening and canonical recording migration unchanged",async()=>{
 const f=fixture(),a=f.tab(),choice=a.createFavoriteIntent("owner",track("external"),true,7);
 await a.writeFavoriteDraft("owner",["external"],{external:choice},{canonical:7});await a.writeFavoriteDraft("owner",["canonical"],{canonical:{...choice,track:track("canonical")}});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.pending.canonical.baseRevision,7);assert.equal(reopened?.pending.canonical.operationId,choice.operationId);assert.equal(reopened?.revisions?.canonical,7);
});

test("accepted conflict state is durable even when the page closes before a replacement full draft",async()=>{
 const f=fixture(),a=f.tab(),choice=a.createFavoriteIntent("owner",track("song"),true,0);await a.writeFavoriteDraft("owner",["song"],{song:choice});
 await a.acknowledgeFavoriteDraft("owner",choice.operationId,{recordingId:"song",liked:false,revision:2});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(Object.keys(reopened!.pending).length,0);assert.equal(reopened?.likedIds.includes("song"),false);assert.equal(reopened?.revisions?.song,2);
});

test("a stale tab cannot replace a confirmed unlike or decrease its cached revision",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),choice=a.createFavoriteIntent("owner",track("song"),true,1);await a.writeFavoriteDraft("owner",["song"],{song:choice},{song:1});
 await a.acknowledgeFavoriteDraft("owner",choice.operationId,{recordingId:"song",liked:false,revision:3});await b.writeFavoriteDraft("owner",["song"],{song:choice},{song:1});
 const reopened=await a.readFavoriteDraft("owner");assert.equal(reopened?.likedIds.includes("song"),false);assert.equal(reopened?.revisions?.song,3);assert.equal(Object.keys(reopened!.pending).length,0);
});

test("new local favorite choices remain ordered across equal timestamps and a clock rollback",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab(),first=a.createFavoriteIntent("owner",track("song"),true,0);await a.writeFavoriteDraft("owner",["song"],{song:first});
 f.now(10);const later=b.createFavoriteIntent("owner",track("song"),false,0);assert.ok(later.createdAt!>first.createdAt!);await b.writeFavoriteDraft("owner",[],{song:later});
 const reopened=await a.readFavoriteDraft("owner");assert.equal(reopened?.pending.song.operationId,later.operationId);assert.equal(reopened?.likedIds.includes("song"),false);
});

test("favorite revision merges reject malformed metadata and keep the newest account values",()=>{
 assert.deepEqual(mergeFavoriteRevisions({song:7,negative:-1,fractional:1.5},{song:2,another:0}),{song:7,another:0});
});

test("legacy pending favorites acquire a conservative baseline instead of bypassing conflict protection",async()=>{
 const f=fixture(),a=f.tab(),old=intent("song");await a.writeFavoriteDraft("owner",["song"],{song:old});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.pending.song.baseRevision,0);assert.equal(reopened?.pending.song.operationId,old.operationId);
});

for(const diskOnly of [false,true])for(const liked of [false,true])test(`a stale server snapshot preserves the newer ${liked?"like":"unlike"} and its paired revision${diskOnly?" with IndexedDB only":""}`,async()=>{
 const f=fixture();if(diskOnly)f.failMirror();const stale=f.tab(),current=f.tab();
 await current.writeFavoriteDraft("owner",liked?["song"]:[],{},{song:3});
 await stale.writeFavoriteDraft("owner",liked?[]:["song"],{},{song:1});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.revisions?.song,3);assert.equal(reopened?.likedIds.includes("song"),liked);
});

for(const diskOnly of [false,true])test(`a stale same-operation write cannot downgrade a rebased favorite baseline${diskOnly?" with IndexedDB only":""}`,async()=>{
 const f=fixture();if(diskOnly)f.failMirror();const stale=f.tab(),current=f.tab(),operation=stale.createFavoriteIntent("owner",track("song"),false,0);
 await stale.writeFavoriteDraft("owner",[],{song:operation});const old=plain(operation),rebased={...operation,baseRevision:1};
 await current.writeFavoriteDraft("owner",[],{song:rebased},{song:1});
 await stale.writeFavoriteDraft("owner",[],{song:old},{song:0});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.pending.song.operationId,operation.operationId);assert.equal(reopened?.pending.song.baseRevision,1);assert.equal(reopened?.pending.song.liked,false);
});

test("IndexedDB-only intent order survives a backward clock and stale operation rewrite",async()=>{
 const f=fixture();f.failMirror();f.now(1000);const stale=f.tab(),first=stale.createFavoriteIntent("owner",track("song"),true,0);
 await stale.writeFavoriteDraft("owner",["song"],{song:first});f.now(1);const current=f.tab(),later=current.createFavoriteIntent("owner",track("song"),false,0);
 await current.writeFavoriteDraft("owner",[],{song:later});assert.ok(later.createdAt!>first.createdAt!,"durable staging must normalize caller operation order before delivery");
 await stale.writeFavoriteDraft("owner",["song"],{song:first});const reopened=await f.tab().readFavoriteDraft("owner");
 assert.equal(reopened?.pending.song.operationId,later.operationId);assert.equal(reopened?.likedIds.includes("song"),false);
});

test("concurrent IndexedDB-only tabs reserve distinct durable favorite order",async()=>{
 const f=fixture();f.failMirror();f.now(1);const firstTab=f.tab(),secondTab=f.tab(),first=firstTab.createFavoriteIntent("owner",track("song"),true),second=secondTab.createFavoriteIntent("owner",track("song"),false);
 await Promise.all([firstTab.writeFavoriteDraft("owner",["song"],{song:first}),secondTab.writeFavoriteDraft("owner",[],{song:second})]);
 assert.ok(second.createdAt!>first.createdAt!,"transactions must serialize equal-clock operation reservations");const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.pending.song.operationId,second.operationId);assert.equal(reopened?.likedIds.includes("song"),false);
});

for(const diskOnly of [false,true])test(`acknowledging a newer song choice prevents an older operation from resurfacing${diskOnly?" with IndexedDB only":""}`,async()=>{
 const f=fixture();if(diskOnly)f.failMirror();const stale=f.tab(),current=f.tab(),first=stale.createFavoriteIntent("owner",track("song"),false,0);
 await stale.writeFavoriteDraft("owner",[],{song:first});const latest=current.createFavoriteIntent("owner",track("song"),true,0),unrelated=current.createFavoriteIntent("owner",track("other"),true,0);
 await current.writeFavoriteDraft("owner",["song","other"],{song:latest,other:unrelated});await current.acknowledgeFavoriteDraft("owner",latest.operationId,{recordingId:"song",liked:true,revision:1});
 await stale.writeFavoriteDraft("owner",[],{song:first},{song:0});const reopened=await f.tab().readFavoriteDraft("owner");
 assert.equal(reopened?.pending.song,undefined);assert.equal(reopened?.pending.other.operationId,unrelated.operationId);assert.equal(reopened?.likedIds.includes("song"),true);assert.equal(reopened?.likedIds.includes("other"),true);assert.equal(reopened?.revisions?.song,1);
});

test("an explicit server snapshot preserves confirmed favorites alongside optimistic local edits",async()=>{
 const f=fixture(),a=f.tab(),unrelated=a.createFavoriteIntent("owner",track("other"),true,0);
 await a.writeFavoriteDraft("owner",["other"],{other:unrelated},{song:4},{likedIds:["song"],revisions:{song:4}});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.likedIds.includes("song"),true);assert.equal(reopened?.revisions?.song,4);assert.equal(reopened?.likedIds.includes("other"),true);assert.equal(reopened?.pending.other.operationId,unrelated.operationId);
});

test("server page state pairs override mismatched liked rows without dropping local song choices",async()=>{
 const f=fixture(),a=f.tab(),unrelated=a.createFavoriteIntent("owner",track("other"),true,0);
 await a.writeFavoriteDraft("owner",["song","other"],{other:unrelated},{song:4},{states:{song:{liked:false,revision:4}}});
 const reopened=await f.tab().readFavoriteDraft("owner");assert.equal(reopened?.likedIds.includes("song"),false);assert.equal(reopened?.revisions?.song,4);assert.equal(reopened?.likedIds.includes("other"),true);assert.equal(reopened?.pending.other.operationId,unrelated.operationId);
});

for(const diskOnly of [false,true])test(`a newer canonical song acknowledgment suppresses its older external intent${diskOnly?" with IndexedDB only":""}`,async()=>{
 const f=fixture();if(diskOnly)f.failMirror();const stale=f.tab(),current=f.tab(),older=stale.createFavoriteIntent("owner",track("external"),false,0);
 await stale.writeFavoriteDraft("owner",[],{external:older});f.disk.set("owner:aliases",{"deezer::1":"canonical"});
 const latest=current.createFavoriteIntent("owner",track("canonical"),true,0),otherTrack={...track("other"),reference:{provider:"deezer" as const,id:"2"},references:[{provider:"deezer" as const,id:"2"}]},unrelated=current.createFavoriteIntent("owner",otherTrack,true,0);
 await current.writeFavoriteDraft("owner",["canonical","other"],{canonical:latest,other:unrelated});await current.acknowledgeFavoriteDraft("owner",latest.operationId,{recordingId:"canonical",liked:true,revision:1});
 await stale.writeFavoriteDraft("owner",[],{external:older},{canonical:0});const reopened=await f.tab().readFavoriteDraft("owner");
 assert.equal(reopened?.pending.external,undefined);assert.equal(reopened?.pending.canonical,undefined);assert.equal(reopened?.pending.other.operationId,unrelated.operationId);assert.equal(reopened?.likedIds.includes("canonical"),true);assert.equal(reopened?.likedIds.includes("other"),true);assert.equal(reopened?.revisions?.canonical,1);
});
