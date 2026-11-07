import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {test,type TestContext} from "node:test";
import {Pool,type PoolClient,type QueryConfig,type QueryResult} from "pg";
import {readAccountById,inIdempotentTransaction,inTransaction} from "../src/rebuild/data/db";

type Callback=(error:Error|null,result?:QueryResult)=>void;
type Dispatch={clientId:number;text:string;values:unknown[]};
const accountA="90000000-0000-4000-8000-000000000081";
const accountB="90000000-0000-4000-8000-000000000082";
function failure(message:string,code?:string){return Object.assign(new Error(message),code?{code}:{});}

/** The real pg-pool lifecycle runs against deterministic sockets. No connection
 * string or real database is used; release(error) must remove the failed client. */
function fixture(t:TestContext,options:{hungConnect?:number;missing?:boolean;query?:(dispatch:Dispatch)=>Error|undefined}={}) {
  const state={created:0,destroyed:[] as number[],ended:[] as number[],removed:[] as number[],dispatched:[] as Dispatch[]};
  class SocketClient extends EventEmitter {
    id=++state.created;_queryable=true;_ending=false;connectCallback:((error?:Error)=>void)|null=null;
    connection={stream:{destroy:()=>{state.destroyed.push(this.id);queueMicrotask(()=>this.connectCallback?.(failure("Connection terminated unexpectedly")));}}};
    connect(callback:(error?:Error)=>void){this.connectCallback=callback;if(this.id!==options.hungConnect)queueMicrotask(()=>callback());}
    ref(){} unref(){}
    query(statement:string|QueryConfig,values?:unknown[]|Callback,callback?:Callback):Promise<QueryResult>|void {
      const text=typeof statement==="string"?statement:statement.text;
      const parameters=typeof statement==="string"?(Array.isArray(values)?values:[]):statement.values||[];
      const dispatch={clientId:this.id,text,values:parameters};state.dispatched.push(dispatch);
      const complete=(done:Callback)=>queueMicrotask(()=>{
        const error=options.query?.(dispatch);if(error){done(error);return;}
        const rows=text.startsWith("SELECT")&&!options.missing?[{id:parameters[0],username:parameters[0]===accountB?"listener_b":"listener_a",email:"synthetic@example.invalid",avatarUrl:null}]:[];
        done(null,{rows,command:text.split(" ")[0],rowCount:rows.length,oid:0,fields:[]});
      });
      const done=typeof values==="function"?values:callback;
      if(done){complete(done);return;}
      return new Promise((resolve,reject)=>complete((error,result)=>error?reject(error):resolve(result!)));
    }
    end(callback?:()=>void){this._ending=true;state.ended.push(this.id);queueMicrotask(()=>{this.emit("end");callback?.();});}
  }
  const pool=new Pool({Client:SocketClient as unknown as typeof import("pg").Client,max:5,connectionTimeoutMillis:20,idleTimeoutMillis:0,allowExitOnIdle:true});
  pool.on("error",()=>{});pool.on("remove",(client:PoolClient)=>state.removed.push((client as unknown as SocketClient).id));
  const runtime=globalThis as unknown as {sakuraV2ProductPool?:Pool};const previous=runtime.sakuraV2ProductPool;runtime.sakuraV2ProductPool=pool;
  t.after(async()=>{await pool.end();if(previous)runtime.sakuraV2ProductPool=previous;else delete runtime.sakuraV2ProductPool;});
  return {pool,state};
}

test("account read retries a cold handshake once after pg-pool destroys its socket",async t=>{
  const {pool,state}=fixture(t,{hungConnect:1});
  const account=await readAccountById(accountA);
  assert.equal(account?.id,accountA);assert.equal(state.created,2);assert.deepEqual(state.destroyed,[1]);
  assert.equal(state.dispatched.length,1);assert.equal(state.dispatched[0].clientId,2);assert.equal(pool.totalCount,1);
});

