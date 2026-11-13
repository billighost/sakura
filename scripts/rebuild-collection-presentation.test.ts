import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import { DEFAULT_ROOM_PRESENTATION, mergeRoomPresentation, roomPresentation, storedRoomPresentation, reconcileRoomPresentation } from "../src/rebuild/app/collectionPresentation";
import { collectionRoom, collectionView } from "../src/rebuild/data/collectionViews";
import { ProductError } from "../src/rebuild/data/validation";

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function browserFixture(t:TestContext){
 const disk=new Map<string,string>(),originalStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),originalWindow=Object.getOwnPropertyDescriptor(globalThis,"window");let writes=0;
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>disk.get(key)||null,setItem:(key:string,value:string)=>{writes++;disk.set(key,value);}}});
 Object.defineProperty(globalThis,"window",{configurable:true,value:{dispatchEvent:()=>true}});
 t.after(()=>{if(originalStorage)Object.defineProperty(globalThis,"localStorage",originalStorage);else Reflect.deleteProperty(globalThis,"localStorage");if(originalWindow)Object.defineProperty(globalThis,"window",originalWindow);else Reflect.deleteProperty(globalThis,"window");});
 return {disk,get writes(){return writes;},key:(account:string)=>"sakura-collection-presentation:"+account+":liked"};
}

test("simultaneous room refreshes share one GET and unchanged receipts cause no writes",async t=>{
 const fixture=browserFixture(t),account="presentation-shared",key=fixture.key(account),preference={layout:"cards",sort:"artist",direction:"desc",updatedAt:"2026-11-12T12:00:00.000Z"};
 fixture.disk.set(key,JSON.stringify({...preference,savedAt:1,pending:false,serverUpdatedAt:preference.updatedAt}));
 let calls=0,release!:(response:Response)=>void;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Promise<Response>(resolve=>release=resolve);});
 const first=reconcileRoomPresentation(account,"liked"),second=reconcileRoomPresentation(account,"liked");await tick();assert.equal(calls,1);
 release(Response.json({preference}));await Promise.all([first,second]);assert.equal(fixture.writes,0);
});

test("an old presentation read cannot overwrite a local edit acknowledged while it waited",async t=>{
 const fixture=browserFixture(t),account="presentation-stale",key=fixture.key(account);
 fixture.disk.set(key,JSON.stringify({...DEFAULT_ROOM_PRESENTATION,savedAt:1,pending:false}));
 let release!:(response:Response)=>void;t.mock.method(globalThis,"fetch",async()=>new Promise<Response>(resolve=>release=resolve));
 const old=reconcileRoomPresentation(account,"liked");await tick();
 const acknowledged={layout:"compact",sort:"title",direction:"desc",savedAt:3,pending:false,serverUpdatedAt:"2026-11-12T13:00:00.000Z"};fixture.disk.set(key,JSON.stringify(acknowledged));
 release(Response.json({preference:{...DEFAULT_ROOM_PRESENTATION,updatedAt:"2026-11-12T12:00:00.000Z"}}));await old;
 assert.deepEqual(JSON.parse(fixture.disk.get(key)!),acknowledged);assert.equal(fixture.writes,0);
});

test("newer server presentation receipts reject older reads and one owner can leave a shared refresh",async t=>{
 const fixture=browserFixture(t),account="presentation-receipt",key=fixture.key(account),stored={layout:"cards",sort:"title",direction:"asc",savedAt:9,pending:false,serverUpdatedAt:"2026-11-12T14:00:00.000Z"};fixture.disk.set(key,JSON.stringify(stored));
 let release!:(response:Response)=>void,aborted=false;t.mock.method(globalThis,"fetch",async(_url:RequestInfo|URL,init?:RequestInit)=>{init?.signal?.addEventListener("abort",()=>{aborted=true;});return new Promise<Response>(resolve=>release=resolve);});
 const leaving=new AbortController(),first=reconcileRoomPresentation(account,"liked",leaving.signal),second=reconcileRoomPresentation(account,"liked");await tick();leaving.abort();await first;assert.equal(aborted,false);
 release(Response.json({preference:{...DEFAULT_ROOM_PRESENTATION,updatedAt:"2026-11-12T12:00:00.000Z"}}));await second;
 assert.deepEqual(JSON.parse(fixture.disk.get(key)!),stored);assert.equal(fixture.writes,0);
});

