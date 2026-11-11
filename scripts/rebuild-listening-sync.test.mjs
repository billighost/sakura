import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

import {setup} from './fixtures/listening-sync-test.mjs';
const state=(positionMs=0)=>({queue:[],currentEntryId:null,positionMs,sleepUntil:null});

test('total storage failure is reported once and cannot start an undurable session upload',async()=>{
 const f=setup({blockedMirror:true,blockedDisk:true});await f.sync.start();f.sync.change(state(23000));await assert.rejects(()=>f.sync.flush(),/Storage unavailable/);assert.equal(f.storageErrors.length,1);assert.equal(f.requests.filter(row=>row.init.method==='PUT').length,0);
 f.sync.change(state(24000));await assert.rejects(()=>f.sync.flush(),/Storage unavailable/);assert.equal(f.storageErrors.length,1);f.storageAvailable();f.sync.change(state(25000));await f.sync.flush();assert.equal(f.remote.state.positionMs,25000);f.sync.stop();
});

for(const options of [{blockedMirror:true},{blockedDisk:true}])test('one healthy storage path safely preserves a listening session '+JSON.stringify(options),async()=>{
 const f=setup(options);await f.sync.start();f.sync.change(state(23000));await f.sync.flush();assert.equal(f.remote.state.positionMs,23000);assert.equal(f.storageErrors.length,0);f.sync.stop();
});
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

test('a later passive GET checkpoint cannot overrule a newer deliberate choice',async()=>{
 const f=setup();f.remote={state:state(10),revision:1,deviceId:randomUUID(),updatedAt:1000,choiceAt:1000};await f.sync.start();
 f.now(2000);f.sync.change(state(70));f.remote={...f.remote,state:state(15),revision:2,updatedAt:4000};f.now(4500);await f.sync.refresh();
 assert.equal(f.remote.state.positionMs,70);assert.equal(f.restored.length,1);assert.ok(f.remote.choiceAt>1000&&f.remote.choiceAt<4000);f.sync.stop();
});

test('a passive checkpoint committed after an explicit PUT started does not reclaim ownership',async()=>{
 const f=setup();f.remote={state:state(10),revision:1,deviceId:randomUUID(),updatedAt:1000,choiceAt:1000};await f.sync.start();
 f.now(2000);f.sync.change(state(70));let resolve;f.holdPut(new Promise(done=>{resolve=done;}));const pending=f.sync.flush();
 f.remote={...f.remote,state:state(15),revision:2,updatedAt:4000};f.now(4500);resolve({accepted:false,session:f.remote});await pending;await f.sync.flush();
 assert.equal(f.remote.state.positionMs,70);assert.equal(f.restored.length,1);assert.equal(JSON.parse(f.requests.at(-1).init.body).explicit,true);f.sync.stop();
});

test('a newer remote deliberate choice still wins over an older local choice',async()=>{
 const f=setup();f.remote={state:state(10),revision:1,deviceId:randomUUID(),updatedAt:1000,choiceAt:1000};await f.sync.start();
 f.now(2000);f.sync.change(state(70));f.remote={...f.remote,state:state(90),revision:2,updatedAt:4000,choiceAt:3000};f.now(4500);await f.sync.flush();
 assert.equal(f.remote.state.positionMs,90);assert.equal(f.restored.at(-1).positionMs,90);f.sync.stop();
});

test('acknowledged playback progress never advances the server choice timestamp',async()=>{
 const f=setup();await f.sync.start();f.sync.change(state(10));await f.sync.flush();const choiceAt=f.remote.choiceAt;
 f.now(4000);f.sync.change(state(70),false);await f.sync.flush();
 assert.equal(f.remote.choiceAt,choiceAt);assert.ok(f.remote.updatedAt>choiceAt);assert.equal(JSON.parse(f.requests.at(-1).init.body).explicit,false);f.sync.stop();
});

test('an offline choice reopened under a new writer wins a later remote passive checkpoint',async()=>{
 const f=setup();f.remote={state:state(10),revision:1,deviceId:randomUUID(),updatedAt:1000,choiceAt:1000};await f.sync.start();
 f.now(2000);f.offline(true);f.sync.change(state(70));await assert.rejects(()=>f.sync.flush());f.sync.stop();
 f.remote={...f.remote,state:state(15),revision:2,updatedAt:4000};f.now(4500);f.offline(false);const next=f.newSync(randomUUID());await next.start();
 assert.equal(f.remote.state.positionMs,70);assert.equal(f.restored.at(-1).positionMs,70);assert.ok(f.remote.choiceAt<4000);next.stop();
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
