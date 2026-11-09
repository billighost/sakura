import type {RecordingCard} from "../data/catalog";
import type {BloomArtistInsight,BloomChapter,BloomRankedRecording,BloomListeningProfile} from "./uiTypes";
import type {BloomWindow} from "./calendar";
import {bloomDesignForPeriod} from "./design";
import {listeningComparison,listeningDuration} from "./comparisons";
import {buildBloomListening,bloomArtistKey,bloomGenres,normaliseBloomRows,type BloomListeningContext,type BloomListeningRow} from "./listening";
import {bloomChapterTitle} from "./story";
import {createBloomExperience,experienceChoice,type BloomExperience} from "./experience";

export type ListeningRow=BloomListeningRow;
export type SavedBloomChapter=Omit<BloomChapter,"stat"|"revealed">&{stat:NonNullable<BloomChapter["stat"]>};
export interface BloomSnapshot {version?:number;worldId?:string;experience?:BloomExperience;summary:{audibleMs:number;playCount:number;recordingCount:number;activeDays:number};listening?:BloomListeningProfile;chapters:SavedBloomChapter[]}
const card=(recording:RecordingCard)=>recording as unknown as Record<string,unknown>;
const quantity=(count:number,singular:string)=>`${count} ${singular}${count===1?"":"s"}`;
export function buildBloomSnapshot(rows:readonly ListeningRow[],cards:readonly RecordingCard[],activeDays:number,item:BloomWindow,context:BloomListeningContext={}):BloomSnapshot{
 const sorted=normaliseBloomRows(rows).sort((a,b)=>Number(b.audible_ms)-Number(a.audible_ms)||a.id.localeCompare(b.id));
 const byId=new Map(cards.map(recording=>[recording.id,recording]));
 const total=sorted.reduce((n,row)=>n+Number(row.audible_ms),0),plays=sorted.reduce((n,row)=>n+Number(row.plays),0);
 const measurements=buildBloomListening(sorted,cards,activeDays,item,context),listening=measurements.profile;
 const summary={audibleMs:total,playCount:plays,recordingCount:sorted.length,activeDays:listening.activeDays||0};
 const worldId=bloomDesignForPeriod(item.period,item.periodStart,item.timeZone);
 const experience=createBloomExperience(context.experienceIdentity||`${item.id}|${item.timeZone}`,worldId);
 const base={version:4,worldId,experience,summary,...(total?{listening}:{})};
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
 const artists=[...groups.values()].sort((a,b)=>b.audibleMs-a.audibleMs||a.key.localeCompare(b.key)).map(artist=>({...artist,recordingCount:artist.recordings.length,recordings:artist.recordings.slice(0,3).map((recording,index)=>({...recording,rank:index+1}))}));
 const discovered=ranked.filter(entry=>measurements.discoveredIds.has(String(entry.recording.id))),returned=ranked.filter(entry=>measurements.returningIds.has(String(entry.recording.id)));
 const mostRepeatedRow=sorted.filter(row=>row.plays>1).sort((a,b)=>b.plays-a.plays||Number(b.audible_ms)-Number(a.audible_ms)||a.id.localeCompare(b.id))[0];
 const mostRepeated=ranked.find(entry=>String(entry.recording.id)===mostRepeatedRow?.id);
 const chapters:SavedBloomChapter[]=[];
 function add(id:string,kind:NonNullable<BloomChapter["kind"]>,label:string,value:number|string,unit="",extra:Partial<SavedBloomChapter>={}){const title=bloomChapterTitle(base.worldId,kind,id,base.experience);const singular:Record<string,string>={days:"day",songs:"song",artists:"artist",plays:"play",genres:"genre",months:"month"};chapters.push({id,kind,title,prompt:title,stat:{label,value,unit:value===1?singular[unit]||unit:unit},relatedRecording:top,detail:null,...extra});}
 add("listening-time","time","of actual listening",listeningDuration(total));
 if(!listening.comparison){const comparison=listeningComparison(total,base.experience);add("time-comparison","comparison","of actual listening",listeningDuration(total),"",{comparison,detail:comparison.detail});}
 add("listening-days","days","days with recorded listening",summary.activeDays,"days",{detail:`${quantity(summary.activeDays,"calendar day")} in ${item.timeZone}. Only recorded listening in this period is included.`});
 if(listening.comparison){const prior=listening.comparison,change=prior.changeMs;add("period-comparison","comparison",change>0?"more recorded listening":change<0?"less recorded listening":"the same recorded listening time",listeningDuration(Math.abs(change)),"",{comparison:{title:`Compared with ${prior.periodLabel}.`,detail:`This period: ${listeningDuration(total)}. ${prior.periodLabel}: ${listeningDuration(prior.audibleMs)}. ${quantity(prior.sharedRecordingCount,"song")} and ${quantity(prior.sharedArtistCount,"artist")} appear in both periods.`,reference:"The two calendar periods shown use this story's time zone. Only dated history you kept is counted. Months and daylight-saving weeks can have different lengths.",approximate:false}});}
 add("song-count","breadth","different songs heard",sorted.length,"songs",{detail:`${quantity(plays,"recorded play")} across ${quantity(sorted.length,"song")}.`});
 const countdown=ranked.filter(entry=>entry.rank>=3&&entry.rank<=5).reverse();
 if(countdown.length)add("song-countdown","songs","your most-listened songs",countdown.length,"songs",{recordings:countdown,detail:"Ranked by recorded listening time."});
 if(runnerUp)add("runner-up","songs","your runner-up",2,"",{recordings:[runnerUp],relatedRecording:runnerUp.recording});
 if(winner)add("top-song","song-winner",String(top?.title||"Your leading song"),listeningDuration(winner.audibleMs),"",{recordings:[winner],detail:"Your most-listened song this period."});
 if(winner&&sorted.length>1)add("top-song-share","breadth","of your listening went to your number one",`${Math.round(winner.audibleMs/total*100)}%`,"",{detail:`${String(top?.title||"Your leading song")} held ${listeningDuration(winner.audibleMs)} of your ${listeningDuration(total)} soundtrack. Ranked by listening time, including partial plays.`});
 if(artists[0]){
  const artist=artists[0];add("top-artist","artist",artist.name,listeningDuration(artist.audibleMs),"",{artists:[artist],recordings:artist.recordings.slice(0,1),relatedRecording:artist.recordings[0]?.recording||null,detail:"Your leading artist among songs with known artist details. Totals use the main artist listed for each song."});
  add("artist-songs","artist-songs","songs from your leading artist",artist.recordingCount||artist.recordings.length,"songs",{artists:[artist],recordings:artist.recordings,relatedRecording:artist.recordings[0]?.recording||null,detail:`${quantity(artist.recordingCount||artist.recordings.length,"song")} from ${artist.name} made your soundtrack. ${artist.recordings.length<(artist.recordingCount||0)?"These are the three you listened to most.":"These are the songs you listened to most."}`});
  const returningArtists=artists.filter(artist=>measurements.artistsReturning.has(artist.key));
  if(returningArtists.length)add("artist-continuity","artists","artists heard before this period",listening.returningArtistCount||0,"artists",{artists:returningArtists.slice(0,3),relatedRecording:returningArtists[0].recordings[0]?.recording||null,detail:"These artists also appear in earlier dated listening kept in your Sakura history."});
  if(artists.length>1)add("other-artists","artists","more artists in your listening",artists.length-1,"artists",{artists:artists.slice(1,4),relatedRecording:artists[1].recordings[0]?.recording||null,detail:`${quantity(artists.length-1,"other artist")} joined your soundtrack. Here are ${Math.min(3,artists.length-1)} of the names you heard most.`});
 }
 if(discovered.length){const artistCount=listening.discoveredArtistCount||0;add("discoveries","discoveries","songs first recorded this period",listening.discoveredRecordingCount||0,"songs",{recordings:discovered.slice(0,3),relatedRecording:discovered[0].recording,detail:`First recorded in the dated Sakura history you have kept. ${quantity(artistCount,"artist")} with known details ${artistCount===1?"is":"are"} first recorded here too. Imported listening without a date is left out of first-listen counts.`});}
 if(returned.length)add("returning-songs","returns","songs heard again",listening.returningRecordingCount||0,"songs",{recordings:returned.slice(0,3),relatedRecording:returned[0].recording,detail:"Heard in an earlier recorded period, or in more than one listening session during this one."});
 if(mostRepeated)add("most-replayed","returns","recorded plays of your most revisited song",mostRepeated.plays,"plays",{recordings:[mostRepeated],relatedRecording:mostRepeated.recording,detail:"Separate recorded plays, including partial listens."});
 const genre=listening.genres?.[0];
 if(genre){const tagged=ranked.filter(entry=>bloomGenres(byId.get(String(entry.recording.id))!).some(name=>name.toLocaleLowerCase("en")===genre.name.toLocaleLowerCase("en")));add("catalog-genre","genres","genres listed for your music",listening.genreCount||0,"genres",{recordings:tagged.slice(0,3),detail:`${genre.name} has the largest share: ${listeningDuration(genre.audibleMs)}. Each song's time is divided equally across the different genres listed for it.${listening.unknownGenreMs?` ${listeningDuration(listening.unknownGenreMs)} has no known genre.`:""}`});}
 if(listening.peakHour!=null){const hour=listening.peakHour,next=(hour+1)%24;add("listening-hours","pattern","hour with the most recorded listening",`${String(hour).padStart(2,"0")}:00–${String(next).padStart(2,"0")}:00`,"",{detail:`Local time in ${item.timeZone}, during this period. The painted light follows the times when listening was recorded.`});}
 if(listening.peakHour==null)add("listening-moments","pattern","recorded plays",plays,"plays",{detail:`${listeningDuration(total)} of measured listening across these plays, including partial listens.`});
 if(listening.listeningIdentity)add("listening-character","pattern","your listening signature this time",listening.listeningIdentity.name,"",{detail:listening.listeningIdentity.detail});
 const percent=(share:number)=>`${Math.round(share*100)}%`;
 const longForm=item.period!=="weekly";
 if(longForm){
  const source=listening.sources?.[0];
  if(source){
   const title=experienceChoice(["Where your soundtrack took off.","The places behind your plays.","Every soundtrack starts somewhere."],experience.seed,"source-chapter-title");
   const unknown=listening.unknownSourceMs||0;
   add("listening-source","breadth","your leading known listening source",source.name,"",{title,prompt:title,detail:`${listening.sources!.map(row=>`${row.name}: ${percent(row.share)}`).join(". ")}. Shares use recorded listening time, including partial listens.${unknown?` ${percent(unknown/total)} has no recognised source and stays outside the ranking.`:""} These are the places where playback began; they do not describe why you chose a song.`});
  }
  if(listening.averageActiveDayMs)add("average-day","time","on an average listening day",listeningDuration(listening.averageActiveDayMs),"",{detail:`Your ${listeningDuration(total)} soundtrack, divided across ${quantity(summary.activeDays,"day")} when listening was recorded. Quiet days are outside this average.`});
  if(listening.discoveryListeningShare&&sorted.length>1)add("discovery-share","breadth","of your listening went to first-recorded songs",percent(listening.discoveryListeningShare),"",{detail:`${quantity(measurements.discoveredIds.size,"song")} first appeared in your retained dated Sakura history this period. Fresh additions brought a new colour to your soundtrack.`});
  if(listening.repeatListeningShare&&sorted.length>1)add("replay-share","breadth","of your listening went to songs you played again",percent(listening.repeatListeningShare),"",{detail:"Time spent on songs with at least two recorded plays this period. This includes their first play; partial plays count as separate recorded plays."});
  if(sorted.length>5){const five=sorted.slice(0,5).reduce((sum,row)=>sum+Number(row.audible_ms),0);add("top-five-share","breadth","of your soundtrack belonged to your top five",percent(five/total),"",{detail:`Your five most-listened songs held ${listeningDuration(five)}. The other ${quantity(sorted.length-5,"song")} gave your soundtrack its remaining colours.`});}
  if(artists.length>1)add("artist-count","breadth","different main artists in your soundtrack",listening.artistCount||0,"artists",{detail:`${artists[0].name} led with ${percent(artists[0].audibleMs/total)} of your total listening time. Only songs with a known main artist contribute to the artist count.`});
  if(genre&&listening.genres!.length>1)add("genre-leader","genres","the biggest genre colour in your soundtrack",genre.name,"",{detail:`${percent(genre.share)} of all your listening time: ${listeningDuration(genre.audibleMs)}. A song's time is divided equally across its listed genres, so the shares do not multiply your listening time.`});
  const dominant=[...(listening.hourBands||[])].sort((a,b)=>b.audibleMs-a.audibleMs)[0];
  if(dominant?.audibleMs){const names={dawn:"05:00–11:00",day:"11:00–17:00",evening:"17:00–22:00",night:"22:00–05:00"};add("time-of-day","pattern","your biggest listening window",names[dominant.id],"",{detail:`${percent(dominant.share)} of listening with a recorded hour fell in this window, in ${item.timeZone}. Your music found its strongest rhythm here.`});}
  const dayLabel=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString("en",{day:"numeric",month:"long",timeZone:"UTC"});
  if(listening.peakDay&&summary.activeDays>1)add("peak-day","days","your biggest listening day",dayLabel(listening.peakDay.date),"",{detail:`${listeningDuration(listening.peakDay.audibleMs)} of listening on this date, in ${item.timeZone}. This is the day with the most recorded listening time.`});
  if(listening.longestStreak&&listening.longestStreak.days>1){const streak=listening.longestStreak;add("listening-streak","days","consecutive days with recorded listening",streak.days,"days",{detail:`From ${dayLabel(streak.startDate)} to ${dayLabel(streak.endDate)}, you kept the soundtrack going. Counted as local calendar dates in ${item.timeZone}, including daylight-saving changes.`});}
 }
 if(item.period==="yearly"&&listening.months?.length){
  const months=listening.months,monthLabel=(value:string)=>new Date(`${value}-15T12:00:00Z`).toLocaleDateString("en",{month:"long",timeZone:"UTC"});
  add("active-months","days","months with recorded listening",months.length,"months",{detail:`${months.map(row=>monthLabel(row.month)).join(", ")}. Every month shown contains dated listening kept in your Sakura history.`});
  if(months.length>1){
   const peak=[...months].sort((a,b)=>b.audibleMs-a.audibleMs||a.month.localeCompare(b.month))[0];
   add("peak-month","time","the month with your biggest soundtrack",monthLabel(peak.month),"",{detail:`${listeningDuration(peak.audibleMs)} of recorded listening. ${percent(peak.audibleMs/total)} of the year's soundtrack happened here.`});
   const first=months[0],last=months[months.length-1];
   add("year-opening","pattern","the first month in your recorded year",monthLabel(first.month),"",{detail:`Your retained soundtrack begins here with ${listeningDuration(first.audibleMs)}. The year grew from this first chapter.`});
   add("year-closing","pattern","the final month in your recorded year",monthLabel(last.month),"",{detail:`${listeningDuration(last.audibleMs)} in the final month with recorded listening. The last colours in this year's bloom.`});
   const quarters=[0,0,0,0];for(const row of months)quarters[Math.floor((Number(row.month.slice(5))-1)/3)]+=row.audibleMs;
   const quarter=quarters.indexOf(Math.max(...quarters)),quarterLabels=["January–March","April–June","July–September","October–December"];
   add("season-spotlight","time","the three-month stretch that led your year",quarterLabels[quarter],"",{detail:`${listeningDuration(quarters[quarter])} of recorded listening, ${percent(quarters[quarter]/total)} of your year's total. This calendar quarter was your soundtrack's biggest chapter.`});
   const firstHalf=months.filter(row=>Number(row.month.slice(5))<=6).reduce((sum,row)=>sum+row.audibleMs,0),lastHalf=months.filter(row=>Number(row.month.slice(5))>6).reduce((sum,row)=>sum+row.audibleMs,0);
   if(firstHalf&&lastHalf)add("half-year-shift","comparison","how your recorded year unfolded",lastHalf>firstHalf?"A louder second act":lastHalf<firstHalf?"A bigger opening act":"Two equal acts","",{comparison:{title:"Your year in two acts.",detail:`January–June: ${listeningDuration(firstHalf)}. July–December: ${listeningDuration(lastHalf)}. ${listeningDuration(Math.abs(lastHalf-firstHalf))} ${lastHalf===firstHalf?"difference":lastHalf>firstHalf?"more in the second half":"more in the first half"}.`,reference:"Compared using dated audible listening kept in Sakura. Both halves use this bloom's saved time zone; calendar lengths and retained coverage can differ.",approximate:false}});
  }
  if(listening.weekendListeningShare!=null&&summary.activeDays>1)add("weekend-rhythm","pattern","of dated listening landed on Saturday or Sunday",percent(listening.weekendListeningShare),"",{detail:`${percent(1-listening.weekendListeningShare)} fell on Monday–Friday. Your soundtrack had its own weekly rhythm, measured by listening time on local calendar dates in ${item.timeZone}.`});
 }
 return {...base,chapters};
}

/** The projection hides every new private collection until its chapter opens. */
export function discloseBloomChapter(chapter:SavedBloomChapter,revealed:boolean):BloomChapter{
 return {...chapter,stat:revealed?chapter.stat:null,relatedRecording:revealed?chapter.relatedRecording:null,detail:revealed?chapter.detail:null,recordings:revealed?chapter.recordings:undefined,artists:revealed?chapter.artists:undefined,comparison:revealed?chapter.comparison:null,revealed};
}