test("a later pending presentation edit drains after the old write instead of waiting for focus",async t=>{
 const fixture=browserFixture(t),account="presentation-write-drain",key=fixture.key(account);fixture.disk.set(key,JSON.stringify({...DEFAULT_ROOM_PRESENTATION,savedAt:1,pending:true}));
 const sent:Record<string,unknown>[]=[],releases:((response:Response)=>void)[]=[];
 t.mock.method(globalThis,"fetch",async(_url:RequestInfo|URL,init?:RequestInit)=>{assert.equal(init?.method,"PATCH");sent.push(JSON.parse(String(init?.body)));return new Promise<Response>(resolve=>releases.push(resolve));});
 const pending=reconcileRoomPresentation(account,"liked");await tick();
 fixture.disk.set(key,JSON.stringify({layout:"compact",sort:"title",direction:"desc",savedAt:2,pending:true}));
 releases[0](Response.json({preference:{...DEFAULT_ROOM_PRESENTATION,updatedAt:"2026-11-12T12:00:00.000Z"}}));await tick();assert.equal(sent.length,2);assert.equal(sent[1].layout,"compact");
 releases[1](Response.json({preference:{layout:"compact",sort:"title",direction:"desc",updatedAt:"2026-11-12T13:00:00.000Z"}}));await pending;
 const saved=JSON.parse(fixture.disk.get(key)!);assert.equal(saved.pending,false);assert.equal(saved.layout,"compact");assert.equal(saved.savedAt,2);
});

test("collection presentation accepts only complete known layout and sorting choices",()=>{
 assert.deepEqual(roomPresentation({layout:"cards",sort:"artist",direction:"desc"}),{layout:"cards",sort:"artist",direction:"desc"});
 for(const value of [null,{}, {layout:"tiles",sort:"artist",direction:"desc"},{layout:"list",sort:"random",direction:"asc"},{layout:"compact",sort:"title",direction:"backward"}])assert.equal(roomPresentation(value),null);
});

test("local presentation records reject damaged timestamps and preserve valid server receipts",()=>{
 assert.deepEqual(storedRoomPresentation({layout:"compact",sort:"duration",direction:"asc",savedAt:12,pending:false,serverUpdatedAt:"2026-11-09T10:00:00.000Z"}),{layout:"compact",sort:"duration",direction:"asc",savedAt:12,pending:false,serverUpdatedAt:"2026-11-09T10:00:00.000Z"});
 assert.equal(storedRoomPresentation({layout:"list",sort:"kept",direction:"asc",savedAt:-1,pending:false}),null);
 assert.equal(storedRoomPresentation({layout:"list",sort:"kept",direction:"asc",savedAt:1,pending:"yes"}),null);
});

test("partial control changes retain the other room choices",()=>{
 assert.deepEqual(mergeRoomPresentation(DEFAULT_ROOM_PRESENTATION,{layout:"cards"}),{layout:"cards",sort:"kept",direction:"asc"});
 assert.deepEqual(mergeRoomPresentation({layout:"cards",sort:"title",direction:"desc"},{sort:"added"}),{layout:"cards",sort:"added",direction:"desc"});
 assert.deepEqual(mergeRoomPresentation(DEFAULT_ROOM_PRESENTATION,{layout:"unknown" as "list"}),DEFAULT_ROOM_PRESENTATION);
});

test("server collection views validate bounded room identities and the same choices as the client",()=>{
 assert.equal(collectionRoom("playlist:42"),"playlist:42");
 assert.deepEqual(collectionView({layout:"cards",sort:"added",direction:"desc",room:"ignored"}),{layout:"cards",sort:"added",direction:"desc"});
 assert.throws(()=>collectionRoom(" "),(error:unknown)=>error instanceof ProductError&&error.status===400);
 assert.throws(()=>collectionRoom("x".repeat(181)),(error:unknown)=>error instanceof ProductError&&error.status===400);
 assert.throws(()=>collectionView({layout:"cards",sort:"shuffle",direction:"asc"}),(error:unknown)=>error instanceof ProductError&&error.status===400);
});
