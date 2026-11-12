import assert from "node:assert/strict";
import {test} from "node:test";
import {ProviderFlight} from "../src/rebuild/server/provider-flight";
import {DeezerCatalogService} from "../src/rebuild/server/catalog";
import {CachedCatalogProvider,SpotifyCatalogProvider} from "../src/rebuild/server/providers";
import {MusicCollectionImporter} from "../src/rebuild/server/import";
import {RecordingIngestor,type SqlTransaction} from "../src/rebuild/server/ingestion";
import type {CatalogProvider,CatalogRecording} from "../src/rebuild/server/contracts";
import {SharedPublicMetadataCache} from "../src/rebuild/server/redisCache";

function deferred<T>(){
  let resolve!:(value:T|PromiseLike<T>)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
const reference={provider:"deezer" as const,id:"123"};
const recording:CatalogRecording={reference,references:[reference],metadata:{title:"Song",artists:["Artist"],durationMs:180000}};
const transaction:SqlTransaction=async operation=>operation(async<Row>()=>[] as Row[]);
const ingestor=new RecordingIngestor(transaction,[]);
const runtime=globalThis as typeof globalThis&{sakuraSharedPublicRedis?:SharedPublicMetadataCache};

test("provider consumers share cold reads and cancel independently",async()=>{
  const flights=new ProviderFlight<string>(),release=deferred<string>(),started=deferred<void>();
  const foreground=new AbortController(),prefetch=new AbortController();let calls=0,upstream:AbortSignal|undefined;
  const work=async(signal:AbortSignal)=>{calls++;upstream=signal;started.resolve();return release.promise;};
  const first=flights.run("metadata",prefetch.signal,work),second=flights.run("metadata",foreground.signal,work);
  await started.promise;prefetch.abort();await assert.rejects(first,{name:"AbortError"});
  assert.equal(calls,1);assert.equal(upstream!.aborted,false);
  release.resolve("complete");assert.equal(await second,"complete");
});

test("abandoned reads leave immediately and cannot replace a fresh request",async()=>{
  const flights=new ProviderFlight<string>(),release=deferred<string>(),started=deferred<void>(),controller=new AbortController();
  let abandoned:AbortSignal|undefined;
  const first=flights.run("metadata",controller.signal,async signal=>{abandoned=signal;started.resolve();return release.promise;});
  await started.promise;controller.abort();await assert.rejects(first,{name:"AbortError"});assert.equal(abandoned!.aborted,true);
  assert.equal(await flights.run("metadata",undefined,async()=>"new"),"new");
  release.resolve("old");await release.promise;
  assert.equal(await flights.run("metadata",undefined,async()=>"later"),"later");
});

test("a full flight registry preserves active reads and bounds overflow sharing",async()=>{
  const flights=new ProviderFlight<number>(1),hold=deferred<number>();let shared=0,overflow=0;
  const a=flights.run("a",undefined,async()=>{shared++;return hold.promise;});
  const b=flights.run("b",undefined,async()=>++overflow),anotherB=flights.run("b",undefined,async()=>++overflow);
  const anotherA=flights.run("a",undefined,async()=>{shared++;return -1;});
  assert.deepEqual(await Promise.all([b,anotherB]),[1,2]);hold.resolve(7);
  assert.deepEqual(await Promise.all([a,anotherA]),[7,7]);assert.equal(shared,1);
});

test("public metadata crosses server instances through Redis while warm L1 bypasses it",async context=>{
  const previous=runtime.sakuraSharedPublicRedis,stored=new Map<string,string>();let cacheGets=0,providerReads=0,tokens=0;
  runtime.sakuraSharedPublicRedis=new SharedPublicMetadataCache({transport:{
    async get(key){cacheGets++;return stored.get(key);},async set(key,value){stored.set(key,value);},
  }});
  context.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.hostname==="accounts.spotify.com"){tokens++;return Response.json({access_token:"fixture-token",expires_in:3600});}
    providerReads++;
    return Response.json(url.hostname==="api.deezer.com"?{id:24,title:"Album",preview:"https://example.invalid/unused-audio",tracks:{data:[]}}:{id:"0123456789ABCDEFGHIJKL",name:"Artist",preview_url:"https://example.invalid/unused-audio"});
  });
  try{
    await new DeezerCatalogService().detail("album","24");
    const anotherDeezer=new DeezerCatalogService();assert.equal((await anotherDeezer.detail("album","24")).title,"Album");
    const afterSharedHit=cacheGets;await anotherDeezer.detail("album","24");assert.equal(cacheGets,afterSharedHit);
    const path="/artists/0123456789ABCDEFGHIJKL";await new SpotifyCatalogProvider("fixture-id","fixture-secret").getMetadata(path);
    const anotherSpotify=new SpotifyCatalogProvider("","");assert.equal((await anotherSpotify.getMetadata(path) as {name:string}).name,"Artist");
    const afterSpotifyHit=cacheGets;await anotherSpotify.getMetadata(path);assert.equal(cacheGets,afterSpotifyHit);
    assert.equal(providerReads,2);assert.equal(tokens,1);assert.equal(stored.size,2);
    assert.ok([...stored.values()].every(value=>!value.includes("unused-audio")&&!value.includes("fixture-token")));
  }finally{runtime.sakuraSharedPublicRedis=previous;}
});

