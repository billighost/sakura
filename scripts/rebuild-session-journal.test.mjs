import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setup} from './fixtures/listening-sync-test.mjs';

const state=(positionMs=0)=>({queue:[],currentEntryId:null,positionMs,sleepUntil:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function requested(f,count){for(let i=0;i<100;i++){if(f.requests.filter(row=>row.init.method==='PUT').length>=count)return;await tick();}assert.fail('The submitted save did not start');}
const cached=f=>JSON.parse(f.mirror.get('sakura-v2-listening:account-a'));

for(const storage of [{},{blockedMirror:true},{blockedDisk:true}])test('offline writers preserve the newer choice after a later stale checkpoint '+JSON.stringify(storage),async()=>{
 const f=setup(storage);await f.sync.start();f.sync.change(state(10));await f.sync.flush();const second=f.newSync(randomUUID());await second.start();
 f.offline(true);f.now(2000);second.change(state(70));await assert.rejects(()=>second.flush(),/offline/);
 f.now(3000);f.sync.change(state(15),false);await assert.rejects(()=>f.sync.flush(),/offline/);f.sync.stop();second.stop();
 const reopened=f.newSync(randomUUID());await reopened.start();assert.equal(f.restored.at(-1).positionMs,70);reopened.stop();
});

test('same-millisecond and backward clock choices retain deliberate local order',async()=>{
 const f=setup();await f.sync.start();f.offline(true);f.now(9000);f.sync.change(state(10));await assert.rejects(()=>f.sync.flush());
 f.now(9000);f.sync.change(state(20));await assert.rejects(()=>f.sync.flush());f.now(1000);f.sync.change(state(70));await assert.rejects(()=>f.sync.flush());f.sync.stop();
 const reopened=f.newSync(randomUUID());await reopened.start();assert.equal(f.restored.at(-1).positionMs,70);reopened.stop();
});

test('a new page can acknowledge a preserved choice without a stale journal resurrecting it',async()=>{
 const f=setup();await f.sync.start();f.offline(true);f.sync.change(state(70));await assert.rejects(()=>f.sync.flush());
 const stale=cached(f);f.sync.stop();f.offline(false);const resumed=f.newSync(randomUUID());await resumed.start();assert.equal(f.remote.state.positionMs,70);resumed.stop();
 f.mirror.set('sakura-v2-listening:'+ 'account-a',JSON.stringify(stale));f.mirror.set('sakura-v2-listening-choice:account-a:'+stale.choiceId,JSON.stringify(stale));f.disk.set('account-a:listening-choice:'+stale.choiceId,stale);f.disk.set('account-a',stale);
 f.offline(true);const reopened=f.newSync(randomUUID());await reopened.start();assert.equal(f.restored.at(-1).positionMs,70);assert.equal(reopened.draft.pending,false);reopened.stop();
});

test('an older in-flight accepted choice cannot retire a newer deliberate choice',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));let release;f.holdPut(new Promise(resolve=>{release=resolve;}));const saving=f.sync.flush();await requested(f,1);
 const sent=JSON.parse(f.requests.find(row=>row.init.method==='PUT').init.body);f.sync.change(state(70));
 f.remote={state:sent.state,revision:1,deviceId:f.deviceId,updatedAt:2000,choiceAt:1000};release({accepted:true,session:f.remote});await saving;f.offline(true);await assert.rejects(()=>f.sync.flush());assert.equal(cached(f).pending,true);assert.equal(cached(f).state.positionMs,70);f.sync.stop();
 const reopened=f.newSync(randomUUID());await reopened.start();assert.equal(f.restored.at(-1).positionMs,70);reopened.stop();
});

for(const [label,make] of [
 ['empty',()=>({})],
 ['string acceptance',(sent,writer)=>({accepted:'true',session:{state:sent.state,deviceId:writer,revision:1,updatedAt:1000}})],
 ['wrong writer',(sent)=>({accepted:true,session:{state:sent.state,deviceId:randomUUID(),revision:1,updatedAt:1000}})],
 ['wrong position',(sent,writer)=>({accepted:true,session:{state:state(900),deviceId:writer,revision:1,updatedAt:1000}})],
 ['unchanged revision',(sent,writer)=>({accepted:true,session:{state:sent.state,deviceId:writer,revision:0,updatedAt:1000}})],
 ['broken queue',(sent,writer)=>({accepted:true,session:{state:{...sent.state,queue:[null]},deviceId:writer,revision:1,updatedAt:1000}})],
])test('a '+label+' receipt preserves the exact pending save until a valid retry',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(70));let release;f.holdPut(new Promise(resolve=>{release=resolve;}));const saving=f.sync.flush();await requested(f,1);
 const first=f.requests.find(row=>row.init.method==='PUT').init.body;release(make(JSON.parse(first),f.deviceId));await assert.rejects(()=>saving,/session|receipt/);
 assert.equal(cached(f).pending,true);assert.equal(cached(f).state.positionMs,70);await f.sync.flush();assert.equal(f.remote.state.positionMs,70);assert.equal(cached(f).pending,false);assert.equal(f.requests.filter(row=>row.init.method==='PUT')[1].init.body,first);f.sync.stop();
});

test('superseded choice snapshots are compacted after the newer choice is durable',async()=>{
 const f=setup();await f.sync.start();f.offline(true);
 for(let position=1;position<=30;position++){f.sync.change(state(position));await assert.rejects(()=>f.sync.flush());}
 assert.equal([...f.disk.keys()].filter(key=>key.startsWith('account-a:listening-choice:')).length,1);
 assert.equal([...f.mirror.keys()].filter(key=>key.startsWith('sakura-v2-listening-choice:account-a:')).length,1);f.sync.stop();
});