test("account read timeout discards its client before repeating the fixed SELECT",async t=>{
  const {pool,state}=fixture(t,{query:dispatch=>dispatch.clientId===1?failure("Query read timeout"):undefined});
  const account=await readAccountById(accountA);
  assert.equal(account?.id,accountA);assert.deepEqual(state.ended,[1]);assert.deepEqual(state.removed,[1]);
  assert.deepEqual(state.dispatched.map(item=>item.clientId),[1,2]);assert.equal(pool.totalCount,1);
  assert.ok(state.dispatched.every(item=>item.text==='SELECT id, username, email, "avatarUrl" FROM public."User" WHERE id = $1::uuid'));
});

test("SQL validation and server cancellation fail immediately without read retries",async t=>{
  let code="22P02";const {state}=fixture(t,{query:()=>failure("Synthetic server error",code)});
  await assert.rejects(readAccountById(accountA),error=>(error as {code:string}).code==="22P02");
  assert.equal(state.dispatched.length,1);code="57014";
  await assert.rejects(readAccountById(accountA),error=>(error as {code:string}).code==="57014");
  assert.equal(state.dispatched.length,2);
});

test("transport failures stop after two reads and failed work is not retained",async t=>{
  let fail=true;const {state}=fixture(t,{query:()=>fail?failure("Connection terminated unexpectedly","ECONNRESET"):undefined});
  await assert.rejects(readAccountById(accountA),/Connection terminated/);
  assert.equal(state.dispatched.length,2);assert.equal(state.created,2);assert.deepEqual(state.ended,[1,2]);
  fail=false;assert.equal((await readAccountById(accountA))?.id,accountA);assert.equal(state.dispatched.length,3);
});

test("concurrent reads share only matching account work and never keep a stale account snapshot",async t=>{
  const {state}=fixture(t);
  const [first,duplicate,other]=await Promise.all([readAccountById(accountA),readAccountById(accountA),readAccountById(accountB)]);
  assert.equal(first?.id,accountA);assert.equal(duplicate?.id,accountA);assert.equal(other?.id,accountB);
  assert.equal(state.dispatched.length,2);
  await readAccountById(accountA);assert.equal(state.dispatched.length,3,"The next request must re-check account existence");
});

test("a missing account returns null once and is checked again on the next request",async t=>{
  const {state}=fixture(t,{missing:true});
  assert.equal(await readAccountById(accountA),null);assert.equal(state.dispatched.length,1);
  assert.equal(await readAccountById(accountA),null);assert.equal(state.dispatched.length,2);
});

test("an uncertain mutation commit is never retried and its dead client is removed",async t=>{
  const {state}=fixture(t,{query:dispatch=>dispatch.text==="COMMIT"?failure("Connection terminated unexpectedly","ECONNRESET"):undefined});
  let operations=0;
  await assert.rejects(inTransaction(async client=>{operations++;await client.query("UPDATE fixture SET counter=counter+1");}),/Connection terminated/);
  assert.equal(operations,1);assert.equal(state.dispatched.filter(item=>item.text.startsWith("UPDATE")).length,1);
  assert.equal(state.dispatched.filter(item=>item.text==="COMMIT").length,1);assert.deepEqual(state.ended,[1]);
  assert.equal(state.dispatched.some(item=>item.text==="ROLLBACK"),false,"Never queue rollback on a dead connection");
  assert.equal((await readAccountById(accountA))?.id,accountA);assert.equal(state.created,2);
});

test("an explicitly idempotent transaction retries once after an uncertain commit",async t=>{
  const {state}=fixture(t,{query:dispatch=>dispatch.clientId===1&&dispatch.text==="COMMIT"?failure("Connection terminated unexpectedly","ECONNRESET"):undefined});
  let operations=0;
  const result=await inIdempotentTransaction(async client=>{operations++;await client.query("INSERT INTO retry_ledger VALUES (1) ON CONFLICT DO NOTHING");return operations;});
  assert.equal(result,2);assert.equal(operations,2);assert.deepEqual(state.dispatched.filter(item=>item.text.startsWith("INSERT")).map(item=>item.clientId),[1,2]);
  assert.deepEqual(state.dispatched.filter(item=>item.text==="COMMIT").map(item=>item.clientId),[1,2]);assert.deepEqual(state.ended,[1]);
});
