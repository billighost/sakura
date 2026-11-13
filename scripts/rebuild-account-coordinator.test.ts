import assert from "node:assert/strict";
import {test} from "node:test";
import {AccountReadCoordinator} from "../src/rebuild/app/accountReadCoordinator";
const path="/api/v2/settings";
test("early and duplicate timer callbacks retain the fifteen-second boundary",async()=>{
 let now=0,calls=0;const coordinator=new AccountReadCoordinator("timer-owner",{now:()=>now,channel:null,locks:null,storage:null});
 try{await coordinator.read(path,async()=>++calls);assert.equal(coordinator.advancePeriodicBoundary(),false);now=14999;assert.equal(coordinator.advancePeriodicBoundary(),false);assert.equal(await coordinator.read(path,async()=>++calls),1);now=15000;assert.equal(coordinator.advancePeriodicBoundary(),true);assert.equal(await coordinator.read(path,async()=>++calls),2);assert.equal(coordinator.advancePeriodicBoundary(),false);}finally{coordinator.dispose();}
});
function fixture(){
 let stamp=1000;const storage=new Map<string,string>(),channels=new Set<{onmessage:((event:{data:unknown})=>void)|null;postMessage:(message:unknown)=>void;close:()=>void}>(),tails=new Map<string,Promise<unknown>>();
 const channel=()=>{const current={onmessage:null as ((event:{data:unknown})=>void)|null,postMessage(message:unknown){for(const receiver of channels)if(receiver!==current)queueMicrotask(()=>receiver.onmessage?.({data:structuredClone(message)}));},close(){channels.delete(current);}};channels.add(current);return current;};
 const locks={async request<T>(name:string,options:{signal:AbortSignal},callback:()=>Promise<T>){const previous=tails.get(name)||Promise.resolve();const operation=previous.catch(()=>{}).then(()=>{options.signal.throwIfAborted();return callback();});tails.set(name,operation);return operation;}};
 const tab=(owner="owner")=>new AccountReadCoordinator(owner,{now:()=>stamp,channel:channel() as never,locks,storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storage.set(key,value);}},wait:async()=>{await new Promise(resolve=>setImmediate(resolve));}});
 return {tab,advance(ms:number){stamp+=ms;},storage,channels};
}
test("three tabs share one passive read per 15-second freshness period",async()=>{
 const f=fixture(),tabs=[f.tab(),f.tab(),f.tab()];let calls=0;const loader=async()=>({revision:++calls});
 try{const results=await Promise.all(tabs.map(tab=>tab.read(path,loader)));assert.equal(calls,1);assert.deepEqual(results,[{revision:1},{revision:1},{revision:1}]);f.advance(14999);await Promise.all(tabs.map(tab=>tab.read(path,loader)));assert.equal(calls,1);f.advance(1);await Promise.all(tabs.map(tab=>tab.read(path,loader)));assert.equal(calls,2);}finally{tabs.forEach(tab=>tab.dispose());}
});
test("response latency does not postpone the next 15-second refresh",async()=>{
 const f=fixture(),tab=f.tab();let calls=0;try{await tab.read(path,async()=>{calls++;f.advance(1000);return calls;});f.advance(14000);assert.equal(await tab.read(path,async()=>++calls),2);}finally{tab.dispose();}
});
test("a delayed initial GET cannot suppress the first periodic refresh",async()=>{
 const f=fixture(),tab=f.tab();let calls=0;try{f.advance(2000);assert.equal(await tab.read(path,async()=>++calls),1);f.advance(13000);tab.requireFreshSince();assert.equal(await tab.read(path,async()=>++calls),2);f.advance(15000);tab.requireFreshSince();assert.equal(await tab.read(path,async()=>++calls),3);}finally{tab.dispose();}
});

