import assert from "node:assert/strict";
import {test,type TestContext} from "node:test";
import {CachedCatalogProvider,DeezerCatalogProvider,SpotifyCatalogProvider} from "../src/rebuild/server/providers";
import {SharedPublicMetadataCache} from "../src/rebuild/server/redisCache";

const reference={provider:"deezer" as const,id:"123"},isrc="USAT21601045",spotifyId="0123456789ABCDEFGHIJKL";
const wire=(value:unknown)=>JSON.parse(JSON.stringify(value));
function fixture(t:TestContext){
 const runtime=globalThis as typeof globalThis&{sakuraSharedPublicRedis?:SharedPublicMetadataCache},previous=runtime.sakuraSharedPublicRedis;
 const rows=new Map<string,string>(),calls={get:0,set:0,provider:0,token:0};let missing=false;
 runtime.sakuraSharedPublicRedis=new SharedPublicMetadataCache({transport:{async get(key){calls.get++;return rows.get(key);},async set(key,value){calls.set++;rows.set(key,value);}}});
 t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));if(url.hostname==="accounts.spotify.com"){calls.token++;return Response.json({access_token:"private-fixture-token",expires_in:3600});}
  calls.provider++;if(missing)return new Response(null,{status:404});
  return Response.json(url.hostname==="api.deezer.com"?{id:123,title:"Song",duration:180,isrc,artist:{id:42,name:"Artist"},album:{id:24,title:"Album"},contributors:[{id:42,name:"Artist",role:"Main"}],preview:"https://example.test/unused-audio"}:
   {id:spotifyId,name:"Song",duration_ms:180000,external_ids:{isrc},artists:[{id:"ABCDEFGHIJKL0123456789",name:"Artist"}],album:{id:"1234567890ABCDEFGHIJKL",name:"Album",images:[]},preview_url:"https://example.test/unused-audio"});
 });
 t.after(()=>{runtime.sakuraSharedPublicRedis=previous;});
 return{rows,calls,setMissing:(value:boolean)=>{missing=value;}};
}

test("validated exact and ISRC projections cross instances while warm L1 has zero Redis work",async t=>{
 const f=fixture(t),first=new CachedCatalogProvider(new DeezerCatalogProvider());
 const exact=await first.getExact(reference);const second=new CachedCatalogProvider(new DeezerCatalogProvider());
 assert.deepEqual(wire(await second.getExact(reference)),wire(exact));assert.equal(f.calls.provider,1);
 const afterShared={...f.calls};const caller=await second.getExact(reference);caller!.metadata.title="Changed";await second.getExact(reference);
 assert.deepEqual(f.calls,afterShared);assert.equal((await second.getExact(reference))?.metadata.title,"Song");
 const byIsrc=await first.getByIsrc(isrc),reads=f.calls.provider;
 const third=new CachedCatalogProvider(new DeezerCatalogProvider());assert.deepEqual(wire(await third.getByIsrc(isrc)),wire(byIsrc));assert.equal(f.calls.provider,reads);
 const afterIsrc={...f.calls};await third.getByIsrc(isrc);assert.deepEqual(f.calls,afterIsrc);
 assert.ok([...f.rows.values()].every(value=>!value.includes("unused-audio")&&!value.includes("private-fixture-token")&&!value.includes("preview")));
 const canceled=new AbortController();canceled.abort();await assert.rejects(third.getExact(reference,canceled.signal),{name:"AbortError"});await assert.rejects(third.getByIsrc(isrc,canceled.signal),{name:"AbortError"});assert.deepEqual(f.calls,afterIsrc);
});

test("shared Spotify exact projection avoids authorization on a fresh server instance",async t=>{
 const f=fixture(t),ref={provider:"spotify" as const,id:spotifyId};
 const first=await new CachedCatalogProvider(new SpotifyCatalogProvider("fixture-client","fixture-secret")).getExact(ref);
 assert.deepEqual(wire(await new CachedCatalogProvider(new SpotifyCatalogProvider("","")).getExact(ref)),wire(first));
 assert.equal(f.calls.token,1);assert.equal(f.calls.provider,1);
 assert.ok([...f.rows.values()].every(value=>!value.includes("fixture-secret")&&!value.includes("private-fixture-token")));
});

test("wrong exact IDs and malformed or mismatched ISRC proof fall back to exact upstream validation",async t=>{
 const f=fixture(t);await new CachedCatalogProvider(new DeezerCatalogProvider()).getExact(reference);
 for(const [key,raw] of f.rows){const saved=JSON.parse(raw);saved.value.record.reference.id="456";saved.value.record.references[0].id="456";f.rows.set(key,JSON.stringify(saved));}
 assert.equal((await new CachedCatalogProvider(new DeezerCatalogProvider()).getExact(reference))?.reference.id,"123");assert.equal(f.calls.provider,2);
 const first=new CachedCatalogProvider(new DeezerCatalogProvider());await first.getByIsrc(isrc);const before=f.calls.provider;
 for(const [key,raw] of f.rows){const saved=JSON.parse(raw);if(saved.value.records){saved.value.records[0].references=[reference];f.rows.set(key,JSON.stringify(saved));}}
 assert.equal((await new CachedCatalogProvider(new DeezerCatalogProvider()).getByIsrc(isrc)).length,1);assert.equal(f.calls.provider,before+2);
 for(const [key,raw] of f.rows){const saved=JSON.parse(raw);if(saved.value.record){saved.value.record.artistCredits=[{name:"Artist",role:"untrusted"}];f.rows.set(key,JSON.stringify(saved));}}
 const beforeMalformed=f.calls.provider;await new CachedCatalogProvider(new DeezerCatalogProvider()).getExact(reference);assert.equal(f.calls.provider,beforeMalformed+1);
});

test("missing recordings are not persisted or retained as negative ISRC entries",async t=>{
 const f=fixture(t);f.setMissing(true);const first=new CachedCatalogProvider(new DeezerCatalogProvider());
 assert.equal(await first.getExact(reference),null);assert.equal(await first.getExact(reference),null);
 assert.deepEqual(await first.getByIsrc(isrc),[]);assert.deepEqual(await first.getByIsrc(isrc),[]);assert.equal(f.calls.provider,4);assert.equal(f.rows.size,0);
 f.setMissing(false);assert.ok(await new CachedCatalogProvider(new DeezerCatalogProvider()).getExact(reference));assert.equal(f.calls.provider,5);
});

test("injected exact catalog transports bypass the shared Redis cache",async t=>{
 const f=fixture(t),provider=new CachedCatalogProvider(new DeezerCatalogProvider((async()=>Response.json({id:123,title:"Song",duration:180,artist:{id:42,name:"Artist"},album:{id:24,title:"Album"}})) as typeof fetch));
 assert.ok(await provider.getExact(reference));assert.equal(f.calls.get,0);assert.equal(f.calls.set,0);
});