test("a slow shared cache falls back once then preserves warm provider reads",async context=>{
  const previous=runtime.sakuraSharedPublicRedis;let cacheGets=0,providerReads=0;
  runtime.sakuraSharedPublicRedis=new SharedPublicMetadataCache({timeoutMs:10,transport:{
    async get(){cacheGets++;return new Promise(()=>{});},async set(){throw new Error("The open circuit must skip this write");},
  }});
  context.mock.method(globalThis,"fetch",async()=>{providerReads++;return Response.json({id:24,title:"Album",tracks:{data:[]}});});
  try{
    const first=new DeezerCatalogService();assert.equal((await first.detail("album","24")).title,"Album");
    await first.detail("album","24");assert.equal(providerReads,1);assert.equal(cacheGets,1);
    await new DeezerCatalogService().detail("album","24");assert.equal(providerReads,2);assert.equal(cacheGets,1);
  }finally{runtime.sakuraSharedPublicRedis=previous;}
});

test("injected provider fixtures bypass a configured Redis cache",async()=>{
  const previous=runtime.sakuraSharedPublicRedis;let cacheCalls=0;
  runtime.sakuraSharedPublicRedis=new SharedPublicMetadataCache({transport:{
    async get(){cacheCalls++;return undefined;},async set(){cacheCalls++;},
  }});
  try{
    await new DeezerCatalogService((async()=>Response.json({id:24,title:"Album",tracks:{data:[]}})) as typeof fetch).detail("album","24");
    await new SpotifyCatalogProvider("fixture-id","fixture-secret",(async input=>Response.json(new URL(String(input)).hostname==="accounts.spotify.com"?{access_token:"fixture-token",expires_in:3600}:{name:"Artist"})) as typeof fetch).getMetadata("/artists/0123456789ABCDEFGHIJKL");
    assert.equal(cacheCalls,0);
  }finally{runtime.sakuraSharedPublicRedis=previous;}
});

test("Deezer artist metadata, top tracks and albums start together",{timeout:3000},async()=>{
  const started=deferred<void>(),release=deferred<void>(),paths:string[]=[];
  const catalog=new DeezerCatalogService((async input=>{
    const path=new URL(String(input)).pathname;paths.push(path);if(paths.length===3)started.resolve();await release.promise;
    if(path.endsWith("/top"))return Response.json({data:[{id:123,title:"Song",duration:180,artist:{id:42,name:"Artist"},album:{id:24,title:"Album"}}]});
    if(path.endsWith("/albums"))return Response.json({data:[{id:24,title:"Album"}]});
    return Response.json({id:42,name:"Artist"});
  }) as typeof fetch);
  const pending=catalog.detail("artist","42");await started.promise;
  assert.deepEqual(paths.sort(),["/artist/42","/artist/42/albums","/artist/42/top"]);release.resolve();
  const result=await pending;assert.equal(result.tracks.length,1);assert.equal(result.albums.length,1);
});

