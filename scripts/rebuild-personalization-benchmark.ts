import {performance} from "node:perf_hooks";
import {rankPersonalizedTracks,orderPersonalizedTracks,artistDiversityKey,type RankedTrack,type TasteTrack} from "../src/rebuild/recommendations/personalization";

/** Compare the replaced scan and current exact sequencer on the same process,
 * fixtures and scores. These are synthetic CPU timings, never HTTP timings. */
function previousSequence<T extends TasteTrack>(ranked:readonly RankedTrack<T>[]){
  const variety=.65,pending=ranked.map(item=>({item,key:artistDiversityKey(item.track),genres:(item.track.genres||[]).map(genre=>genre.normalize("NFKC").trim().toLowerCase())}));
  const result:RankedTrack<T>[]=[],counts=new Map<string,number>(),last:string[]=[];
  let previous:{key:string;genres:Set<string>}|undefined;
  while(pending.length){
    let best=0,bestScore=-Infinity;
    const alternate=previous&&pending.some(item=>item.key!==previous!.key);
    for(let index=0;index<pending.length;index++){
      const candidate=pending[index],adjacent=previous&&candidate.key===previous.key;
      if(alternate&&adjacent)continue;
      const shared=previous&&candidate.genres.some(genre=>previous!.genres.has(genre));
      const score=candidate.item.score-(adjacent?1.2+variety*2:0)-(last.includes(candidate.key)?variety*.8:0)-Math.log1p(counts.get(candidate.key)||0)*variety*.65+(shared?.13:0);
      if(score>bestScore){best=index;bestScore=score;}
    }
    const next=pending.splice(best,1)[0];result.push(next.item);counts.set(next.key,(counts.get(next.key)||0)+1);
    previous={key:next.key,genres:new Set(next.genres)};last.push(next.key);if(last.length>3)last.shift();
  }
  return result;
}
const measure=(operation:()=>unknown)=>{const start=performance.now();operation();return performance.now()-start;};
const stats=(values:number[])=>{const sorted=values.slice().sort((a,b)=>a-b),round=(value:number)=>Math.round(value*100)/100;
  return {medianMs:round(sorted[Math.floor(sorted.length/2)]),minMs:round(sorted[0]),maxMs:round(sorted[sorted.length-1])};};
for(const count of [600,2500]){
  const settings={timeZone:"Africa/Lagos",seedArtists:["Artist 0"],seedGenres:["Pop"],artistVariety:.65};
  const tracks=Array.from({length:count},(_,index)=>({id:`track-${index}`,title:`Track ${index}`,artists:[`Artist ${index%80}`],artistId:`artist-${index%80}`,
    genres:[["Pop","Jazz","Rock","Afrobeats"][index%4]],popularity:index%100/100,durationMs:180000,metadata:{explicit:"unknown"}}));
  const history=tracks.slice(0,1000).map((track,index)=>({recordingId:track.id,audibleMs:60000*(index%10+1),playCount:index%10+1,completedCount:index%5,skippedCount:0}));
  const ranked=rankPersonalizedTracks(tracks,{settings,history,nowMs:Date.UTC(2026,10,11,12),seed:"audit"});
  previousSequence(ranked);orderPersonalizedTracks(ranked,settings);
  const before:number[]=[],after:number[]=[];
  for(let sample=0;sample<5;sample++){before.push(measure(()=>previousSequence(ranked)));after.push(measure(()=>orderPersonalizedTracks(ranked,settings)));}
  const previous=stats(before),current=stats(after);
  console.log(JSON.stringify({synthetic:true,metric:"full-sequencing-cpu",count,iterations:5,previous,current,medianSpeedup:Math.round(previous.medianMs/current.medianMs*100)/100}));
}
