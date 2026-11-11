import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real coordinator with deterministic storage and transport, so
// request ordering and browser-close recovery can be tested without a server.
const compiled=ts.transpileModule(await readFile('src/rebuild/app/listeningSync.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const state=(positionMs=0)=>({queue:[],currentEntryId:null,positionMs,sleepUntil:null});
function setup(options={}){
 const mirror=new Map(),disk=new Map(),restored=[],requests=[],timers=new Map();let remote=null,stamp=1000,elapsed=0,serverTime=undefined,offline=false,holdGet=null,holdPut=null,nextTimer=0;
 const exports={};const localStorage={getItem:key=>mirror.get(key)||null,setItem:(key,value)=>mirror.set(key,value)};
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const transport=async(path,init={},options={})=>{
  requests.push({path,init,options});if(offline)throw new Error('offline');if(init.signal?.aborted)throw new DOMException('aborted','AbortError');
  if(!init.method){if(holdGet){const hold=holdGet;holdGet=null;return hold;}return {session:clone(remote),serverTime};}
  if(holdPut){const hold=holdPut;holdPut=null;return hold;}
  const sent=JSON.parse(init.body);if(sent.revision!==(remote?.revision||0))return {accepted:false,session:clone(remote),serverTime};
  remote={state:sent.state,revision:sent.revision+1,deviceId:sent.deviceId,updatedAt:serverTime??++stamp};return {accepted:true,session:clone(remote),serverTime};
 };
 vm.runInNewContext(compiled,{exports,require:path=>path==='./offline'?{localRead:async(account)=>clone(disk.get(account)),localWrite:async(account,name,draft)=>disk.set(account,clone(draft))}:path==='./sessionState'?{localId:randomUUID}:{requestJson:transport},localStorage,crypto:{randomUUID},AbortController,DOMException,Date:{now:()=>++stamp},performance:options.monotonic?{now:()=>elapsed}:undefined,setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const deviceId=randomUUID(),sync=new exports.ListeningSync('account-a',deviceId,value=>restored.push(clone(value)));
 return {sync,deviceId,mirror,disk,restored,requests,writerIdentity:exports.deviceIdentity,get remote(){return remote;},set remote(value){remote=value;},offline(value){offline=value;},now(value){stamp=value;},elapsed(value){elapsed=value;},serverTime(value){serverTime=value;},hold(value){holdGet=value;},holdPut(value){holdPut=value;},newSync(writerId=deviceId){return new exports.ListeningSync('account-a',writerId,value=>restored.push(clone(value)));}};
}
test('an old playing device yields to another device even with a recent position checkpoint',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));await f.sync.flush();const revision=f.remote.revision;
 f.remote={state:state(50),revision:revision+1,deviceId:randomUUID(),updatedAt:2000};f.sync.change(state(15),false);await f.sync.refresh();assert.equal(f.restored.at(-1).positionMs,50);assert.equal(f.remote.state.positionMs,50);f.sync.stop();
});
test('a newer explicit listening choice survives a stale in-flight GET',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));await f.sync.flush();let resolve;f.hold(new Promise(done=>{resolve=done;}));const pending=f.sync.refresh();f.sync.change(state(70));resolve({session:{...f.remote,state:state(5)}});await pending;assert.equal(f.remote.state.positionMs,70);assert.ok(!f.restored.some(value=>value.positionMs===5));f.sync.stop();
});
test('offline changes are synchronously mirrored and restored on the next visit',async()=>{
 const f=setup();await f.sync.start();f.offline(true);f.sync.change(state(1234));assert.equal(JSON.parse(f.mirror.get('sakura-v2-listening:account-a')).state.positionMs,1234);await assert.rejects(()=>f.sync.flush());f.sync.stop();const next=f.newSync();await next.start();assert.equal(f.restored.at(-1).positionMs,1234);f.offline(false);await next.refresh();assert.equal(f.remote.state.positionMs,1234);next.stop();
});
test('account teardown prevents an old request restoring account data',async()=>{
 const f=setup();await f.sync.start();let resolve;f.hold(new Promise(done=>{resolve=done;}));const pending=f.sync.refresh();f.sync.stop();resolve({session:{state:state(999),revision:10,deviceId:randomUUID(),updatedAt:2000}});await pending;assert.equal(f.restored.length,0);assert.equal(f.requests.at(-1).init.signal.aborted,true);
});
test('a second click during startup is saved rather than replaced by cache hydration',async()=>{
 const f=setup();f.disk.set('account-a',{state:state(3),revision:0,updatedAt:0,pending:false,savedAt:100});const pending=f.sync.start();f.sync.change(state(77));await pending;assert.equal(f.remote.state.positionMs,77);assert.ok(!f.restored.some(value=>value.positionMs===3));f.sync.stop();
});
test('passive checkpoints do not renew an older offline listening choice',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:2000};f.now(5000);f.sync.change(state(15),false);await f.sync.refresh();assert.equal(f.restored.at(-1).positionMs,50);assert.equal(f.remote.state.positionMs,50);f.sync.stop();
});
test('a stale explicit choice yields on a write conflict even when another checkpoint arrives',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));let resolve;f.holdPut(new Promise(done=>{resolve=done;}));const pending=f.sync.flush();f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:2000};f.now(5000);f.sync.change(state(15),false);resolve({accepted:false,session:f.remote});await pending;assert.equal(f.restored.at(-1).positionMs,50);assert.equal(f.remote.state.positionMs,50);f.sync.stop();
});
test('a newer deliberate choice retries its revision and wins an older remote write',async()=>{
 const f=setup();await f.sync.start();f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:2000};f.now(3000);f.sync.change(state(70));await f.sync.flush();await f.sync.flush();assert.equal(f.remote.state.positionMs,70);assert.ok(!f.restored.some(value=>value.positionMs===50));f.sync.stop();
});
test('malformed local listening cache is ignored without restoring broken queue entries',async()=>{
 const f=setup();f.mirror.set('sakura-v2-listening:account-a',JSON.stringify({state:{...state(),queue:[null]},revision:1,updatedAt:100,savedAt:100,pending:false}));await f.sync.start();assert.equal(f.restored.length,0);f.sync.stop();
});
test('a device clock far ahead does not reclaim a newer server listening session',async()=>{
 const f=setup();f.now(5000000);f.serverTime(1000);f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:900};await f.sync.start();f.sync.change(state(70));
 f.remote={state:state(90),revision:2,deviceId:randomUUID(),updatedAt:2000};f.serverTime(3000);f.now(5005000);f.sync.change(state(75),false);await f.sync.flush();
 assert.equal(f.remote.state.positionMs,90);assert.equal(f.restored.at(-1).positionMs,90);assert.ok(Number.isFinite(JSON.parse(f.mirror.get('sakura-v2-listening:account-a')).clockOffset));f.sync.stop();
});
test('a deliberate choice during first startup is calibrated before comparing remote time',async()=>{
 const f=setup();f.now(5000000);f.serverTime(1000);f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:900};const pending=f.sync.start();f.sync.change(state(70));await pending;assert.equal(f.remote.state.positionMs,70);assert.ok(!f.restored.some(value=>value.positionMs===50));f.sync.stop();
});
test('a clock jump after a cached offset is learned cannot revive an older offline intent',async()=>{
 const f=setup();f.serverTime(1000);f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:900};await f.sync.start();f.now(5000000);f.sync.change(state(70));
 f.now(5001600);f.remote={state:state(90),revision:2,deviceId:randomUUID(),updatedAt:2000};f.serverTime(3000);await f.sync.flush();assert.equal(f.remote.state.positionMs,90);assert.equal(f.restored.at(-1).positionMs,90);f.sync.stop();
});
test('live intent ordering uses monotonic elapsed time across a device clock jump',async()=>{
 const f=setup({monotonic:true});f.serverTime(1000);f.remote={state:state(50),revision:1,deviceId:randomUUID(),updatedAt:900};await f.sync.start();f.elapsed(400);f.now(5000000);f.sync.change(state(70));
 f.elapsed(2000);f.remote={state:state(90),revision:2,deviceId:randomUUID(),updatedAt:2000};f.serverTime(3000);await f.sync.flush();assert.equal(f.remote.state.positionMs,90);assert.equal(f.restored.at(-1).positionMs,90);f.sync.stop();
});


