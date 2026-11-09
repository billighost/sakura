import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomWindow,bloomWindows} from "../src/rebuild/bloom/calendar";
import {bloomPromotions,nextBloomPromotionBoundary} from "../src/rebuild/bloom/promotions";
import {bloomShelfItems} from "../src/rebuild/bloom/shelf";

const promotions=(id:string,time:string,timeZone="Africa/Lagos")=>{
 const now=new Date(time);return bloomPromotions([bloomWindow(id,now,timeZone)],now);
};
describe("Sakura Bloom anticipation and promotion",()=>{
 it("builds weekly anticipation the day before, launch today and a reminder tomorrow",()=>{
  const id="weekly-2026-11-02";
  assert.equal(promotions(id,"2026-11-07T12:00:00Z").length,0);
  const before=promotions(id,"2026-11-08T12:00:00Z")[0];
  assert.equal(before.phase,"anticipation");assert.equal(before.timing,"Opens tomorrow");assert.equal(before.href,"/bloom?period=weekly");
  const launch=promotions(id,"2026-11-09T12:00:00Z")[0];
  assert.equal(launch.phase,"launch");assert.equal(launch.action,"Check your Sakura Bloom");assert.equal(launch.href,`/bloom/${id}`);
  assert.equal(promotions(id,"2026-11-10T12:00:00Z")[0].phase,"reminder");
  assert.equal(promotions(id,"2026-11-11T12:00:00Z").length,0);
 });
 it("gives monthly and annual listening more campaign moments",()=>{
  const count=(id:string,from:string,days:number)=>Array.from({length:days},(_,day)=>{
   const now=new Date(Date.parse(from)+day*86_400_000);return bloomPromotions([bloomWindow(id,now)],now).length;
  }).reduce((sum,value)=>sum+value,0);
  const weekly=count("weekly-2026-11-02","2026-11-01T12:00:00Z",15);
  const monthly=count("monthly-2026-10","2026-10-01T12:00:00Z",65);
  const annual=count("yearly-2025","2025-12-01T12:00:00Z",400);
  assert.equal(weekly,3);assert.ok(monthly>=10);assert.ok(annual>monthly*3);
 });
 it("uses local calendar days over a 25-hour daylight saving day",()=>{
  const id="weekly-2026-10-26",zone="America/New_York";
  assert.equal(promotions(id,"2026-11-01T03:59:00Z",zone).length,0);
  const now=new Date("2026-11-01T04:01:00Z"),item=bloomWindow(id,now,zone);
  assert.ok(Date.parse(item.publishAt)-now.getTime()>86_400_000);
  assert.equal(bloomPromotions([item],now)[0].timing,"Opens tomorrow");
  assert.equal(nextBloomPromotionBoundary([item],now),"2026-11-02T05:00:00.000Z");
 });
 it("never promotes empty, completed, expired or stale cached stories",()=>{
  const now=new Date("2026-11-09T12:00:00Z"),item=bloomWindow("weekly-2026-11-02",now);
  for(const status of ["empty","expired","archived"] as const)assert.equal(bloomPromotions([{...item,status}],now).length,0);
  assert.equal(bloomPromotions([{...item,completed:true}],now).length,0);
  assert.equal(bloomPromotions([item],new Date(item.expiresAt)).length,0);
  assert.equal(bloomPromotions([item],new Date(Date.parse(item.publishAt)-1)).length,0);
  assert.equal(bloomPromotions([{...item,status:"locked"}],new Date(item.publishAt)).length,0);
 });
 it("features the annual launch ahead of monthly and weekly stories",()=>{
  const now=new Date("2026-01-01T12:00:00Z"),items=(["weekly","monthly","yearly"] as const).flatMap(period=>bloomWindows(period,now));
  assert.equal(bloomPromotions(items,now)[0].item.id,"yearly-2025");
  assert.equal(bloomShelfItems(items,now)[0].id,"yearly-2025");
  const completed=items.map(item=>({...item,completed:item.period==="yearly"}));
  assert.equal(bloomPromotions(completed,now)[0].item.id,"monthly-2025-12");
  assert.equal(bloomShelfItems(completed,now)[0].id,"monthly-2025-12");
 });
 it("gives monthly reminders a place beside the weekly story and warns before closing",()=>{
  const now=new Date("2026-11-15T12:00:00Z"),items=(["weekly","monthly"] as const).flatMap(period=>bloomWindows(period,now));
  assert.equal(bloomPromotions(items,now)[0].item.id,"monthly-2026-10");
  assert.equal(bloomShelfItems(items,now)[0].id,"monthly-2026-10");
  const closing=promotions("monthly-2026-10","2026-11-23T12:00:00Z")[0];
  assert.equal(closing.phase,"closing");assert.equal(closing.timing,"Last day to open");
 });
 it("keeps copy and dismissal identity stable within a moment, then creates a new reminder",()=>{
  const early=promotions("weekly-2026-11-02","2026-11-09T00:01:00Z")[0];
  const late=promotions("weekly-2026-11-02","2026-11-09T21:00:00Z")[0];
  assert.deepEqual(early,late);
  const next=promotions("weekly-2026-11-02","2026-11-10T12:00:00Z")[0];
  assert.notEqual(next.key,early.key);
 });
 it("rejects malformed cached calendars without breaking valid promotions",()=>{
  const now=new Date("2026-11-09T12:00:00Z"),item=bloomWindow("weekly-2026-11-02",now);
  assert.equal(bloomPromotions([{...item,timeZone:"Invalid/Zone"},item],now).length,1);
  assert.equal(bloomPromotions([{...item,publishAt:"not-a-date"}],now).length,0);
  assert.equal(nextBloomPromotionBoundary([],now),undefined);
  assert.equal(nextBloomPromotionBoundary([item],new Date("invalid")),undefined);
 });
});
