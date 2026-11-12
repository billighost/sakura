import assert from "node:assert/strict";
import {test} from "node:test";
import {loadResource,resourceSnapshot,invalidateResources,clearResources,useResource} from "../src/rebuild/app/resources";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {responseIssue,userMessage,UserFacingError} from "../src/rebuild/app/errors";
import {settingsFields} from "../src/rebuild/app/preferences";
import {preferencesPatch,DEFAULT_SETTINGS} from "../src/rebuild/data/validation";
import {canonicalResourcePath,durableCatalogResource,resourceIsFresh} from "../src/rebuild/app/resourcePolicy";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as react from "react";
import * as errors from "../src/rebuild/app/errors";
import * as policy from "../src/rebuild/app/resourcePolicy";

test("catalog identities outlive a time limit while evolving personal resources refresh",()=>{
 const stamp=1700000000000,monthLater=stamp+31*86400000;
 for(const path of ["/api/v2/artists/deezer%3A1","/api/v2/albums/album-1?cursor=2","/api/v2/recordings/recording-1","/api/v2/search?q=hana"])assert.equal(resourceIsFresh(path,stamp,monthLater),true,path);
 for(const path of ["/api/v2/home","/api/v2/feed?surface=discover","/api/v2/library","/api/v2/bloom/shelf"])assert.equal(resourceIsFresh(path,stamp,monthLater),false,path);
 assert.equal(durableCatalogResource("/api/v2/recordings/id/audio"),false);
 assert.equal(resourceIsFresh("/api/v2/artists/id",monthLater+60000,stamp),false,"A corrupt future timestamp is never fresh");
 assert.equal(canonicalResourcePath("/api/v2/search?kind=tracks&q=wind%20song"),canonicalResourcePath("/api/v2/search?q=wind+song&kind=tracks"));
});

test("equivalent catalog lookups share a flight and library edits do not refetch metadata",async t=>{
 const account="resource-catalog-once",path="/api/v2/search?q=wind%20song&kind=tracks";let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({tracks:["wind"]});});
 await Promise.all([loadResource(account,path),loadResource(account,"/api/v2/search?kind=tracks&q=wind+song")]);
 assert.equal(calls,1);invalidateResources(account);await loadResource(account,path);assert.equal(calls,1);
 assert.deepEqual(resourceSnapshot(account,"/api/v2/search?kind=tracks&q=wind%20song").data,{tracks:["wind"]});
 await loadResource(account,path,true);assert.equal(calls,2,"Explicit refresh still reaches the provider");clearResources(account);
});

test("offline navigation serves old personal data without a failed fetch and explains an unvisited page",async t=>{
 const account="resource-offline-cached",path="/api/v2/library",original=Object.getOwnPropertyDescriptor(globalThis,"navigator");let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({recordings:["saved song"]});});
 await loadResource(account,path);
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:false}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,"navigator",original);else Reflect.deleteProperty(globalThis,"navigator");clearResources(account);});
 t.mock.method(Date,"now",()=>2000000000000);
 await loadResource(account,path);assert.equal(calls,1);assert.deepEqual(resourceSnapshot(account,path).data,{recordings:["saved song"]});assert.equal(resourceSnapshot(account,path).error,null);
 await loadResource(account,"/api/v2/albums/not-visited");assert.equal(calls,1);assert.equal(resourceSnapshot(account,"/api/v2/albums/not-visited").error?.issue.kind,"offline");
});

test("an uncached room shows loading from its first paint, before effects fetch",()=>{
 function Room({account,path}:{account:string|null;path:string|null}){
  const state=useResource(account,path);
  return createElement("span",null,state.loading?"loading":"idle");
 }
 assert.equal(renderToStaticMarkup(createElement(Room,{account:"first-paint",path:"/api/v2/first-paint"})),"<span>loading</span>");
 assert.equal(renderToStaticMarkup(createElement(Room,{account:null,path:"/api/v2/first-paint"})),"<span>idle</span>");
 assert.equal(renderToStaticMarkup(createElement(Room,{account:"first-paint",path:null})),"<span>idle</span>");
});

