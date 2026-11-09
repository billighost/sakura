import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {createBloomExperience,experienceForItem,experienceFraction} from "../src/rebuild/bloom/experience";
import {bloomChapterTitle,bloomWorldVoice,chapterHold} from "../src/rebuild/bloom/story";
import {listeningComparison} from "../src/rebuild/bloom/comparisons";

describe("saved Bloom experience",()=>{
 it("keeps words and visual choices identical after serialization and later reopening",()=>{
  const first=createBloomExperience("account-a|monthly-2026-10|Africa/Lagos","sakura");
  const reopened=JSON.parse(JSON.stringify(first));
  assert.deepEqual(createBloomExperience("account-a|monthly-2026-10|Africa/Lagos","sakura"),first);
  assert.deepEqual(experienceForItem({id:"monthly-2026-10",timeZone:"Africa/Lagos",worldId:"sakura",version:4,experience:reopened}),first);
  assert.deepEqual(bloomWorldVoice("sakura",first),bloomWorldVoice("sakura",reopened));
  assert.equal(bloomChapterTitle("sakura","finale",undefined,reopened),first.finaleTitle);
  assert.equal(listeningComparison(216*60000,first).detail,listeningComparison(216*60000,reopened).detail);
 });
 it("gives the same world in another recap or account its own stable identity",()=>{
  const experience=createBloomExperience("account-a|weekly-2026-11-02|Africa/Lagos","ocean");
  assert.notEqual(experience.seed,createBloomExperience("account-a|weekly-2026-11-09|Africa/Lagos","ocean").seed);
  assert.notEqual(experience.seed,createBloomExperience("account-b|weekly-2026-11-02|Africa/Lagos","ocean").seed);
  assert.notEqual(experience.seed,createBloomExperience("account-a|weekly-2026-11-02|America/New_York","ocean").seed);
 });
 it("varies composition, palette, prose and illustrative references within a repeated world",()=>{
  const experiences=Array.from({length:80},(_,index)=>createBloomExperience(`account|monthly-${2020+Math.floor(index/12)}-${index%12+1}|UTC`,"cosmos"));
  for(const key of ["composition","palette","tempo"] as const){assert.equal(new Set(experiences.map(item=>item[key])).size,4);assert.ok(experiences.every(item=>item[key]>=0&&item[key]<=3));}
  assert.ok(new Set(experiences.map(item=>`${item.composition}|${item.palette}|${item.tempo}`)).size>=25);
  assert.ok(new Set(experiences.map(item=>item.opening)).size>=10);
  assert.ok(new Set(experiences.map(item=>bloomChapterTitle("cosmos","song-winner","top-song",item))).size>=3);
  assert.ok(new Set(experiences.map(item=>listeningComparison(360*60000,item).reference)).size>=6);
 });
 it("preserves existing voices, timing, comparisons and legacy artwork",()=>{
  assert.equal(experienceForItem({id:"monthly-2026-10",timeZone:"Africa/Lagos",worldId:"sakura",version:3}),undefined);
  assert.equal(experienceForItem({id:"monthly-2026-10",timeZone:"Africa/Lagos",version:1}),undefined);
  assert.equal(bloomWorldVoice("sakura").opening,"An orchard in ink, drawn from the music recorded in this period.");
  assert.equal(bloomChapterTitle("sakura","song-winner","top-song"),"The fullest blossom on this branch.");
  assert.equal(chapterHold(undefined),11500);
  assert.equal(listeningComparison(216*60000).title,"A whole double feature.");
 });
 it("has distinct titles for expanded monthly and yearly insights without exposing values",()=>{
  const experience=createBloomExperience("account|yearly-2026|UTC","glass");
  for(const id of ["listening-character","top-song-share","average-day","discovery-share","replay-share","top-five-share","artist-count","genre-leader","time-of-day","peak-day","listening-streak","active-months","peak-month","year-opening","year-closing","season-spotlight","weekend-rhythm","half-year-shift"]){
   const title=bloomChapterTitle("glass","pattern",id,experience);
   assert.notEqual(title,"The recorded hours light the window.");
   assert.ok(title.length>10);
   assert.doesNotMatch(title,/\d/);
  }
 });
 it("derives decorative values reproducibly inside safe numeric bounds",()=>{
  const experience=createBloomExperience("account|monthly-2026-10|UTC","jungle");
  const values=Array.from({length:100},(_,index)=>experienceFraction(experience.seed,index));
  assert.deepEqual(values,Array.from({length:100},(_,index)=>experienceFraction(experience.seed,index)));
  assert.ok(values.every(value=>value>=0&&value<1));
  assert.equal(new Set(values).size,100);
  assert.ok(chapterHold(undefined,experience)>=11500&&chapterHold(undefined,experience)<=12880);
 });
 it("only uses comparison units that fit the measured time",()=>{
  for(const ms of [500,59000,180000,600000,3600000,216*60000,42*3600000]){
   for(let seed=0;seed<25;seed++){
    const comparison=listeningComparison(ms,{seed});
    const match=comparison.detail.match(/^Picture (\d+) .* of (\d+) minutes each/);
    if(match)assert.ok(Number(match[1])*Number(match[2])*60000<=ms);
    assert.equal(comparison.approximate,false);
   }
  }
 });
 it("keeps sparse and annual copy aligned with the facts available",()=>{
  for(let index=0;index<80;index++){
   const experience=createBloomExperience(`account|yearly-${2020+index}|UTC`,"ocean");
   assert.doesNotMatch(experience.opening,/every replay|every new discovery/i);
   assert.doesNotMatch(experience.closing,/whenever you want|the discoveries|the little returns/i);
   assert.doesNotMatch(bloomChapterTitle("ocean","pattern","year-opening",experience),/first song/i);
   assert.doesNotMatch(bloomChapterTitle("ocean","pattern","year-closing",experience),/the song|last note/i);
   assert.doesNotMatch(bloomChapterTitle("ocean","comparison","half-year-shift",experience),/changed/i);
  }
 });
});