test("periodic boundaries ignore early and duplicate timers without delaying the cadence",async()=>{
 const f=fixture(),tab=f.tab();let calls=0;
 try{f.advance(2000);await tab.read(path,async()=>++calls);f.advance(12999);assert.equal(tab.advancePeriodicBoundary(),false);assert.equal(await tab.read(path,async()=>++calls),1);f.advance(1);assert.equal(tab.advancePeriodicBoundary(),true);assert.equal(await tab.read(path,async()=>++calls),2);assert.equal(tab.advancePeriodicBoundary(),false);assert.equal(await tab.read(path,async()=>++calls),2);f.advance(15000);assert.equal(tab.advancePeriodicBoundary(),true);assert.equal(await tab.read(path,async()=>++calls),3);f.advance(-15000);assert.equal(tab.advancePeriodicBoundary(),true);assert.equal(await tab.read(path,async()=>++calls),4);}finally{tab.dispose();}
});
test("three delayed-start tabs share each periodic boundary without invalidating reads",async()=>{
 const f=fixture(),tabs=[f.tab(),f.tab(),f.tab()];let calls=0;const loader=async()=>({revision:++calls});try{f.advance(2000);await Promise.all(tabs.map(tab=>tab.read(path,loader)));assert.equal(calls,1);for(let period=0;period<2;period++){f.advance(period?15000:13000);for(const tab of tabs)tab.requireFreshSince();const results=await Promise.all(tabs.map(tab=>tab.read(path,loader)));assert.equal(calls,period+2);assert.deepEqual(results,Array(3).fill({revision:period+2}));}}finally{tabs.forEach(tab=>tab.dispose());}
});
test("a boundary reached during an initial flight shares one fresh replacement",async()=>{
 const f=fixture(),tabs=[f.tab(),f.tab(),f.tab()];let calls=0,release!:(value:{revision:number})=>void;const held=new Promise<{revision:number}>(resolve=>{release=resolve;}),loader=async()=>++calls===1?held:{revision:calls};
 try{f.advance(2000);const initial=tabs[0].read(path,loader);for(let i=0;i<10&&!calls;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);f.advance(13000);for(const tab of tabs)tab.requireFreshSince();const periodic=tabs.map(tab=>tab.read(path,loader));release({revision:1});const results=await Promise.all([initial,...periodic]);assert.equal(calls,2);assert.deepEqual(results,Array(4).fill({revision:2}));}finally{tabs.forEach(tab=>tab.dispose());}
});
test("per-read minimum request time is checked after waiting for a tab lock",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab();let calls=0;try{await a.read(path,async()=>++calls);f.advance(1000);assert.equal(await b.read(path,async()=>++calls,{minRequestedAt:2000}),2);assert.equal(calls,2);}finally{a.dispose();b.dispose();}
});
test("slow qualifying responses and clock rollback do not create retry loops",async()=>{
 const f=fixture(),tab=f.tab();let calls=0;try{assert.equal(await tab.read(path,async()=>{calls++;f.advance(20000);return calls;}),1);assert.equal(calls,1);tab.requireFreshSince();assert.equal(await tab.read(path,async()=>++calls),2);f.advance(-15000);tab.requireFreshSince();assert.equal(await tab.read(path,async()=>++calls),3);}finally{tab.dispose();}
});
test("mutations invalidate peer observations and simultaneous invalidations converge",async()=>{
 const f=fixture(),a=f.tab(),b=f.tab();let calls=0;try{await a.read(path,async()=>({revision:++calls}));await new Promise(resolve=>setImmediate(resolve));a.invalidate(path);b.invalidate(path);await new Promise(resolve=>setImmediate(resolve));const results=await Promise.all([a.read(path,async()=>({revision:++calls})),b.read(path,async()=>({revision:++calls}))]);assert.equal(calls,2);assert.deepEqual(results,[{revision:2},{revision:2}]);}finally{a.dispose();b.dispose();}
});
test("caller cancellation does not abort a shared read, but account disposal does",async()=>{
 const coordinator=new AccountReadCoordinator("owner",{channel:null,locks:null,storage:null}),first=new AbortController();let release!:(value:number)=>void,transport:AbortSignal|undefined;
 const loader=(signal:AbortSignal)=>{transport=signal;return new Promise<number>(resolve=>{release=resolve;});};
 const canceled=coordinator.read(path,loader,{signal:first.signal}),kept=coordinator.read(path,loader);first.abort();await assert.rejects(canceled);assert.equal(transport?.aborted,false);release(7);assert.equal(await kept,7);coordinator.invalidate(path);const running=coordinator.read(path,loader);coordinator.dispose();assert.equal(transport?.aborted,true);release(8);await assert.rejects(running);
 await assert.rejects(coordinator.read(path,loader));
});
test("leader closure and unavailable coordination fall back without caching failures",async()=>{
 const f=fixture(),a=f.tab();await a.read(path,async()=>1);a.dispose();const b=f.tab();let calls=0;try{assert.equal(await b.read(path,async()=>++calls),1);assert.equal(calls,1);b.invalidate(path);await assert.rejects(b.read(path,async()=>{calls++;throw new Error("service failed");}),/service failed/);assert.equal(calls,2);assert.equal(await b.read(path,async()=>++calls),3);}finally{b.dispose();}
});

test("a caller aborted synchronously by the loader settles without canceling peer work",async()=>{
 const coordinator=new AccountReadCoordinator("owner",{channel:null,locks:null,storage:null}),caller=new AbortController();let transport:AbortSignal|undefined;
 try{const canceled=coordinator.read(path,async signal=>{transport=signal;caller.abort();return 7;},{signal:caller.signal}),peer=coordinator.read(path,async()=>8);await assert.rejects(canceled,{name:"AbortError"});assert.equal(await peer,7);assert.equal(transport?.aborted,false);}finally{coordinator.dispose();}
});

test("account disposal during lock acquisition starts no transport",async()=>{
 let release!:()=>void,calls=0;const held=new Promise<void>(resolve=>{release=resolve;}),locks={async request<T>(_name:string,_options:{signal:AbortSignal},callback:()=>Promise<T>){return callback();}},coordinator=new AccountReadCoordinator("owner",{channel:null,locks,storage:null,wait:()=>held});
 const running=coordinator.read(path,async()=>++calls);coordinator.dispose();release();await assert.rejects(running,{name:"AbortError"});assert.equal(calls,0);
});
test("account channels and nonsynchronization requests cannot share state",async()=>{
 const f=fixture(),a=f.tab("a"),b=f.tab("b");let calls=0;try{await a.read(path,async()=>({owner:"a"}));assert.deepEqual(await b.read(path,async()=>({owner:"b"})),{owner:"b"});await a.read("/api/v2/bootstrap",async()=>++calls);await a.read("/api/v2/bootstrap",async()=>++calls);assert.equal(calls,2);}finally{a.dispose();b.dispose();}
});
