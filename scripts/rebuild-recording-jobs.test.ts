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

test("compact pending polls retain the initiating recording and opt in to smaller status",async t=>{
 const recordingId="11111111-1111-4111-8111-111111111111";
 const start={...pending,recording:{recordingId}} as ResolveRecordingResult;let calls=0;
 t.mock.method(globalThis,"fetch",async(url:unknown)=>{
  assert.equal(new URL(String(url)).searchParams.get("compact"),"1");
  calls++;return Response.json(calls===1?{status:"pending",schemaVersion:1,jobId:"fixture",recordingId,pollUrl:"/api/v2/recordings/jobs/fixture",retryAfterMs:1}:finished);
 });
 assert.deepEqual(await waitForRecording(start,options()),finished);assert.equal(calls,2);
});

test("compact status cannot switch the retained recording or polling job",async t=>{
 const start={...pending,recording:{recordingId:"one"}} as ResolveRecordingResult;
 t.mock.method(globalThis,"fetch",async()=>Response.json({status:"pending",schemaVersion:1,jobId:"fixture",recordingId:"another",pollUrl:pending.status==="pending"?pending.pollUrl:"",retryAfterMs:1}));
 await assert.rejects(()=>waitForRecording(start,options()),error=>error instanceof UserFacingError);
});

test("foreground retry hints never defer result detection beyond one second",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(finished);});
 const waiting=waitForRecording({...pending,retryAfterMs:5000} as ResolveRecordingResult,options());
 t.mock.timers.tick(999);await Promise.resolve();assert.equal(calls,0);
 t.mock.timers.tick(1);await waiting;assert.equal(calls,1);
});