test("Deezer read sharing, clone isolation, TTL and cancellation apply before cache lookup",async context=>{
  let now=1000,calls=0;context.mock.method(Date,"now",()=>now);
  const started=deferred<void>(),release=deferred<void>(),cancel=new AbortController();let upstream:AbortSignal|undefined;
  const catalog=new DeezerCatalogService((async(_input,init)=>{
    calls++;upstream=init?.signal??undefined;if(calls===1){started.resolve();await release.promise;}
    return Response.json({id:24,title:"Album",tracks:{data:[]}});
  }) as typeof fetch);
  const first=catalog.detail("album","24",cancel.signal),second=catalog.detail("album","24");
  await started.promise;cancel.abort();await assert.rejects(first,{name:"AbortError"});assert.equal(upstream!.aborted,false);release.resolve();
  const result=await second;result.title="Changed by caller";
  assert.equal((await catalog.detail("album","24")).title,"Album");assert.equal(calls,1);
  await assert.rejects(catalog.detail("album","24",cancel.signal),{name:"AbortError"});assert.equal(calls,1);
  now+=5*60*1000+1;await catalog.detail("album","24");assert.equal(calls,2);
});

test("Spotify cold metadata shares a token and rejects one canceled consumer locally",{timeout:3000},async()=>{
  const tokenStarted=deferred<void>(),releaseToken=deferred<void>();let tokens=0,reads=0,tokenSignal:AbortSignal|undefined;
  const cancel=new AbortController();
  const provider=new SpotifyCatalogProvider("fixture-id","fixture-secret",(async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="accounts.spotify.com"){tokens++;tokenSignal=init?.signal??undefined;tokenStarted.resolve();await releaseToken.promise;return Response.json({access_token:"fixture-token",expires_in:3600});}
    reads++;return Response.json({id:url.pathname.split("/").at(-1),name:"Artist"});
  }) as typeof fetch);
  const path="/artists/0123456789ABCDEFGHIJKL";
  const first=provider.getMetadata(path,cancel.signal),second=provider.getMetadata(path),third=provider.getMetadata("/artists/ABCDEFGHIJKL0123456789");
  await tokenStarted.promise;cancel.abort();await assert.rejects(first,{name:"AbortError"});assert.equal(tokenSignal!.aborted,false);releaseToken.resolve();
  const [a,b]=await Promise.all([second,third]);assert.equal(tokens,1);assert.equal(reads,2);
  (a as {name:string}).name="Caller change";
  assert.equal((await provider.getMetadata(path) as {name:string}).name,"Artist");assert.ok(b);
  assert.equal(tokens,1);assert.equal(reads,2);
});

test("exact catalog cache evicts failed reads, clones results, and refreshes expired metadata",async context=>{
  let now=1000,calls=0;context.mock.method(Date,"now",()=>now);
  const upstream:CatalogProvider={provider:"deezer",async getExact(){calls++;if(calls===1)throw new Error("provider failed");return structuredClone(recording);}};
  const cached=new CachedCatalogProvider(upstream,50,2);
  await assert.rejects(cached.getExact(reference),/provider failed/);
  const [a,b]=await Promise.all([cached.getExact(reference),cached.getExact(reference)]);assert.equal(calls,2);
  a!.metadata.title="Caller change";assert.equal(b!.metadata.title,"Song");assert.equal((await cached.getExact(reference))!.metadata.title,"Song");
  now+=51;await cached.getExact(reference);assert.equal(calls,3);
});

test("abandoned exact catalog work cannot publish a late cache entry",async()=>{
  const started=deferred<void>(),release=deferred<void>(),cancel=new AbortController();let calls=0;
  const cached=new CachedCatalogProvider({provider:"deezer",async getExact(){calls++;if(calls===1){started.resolve();await release.promise;}return structuredClone(recording);}});
  const first=cached.getExact(reference,cancel.signal);await started.promise;cancel.abort();await assert.rejects(first,{name:"AbortError"});
  release.resolve();await new Promise<void>(resolve=>setImmediate(resolve));
  await cached.getExact(reference);assert.equal(calls,2);
});

test("abandoned Spotify authorization cannot fill the token or metadata cache",async()=>{
  const started=deferred<void>(),release=deferred<void>(),cancel=new AbortController();let tokens=0;
  const provider=new SpotifyCatalogProvider("fixture-id","fixture-secret",(async input=>{
    if(new URL(String(input)).hostname==="accounts.spotify.com"){
      tokens++;if(tokens===1){started.resolve();await release.promise;}
      return Response.json({access_token:"fixture-token",expires_in:3600});
    }
    return Response.json({id:"0123456789ABCDEFGHIJKL",name:"Artist"});
  }) as typeof fetch);
  const path="/artists/0123456789ABCDEFGHIJKL",pending=provider.getMetadata(path,cancel.signal);
  await started.promise;cancel.abort();await assert.rejects(pending,{name:"AbortError"});
  release.resolve();await new Promise<void>(resolve=>setImmediate(resolve));await provider.getMetadata(path);assert.equal(tokens,2);
});

