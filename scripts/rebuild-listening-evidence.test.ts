import assert from "node:assert/strict";
import {test} from "node:test";
import {audibleIncrement,listeningOutcome,listeningTimeFallsInPeriod} from "../src/rebuild/app/listeningEvidence";
import {smartContinuation} from "../src/rebuild/app/smartQueue";
import type {MusicTrack,QueueEntry} from "../src/rebuild/app/types";

const audible={mediaDeltaMs:250,wallDeltaMs:250,playing:true,paused:false,seeking:false,privateSession:false,learnFromListening:true};
test("audible listening rejects seek jumps, silence and learning pauses",()=>{
 assert.equal(audibleIncrement(audible),250);
 for(const patch of [{mediaDeltaMs:30000},{mediaDeltaMs:-500},{paused:true},{seeking:true},{playing:false},{privateSession:true},{learnFromListening:false},{muted:true},{volume:0},{volume:Number.NaN},{wallDeltaMs:Number.NaN}])assert.equal(audibleIncrement({...audible,...patch}),0);
 assert.equal(audibleIncrement({...audible,mediaDeltaMs:30000,wallDeltaMs:30000}),30000,"Background playback is valid when elapsed time supports the media movement");
});
test("jumping to the end cannot count as hearing a complete song",()=>{
 assert.deepEqual(listeningOutcome({naturalEnd:true,explicitSkip:false,audibleMs:5000,durationMs:180000}),{completed:false,skipped:false,finished:true});
 assert.deepEqual(listeningOutcome({naturalEnd:true,explicitSkip:false,audibleMs:170000,durationMs:180000}),{completed:true,skipped:false,finished:true});
 assert.deepEqual(listeningOutcome({naturalEnd:false,explicitSkip:true,audibleMs:3000,durationMs:180000}),{completed:false,skipped:true,finished:true});
});
test("selective history clear keeps earlier listening and handles unknown legacy timestamps",()=>{
 const cutoff=Date.UTC(2026,10,8);
 assert.equal(listeningTimeFallsInPeriod("2026-11-07T00:00:00Z","week",cutoff),true);
 assert.equal(listeningTimeFallsInPeriod("2026-10-28T00:00:00Z","week",cutoff),false);
 assert.equal(listeningTimeFallsInPeriod("2026-10-28T00:00:00Z","month",cutoff),true);
 assert.equal(listeningTimeFallsInPeriod(undefined,"week",cutoff),true);
 assert.equal(listeningTimeFallsInPeriod("2026-11-09T00:00:00Z","week",cutoff),false);
});
const track=(id:string)=>({id,title:id,artists:[id],reference:{provider:"deezer",id}} as MusicTrack);
test("smart continuation preserves current and manual entries while rejecting repeats",()=>{
 const current:QueueEntry={entryId:"current",track:track("1"),priority:"automatic"},manual:QueueEntry={entryId:"manual",track:track("2"),priority:"manual"},automatic:QueueEntry={entryId:"automatic",track:track("3"),priority:"automatic"};
 const existing=[current,manual,automatic],next=smartContinuation(existing,[track("2"),track("4"),track("4"),track("1")],song=>song.id,()=>"new");
 assert.equal(next[0],current);assert.equal(next[1],manual);assert.equal(next[2],automatic);assert.deepEqual(next.map(item=>item.track.id),["1","2","3","4"]);assert.equal(next[3].priority,"automatic");assert.equal(existing.length,3);
 assert.deepEqual(smartContinuation(existing,[track("4")],song=>song.id,()=>"new",3),existing);
});
