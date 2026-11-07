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
function setup(){
 const mirror=new Map(),disk=new Map(),restored=[],requests=[],timers=new Map();let remote=null,stamp=1000,offline=false,holdGet=null,nextTimer=0;
 const exports={};const localStorage={getItem:key=>mirror.get(key)||null,setItem:(key,value)=>mirror.set(key,value)};
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const transport=async(path,init={},options={})=>{
  requests.push({path,init,options});if(offline)throw new Error('offline');if(init.signal?.aborted)throw new DOMException('aborted','AbortError');
  if(!init.method){if(holdGet){const hold=holdGet;holdGet=null;return hold;}return {session:clone(remote)};}
  const sent=JSON.parse(init.body);if(sent.revision!==(remote?.revision||0))return {accepted:false,session:clone(remote)};
  remote={state:sent.state,revision:sent.revision+1,deviceId:sent.deviceId,updatedAt:++stamp};return {accepted:true,session:clone(remote)};
 };
 vm.runInNewContext(compiled,{exports,require:path=>path==='./offline'?{localRead:async(account)=>clone(disk.get(account)),localWrite:async(account,name,draft)=>disk.set(account,clone(draft))}:path==='./sessionState'?{localId:randomUUID}:{requestJson:transport},localStorage,crypto:{randomUUID},AbortController,DOMException,Date:{now:()=>++stamp},setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const sync=new exports.ListeningSync('account-a',randomUUID(),value=>restored.push(clone(value)));
 return {sync,mirror,disk,restored,requests,get remote(){return remote;},set remote(value){remote=value;},offline(value){offline=value;},hold(value){holdGet=value;},newSync(){return new exports.ListeningSync('account-a',randomUUID(),value=>restored.push(clone(value)));}};
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
