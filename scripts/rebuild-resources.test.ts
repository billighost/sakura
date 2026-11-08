import assert from "node:assert/strict";
import {test} from "node:test";
import {loadResource,resourceSnapshot,invalidateResources,clearResources,useResource} from "../src/rebuild/app/resources";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {responseIssue,userMessage,UserFacingError} from "../src/rebuild/app/errors";
import {settingsFields} from "../src/rebuild/app/preferences";
import {preferencesPatch,DEFAULT_SETTINGS} from "../src/rebuild/data/validation";

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
