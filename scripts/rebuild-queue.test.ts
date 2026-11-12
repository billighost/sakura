import test from "node:test";
import assert from "node:assert/strict";
import { appendManual, clearUpcoming, moveUpcoming, nextUpcoming, nextUserRepeat, reorderUpcoming, userRepeatQueue } from "../src/rebuild/app/listeningQueue";
import type { MusicTrack, QueueEntry } from "../src/rebuild/app/types";
const entry = (id:string, priority:"manual"|"automatic"="automatic"):QueueEntry => ({entryId:id,priority,track:{id:"same-recording"} as MusicTrack});
const ids = (entries:readonly QueueEntry[]) => entries.map(entry=>entry.entryId);

test("intentional additions form a FIFO priority above contextual songs",()=>{
  let queue=[entry("past"),entry("current"),entry("search-1"),entry("search-2")];
  queue=appendManual(queue,"current",entry("my-1"));
  queue=appendManual(queue,"current",entry("my-2"));
  assert.deepEqual(ids(queue),["past","current","my-1","my-2","search-1","search-2"]);
  assert.equal(nextUpcoming(queue,"current",true,()=>.99)?.entryId,"my-1");
  assert.equal(nextUpcoming(queue,"my-1",true,()=>.99)?.entryId,"my-2");
});
test("reorder affects exact duplicate occurrence, respects priority and leaves current stable",()=>{
  const queue=[entry("current"),entry("my-1","manual"),entry("my-2","manual"),entry("auto-1"),entry("auto-2")];
  assert.deepEqual(ids(moveUpcoming(queue,"current","my-2",-1)),["current","my-2","my-1","auto-1","auto-2"]);
  assert.equal(moveUpcoming(queue,"current","my-1",-1),queue);
  assert.equal(moveUpcoming(queue,"current","my-2",1),queue);
  assert.deepEqual(ids(reorderUpcoming(queue,"current","auto-2","auto-1")),["current","my-1","my-2","auto-2","auto-1"]);
  assert.deepEqual(ids(reorderUpcoming(queue,"current","my-1",null)),["current","my-2","my-1","auto-1","auto-2"]);
  assert.equal(reorderUpcoming(queue,"current","auto-1","my-2"),queue);
});
test("clear drops both future sections while preserving current occurrence and history",()=>{
  const queue=[entry("past"),entry("current"),entry("my-1","manual"),entry("auto-1")];
  const cleared=clearUpcoming(queue,"current");
  assert.deepEqual(ids(cleared),["past","current"]);
  assert.equal(cleared[1],queue[1]);
  assert.equal(nextUpcoming(cleared,"current",false),undefined);
  assert.deepEqual(clearUpcoming(queue,null),[]);
});
test("add before listening and empty queue both choose manual next",()=>{
  const queue=appendManual([entry("auto")],null,entry("my-1"));
  assert.deepEqual(ids(queue),["my-1","auto"]);
  assert.equal(nextUpcoming(queue,null,false)?.entryId,"my-1");
  assert.equal(nextUpcoming([],null,true),undefined);
});
test("repeat cycles now playing and Added by you without entering automatic continuation",()=>{
  const queue=[entry("history"),entry("current"),entry("my-1","manual"),entry("my-2","manual"),entry("continuation-1"),entry("continuation-2")];
  assert.deepEqual(ids(userRepeatQueue(queue,"current")),["current","my-1","my-2"]);
  assert.equal(nextUserRepeat(queue,"current","current")?.entryId,"my-1");
  assert.equal(nextUserRepeat(queue,"my-1","current")?.entryId,"my-2");
  assert.equal(nextUserRepeat(queue,"my-2","current")?.entryId,"current");
});
test("repeat anchor follows the song selected by the listener and can skip an unavailable occurrence",()=>{
  const queue=[entry("old-current"),entry("old-pick","manual"),entry("selected","manual"),entry("new-pick","manual"),entry("continuation")];
  assert.deepEqual(ids(userRepeatQueue(queue,"selected")),["selected","new-pick"]);
  assert.equal(nextUserRepeat(queue,"new-pick","selected",candidate=>candidate.entryId!=="selected")?.entryId,"new-pick");
  assert.equal(nextUserRepeat(queue,"selected","selected",()=>false),undefined);
});
