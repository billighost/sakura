import assert from "node:assert/strict";
import {test} from "node:test";
import {DownloadGate} from "../src/rebuild/app/downloadGate";
test("batch downloads have a bounded FIFO transfer count",async()=>{
 const gate=new DownloadGate(2),signal=new AbortController().signal;
 const releaseA=await gate.acquire(signal),releaseB=await gate.acquire(signal);let entered=false;const pending=gate.acquire(signal).then(release=>{entered=true;return release;});await Promise.resolve();assert.equal(entered,false);releaseA();const releaseC=await pending;assert.equal(entered,true);releaseA();releaseB();releaseC();
});
test("canceling a queued download removes it without blocking the next song",async()=>{
 const gate=new DownloadGate(1),release=await gate.acquire(new AbortController().signal),controller=new AbortController();const canceled=gate.acquire(controller.signal);controller.abort();await assert.rejects(canceled,{name:"AbortError"});const next=gate.acquire(new AbortController().signal);release();(await next)();
});
