import test from 'node:test';
import assert from 'node:assert/strict';
import {guardSender,guardClientSenders,withDeadline} from './src/deadline.mjs';
test('stalled queued RPC rejects and retires the transport so its chat queue can finish',async()=>{
 let rejected,retired=0;const state={promise:new Promise((_,reject)=>{rejected=reject;}),reject:error=>rejected(error)};
 const sender=guardSender({addStateToQueue(){},send(){return new Promise(()=>{});}},()=>retired++,10);
 sender.addStateToQueue(state);await assert.rejects(state.promise,/TIMEOUT/);assert.equal(retired,1);
});
test('successful requests clear their deadline and never retire a healthy transport',async()=>{
 let retired=0;assert.equal(await withDeadline(Promise.resolve(12),10,()=>retired++),12);
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(retired,0);
});
test('parallel file transfers on the account DC reuse the only main sender; retired clients cannot reopen',async()=>{
 let borrowed=0,current=true;const main={},media={};
 const client={session:{dcId:2},_sender:main,_createExportedSender(){return media;},async getSender(){borrowed++;return media;}};
 guardClientSenders(client,()=>current,()=>{});
 const results=await Promise.all(Array.from({length:40},()=>client.getSender(2)));
 assert.ok(results.every(sender=>sender===main));assert.equal(borrowed,0);
 assert.equal(await client.getSender(4),media);assert.equal(borrowed,1);
 current=false;await assert.rejects(client.getSender(2),/retired/);await assert.rejects(client.getSender(4),/retired/);assert.equal(borrowed,1);
});
