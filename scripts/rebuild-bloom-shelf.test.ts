import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomWindow,bloomWindows} from "../src/rebuild/bloom/calendar";
import {bloomOpeningDate,bloomShelfItems} from "../src/rebuild/bloom/shelf";

describe("Home Bloom readiness and opening dates",()=>{
 it("shows a ready monthly story beside the nearest weekly opening on Sunday",()=>{
  const now=new Date("2026-11-08T12:00:00Z");
  const items=(["weekly","monthly","yearly"] as const).flatMap(period=>bloomWindows(period,now));
  assert.deepEqual(bloomShelfItems(items,now).map(item=>item.id),["monthly-2026-10","weekly-2026-11-02"]);
 });
 it("uses the weekly story when ready and limits six calendar cards to two",()=>{
  const now=new Date("2026-11-09T00:01:00Z");
  const items=(["weekly","monthly","yearly"] as const).flatMap(period=>bloomWindows(period,now));
  assert.deepEqual(bloomShelfItems(items,now).map(item=>item.id),["weekly-2026-11-02","weekly-2026-11-09"]);
 });
 it("does not replace an available monthly story with an empty weekly period",()=>{
  const now=new Date("2026-11-09T00:01:00Z");
  const items=(["weekly","monthly"] as const).flatMap(period=>bloomWindows(period,now)).map(item=>item.period==="weekly"&&item.status==="available"?{...item,status:"empty" as const}:item);
  assert.equal(bloomShelfItems(items,now)[0].id,"monthly-2026-10");
 });
 it("keeps a real empty current period visible without inventing a ready story",()=>{
  const now=new Date("2026-11-09T00:01:00Z");
  const items=bloomWindows("weekly",now).map(item=>item.status==="available"?{...item,status:"empty" as const}:item);
  assert.deepEqual(bloomShelfItems(items,now).map(item=>item.status),["empty","locked"]);
 });
 it("drops stale locked and expired cards exactly at calendar boundaries",()=>{
  const now=new Date("2026-11-08T12:00:00Z"),items=bloomWindows("weekly",now);
  assert.equal(bloomShelfItems(items,now).length,1);
  assert.equal(bloomShelfItems(items,new Date(items[1].publishAt)).length,0);
 });
 it("formats the opening in the period's timezone across daylight saving changes",()=>{
  const item=bloomWindow("weekly-2026-10-26",new Date("2026-10-30T12:00:00Z"),"America/New_York");
  assert.equal(item.publishAt,"2026-11-02T05:00:00.000Z");
  const label=bloomOpeningDate(item.publishAt,item.timeZone);
  assert.match(label,/Nov/);assert.match(label,/12:00|00:00/);assert.doesNotMatch(label,/5:00/);
 });
});