test("invalidation discards a response already in flight and reads the new server state",async t=>{
 const account="resource-race",path="/api/v2/race";let calls=0,release!:(response:Response)=>void,started!:()=>void;
 const firstStarted=new Promise<void>(resolve=>started=resolve);
 t.mock.method(globalThis,"fetch",async()=>{calls++;if(calls===1){started();return new Promise<Response>(resolve=>release=resolve);}return Response.json({generation:"new"});});
 const flight=loadResource(account,path);await firstStarted;invalidateResources(account);release(Response.json({generation:"old"}));await flight;
 assert.equal(calls,2);assert.deepEqual(resourceSnapshot(account,path).data,{generation:"new"});
 await loadResource(account,path);assert.equal(calls,2,"A successful refreshed snapshot remains cached");clearResources(account);
});
test("several invalidations during one flight coalesce into one current response",async t=>{
 const account="resource-coalesce",path="/api/v2/coalesce";let calls=0,release!:(response:Response)=>void,started!:()=>void;
 const firstStarted=new Promise<void>(resolve=>started=resolve);
 t.mock.method(globalThis,"fetch",async()=>{calls++;if(calls===1){started();return new Promise<Response>(resolve=>release=resolve);}return Response.json({latest:true});});
 const flight=loadResource(account,path);await firstStarted;invalidateResources(account);invalidateResources(account);const forced=loadResource(account,path,true);
 release(Response.json({latest:false}));await Promise.all([flight,forced]);assert.equal(calls,2);assert.deepEqual(resourceSnapshot(account,path).data,{latest:true});clearResources(account);
});
test("expired recaps discard cached data and keep their own recovery issue",async t=>{
 const account="resource-expiry",path="/api/v2/bloom/weekly-fixture";let status=200;
 t.mock.method(globalThis,"fetch",async()=>Response.json(status===200?{chapters:["private cached story"]}:{error:"This Bloom window has closed"},{status}));
 await loadResource(account,path);status=410;await loadResource(account,path,true);
 const snapshot=resourceSnapshot(account,path);assert.equal(snapshot.data,undefined);assert.ok(snapshot.error instanceof UserFacingError);
 assert.match(snapshot.error.issue.title,/season has passed/);
 userMessage(new UserFacingError(responseIssue(503,null,"download")),"download");
 assert.match(resourceSnapshot(account,path).error!.issue.title,/season has passed/);clearResources(account);
});

test("unavailable and session responses stay authoritative when deleting their saved response fails",async t=>{
 const disk=new Map<string,unknown>(),markers=new Map<string,string>();
 let deletionGate:Promise<void>=Promise.resolve(),deletionStarted=()=>{};
 const exports={},context=vm.createContext({module:{exports},exports,Date,AbortController,DOMException,
  localStorage:{getItem:(key:string)=>markers.get(key)||null,setItem:(key:string,value:string)=>markers.set(key,value)},
  require(name:string){if(name==="react")return react;if(name==="./errors")return errors;if(name==="./resourcePolicy")return policy;if(name==="./offline")return {
   localRead:async(account:string,name:string)=>disk.get(account+":"+name),
   localWrite:async(account:string,name:string,value:unknown)=>{disk.set(account+":"+name,value);},
   localDelete:async()=>{deletionStarted();await deletionGate;throw new DOMException("Deletion denied","SecurityError");},
  };throw new Error("Unexpected fixture dependency: "+name);},
 });
 const code=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/resources.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInContext(code,context);
 const api=vm.runInContext("module.exports",context) as {loadResource:typeof loadResource;resourceSnapshot:typeof resourceSnapshot;clearResources:typeof clearResources};
 let status=200;t.mock.method(globalThis,"fetch",async()=>Response.json(status===200?{private:"saved story"}:{error:"Unavailable"},{status}));
 for(const terminalStatus of [404,410,401]){
  const account="resource-delete-failure-"+terminalStatus,path="/api/v2/bloom/story";
  status=200;await api.loadResource(account,path);
  let releaseDeletion!:()=>void;deletionGate=new Promise(resolve=>releaseDeletion=resolve);
  const started=new Promise<void>(resolve=>deletionStarted=resolve);
  status=terminalStatus;const pending=api.loadResource(account,path,true);await started;
  const revoked=api.resourceSnapshot(account,path);assert.equal(revoked.data,undefined);assert.equal(revoked.error?.status,terminalStatus);
  releaseDeletion();await assert.doesNotReject(pending);
  assert.ok(disk.has(account+":resource:"+path),"The simulated disk deletion failed");
  // A navigation after its in-memory entry was cleared still rejects the old
  // persisted response, even while the origin cannot supply a replacement.
  api.clearResources(account);status=503;await api.loadResource(account,path);
  assert.equal(api.resourceSnapshot(account,path).data,undefined,"Revoked saved data must not reappear after a transient origin failure");
  api.clearResources(account);
 }
});
test("clearing an account prevents a late response from repopulating its cache",async t=>{
 const account="resource-account-clear",path="/api/v2/private";let release!:(response:Response)=>void,started!:()=>void;
 const firstStarted=new Promise<void>(resolve=>started=resolve);
 t.mock.method(globalThis,"fetch",async()=>{started();return new Promise<Response>(resolve=>release=resolve);});
 const flight=loadResource(account,path);await firstStarted;clearResources(account);release(Response.json({private:true}));await flight;
 assert.equal(resourceSnapshot(account,path).data,undefined);assert.equal(resourceSnapshot(account,path).error,null);
});
test("server preference metadata is excluded while a dirty patch keeps only changed fields",()=>{
 const settings=settingsFields({...DEFAULT_SETTINGS,seedArtists:[],seedGenres:[],onboarded:true,revision:99,serverOnly:"private"});
 assert.doesNotThrow(()=>preferencesPatch(settings));assert.equal("revision" in settings,false);assert.equal("serverOnly" in settings,false);
 const dirty=settingsFields({theme:"dark",revision:99});assert.deepEqual(dirty,{theme:"dark"});assert.deepEqual(preferencesPatch(dirty),{theme:"dark"});
});