test('reconnect rebases this device\'s delayed checkpoint without restoring its older position',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10000));await f.sync.flush();
 f.remote={...f.remote,state:state(12000),revision:f.remote.revision+1,updatedAt:2000};
 f.now(4000);f.sync.change(state(45000),false);await f.sync.refresh();
 assert.equal(f.remote.state.positionMs,45000);assert.equal(f.restored.length,0);f.sync.stop();
});

test('a same-device write conflict preserves a checkpoint recorded while its PUT was in flight',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10000));await f.sync.flush();
 f.sync.change(state(15000),false);let resolve;f.holdPut(new Promise(done=>{resolve=done;}));const pending=f.sync.flush();
 f.sync.change(state(58000),false);f.remote={...f.remote,state:state(12000),revision:f.remote.revision+1,updatedAt:2000};
 resolve({accepted:false,session:f.remote});await pending;await f.sync.flush();
 assert.equal(f.remote.state.positionMs,58000);assert.equal(f.restored.length,0);f.sync.stop();
});

test('a resumed offline draft keeps its latest passive checkpoint over the same device\'s last server save',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10000));await f.sync.flush();
 f.offline(true);f.sync.change(state(74000),false);await assert.rejects(()=>f.sync.flush());f.sync.stop();
 f.remote={...f.remote,state:state(11000),revision:f.remote.revision+1,updatedAt:3000};f.offline(false);const next=f.newSync();await next.start();
 assert.equal(f.restored.at(-1).positionMs,74000);assert.equal(f.remote.state.positionMs,74000);assert.equal(f.restored.length,1);next.stop();
});

