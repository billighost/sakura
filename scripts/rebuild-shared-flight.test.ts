import assert from "node:assert/strict";
import {test} from "node:test";
import {SharedFlight} from "../src/rebuild/app/sharedFlight";

test("playback leaving a shared resolution does not cancel an active download",async()=>{
 const flights=new SharedFlight<string>(),play=new AbortController(),download=new AbortController();let calls=0,providerSignal:AbortSignal|undefined,release:(value:string)=>void=()=>{};
 const work=(signal:AbortSignal)=>{calls++;providerSignal=signal;return new Promise<string>(resolve=>{release=resolve;});};
 const a=flights.run("account:recording",play.signal,work),b=flights.run("account:recording",download.signal,work);await Promise.resolve();play.abort();await assert.rejects(a,{name:"AbortError"});assert.equal(calls,1);assert.equal(providerSignal!.aborted,false);release("verified");assert.equal(await b,"verified");
});
test("all consumers leaving cancel the provider and retry uses a fresh operation",async()=>{
 const flights=new SharedFlight<string>(),controller=new AbortController();let signal:AbortSignal|undefined;
 const pending=flights.run("a",controller.signal,s=>{signal=s;return new Promise<string>((_,reject)=>s.addEventListener("abort",()=>reject(s.reason),{once:true}));});await Promise.resolve();controller.abort();await assert.rejects(pending,{name:"AbortError"});assert.equal(signal!.aborted,true);assert.equal(await flights.run("a",new AbortController().signal,async()=>"new"),"new");
});
test("account boundaries and failed resolution retries do not share stale work",async()=>{
 const flights=new SharedFlight<number>(),signal=new AbortController().signal;let calls=0;
 await assert.rejects(flights.run("account-a:song",signal,async()=>{calls++;throw new Error("provider failed");}));
 assert.deepEqual(await Promise.all([flights.run("account-a:song",signal,async()=>++calls),flights.run("account-b:song",signal,async()=>++calls)]),[2,3]);
});
test("switching accounts settles abandoned consumers even if a provider ignores abort",async()=>{
 const flights=new SharedFlight<string>();
 const pending=flights.run("account:song",new AbortController().signal,()=>new Promise<string>(()=>{}));
 flights.clear();await assert.rejects(pending,{name:"AbortError"});
});
