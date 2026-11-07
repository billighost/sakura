import type {RecordingCard} from "../data/catalog";
import type {BloomArtistInsight,BloomChapter,BloomRankedRecording} from "./uiTypes";
import type {BloomWindow} from "./calendar";
import {bloomDesignForMonth} from "./design";
import {listeningComparison,listeningDuration} from "./comparisons";

export interface ListeningRow {id:string;audible_ms:number|string;plays:number;first_ever:Date|string;}
export type SavedBloomChapter=Omit<BloomChapter,"stat"|"revealed">&{stat:NonNullable<BloomChapter["stat"]>};
export interface BloomSnapshot {version?:number;worldId?:string;summary:{audibleMs:number;playCount:number;recordingCount:number;activeDays:number};chapters:SavedBloomChapter[]}
const card=(recording:RecordingCard)=>recording as unknown as Record<string,unknown>;
export function buildBloomSnapshot(rows:readonly ListeningRow[],cards:readonly RecordingCard[],activeDays:number,item:BloomWindow):BloomSnapshot{
 const sorted=[...rows].filter(row=>Number(row.audible_ms)>0).sort((a,b)=>Number(b.audible_ms)-Number(a.audible_ms)||a.id.localeCompare(b.id));
 const byId=new Map(cards.map(recording=>[recording.id,recording]));
 const total=sorted.reduce((n,row)=>n+Number(row.audible_ms),0),plays=sorted.reduce((n,row)=>n+Number(row.plays),0);
 const summary={audibleMs:total,playCount:plays,recordingCount:sorted.length,activeDays};
 const base={version:2,worldId:bloomDesignForMonth(item.periodStart,item.timeZone),summary};
 if(!total)return {...base,chapters:[]};
 const ranked:BloomRankedRecording[]=sorted.flatMap((row,index)=>{const recording=byId.get(row.id);return recording?[{rank:index+1,audibleMs:Number(row.audible_ms),plays:Number(row.plays),recording:card(recording)}]:[];});
 const winner=ranked.find(entry=>entry.rank===1),runnerUp=ranked.find(entry=>entry.rank===2),top=winner?.recording||null;
 const groups=new Map<string,BloomArtistInsight>(),genres=new Map<string,{time:number;recordings:BloomRankedRecording[]}>();
 for(const entry of ranked){
  const recording=byId.get(String(entry.recording.id))!;const credit=recording.artistCredits.find(c=>c.role==="primary"),reference=credit?.reference;
  const artistId=credit?.artistId||recording.artistId;const key=artistId|| (reference?`${reference.provider}:${reference.id}`:null);
  const name=credit?.name||recording.artists[0];
  if(key&&name){const prior=groups.get(key);groups.set(key,{key,name,artistId:artistId||null,imageUrl:prior?.imageUrl||recording.artistImageUrl,audibleMs:(prior?.audibleMs||0)+entry.audibleMs,recordings:[...(prior?.recordings||[]),entry]});}
  const genre=recording.genres[0];if(genre){const prior=genres.get(genre);genres.set(genre,{time:(prior?.time||0)+entry.audibleMs,recordings:[...(prior?.recordings||[]),entry]});}
 }
 const artists=[...groups.values()].sort((a,b)=>b.audibleMs-a.audibleMs||a.key.localeCompare(b.key)).map(artist=>({...artist,recordings:artist.recordings.slice(0,3).map((recording,index)=>({...recording,rank:index+1}))}));
 const firstHeard=new Set(sorted.filter(row=>new Date(row.first_ever)>=new Date(item.periodStart)).map(row=>row.id));
 const discovered=ranked.filter(entry=>firstHeard.has(String(entry.recording.id))),repeated=ranked.filter(entry=>entry.plays>1).sort((a,b)=>b.plays-a.plays||b.audibleMs-a.audibleMs||String(a.recording.id).localeCompare(String(b.recording.id)));
 const chapters:SavedBloomChapter[]=[];
 function add(id:string,kind:NonNullable<BloomChapter["kind"]>,title:string,label:string,value:number|string,unit="",extra:Partial<SavedBloomChapter>={}){chapters.push({id,kind,title,prompt:title,stat:{label,value,unit},relatedRecording:top,detail:null,...extra});}
 add("listening-time","time","Time became music.","of actual listening",listeningDuration(total));
 const comparison=listeningComparison(total);add("time-comparison","comparison","Let's put that into perspective.","of actual listening",listeningDuration(total),"",{comparison,detail:comparison.detail});
 add("listening-days","days","Music found its way into your days.","days with music",activeDays,"days",{detail:`${activeDays} different days held a little of your listening story.`});
 add("song-count","breadth","A collection all your own.","different recordings heard",sorted.length,"songs",{detail:`${plays} listening moments across ${sorted.length} recordings.`});
 const countdown=ranked.filter(entry=>entry.rank>=3&&entry.rank<=5).reverse();
 if(countdown.length)add("song-countdown","songs","The songs that stayed.","your most-listened songs",countdown.length,"favorites",{recordings:countdown,detail:"Ranked by the time you actually listened."});
 if(runnerUp)add("runner-up","songs","So close to the centre of your story.","your runner-up",2,"",{recordings:[runnerUp],relatedRecording:runnerUp.recording});
 if(winner)add("top-song","song-winner","And the song at the heart of it all…",String(top?.title||"Your leading song"),listeningDuration(winner.audibleMs),"",{recordings:[winner],detail:"Your most-listened recording this period."});
 if(artists[0]){
  const artist=artists[0];add("top-artist","artist","The voice you kept coming back to.",artist.name,listeningDuration(artist.audibleMs),"",{artists:[artist],recordings:artist.recordings.slice(0,1),relatedRecording:artist.recordings[0]?.recording||null,detail:"Your leading artist by listening time. Primary artist credits determine this ranking."});
  add("artist-songs","artist-songs","The songs behind your favorite artist.","the songs behind your favorite artist",artist.recordings.length,"songs",{artists:[artist],recordings:artist.recordings,relatedRecording:artist.recordings[0]?.recording||null});
  if(artists.length>1)add("other-artists","artists","And these voices belonged here too.","more of your favorite artists",Math.min(3,artists.length-1),"artists",{artists:artists.slice(1,4),relatedRecording:artists[1].recordings[0]?.recording||null});
 }
 if(discovered.length)add("discoveries","discoveries","New arrivals, already part of you.","recordings first heard this period",discovered.length,"songs",{recordings:discovered.slice(0,3),relatedRecording:discovered[0].recording,detail:"First heard in your retained Sakura listening history."});
 if(repeated.length){add("returning-songs","returns","Some songs deserved another moment.","recordings you returned to",repeated.length,"songs",{recordings:repeated.slice(0,3),relatedRecording:repeated[0].recording});add("most-replayed","returns","Once was never quite enough.","listening moments with your most revisited song",repeated[0].plays,"plays",{recordings:[repeated[0]],relatedRecording:repeated[0].recording,detail:"Distinct listening events, including partial listens."});}
 const genre=[...genres.entries()].sort((a,b)=>b[1].time-a[1].time||a[0].localeCompare(b[0]))[0];
 if(genre)add("catalog-genre","genres","The colours of your collection.",genre[0],listeningDuration(genre[1].time),"",{recordings:genre[1].recordings.slice(0,3),detail:"From the first published genre tag on each recording."});
 add("listening-moments","pattern","Every little listen left a trace.","listening moments",plays,"moments",{detail:`Together, they became ${listeningDuration(total)} of your life in music.`});
 return {...base,chapters};
}

/** The projection hides every new private collection until its chapter opens. */
export function discloseBloomChapter(chapter:SavedBloomChapter,revealed:boolean):BloomChapter{
 return {...chapter,stat:revealed?chapter.stat:null,relatedRecording:revealed?chapter.relatedRecording:null,detail:revealed?chapter.detail:null,recordings:revealed?chapter.recordings:undefined,artists:revealed?chapter.artists:undefined,comparison:revealed?chapter.comparison:null,revealed};
}
