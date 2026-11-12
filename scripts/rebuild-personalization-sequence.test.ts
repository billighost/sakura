import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {orderPersonalizedTracks,artistDiversityKey,type RankedTrack,type TasteTrack,type TasteSettings} from "../src/rebuild/recommendations/personalization";
import {FEED_DEFAULTS} from "../src/rebuild/app/feedPreferences";

/** The previous full-scan implementation is an independent equivalence oracle. */
function referenceSequence<T extends TasteTrack>(ranked:readonly RankedTrack<T>[],settings:TasteSettings={},limit=ranked.length){
  const normal=(value:string)=>value.normalize("NFKC").trim().toLowerCase();
  const pending=ranked.map(item=>({item,key:artistDiversityKey(item.track),genres:(item.track.genres||[]).map(normal)}));
  const ordered:RankedTrack<T>[]=[],counts=new Map<string,number>(),raw=settings.artistVariety;
  const variety=typeof raw==="number"&&Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):FEED_DEFAULTS.artistVariety,lastArtists:string[]=[];
  let previous:{key:string;genres:Set<string>}|undefined;
  const bound=Math.max(0,Math.min(ranked.length,Math.floor(limit)));
  while(pending.length&&ordered.length<bound){
    let best=0,bestScore=-Infinity;
    const alternate=variety>=.5&&previous&&pending.some(item=>item.key!==previous!.key);
    for(let index=0;index<pending.length;index++){
      const choice=pending[index],key=choice.key,adjacent=previous&&key===previous.key;
      if(alternate&&adjacent)continue;
      const shared=previous&&choice.genres.some(genre=>previous!.genres.has(genre));
      const score=choice.item.score-(adjacent?1.2+variety*2:0)-(lastArtists.includes(key)?variety*.8:0)-Math.log1p(counts.get(key)||0)*variety*.65+(shared?.13:0);
      if(score>bestScore){best=index;bestScore=score;}
    }
    const next=pending.splice(best,1)[0];ordered.push(next.item);counts.set(next.key,(counts.get(next.key)||0)+1);
    previous={key:next.key,genres:new Set(next.genres)};lastArtists.push(next.key);if(lastArtists.length>3)lastArtists.shift();
  }
  return ordered;
}
function random(seed:number){let value=seed;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
function choices(count:number,seed:number,nearTies=false):RankedTrack<TasteTrack>[] {
  const next=random(seed),names=["A","b","Ｂ",""," É ","Artist C"],genres=["Pop","pop"," POP ","Jazz","Rock","","Afrobeats"];
  return Array.from({length:count},(_,position)=>({track:{id:`${seed}:${position}`,artists:[names[Math.floor(next()*names.length)]],genres:Array.from({length:Math.floor(next()*4)},()=>genres[Math.floor(next()*genres.length)])},
    score:nearTies?1+(Math.floor(next()*12)-6)*Number.EPSILON:Math.floor(next()*160)/20,
    reason:"fixture",lane:"familiar" as const,familiarArtist:true,heard:false}));
}
describe("Indexed personalized sequencing",()=>{
  it("matches the original choices for randomized artist spacing, genres, ties and limits",()=>{
    const varieties=[0,.2,.49,.5,.65,1,undefined,NaN,-1,2];
    for(let seed=1;seed<=500;seed++){
      const ranked=choices(seed%93,seed),settings={artistVariety:varieties[seed%varieties.length]},limit=seed%4===0?seed%31:ranked.length;
      assert.deepEqual(orderPersonalizedTracks(ranked,settings,limit),referenceSequence(ranked,settings,limit),`seed ${seed}`);
    }
  });
  it("retains input order when floating point operations collapse unequal scores into ties",()=>{
    for(let seed=1;seed<=100;seed++)for(const artistVariety of [0,.2,.5,.65,1]){
      const ranked=choices(35,seed,true),settings={artistVariety};
      assert.deepEqual(orderPersonalizedTracks(ranked,settings),referenceSequence(ranked,settings),`near tie ${seed}, ${artistVariety}`);
    }
  });
  it("preserves the complete 2,500-recording reservoir and does not mutate its inputs",()=>{
    const ranked=choices(2500,503),before=ranked.map(item=>({...item,track:{...item.track,genres:item.track.genres?.slice()}}));
    const result=orderPersonalizedTracks(ranked,{artistVariety:.65});
    assert.equal(result.length,2500);assert.equal(new Set(result.map(item=>item.track.id)).size,2500);
    assert.deepEqual(result,referenceSequence(ranked,{artistVariety:.65}));assert.deepEqual(ranked,before);
  });
  it("handles one remaining artist, missing artist names, empty inputs and non-finite scores",()=>{
    const ranked=choices(40,612).map(item=>({...item,track:{...item.track,artists:[]}}));
    for(const artistVariety of [0,.65,1])assert.deepEqual(orderPersonalizedTracks(ranked,{artistVariety}),referenceSequence(ranked,{artistVariety}));
    assert.deepEqual(orderPersonalizedTracks([]),[]);
    for(const score of [Infinity,-Infinity,NaN]){
      const values=choices(8,19);values[3].score=score;
      assert.deepEqual(orderPersonalizedTracks(values),referenceSequence(values));
    }
    for(const limit of [0,-1,1.8,NaN,Infinity])assert.deepEqual(orderPersonalizedTracks(ranked,{},limit),referenceSequence(ranked,{},limit));
  });
});
