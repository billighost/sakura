import assert from "node:assert/strict";
import {test} from "node:test";
import {DownloadGate} from "../src/rebuild/app/downloadGate";
import {verifiedAudio,validOfflineAudio,deliverListen,drainListen,type ListenChunk} from "../src/rebuild/app/offline";
import {createHash} from "node:crypto";
test("batch downloads have a bounded FIFO transfer count",async()=>{
 const gate=new DownloadGate(2),signal=new AbortController().signal;
 const releaseA=await gate.acquire(signal),releaseB=await gate.acquire(signal);let entered=false;const pending=gate.acquire(signal).then(release=>{entered=true;return release;});await Promise.resolve();assert.equal(entered,false);releaseA();const releaseC=await pending;assert.equal(entered,true);releaseA();releaseB();releaseC();
});
test("canceling a queued download removes it without blocking the next song",async()=>{
 const gate=new DownloadGate(1),release=await gate.acquire(new AbortController().signal),controller=new AbortController();const canceled=gate.acquire(controller.signal);controller.abort();await assert.rejects(canceled,{name:"AbortError"});const next=gate.acquire(new AbortController().signal);release();(await next)();
});

test("canceling a stalled audio transfer settles even if its source never finishes canceling",{timeout:1000},async()=>{
 const controller=new AbortController();let canceled=false;
 const response=new Response(new ReadableStream<Uint8Array>({cancel(){canceled=true;return new Promise<void>(()=>{});}}),{headers:{"Content-Type":"audio/wav"}});
 const pending=verifiedAudio(response,8,controller.signal,()=>assert.fail("Canceled audio must not publish progress"));
 controller.abort();await assert.rejects(pending,{name:"AbortError"});assert.equal(canceled,true);
});

test("audio validation saves only a complete matching recording",async()=>{
 const bytes=new Uint8Array([82,73,70,70,1,2,3,4]),sha=createHash("sha256").update(bytes).digest("hex");let progress=0;
 const response=()=>new Response(bytes,{headers:{"Content-Type":"audio/wav"}});
 const saved=await verifiedAudio(response(),bytes.length,new AbortController().signal,value=>{progress=value;},sha);
 assert.equal(saved.sha256,sha);assert.equal(saved.blob.size,bytes.length);assert.equal(progress,bytes.length);
 await assert.rejects(verifiedAudio(response(),bytes.length+1,new AbortController().signal,()=>{}),/complete song/);
 await assert.rejects(verifiedAudio(response(),bytes.length-1,new AbortController().signal,()=>{}),/file size changed/);
 await assert.rejects(verifiedAudio(response(),bytes.length,new AbortController().signal,()=>{},"0".repeat(64)),/verified recording/);
});

test("stalled audio times out, cancels its reader and leaves no complete artifact",{timeout:1000},async()=>{
 let canceled=false;const response=new Response(new ReadableStream<Uint8Array>({cancel(){canceled=true;}}),{headers:{"Content-Type":"audio/wav"}});
 await assert.rejects(verifiedAudio(response,8,new AbortController().signal,()=>{},undefined,5),/connection paused/);assert.equal(canceled,true);
});

test("saved downloads reject partial or non-audio artifacts before they appear ready",()=>{
 const blob=new Blob([new Uint8Array([1,2,3])],{type:"audio/wav"});const saved={track:{id:"recording-1"},blob,sizeBytes:3,sha256:"a".repeat(64),savedAt:Date.now()};
 assert.equal(validOfflineAudio(saved),true);assert.equal(validOfflineAudio({...saved,sizeBytes:4}),false);assert.equal(validOfflineAudio({...saved,sha256:"missing"}),false);assert.equal(validOfflineAudio({...saved,blob:new Blob(["error"],{type:"text/html"})}),false);assert.equal(validOfflineAudio(null),false);
});

async function withListenStorage(run:(values:Map<string,string>)=>Promise<void>){
 const originalStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),originalFetch=globalThis.fetch,values=new Map<string,string>();
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(name:string)=>values.get(name)??null,setItem:(name:string,value:string)=>values.set(name,value),removeItem:(name:string)=>values.delete(name),key:(index:number)=>[...values.keys()][index]??null,get length(){return values.size;}}});
 try{await run(values);}finally{globalThis.fetch=originalFetch;if(originalStorage)Object.defineProperty(globalThis,"localStorage",originalStorage);else Reflect.deleteProperty(globalThis,"localStorage");}
}
const listenChunk:ListenChunk={eventId:"listen-event",recordingId:"recording-1",sequence:0,msPlayed:1200,positionMs:1200,completed:false,context:"direct"};

test("unresponsive history upload has a deadline and keeps its account outbox",{timeout:1000},async()=>withListenStorage(async values=>{
 globalThis.fetch=async(_url,init)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new DOMException("Canceled","AbortError")),{once:true});});
 assert.equal(await deliverListen("account-a",listenChunk,5),false);assert.equal(values.size,1);assert.ok(values.has("sakura-v2-outbox:account-a:listen-event:0"));
}));

test("repeated listening uploads coalesce and remove the exact outbox only after acceptance",async()=>withListenStorage(async values=>{
 let requests=0,release:(response:Response)=>void=()=>{};
 globalThis.fetch=async(_url,init)=>{requests++;assert.equal(new Headers(init?.headers).get("X-Sakura-Account"),"account-a");return new Promise<Response>(resolve=>{release=resolve;});};
 const first=deliverListen("account-a",listenChunk),second=deliverListen("account-a",listenChunk);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests,1);assert.equal(values.size,1);
 release(new Response("{}",{status:200}));assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(values.size,0);
}));

test("failed history drain stops at one request and preserves the backlog for each account",async()=>withListenStorage(async values=>{
 for(const [account,sequence]of [["account-a",0],["account-a",1],["account-b",0]] as const)values.set(`sakura-v2-outbox:${account}:listen-event:${sequence}`,JSON.stringify({...listenChunk,sequence}));
 let requests=0;globalThis.fetch=async()=>{requests++;return new Response("{}",{status:503});};
 await drainListen("account-a");assert.equal(requests,1);assert.equal(values.size,3);
}));
