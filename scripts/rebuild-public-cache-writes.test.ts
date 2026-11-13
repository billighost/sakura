import assert from "node:assert/strict";
import {test,type TestContext} from "node:test";
import {SharedPublicMetadataCache,setSharedPublicCache,withPublicCacheWrites,publicCachePendingWrites} from "../src/rebuild/server/redisCache";

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
function fixture(t:TestContext,hold?:Promise<void>){
 const runtime=globalThis as typeof globalThis&{sakuraSharedPublicRedis?:SharedPublicMetadataCache},previous=runtime.sakuraSharedPublicRedis;
 const writes:unknown[]=[],flushes:(()=>Promise<void>)[]=[];let active=0,maximum=0;
 runtime.sakuraSharedPublicRedis=new SharedPublicMetadataCache({timeoutMs:250,transport:{async get(){return null;},async set(_key,raw){active++;maximum=Math.max(maximum,active);try{if(hold)await hold;writes.push(JSON.parse(raw).value);}finally{active--;}}}});
 t.after(()=>{runtime.sakuraSharedPublicRedis=previous;assert.deepEqual(publicCachePendingWrites(),{count:0,bytes:0});});
 return{writes,flushes,schedule:(flush:()=>Promise<void>)=>{flushes.push(flush);},maximum:()=>maximum};
}

test("public SET cannot gate a scoped response; deferred writes coalesce immutable snapshots",async t=>{
 const gate=deferred(),f=fixture(t,gate.promise),value={title:"Original"};
 assert.equal(await withPublicCacheWrites(f.schedule,async()=>{
  await setSharedPublicCache("provider_deezer","same",value,300);value.title="Updated";
  await setSharedPublicCache("provider_deezer","same",value,300);value.title="Caller edit";
  await setSharedPublicCache("reading_transform","other",{text:"Reading"},300);return"useful response";
 }),"useful response");
 assert.equal(f.writes.length,0);assert.equal(f.flushes.length,1);assert.equal(publicCachePendingWrites().count,2);
 const flushing=f.flushes[0]();await Promise.resolve();gate.resolve();await flushing;
 assert.deepEqual(f.writes,[{title:"Updated"},{text:"Reading"}]);assert.equal(f.maximum(),2);
});

test("deferred public writes enforce per request and global count and byte bounds",async t=>{
 const f=fixture(t);
 for(let request=0;request<5;request++)await withPublicCacheWrites(f.schedule,async()=>{
  for(let item=0;item<40;item++)await setSharedPublicCache("provider_deezer",`${request}:${item}`,{title:"Song"},300);
 });
 assert.equal(publicCachePendingWrites().count,128);assert.equal(f.flushes.length,4);
 for(const flush of f.flushes.splice(0))await flush();assert.equal(f.writes.length,128);
 for(let request=0;request<6;request++)await withPublicCacheWrites(f.schedule,async()=>{
  for(let item=0;item<20;item++)await setSharedPublicCache("provider_deezer",`large:${request}:${item}`,{text:"x".repeat(128*1024)},300);
 });
 assert.ok(publicCachePendingWrites().bytes<=8*1024*1024);assert.ok(publicCachePendingWrites().count<120);
 assert.ok(publicCachePendingWrites().count>0);
 for(const flush of f.flushes)await flush();
});

test("private, cyclic, oversized and invalid public writes never occupy the deferred queue",async t=>{
 const f=fixture(t),cyclic:Record<string,unknown>={};cyclic.self=cyclic;
 await withPublicCacheWrites(f.schedule,async()=>{
  for(const value of [{accountId:"private"},{preview:"https://example.test/audio"},{url:"https://example.test/?sig=private"},cyclic,{text:"x".repeat(300*1024)}])await setSharedPublicCache("provider_deezer","invalid",value,300);
  await setSharedPublicCache("provider_deezer","invalid",{},0);
 });
 assert.equal(f.flushes.length,0);assert.equal(f.writes.length,0);
});

test("standalone writes, failed lifecycle registration and closed originating flights stay awaited",async t=>{
 const gate=deferred(),f=fixture(t,gate.promise);let completed=false;
 const first=setSharedPublicCache("provider_deezer","standalone",{title:"Song"},300).then(()=>{completed=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(completed,false);gate.resolve();await first;
 await withPublicCacheWrites(()=>{throw new Error("No request lifetime");},()=>setSharedPublicCache("provider_deezer","fallback",{title:"Fallback"},300));
 assert.equal(f.writes.length,2);
 const lateGate=deferred();let late!:Promise<void>;
 await withPublicCacheWrites(f.schedule,async()=>{late=lateGate.promise.then(()=>setSharedPublicCache("provider_deezer","late",{title:"Late"},300));});
 lateGate.resolve();await late;assert.equal(f.flushes.length,0);assert.equal(f.writes.length,3);
});

test("a failed response still leaves an owned lifecycle flush",async t=>{
 const f=fixture(t),failure=new Error("Response failed");
 await assert.rejects(withPublicCacheWrites(f.schedule,async()=>{await setSharedPublicCache("provider_deezer","verified",{title:"Song"},300);throw failure;}),error=>error===failure);
 assert.equal(f.flushes.length,1);await f.flushes[0]();assert.equal(f.writes.length,1);
});