test("history erasure hides a cached Bloom immediately while retaining saved music",async t=>{
 const account="resource-history-erasure",story="/api/v2/bloom/yearly-2025",library="/api/v2/library";
 t.mock.method(globalThis,"fetch",async (input:RequestInfo|URL)=>Response.json(String(input).includes("bloom")?{chapters:["erased story"]}:{recordings:["saved song"]}));
 await Promise.all([loadResource(account,story),loadResource(account,library)]);
 invalidateResources(account,"/api/v2/",true);
 assert.equal(resourceSnapshot(account,story).data,undefined,"An erased story cannot remain on screen while refreshing");
 assert.deepEqual(resourceSnapshot(account,library).data,{recordings:["saved song"]});
 clearResources(account);
});

test("erasure ignores a pending old story response before accepting current history",async t=>{
 const account="resource-late-erased-story",path="/api/v2/bloom/monthly-2026-10";
 let release!:(response:Response)=>void,started!:()=>void,calls=0;
 const pending=new Promise<void>(resolve=>started=resolve);
 t.mock.method(globalThis,"fetch",async()=>{if(++calls===1){started();return new Promise<Response>(resolve=>release=resolve);}return Response.json({chapters:[],status:"empty"});});
 const flight=loadResource(account,path);await pending;invalidateResources(account,"/api/v2/",true);
 release(Response.json({chapters:["erased measurements"]}));await flight;
 assert.deepEqual(resourceSnapshot(account,path).data,{chapters:[],status:"empty"});
 clearResources(account);
});

test("another tab's erasure cannot be overwritten by an older response",async t=>{
 const account="resource-other-tab-erasure",path="/api/v2/bloom/yearly-2025",values=new Map<string,string>();
 const original=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,"localStorage",original);else Reflect.deleteProperty(globalThis,"localStorage");});
 let release!:(response:Response)=>void,started!:()=>void,calls=0;
 const pending=new Promise<void>(resolve=>started=resolve);
 t.mock.method(globalThis,"fetch",async()=>{if(++calls===1){started();return new Promise<Response>(resolve=>release=resolve);}return Response.json({chapters:[],status:"empty"});});
 const flight=loadResource(account,path);await pending;
 values.set("sakura-v2-listening-resource-erased:"+account,String(Date.now()));
 release(Response.json({chapters:["old private story"]}));await flight;
 assert.equal(calls,2);assert.deepEqual(resourceSnapshot(account,path).data,{chapters:[],status:"empty"});
 clearResources(account);
});
