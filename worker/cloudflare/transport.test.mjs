import test from 'node:test';
import assert from 'node:assert/strict';
import { socketClass } from './src/socket.mjs';
import { Ownership, DRAIN_MS } from './src/ownership.mjs';
import { authorized, signature, audioHeaders, tagOf } from './src/http.mjs';
import { DurableSession } from './src/session.mjs';
import authKeys from '../node_modules/telegram/crypto/AuthKey.js';
import workerPerformance from '../rebuild/performance.cjs';

const storage = () => {
 const rows = new Map(); let tail = Promise.resolve();
 const store = { get: async k => structuredClone(rows.get(k)), put: async (k,v) => rows.set(k, structuredClone(v)) };
 store.transaction = fn => { const work = tail.then(() => fn(store)); tail = work.catch(() => {}); return work; }; return store;
};
test('optional numeric telemetry retains every ownership fence before packet writes', async () => {
 const metrics=workerPerformance.createWorkerPerformance(true),store=storage();let now=1000;
 const owner=new Ownership(store,'old',()=>now,metrics);await owner.claim();
 const written=[];
 const Socket=socketClass(()=>({opened:Promise.resolve(),closed:Promise.resolve(),readable:new ReadableStream(),writable:new WritableStream({write(bytes){written.push([...bytes]);}}),close:async()=>{}}),()=>owner.fence(),new Set(),metrics);
 const socket=new Socket();await socket.connect(80,'fixture');await socket.write(Uint8Array.of(1,2));
 const replacement=new Ownership(store,'new',()=>now);await replacement.claim();
 await assert.rejects(socket.write(Uint8Array.of(3)),/retired/);await socket.writes;
 const result=metrics.snapshot();assert.deepEqual(written,[[1,2]]);assert.equal(result.counters.packet_bytes,2);assert.equal(result.stages.storage_fence.count,3);assert.equal(result.stages.socket_write.count,1);
 assert.ok(!JSON.stringify(result).includes('fixture'));
});
test('replacement fences all old writes and waits for in-flight Telegram packets to drain', async () => {
 const store=storage(); let now=1000;
 const old=new Ownership(store,'old',()=>now); await old.claim(); await old.fence();
 const next=new Ownership(store,'next',()=>now); const ready=await next.claim(); assert.equal(ready,now+DRAIN_MS);
 await assert.rejects(old.fence(),/retired/); await assert.rejects(next.fence(),/draining/);
 now=ready; await next.fence(); await assert.rejects(old.fence(),/retired/);
});
test('concurrent transport opening, fragmented reads, ordered writes, and stale-owner cancellation', async () => {
 let opens=0, live=true; const written=[];
 const open=()=>{opens++;return {opened:Promise.resolve(),closed:Promise.resolve(),readable:new ReadableStream({start(c){c.enqueue(Uint8Array.of(1,2));c.enqueue(Uint8Array.of(3));c.close();}}),writable:new WritableStream({write(bytes){written.push([...bytes]);}}),close:async()=>{}};};
 const Socket=socketClass(open,async()=>{if(!live)throw new Error('retired');}); const socket=new Socket();
 await Promise.all(Array.from({length:40},()=>socket.connect(80,'fixture'))); assert.equal(opens,1);
 assert.deepEqual([...await socket.readExactly(3)],[1,2,3]);
 await Promise.all([socket.write(Uint8Array.of(4)),socket.write(Uint8Array.of(5))]); assert.deepEqual(written,[[4],[5]]);
 live=false; await assert.rejects(socket.write(Uint8Array.of(6)),/retired/); await socket.writes; assert.equal(socket.closed,true); assert.deepEqual(written,[[4],[5]]);
});
test('a truncated or oversized Telegram packet rejects rather than allocating unbounded memory', async () => {
 const Socket=socketClass(()=>({opened:Promise.resolve(),closed:Promise.resolve(),readable:new ReadableStream({start(c){c.enqueue(Uint8Array.of(1));c.close();}}),writable:new WritableStream(),close:async()=>{}}),async()=>{});
 const socket=new Socket();await socket.connect(80,'fixture'); await assert.rejects(socket.readExactly(3),/ended/); await assert.rejects(socket.readExactly(3*1024*1024),/length/);
});
const audio={chatScope:'fixturebot',messageId:'12',fileId:'123',size:8192,mimeType:'audio/mpeg'};
const secret='synthetic-secret-with-32-characters',exp=Math.floor(Date.now()/1000)+60;
test('signed audio binds scope, expiry and document; duplicate and malformed parameters reject',()=>{
 const tag=tagOf(audio), query=new URLSearchParams({exp:String(exp),documentTag:tag,sig:signature(secret,'fixturebot','12',exp,tag)});
 const url='https://fixture/v2/audio/fixturebot/12?'+query;
 assert.equal(authorized(new Request(url),secret),true);
 for(const changed of [url.replace('/12?','/13?'),url+'&exp='+exp,url+'&documentTag='+encodeURIComponent(tag),url.replace('sig=','sig=00')])assert.equal(authorized(new Request(changed),secret),false);
});
test('exact ranges, HEAD, suffix, unsatisfiable offsets, stale If-Range and document preconditions',()=>{
 const url='https://fixture/v2/audio/fixturebot/12';
 let p=audioHeaders(new Request(url,{headers:{Range:'bytes=4096-5000'}}),audio);assert.equal(p.status,206);assert.equal(p.headers['Content-Range'],'bytes 4096-5000/8192');assert.equal(p.length,905);
 p=audioHeaders(new Request(url,{headers:{Range:'bytes=-10'}}),audio);assert.equal(p.start,8182);assert.equal(p.length,10);
 p=audioHeaders(new Request(url,{headers:{Range:'bytes=9000-'}}),audio);assert.equal(p.response.status,416);
 p=audioHeaders(new Request(url,{method:'HEAD',headers:{Range:'bytes=0-1'}}),audio);assert.equal(p.status,200);assert.equal(p.length,8192);
 p=audioHeaders(new Request(url,{headers:{Range:'bytes=0-1','If-Range':'"old"'}}),audio);assert.equal(p.status,200);assert.equal(p.length,8192);
 p=audioHeaders(new Request(url,{headers:{'If-Match':'"old"'}}),audio);assert.equal(p.response.status,412);
});
test('session snapshots preserve separate media keys and main DC state across restart',async()=>{
 const session=new DurableSession();session.setDC(2,'149.154.167.51',80);
 const main=new authKeys.AuthKey(),media=new authKeys.AuthKey();await main.setKey(Buffer.alloc(256,1));await media.setKey(Buffer.alloc(256,2));
 session.setAuthKey(main);session.setAuthKey(media,4); const snap=session.snapshot();
 const restored=new DurableSession(snap.main);await restored.load();await restored.restore(snap.keys);
 assert.deepEqual(restored.getAuthKey().getKey(),main.getKey());assert.deepEqual(restored.getAuthKey(4).getKey(),media.getKey());assert.equal(restored.getAuthKey(5),undefined);
});