test('a clean startup can still restore this device\'s later server save',async()=>{
 const f=setup();f.remote={state:state(19000),deviceId:f.deviceId,revision:3,updatedAt:2000};await f.sync.start();
 assert.equal(f.restored.at(-1).positionMs,19000);assert.equal(f.requests.filter(row=>row.init.method==='PUT').length,0);f.sync.stop();
});

test('playback writers are stable within a page and independent across tabs even with cloned storage',()=>{
 const first=setup(),second=setup(),sharedDevice=randomUUID();
 first.mirror.set('sakura-v2-device',sharedDevice);second.mirror.set('sakura-v2-device',sharedDevice);
 assert.equal(first.writerIdentity(),first.writerIdentity());
 assert.notEqual(first.writerIdentity(),second.writerIdentity());
 assert.notEqual(first.writerIdentity(),sharedDevice);first.sync.stop();second.sync.stop();
});

test('an older browser tab yields to a newer song choice from another writer in the same browser',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10000));await f.sync.flush();
 const next=f.newSync(randomUUID());await next.start();f.now(2000);next.change(state(90000));await next.flush();
 f.sync.change(state(15000),false);await f.sync.refresh();
 assert.equal(f.remote.state.positionMs,90000);assert.equal(f.restored.at(-1).positionMs,90000);f.sync.stop();next.stop();
});

test('an older browser tab yields on a passive PUT conflict with a newer seek from another tab',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(90000));await f.sync.flush();
 const next=f.newSync(randomUUID());await next.start();f.now(2000);next.change(state(12000));await next.flush();
 f.sync.change(state(95000),false);await f.sync.flush();
 assert.equal(f.remote.state.positionMs,12000);assert.equal(f.restored.at(-1).positionMs,12000);f.sync.stop();next.stop();
});

test('a new page writer resumes an offline checkpoint without rewinding to its previous page save',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10000));await f.sync.flush();
 f.offline(true);f.sync.change(state(74000),false);await assert.rejects(()=>f.sync.flush());f.sync.stop();
 f.remote={...f.remote,state:state(11000),revision:f.remote.revision+1,updatedAt:3000};f.offline(false);
 const writerId=randomUUID(),next=f.newSync(writerId);await next.start();
 assert.equal(f.restored.at(-1).positionMs,74000);assert.equal(f.remote.state.positionMs,74000);assert.equal(f.remote.deviceId,writerId);
 assert.equal(JSON.parse(f.mirror.get('sakura-v2-listening:account-a')).deviceId,writerId);next.stop();
});
