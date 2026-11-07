import assert from "node:assert/strict";
import {test} from "node:test";
import {waitForRecording} from "../src/rebuild/app/recordingJob";
import {UserFacingError} from "../src/rebuild/app/errors";
import type {ResolveRecordingResult} from "../src/rebuild/server/contracts";
const pending={status:"pending",jobId:"fixture",pollUrl:"/api/v2/recordings/jobs/fixture",retryAfterMs:1,recording:{}} as ResolveRecordingResult;
const finished:ResolveRecordingResult={status:"unavailable",reason:"no-ready-audio",retryable:true};
const options=()=>({signal:new AbortController().signal,accountId:"account-fixture",origin:"https://sakura.invalid"});

test("a healthy job remains pollable beyond the former forty-poll cutoff",async t=>{
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init:RequestInit)=>{
  assert.equal(new Headers(init.headers).get("X-Sakura-Account"),"account-fixture");
  calls++;return Response.json(calls<=55?pending:finished);
 });
 assert.deepEqual(await waitForRecording(pending,options()),finished);assert.equal(calls,56);
});
test("a completed response avoids polling altogether",async t=>{
 t.mock.method(globalThis,"fetch",async()=>{assert.fail("Completed work must not poll");});
 assert.equal(await waitForRecording(finished,options()),finished);
});
test("persistent preparation reaches a wall-clock deadline with a useful retry",async t=>{
 t.mock.method(globalThis,"fetch",async()=>Response.json(pending));
 await assert.rejects(()=>waitForRecording(pending,{...options(),timeoutMs:8}),e=>e instanceof UserFacingError&&e.issue.action==="Retry song"&&e.issue.href==="/library/downloaded");
});
test("caller cancellation stops a pending job without another request",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(pending);});
 const controller=new AbortController();const waiting=waitForRecording({...pending,retryAfterMs:1000} as ResolveRecordingResult,{...options(),signal:controller.signal});controller.abort(new DOMException("Canceled","AbortError"));
 await assert.rejects(()=>waiting,e=>e instanceof DOMException&&e.name==="AbortError");assert.equal(calls,0);
});
test("job polling refuses a different server",async t=>{
 t.mock.method(globalThis,"fetch",async()=>{assert.fail("An unrelated server must never receive account data");});
 await assert.rejects(()=>waitForRecording({...pending,pollUrl:"https://attacker.invalid/api/v2/recordings/jobs/fixture"} as ResolveRecordingResult,options()),e=>e instanceof UserFacingError);
});

