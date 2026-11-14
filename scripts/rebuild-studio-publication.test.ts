import test from "node:test";
import assert from "node:assert/strict";
import { waitForStudioRecording, createStudioPublicationPreparation } from "../src/rebuild/player/studioPublication";
import { validateLyricPublishIdentity } from "../src/rebuild/lyrics/publish";
import type { MusicTrack } from "../src/rebuild/app/types";

test("cancelled metadata lookup releases publication even when catalog never answers",async()=>{
  const controller=new AbortController(),lookup=new Promise<never>(()=>{});
  const result=waitForStudioRecording(lookup,controller.signal);
  controller.abort(new DOMException("Cancelled","AbortError"));
  await assert.rejects(result,error=>error instanceof DOMException&&error.name==="AbortError");
  assert.equal(await waitForStudioRecording(Promise.resolve("retry"),new AbortController().signal),"retry");
});

test("metadata has a recoverable deadline and handles a late rejection",async()=>{
  let fail!:(error:Error)=>void;
  const lookup=new Promise<never>((_,reject)=>{fail=reject;});
  await assert.rejects(waitForStudioRecording(lookup,new AbortController().signal,10),/took too long.*draft is kept/);
  fail(new Error("Late catalog failure"));
  await new Promise(resolve=>setImmediate(resolve));
});

test("closing the studio before metadata finishes prevents a challenge or upload",async()=>{
  let resolve!:(track:MusicTrack)=>void,calls=0;
  const original=globalThis.fetch,track={id:"recording"} as MusicTrack;
  globalThis.fetch=async()=>{calls++;throw new Error("Unexpected request");};
  try{
    const job=createStudioPublicationPreparation(track,{accountId:"owner",ensureRecording:()=>new Promise(done=>{resolve=done;})});
    job.cancel();await assert.rejects(job.ready);
    resolve(track);await new Promise(done=>setImmediate(done));
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test("metadata-only publication preparation rejects incomplete or instrumental recordings",()=>{
  const identity={title:"Song",artist:"Artist",album:"Album",durationSeconds:180};
  assert.doesNotThrow(()=>validateLyricPublishIdentity(identity));
  for(const input of [{...identity,album:""},{...identity,durationSeconds:undefined},{...identity,durationSeconds:NaN},{...identity,durationSeconds:3601}])assert.throws(()=>validateLyricPublishIdentity(input),/verified album and duration/);
  assert.throws(()=>validateLyricPublishIdentity({...identity,title:"Song (Instrumental)"}),/instrumental recording/);
});