test("identical cold import previews share public metadata and isolate caller results",async()=>{
  const started=deferred<void>(),release=deferred<void>();let calls=0;
  const importer=new MusicCollectionImporter(new DeezerCatalogService(),ingestor,transaction,{},(async()=>{
    calls++;started.resolve();await release.promise;return Response.json({title:"Playlist",tracks:{data:[]}});
  }) as typeof fetch);
  const first=importer.preview("https://deezer.com/playlist/123"),second=importer.preview("https://www.deezer.com/playlist/123?tracking=ignored");
  await started.promise;release.resolve();const [a,b]=await Promise.all([first,second]);assert.equal(calls,1);
  a.name="Caller change";assert.equal(b.name,"Playlist");assert.equal((await importer.preview("https://deezer.com/playlist/123")).name,"Playlist");
});

test("different Spotify import previews share one reusable authorization request",async()=>{
  let tokens=0,reads=0;
  const importer=new MusicCollectionImporter(new DeezerCatalogService(),ingestor,transaction,{spotifyClientId:"fixture-id",spotifyClientSecret:"fixture-secret"},(async input=>{
    if(new URL(String(input)).hostname==="accounts.spotify.com"){tokens++;return Response.json({access_token:"fixture-token",expires_in:3600});}
    reads++;return Response.json({name:"Playlist",tracks:{items:[],total:0}});
  }) as typeof fetch);
  await Promise.all([importer.preview("https://open.spotify.com/playlist/0123456789ABCDEFGHIJKL"),importer.preview("https://open.spotify.com/playlist/ABCDEFGHIJKL0123456789")]);
  await importer.preview("https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL");assert.equal(tokens,1);assert.equal(reads,3);
});

test("an abandoned import preview cannot publish stale metadata after cancellation",async()=>{
  const started=deferred<void>(),release=deferred<void>(),cancel=new AbortController();let calls=0;
  const importer=new MusicCollectionImporter(new DeezerCatalogService(),ingestor,transaction,{},(async()=>{
    calls++;if(calls===1){started.resolve();await release.promise;}
    return Response.json({title:"Playlist",tracks:{data:[]}});
  }) as typeof fetch);
  const pending=importer.preview("https://deezer.com/playlist/123",cancel.signal);
  await started.promise;cancel.abort();await assert.rejects(pending,{name:"AbortError"});release.resolve();
  await new Promise<void>(resolve=>setImmediate(resolve));await importer.preview("https://deezer.com/playlist/123");assert.equal(calls,2);
});

test("YouTube matching uses four bounded track searches while retaining playlist order",{timeout:3000},async()=>{
  const fourStarted=deferred<void>(),release=deferred<void>();let active=0,maximum=0,calls=0;
  const catalog={async search(query:string,signal:AbortSignal|undefined,page:{kind?:string}){
    assert.equal(page.kind,"tracks");assert.ok(signal);active++;maximum=Math.max(maximum,active);calls++;
    if(calls===4)fourStarted.resolve();await release.promise;active--;
    const title=query.slice("Artist ".length);
    return {tracks:[{...recording,reference:{provider:"deezer",id:String(Number(title.slice(5))+1)},metadata:{...recording.metadata,title}}]};
  }} as unknown as DeezerCatalogService;
  const importer=new MusicCollectionImporter(catalog,ingestor,transaction,{youtubeApiKey:"fixture-key"},(async input=>{
    const url=new URL(String(input));
    return Response.json(url.pathname.endsWith("/playlists")?{items:[{snippet:{title:"Playlist"}}]}:{items:Array.from({length:9},(_,index)=>({snippet:{title:`Artist - Song ${index}`,videoOwnerChannelTitle:"Artist"}}))});
  }) as typeof fetch);
  const pending=importer.preview("https://youtube.com/playlist?list=PL1234567890123456");await fourStarted.promise;
  assert.equal(calls,4);release.resolve();const preview=await pending;
  assert.equal(maximum,4);assert.equal(calls,9);assert.deepEqual(preview.items.map(item=>item.title),Array.from({length:9},(_,index)=>`Song ${index}`));
  assert.ok(preview.items.every(item=>item.status==="review"),"Unknown video durations still require review before exact recording ingestion");
});
