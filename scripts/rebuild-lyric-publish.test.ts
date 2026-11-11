import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseLyricSubmission, publishLyrics, requestPublishChallenge, LyricPublishError } from "../src/rebuild/lyrics/publish";
import { solveLyricPublishChallenge, publishLyricSubmission } from "../src/rebuild/player/lyricPublish";
import { fetchLrcLibLyrics } from "../src/rebuild/lyrics/provider";
import { createLyricsResolver,LYRICS_WEEKLY_REFRESH_MS } from "../src/rebuild/lyrics/service";

const identity={title:"A Song",artist:"An Artist",album:"A Record",durationSeconds:180};
const workerCode=readFileSync(new URL("../public/lyric-publish-worker.js",import.meta.url),"utf8");
const factory=new Function("self",workerCode+";return {nonceHasher,meetsTarget};");
test("browser worker SHA-256 matches native hashes through decimal and block boundaries",()=>{
  const {nonceHasher}=factory({});
  for(const length of [1,32,55,56,64,200,256]){
    const prefix="x".repeat(length),hash=nonceHasher(prefix);
    for(const nonce of [0,9,10,999,1000,123456789,Number.MAX_SAFE_INTEGER-1]){
      const value=Array.from(hash(nonce) as Uint32Array).map(word=>word.toString(16).padStart(8,"0")).join("");
      assert.equal(value,createHash("sha256").update(prefix+nonce).digest("hex"),`${length}/${nonce}`);
    }
  }
});
test("worker solves inclusive targets with decimal nonces and rejects malformed challenges",()=>{
  const messages:Record<string,unknown>[]=[],scope={onmessage:undefined as undefined|((event:{data:unknown})=>void),postMessage:(value:Record<string,unknown>)=>messages.push(value)};
  factory(scope);scope.onmessage!({data:{prefix:"test",target:"f".repeat(64)}});
  assert.equal(messages.at(-1)?.token,"test:0");
  scope.onmessage!({data:{prefix:"test",target:"invalid"}});assert.equal(messages.at(-1)?.reason,"invalid-challenge");
  const {meetsTarget}=factory({});assert.equal(meetsTarget(new Uint32Array([1,0]),new Uint32Array([1,0])),true);assert.equal(meetsTarget(new Uint32Array([2]),new Uint32Array([1])),false);
});
test("publication validates verified metadata and LRC before any upstream request",async()=>{
  let calls=0;
  await assert.rejects(()=>publishLyrics({...identity,durationSeconds:NaN},{text:"words",format:"plain"},{fetch:async()=>{calls++;return Response.json({});}}),error=>error instanceof LyricPublishError&&error.reason==="lyrics-publish-metadata");
  assert.equal(calls,0);
  assert.throws(()=>parseLyricSubmission({text:"[00:61]words",format:"lrc"},identity));
  assert.throws(()=>parseLyricSubmission({text:"[03:05]words",format:"lrc"},identity));
});
test("plain publication preserves contributor text and stanza spacing exactly",()=>{
  const text="\nFirst line\n\nSecond line\r\nLast line\n";
  assert.equal(parseLyricSubmission({text,format:"plain"},identity).plainLyrics,text);
});
test("prepared browser token avoids expensive server proof and returns verified indexed lyrics",async()=>{
  const calls:string[]=[],payloads:unknown[]=[],headers:Headers[]=[];
  const result=await publishLyrics(identity,{format:"lrc",text:"[00:01.00]words",publishToken:"prefix:123"},{fetch:async(url,options)=>{
    calls.push(String(url));headers.push(new Headers(options?.headers));if(options?.body)payloads.push(JSON.parse(String(options.body)));
    return String(url).includes("/publish")?new Response(null,{status:201}):Response.json({id:3,trackName:identity.title,artistName:identity.artist,albumName:identity.album,duration:180,plainLyrics:"words",syncedLyrics:"[00:01.00]words"});
  }});
  assert.equal(result.published,true);assert.equal(result.track?.id,3);assert.equal(calls.length,2);
  assert.equal(calls.some(url=>url.includes("request-challenge")),false);assert.equal(headers[0].get("X-Publish-Token"),"prefix:123");
  assert.deepEqual(payloads,[{trackName:"A Song",artistName:"An Artist",albumName:"A Record",duration:180,syncedLyrics:"[00:01.00]words",plainLyrics:"words"}]);
});
test("successful publication remains accepted when indexing is rate limited and does not retry lookup",async()=>{
  let calls=0;
  const result=await publishLyrics(identity,{format:"plain",text:"words",publishToken:"prefix:1"},{fetch:async()=>++calls===1?new Response(null,{status:201}):Response.json({name:"RateLimitExceeded"},{status:429,headers:{"Retry-After":"60"}})});
  assert.equal(result.published,true);assert.equal(result.track,undefined);assert.equal(calls,2);
});
test("publication readback finds submitted lyrics when title search precedes signature indexing",async()=>{
  const candidate={id:33,trackName:identity.title,artistName:identity.artist,albumName:identity.album,duration:180,plainLyrics:"words"},calls:string[]=[];
  const result=await publishLyrics(identity,{format:"plain",text:"words",publishToken:"prefix:1"},{fetch:async url=>{
    calls.push(String(url));return String(url).endsWith("publish")?new Response(null,{status:201}):String(url).includes("/get?")?new Response(null,{status:404}):Response.json([{...candidate,id:1,artistName:"Another Artist"},candidate]);
  }});
  assert.equal(result.published,true);assert.equal(result.track?.id,33);assert.equal(calls.length,3);
});
test("early title search still rejects another artist or recording edition",async()=>{
  const original={id:33,trackName:identity.title,artistName:identity.artist,albumName:identity.album,duration:180,plainLyrics:"words"};let titleRead=false;
  const result=await fetchLrcLibLyrics({...identity,artists:[identity.artist,"Featured Artist"]},{fetch:async url=>{
    const query=new URL(String(url)).searchParams;
    if(query.get("q")===identity.title){titleRead=true;return Response.json([{...original,id:1,artistName:"Someone Else"},{...original,id:2,trackName:identity.title+" (Live)"},original]);}
    return String(url).includes("/get?")?new Response(null,{status:404}):Response.json([]);
  }});
  assert.equal(titleRead,true);assert.equal(result.status,"matched");if(result.status==="matched")assert.equal(result.track.id,33);
});
test("server lyric cache keeps synced words reusable and checks plain words weekly",async()=>{
  let now=0,syncedCalls=0,plainCalls=0;
  const track={id:3,trackName:identity.title,artistName:identity.artist,albumName:identity.album,duration:180,plainLyrics:"words"};
  const synced=createLyricsResolver({now:()=>now,load:async()=>{syncedCalls++;return {status:"matched",provider:"lrclib",track:{...track,syncedLyrics:"[00:01.00]words"}};}});
  const plain=createLyricsResolver({now:()=>now,load:async()=>{plainCalls++;return {status:"matched",provider:"lrclib",track};}});
  await synced(identity);await plain(identity);now=LYRICS_WEEKLY_REFRESH_MS-1;await plain(identity);assert.equal(plainCalls,1);
  now=LYRICS_WEEKLY_REFRESH_MS;await plain(identity);assert.equal(plainCalls,2);now=365*24*60*60*1000;await synced(identity);assert.equal(syncedCalls,1);
  await synced(identity,true);assert.equal(syncedCalls,2);
});
test("explicit server retry bypasses a weekly missing result immediately",async()=>{
  let calls=0;const resolver=createLyricsResolver({load:async()=>{calls++;return {status:"missing",reason:"No lyrics"};}});
  await resolver(identity);await resolver(identity);assert.equal(calls,1);await resolver(identity,true);assert.equal(calls,2);
});
test("malformed, expired, rejected and throttled publish replies never claim success",async()=>{
  await assert.rejects(()=>requestPublishChallenge({fetch:async()=>Response.json({prefix:null,target:"f".repeat(64)})}),error=>error instanceof LyricPublishError&&error.reason==="lyrics-publish-invalid-challenge");
  for(const fixture of [{status:400,name:"IncorrectPublishTokenError",reason:"lyrics-publish-token"},{status:400,name:"ValidationError",reason:"lyrics-publish-rejected"},{status:429,name:"RateLimitExceeded",reason:"lyrics-publish-rate-limit"}]){
    let calls=0;await assert.rejects(()=>publishLyrics(identity,{format:"plain",text:"words",publishToken:"prefix:1"},{fetch:async()=>{calls++;return Response.json({name:fixture.name},{status:fixture.status,headers:{"Retry-After":"45"}});}}),error=>error instanceof LyricPublishError&&error.reason===fixture.reason&&(fixture.status!==429||error.retryAfterMs===45000));assert.equal(calls,1);
  }
});
test("browser challenge cancellation terminates the worker and never submits lyrics",async()=>{
  const original=globalThis.Worker,oldFetch=globalThis.fetch;let terminated=false,publishCalls=0;
  class StubWorker {onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;postMessage(){}terminate(){terminated=true;}}
  Object.defineProperty(globalThis,"Worker",{value:StubWorker,configurable:true,writable:true});
  globalThis.fetch=async url=>{if(String(url).endsWith("/publish"))publishCalls++;return Response.json({prefix:"prefix",target:"f".repeat(64),expiresAt:Date.now()+50000});};
  try{const controller=new AbortController(),work=publishLyricSubmission("recording","words","plain",{accountId:"owner",signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort(new DOMException("Canceled","AbortError"));await assert.rejects(()=>work);assert.equal(terminated,true);assert.equal(publishCalls,0);}finally{globalThis.fetch=oldFetch;Object.defineProperty(globalThis,"Worker",{value:original,configurable:true,writable:true});}
});
test("missing browser workers and expired challenges preserve drafts without publication",async()=>{
  const original=globalThis.Worker;Object.defineProperty(globalThis,"Worker",{value:undefined,configurable:true,writable:true});
  try{await assert.rejects(()=>solveLyricPublishChallenge({prefix:"prefix",target:"f".repeat(64),expiresAt:Date.now()+10000},new AbortController().signal),/draft is kept/);await assert.rejects(()=>solveLyricPublishChallenge({prefix:"prefix",target:"f".repeat(64),expiresAt:Date.now()-1},new AbortController().signal));}finally{Object.defineProperty(globalThis,"Worker",{value:original,configurable:true,writable:true});}
});
