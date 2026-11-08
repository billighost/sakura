import type {RecordingCard} from "../data/catalog";
import type {BloomArtistInsight,BloomChapter,BloomRankedRecording,BloomListeningProfile} from "./uiTypes";
import type {BloomWindow} from "./calendar";
import {bloomDesignForMonth} from "./design";
import {listeningComparison,listeningDuration} from "./comparisons";
import {buildBloomListening,bloomArtistKey,bloomGenres,type BloomListeningContext,type BloomListeningRow} from "./listening";
import {bloomChapterTitle} from "./story";

export type ListeningRow=BloomListeningRow;
export type SavedBloomChapter=Omit<BloomChapter,"stat"|"revealed">&{stat:NonNullable<BloomChapter["stat"]>};
export interface BloomSnapshot {version?:number;worldId?:string;summary:{audibleMs:number;playCount:number;recordingCount:number;activeDays:number};listening?:BloomListeningProfile;chapters:SavedBloomChapter[]}
const card=(recording:RecordingCard)=>recording as unknown as Record<string,unknown>;
const quantity=(count:number,singular:string)=>`${count} ${singular}${count===1?"":"s"}`;
export function buildBloomSnapshot(rows:readonly ListeningRow[],cards:readonly RecordingCard[],activeDays:number,item:BloomWindow,context:BloomListeningContext={}):BloomSnapshot{
 const sorted=[...rows].filter(row=>Number.isFinite(Number(row.audible_ms))&&Number(row.audible_ms)>0).sort((a,b)=>Number(b.audible_ms)-Number(a.audible_ms)||a.id.localeCompare(b.id));
 const byId=new Map(cards.map(recording=>[recording.id,recording]));
 const total=sorted.reduce((n,row)=>n+Number(row.audible_ms),0),plays=sorted.reduce((n,row)=>n+Number(row.plays),0);
 const summary={audibleMs:total,playCount:plays,recordingCount:sorted.length,activeDays};
 const measurements=buildBloomListening(sorted,cards,activeDays,item,context),listening=measurements.profile;
 const base={version:3,worldId:bloomDesignForMonth(item.periodStart,item.timeZone),summary,...(total?{listening}:{})};
 if(!total)return {...base,chapters:[]};
 const ranked:BloomRankedRecording[]=sorted.flatMap((row,index)=>{const recording=byId.get(row.id);return recording?[{rank:index+1,audibleMs:Number(row.audible_ms),plays:Number(row.plays),recording:card(recording)}]:[];});
 const winner=ranked.find(entry=>entry.rank===1),runnerUp=ranked.find(entry=>entry.rank===2),top=winner?.recording||null;
 const groups=new Map<string,BloomArtistInsight>();
 for(const entry of ranked){
  const recording=byId.get(String(entry.recording.id))!;const credit=recording.artistCredits.find(c=>c.role==="primary");
  const artistId=credit?credit.artistId:recording.artistCredits.length?null:recording.artistId;const key=bloomArtistKey(recording);
  const name=credit?.name||recording.artists[0];
  const imageUrl=artistId&&artistId===recording.artistId?recording.artistImageUrl:null;
  if(key&&name){const prior=groups.get(key);groups.set(key,{key,name,artistId:artistId||null,imageUrl:prior?.imageUrl||imageUrl,audibleMs:(prior?.audibleMs||0)+entry.audibleMs,recordings:[...(prior?.recordings||[]),entry]});}
 }
 const artists=[...groups.values()].sort((a,b)=>b.audibleMs-a.audibleMs||a.key.localeCompare(b.key)).map(artist=>({...artist,recordings:artist.recordings.slice(0,3).map((recording,index)=>({...recording,rank:index+1}))}));
 const discovered=ranked.filter(entry=>measurements.discoveredIds.has(String(entry.recording.id))),returned=ranked.filter(entry=>measurements.returningIds.has(String(entry.recording.id))),repeated=ranked.filter(entry=>entry.plays>1).sort((a,b)=>b.plays-a.plays||b.audibleMs-a.audibleMs||String(a.recording.id).localeCompare(String(b.recording.id)));
 const chapters:SavedBloomChapter[]=[];
 function add(id:string,kind:NonNullable<BloomChapter["kind"]>,label:string,value:number|string,unit="",extra:Partial<SavedBloomChapter>={}){const title=bloomChapterTitle(base.worldId,kind,id);const singular:Record<string,string>={days:"day",songs:"song",artists:"artist",plays:"play",genres:"genre"};chapters.push({id,kind,title,prompt:title,stat:{label,value,unit:value===1?singular[unit]||unit:unit},relatedRecording:top,detail:null,...extra});}
 add("listening-time","time","of actual listening",listeningDuration(total));
 if(!listening.comparison){const comparison=listeningComparison(total);add("time-comparison","comparison","of actual listening",listeningDuration(total),"",{comparison,detail:comparison.detail});}
 add("listening-days","days","days with recorded listening",activeDays,"days",{detail:`${quantity(activeDays,"calendar day")} in ${item.timeZone}. Only recorded listening in this period is included.`});
 if(listening.comparison){const prior=listening.comparison,change=prior.changeMs;add("period-comparison","comparison",change>0?"more recorded listening":change<0?"less recorded listening":"the same recorded listening time",listeningDuration(Math.abs(change)),"",{comparison:{title:`Compared with ${prior.periodLabel}.`,detail:`This period: ${listeningDuration(total)}. ${prior.periodLabel}: ${listeningDuration(prior.audibleMs)}. ${quantity(prior.sharedRecordingCount,"song")} and ${quantity(prior.sharedArtistCount,"artist")} appear in both periods.`,reference:"The two calendar periods shown use this story's time zone. Only dated history you kept is counted. Months and daylight-saving weeks can have different lengths.",approximate:false}});}
 add("song-count","breadth","different songs heard",sorted.length,"songs",{detail:`${quantity(plays,"recorded play")} across ${quantity(sorted.length,"song")}.`});
 const countdown=ranked.filter(entry=>entry.rank>=3&&entry.rank<=5).reverse();
 if(countdown.length)add("song-countdown","songs","your most-listened songs",countdown.length,"songs",{recordings:countdown,detail:"Ranked by recorded listening time."});
 if(runnerUp)add("runner-up","songs","your runner-up",2,"",{recordings:[runnerUp],relatedRecording:runnerUp.recording});
 if(winner)add("top-song","song-winner",String(top?.title||"Your leading song"),listeningDuration(winner.audibleMs),"",{recordings:[winner],detail:"Your most-listened song this period."});
 if(artists[0]){
  const artist=artists[0];add("top-artist","artist",artist.name,listeningDuration(artist.audibleMs),"",{artists:[artist],recordings:artist.recordings.slice(0,1),relatedRecording:artist.recordings[0]?.recording||null,detail:"Your leading artist among songs with known artist details. Totals use the main artist listed for each song."});
  add("artist-songs","artist-songs","songs from your leading artist",artist.recordings.length,"songs",{artists:[artist],recordings:artist.recordings,relatedRecording:artist.recordings[0]?.recording||null});
  const returningArtists=artists.filter(artist=>measurements.artistsReturning.has(artist.key));
  if(returningArtists.length)add("artist-continuity","artists","artists heard before this period",listening.returningArtistCount||0,"artists",{artists:returningArtists.slice(0,3),relatedRecording:returningArtists[0].recordings[0]?.recording||null,detail:"These artists also appear in earlier dated listening kept in your Sakura history."});
  if(artists.length>1)add("other-artists","artists","more artists in your listening",Math.min(3,artists.length-1),"artists",{artists:artists.slice(1,4),relatedRecording:artists[1].recordings[0]?.recording||null});
 }
 if(discovered.length){const artistCount=listening.discoveredArtistCount||0;add("discoveries","discoveries","songs first recorded this period",listening.discoveredRecordingCount||0,"songs",{recordings:discovered.slice(0,3),relatedRecording:discovered[0].recording,detail:`First recorded in the dated Sakura history you have kept. ${quantity(artistCount,"artist")} with known details ${artistCount===1?"is":"are"} first recorded here too. Imported listening without a date is left out of first-listen counts.`});}
 if(returned.length)add("returning-songs","returns","songs heard again",listening.returningRecordingCount||0,"songs",{recordings:returned.slice(0,3),relatedRecording:returned[0].recording,detail:"Heard in an earlier recorded period, or in more than one listening session during this one."});
 if(repeated.length)add("most-replayed","returns","recorded plays of your most revisited song",repeated[0].plays,"plays",{recordings:[repeated[0]],relatedRecording:repeated[0].recording,detail:"Separate recorded plays, including partial listens."});
 const genre=listening.genres?.[0];
 if(genre){const tagged=ranked.filter(entry=>bloomGenres(byId.get(String(entry.recording.id))!).some(name=>name.toLocaleLowerCase("en")===genre.name.toLocaleLowerCase("en")));add("catalog-genre","genres","genres listed for your music",listening.genreCount||0,"genres",{recordings:tagged.slice(0,3),detail:`${genre.name} has the largest share: ${listeningDuration(genre.audibleMs)}. Each song's time is divided equally across the different genres listed for it.${listening.unknownGenreMs?` ${listeningDuration(listening.unknownGenreMs)} has no known genre.`:""}`});}
 if(listening.peakHour!=null){const hour=listening.peakHour,next=(hour+1)%24;add("listening-hours","pattern","hour with the most recorded listening",`${String(hour).padStart(2,"0")}:00–${String(next).padStart(2,"0")}:00`,"",{detail:`Local time in ${item.timeZone}, during this period. The painted light follows the times when listening was recorded.`});}
 if(listening.peakHour==null)add("listening-moments","pattern","recorded plays",plays,"plays",{detail:`${listeningDuration(total)} of measured listening across these plays, including partial listens.`});
 return {...base,chapters};
}

/** The projection hides every new private collection until its chapter opens. */
export function discloseBloomChapter(chapter:SavedBloomChapter,revealed:boolean):BloomChapter{
 return {...chapter,stat:revealed?chapter.stat:null,relatedRecording:revealed?chapter.relatedRecording:null,detail:revealed?chapter.detail:null,recordings:revealed?chapter.recordings:undefined,artists:revealed?chapter.artists:undefined,comparison:revealed?chapter.comparison:null,revealed};
}
