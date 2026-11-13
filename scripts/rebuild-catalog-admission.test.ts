import assert from "node:assert/strict";
import {test} from "node:test";
import {CatalogWorkQueue} from "../src/rebuild/server/catalog-work";
import {enrichCatalogGenres,warmCandidateCatalog} from "../src/rebuild/recommendations/catalog";
import {getRebuildServices} from "../src/rebuild/server/runtime";
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

test("catalog admission reserves foreground capacity and selects foreground before queued enrichment",async()=>{
 const queue=new CatalogWorkQueue(),gates=Array.from({length:6},deferred),started:number[]=[],pending:Promise<number>[]=[];
 for(let index=0;index<6;index++)pending.push(queue.run(async()=>{started.push(index);await gates[index].promise;return index;},index===2||index===3||index===5?"foreground":"background"));
 assert.deepEqual(started,[0,1,2,3]);assert.deepEqual(queue.snapshot(),{active:4,background:2,queued:2});
 gates[2].resolve();await turn();assert.deepEqual(started,[0,1,2,3,5]);
 gates[0].resolve();await turn();assert.deepEqual(started,[0,1,2,3,5,4]);
 for(const gate of gates)gate.resolve();assert.deepEqual(await Promise.all(pending),[0,1,2,3,4,5]);await turn();
 assert.deepEqual(queue.snapshot(),{active:0,background:0,queued:0});
});

test("queued abort removes work, overflow is bounded, and failed work releases admission",async()=>{
 const queue=new CatalogWorkQueue(1,1,1),gate=deferred(),stop=new AbortController();let forbidden=0;
 const active=queue.run(()=>gate.promise);
 const canceled=queue.run(async()=>{forbidden++;},"background",stop.signal);
 await assert.rejects(queue.run(async()=>{}),/queue is full/);stop.abort();await assert.rejects(canceled,{name:"AbortError"});assert.equal(forbidden,0);
 const failure=queue.run(async()=>{throw new Error("Provider failed");});const failureObserved=assert.rejects(failure,/Provider failed/);
 gate.resolve();await active;await failureObserved;await turn();assert.equal(queue.snapshot().active,0);
 assert.equal(await queue.run(async()=>"recovered","foreground"),"recovered");
 const preAborted=new AbortController();preAborted.abort();assert.throws(()=>queue.run(async()=>{forbidden++;},"foreground",preAborted.signal),{name:"AbortError"});assert.equal(forbidden,0);
});

test("public album enrichment coalesces across accounts and canceled consumers cannot cancel another owner",async t=>{
 const runtime=globalThis as unknown as {sakuraV2ProductPool?:unknown;sakuraV2Services?:unknown;sakuraV2ServicesKey?:string;sakuraV2Generation?:symbol};
 const previous={pool:runtime.sakuraV2ProductPool,services:runtime.sakuraV2Services,key:runtime.sakuraV2ServicesKey,generation:runtime.sakuraV2Generation};
 const gate=deferred(),started=deferred(),stop=new AbortController();let selects=0,details=0,updates=0;const signals:AbortSignal[]=[];
 runtime.sakuraV2ProductPool={async query(text:string){if(text.startsWith("SELECT DISTINCT")){selects++;return{rows:[{id:"66666666-6666-4666-8666-000000000001",external_id:"24"},{id:"66666666-6666-4666-8666-000000000002",external_id:"25"}]};}if(text.startsWith("UPDATE"))updates++;return{rows:[]};}};
 runtime.sakuraV2ServicesKey=undefined;
 t.after(()=>{runtime.sakuraV2ProductPool=previous.pool;runtime.sakuraV2Services=previous.services;runtime.sakuraV2ServicesKey=previous.key;runtime.sakuraV2Generation=previous.generation;});
 t.mock.method(globalThis,"fetch",async()=>{throw new Error("Network is forbidden in this fixture");});
 t.mock.method(getRebuildServices().catalog,"detail",async(_kind:string,_id:string,signal:AbortSignal)=>{details++;signals.push(signal);if(details===2)started.resolve();await gate.promise;return{genres:["Jazz"],releaseDate:"2026-11-12"};});
 const abandoned=enrichCatalogGenres(stop.signal),owner=enrichCatalogGenres();await started.promise;
 stop.abort();await assert.rejects(abandoned,{name:"AbortError"});assert.equal(selects,1);assert.equal(signals.every(signal=>!signal.aborted),true);
 gate.resolve();assert.deepEqual(await owner,{albums:2,enriched:2});assert.equal(details,2);assert.equal(updates,4);
 await enrichCatalogGenres();assert.equal(selects,2,"Only active work is shared; later requests can discover new missing albums");
});

test("many account warmups admit at most two preliminary background SQL projections",async t=>{
 const runtime=globalThis as unknown as {sakuraV2ProductPool?:unknown},previous=runtime.sakuraV2ProductPool;
 const gate=deferred(),started=deferred();let active=0,maximum=0,reads=0;
 const pool={async query(text:string){
  if(text.includes('FROM sakura_v2."AccountPreferences"')){active++;maximum=Math.max(maximum,active);reads++;if(reads===2)started.resolve();await gate.promise;active--;return{rows:[{preferences:{},seed_artists:[],seed_genres:[],onboarded:true,revision:1,field_revisions:{}}]};}
  if(text.startsWith("SELECT COUNT(*) n"))return{rows:[{n:80}]};return{rows:[]};
 },async connect(){return{query:this.query,release(){}};}};
 runtime.sakuraV2ProductPool=pool;t.after(()=>{runtime.sakuraV2ProductPool=previous;});
 const work=Array.from({length:10},(_,index)=>warmCandidateCatalog(`11111111-1111-4111-8111-${String(index).padStart(12,"0")}`,{priority:"background"}));
 await started.promise;await turn();assert.equal(reads,2);gate.resolve();await Promise.all(work);assert.equal(reads,10);assert.equal(maximum,2);
});
