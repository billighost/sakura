import type {RecordingCard} from "../data/catalog";
import type {BloomListeningProfile,BloomListeningSource} from "./uiTypes";
import type {BloomWindow} from "./calendar";

export interface BloomListeningRow {
 id:string;audible_ms:number|string;plays:number;first_ever:Date|string|null;
 first_in_period?:Date|string|null;
}
export interface BloomListeningContext {
 experienceIdentity?:string;
 hours?:readonly {hour:number;audibleMs:number}[];
 /** Local calendar dates in the snapshot's time zone, never receipt dates. */
 days?:readonly {date:string;audibleMs:number;plays?:number}[];
 /** Playback surfaces recorded at the time of listening, never guessed from music metadata. */
 sources?:readonly {context:string|null;audibleMs:number}[];
 knownBeforeRecordingIds?:readonly string[];
 knownBeforeArtistKeys?:readonly string[];
 discoveryUnknownIds?:readonly string[];
 discoveryUnknownArtistKeys?:readonly string[];
 /** Unmapped imported recordings cannot be matched to current catalog IDs. */
 discoveryHistoryIncomplete?:boolean;
 previous?:{periodLabel:string;rows:readonly BloomListeningRow[];cards:readonly RecordingCard[]}|null;
}
const positive=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;};
const date=(value:Date|string|null|undefined)=>value==null?NaN:new Date(value).getTime();
const sourceNames:Record<BloomListeningSource,string>={home:"Home",discover:"Discover",search:"Search",playlist:"Playlists",mix:"Mixes",album:"Albums",artist:"Artist pages",track:"Song pages",library:"Your library",collection:"Collections",downloads:"Downloads",favorites:"Favourites",profile:"Your profile",bloom:"Bloom playback",queue:"Your queue",direct:"Direct playback"};
const queueSources=new Set(["manual-queue","smart-all","smart-liked","smart-downloads","smart-collection"]);
function recordedSources(rows:BloomListeningContext["sources"],total:number){
 if(!rows||!total)return {};
 const measured=rows.reduce((sum,row)=>sum+positive(row.audibleMs),0);
 if(measured>total+.01)return {};
 const groups=new Map<BloomListeningSource,number>();
 for(const row of rows){
  const context=row.context;
  const id=context==="home-feed"?"home":context==="discover-feed"?"discover":context&&queueSources.has(context)?"queue":context;
  if(!id||!Object.prototype.hasOwnProperty.call(sourceNames,id))continue;
  const source=id as BloomListeningSource;
  groups.set(source,(groups.get(source)||0)+positive(row.audibleMs));
 }
 const sources=[...groups].filter(([,ms])=>ms>0).map(([id,audibleMs])=>({id,name:sourceNames[id],audibleMs,share:audibleMs/total}))
  .sort((a,b)=>b.audibleMs-a.audibleMs||a.id.localeCompare(b.id));
 const known=sources.reduce((sum,row)=>sum+row.audibleMs,0);
 return {sources,unknownSourceMs:Math.max(0,total-known)};
}
/** Recording counts and rankings are unique even if a caller supplies partial
 * aggregate rows. Invalid time and play counts cannot poison a saved story. */
export function normaliseBloomRows(rows:readonly BloomListeningRow[]):BloomListeningRow[] {
 const grouped=new Map<string,BloomListeningRow>();
 for(const row of rows){
  const audibleMs=positive(row.audible_ms);if(!row.id||!audibleMs)continue;
  const plays=Math.floor(positive(row.plays)),prior=grouped.get(row.id);
  if(!prior){grouped.set(row.id,{...row,audible_ms:audibleMs,plays});continue;}
  const first=date(prior.first_ever),next=date(row.first_ever);
  const firstInPeriod=[date(prior.first_in_period),date(row.first_in_period)].filter(Number.isFinite);
  grouped.set(row.id,{...prior,audible_ms:positive(prior.audible_ms)+audibleMs,plays:prior.plays+plays,
   first_ever:Number.isFinite(first)&&Number.isFinite(next)?new Date(Math.min(first,next)).toISOString():null,
   ...(firstInPeriod.length?{first_in_period:new Date(Math.min(...firstInPeriod)).toISOString()}: {})});
 }
 return [...grouped.values()];
}
function calendarDate(value:string,timeZone:string){return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));}
function chronology(item:BloomWindow,rows:BloomListeningContext["days"],total:number){
 const start=calendarDate(item.periodStart,item.timeZone),end=calendarDate(item.periodEnd,item.timeZone),byDay=new Map<string,number>();
 for(const row of rows||[]){const stamp=Date.parse(`${row.date}T00:00:00Z`),ms=positive(row.audibleMs);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==row.date||row.date<start||row.date>=end||!ms)continue;
  byDay.set(row.date,(byDay.get(row.date)||0)+ms);
 }
 const days=[...byDay].sort(([a],[b])=>a.localeCompare(b)).map(([date,audibleMs])=>({date,audibleMs}));
 const measured=days.reduce((sum,row)=>sum+row.audibleMs,0);
 // A partial date breakdown cannot establish the period's true peak or
 // its whole-period shares. Production provides the same chunks as total.
 if(!measured||Math.abs(measured-total)>.01)return null;
 const peakDay=[...days].sort((a,b)=>b.audibleMs-a.audibleMs||a.date.localeCompare(b.date))[0];
 let longestStreak={days:1,startDate:days[0].date,endDate:days[0].date},run=1,runStart=days[0].date;
 for(let i=1;i<days.length;i++){
  if(Date.parse(days[i].date)-Date.parse(days[i-1].date)===86400000)run++;
  else {run=1;runStart=days[i].date;}
  if(run>longestStreak.days)longestStreak={days:run,startDate:runStart,endDate:days[i].date};
 }
 const byMonth=new Map<string,number>();let weekendMs=0;
 for(const row of days){const month=row.date.slice(0,7);byMonth.set(month,(byMonth.get(month)||0)+row.audibleMs);const weekday=new Date(`${row.date}T00:00:00Z`).getUTCDay();if(weekday===0||weekday===6)weekendMs+=row.audibleMs;}
 return {peakDay,longestStreak,months:[...byMonth].map(([month,audibleMs])=>({month,audibleMs})),weekendListeningShare:weekendMs/measured};
}
/** Identity follows verified primary credits, never a same-name artist guess. */
export function bloomArtistKey(recording:RecordingCard):string|null {
 const credit=recording.artistCredits.find(c=>c.role==="primary"),reference=credit?.reference;
 if(credit)return credit.artistId||(reference?`${reference.provider}:${reference.id}`:null);
 // A catalog's first linked artist can be a featured credit when the main
 // artist has no verified link. Do not assign that artist the main credit's time.
 return recording.artistCredits.length?null:recording.artistId;
}
/** Case variants and repeated tags represent one genre. Divide each song's
 * measured time equally; the resulting shares never multiply listening time. */
export function bloomGenres(recording:RecordingCard):string[] {
 const tags=new Map<string,string>();
 for(const value of recording.genres){const name=value.trim().replace(/\s+/g," ");if(name&&!tags.has(name.toLocaleLowerCase("en")))tags.set(name.toLocaleLowerCase("en"),name);}
 return [...tags.values()];
}
export function buildBloomListening(rows:readonly BloomListeningRow[],cards:readonly RecordingCard[],activeDays:number,item:BloomWindow,context:BloomListeningContext={}) {
 const heard=normaliseBloomRows(rows),byId=new Map(cards.map(card=>[card.id,card]));
 const total=heard.reduce((sum,row)=>sum+positive(row.audible_ms),0),start=Date.parse(item.periodStart),end=Date.parse(item.periodEnd);
 const unknown=new Set(context.discoveryUnknownIds||[]),knownBefore=new Set(context.knownBeforeRecordingIds||[]);
 for(const row of heard)if(Number.isFinite(date(row.first_ever))&&date(row.first_ever)<start)knownBefore.add(row.id);
 const discoveredIds=new Set(context.discoveryHistoryIncomplete?[]:heard.filter(row=>!unknown.has(row.id)&&!knownBefore.has(row.id)&&date(row.first_ever)>=start&&date(row.first_ever)<end).map(row=>row.id));
 const returningIds=new Set(heard.filter(row=>positive(row.plays)>1||knownBefore.has(row.id)).map(row=>row.id));
 const currentArtists=new Set<string>(),priorArtists=new Set(context.knownBeforeArtistKeys||[]),unknownArtists=new Set(context.discoveryUnknownArtistKeys||[]);
 const firstArtists=new Set<string>(),genreMap=new Map<string,{name:string;audibleMs:number}>();let unknownGenreMs=0;
 for(const row of heard){
  const recording=byId.get(row.id);if(!recording){unknownGenreMs+=positive(row.audible_ms);continue;}
  const artist=bloomArtistKey(recording);
  if(artist){currentArtists.add(artist);if(knownBefore.has(row.id))priorArtists.add(artist);if(unknown.has(row.id)||!Number.isFinite(date(row.first_ever)))unknownArtists.add(artist);if(discoveredIds.has(row.id))firstArtists.add(artist);}
  const tags=bloomGenres(recording),share=tags.length?positive(row.audible_ms)/tags.length:0;
  if(!tags.length)unknownGenreMs+=positive(row.audible_ms);
  for(const name of tags){const key=name.toLocaleLowerCase("en"),prior=genreMap.get(key);genreMap.set(key,{name:prior?.name||name,audibleMs:(prior?.audibleMs||0)+share});}
 }
 const artistsReturning=new Set([...currentArtists].filter(key=>priorArtists.has(key)));
 const artistsDiscovered=new Set([...firstArtists].filter(key=>!priorArtists.has(key)&&!unknownArtists.has(key)));
 const genres=[...genreMap.values()].map(row=>({...row,share:total?row.audibleMs/total:0})).sort((a,b)=>b.audibleMs-a.audibleMs||a.name.localeCompare(b.name));
 const hours=Array.from({length:24},(_,hour)=>({hour,audibleMs:(context.hours||[]).filter(row=>row.hour===hour).reduce((sum,row)=>sum+positive(row.audibleMs),0)}));
 const timedTotal=hours.reduce((sum,row)=>sum+row.audibleMs,0),peak=[...hours].sort((a,b)=>b.audibleMs-a.audibleMs||a.hour-b.hour)[0];
 const band=(hour:number)=>hour>=5&&hour<11?"dawn":hour>=11&&hour<17?"day":hour>=17&&hour<22?"evening":"night";
 const hourBands=(["dawn","day","evening","night"] as const).map(id=>{const audibleMs=hours.filter(row=>band(row.hour)===id).reduce((sum,row)=>sum+row.audibleMs,0);return {id,audibleMs,share:timedTotal?audibleMs/timedTotal:0};});
 const previous=context.previous,previousRows=normaliseBloomRows(previous?.rows||[]),previousTotal=previousRows.reduce((sum,row)=>sum+positive(row.audible_ms),0);
 const previousIds=new Set(previousRows.map(row=>row.id)),previousCards=new Map(previous?.cards.map(card=>[card.id,card])||[]);
 const previousArtistKeys=new Set(previousRows.flatMap(row=>{const card=previousCards.get(row.id),key=card?bloomArtistKey(card):null;return key?[key]:[];}));
 const safeDays=Math.floor(positive(activeDays)),daily=chronology(item,context.days,total);
 const repeatListeningShare=total?heard.filter(row=>positive(row.plays)>1).reduce((sum,row)=>sum+positive(row.audible_ms),0)/total:0;
 const discoveryListeningShare=total?heard.filter(row=>discoveredIds.has(row.id)).reduce((sum,row)=>sum+positive(row.audible_ms),0)/total:0;
 const dominantBand=[...hourBands].sort((a,b)=>b.audibleMs-a.audibleMs)[0];
 const bandNames={dawn:"The early set",day:"The daylight soundtrack",evening:"The evening headliner",night:"The after-hours session"};
 const listeningIdentity=timedTotal&&dominantBand.share>=.5?{name:bandNames[dominantBand.id],detail:`${Math.round(dominantBand.share*100)}% of listening with a recorded hour fell in the ${dominantBand.id} band.`}:
  !context.discoveryHistoryIncomplete&&discoveryListeningShare>=.6?{name:"The new-song explorer",detail:`${Math.round(discoveryListeningShare*100)}% of your listening went to songs first recorded in your retained Sakura history this period.`}:
  repeatListeningShare>=.6?{name:"The encore collector",detail:`${Math.round(repeatListeningShare*100)}% of your listening went to songs with more than one recorded play this period.`}:
  {name:currentArtists.size>=3?"The wide-open soundtrack":"The personal soundtrack",detail:`${heard.length} different ${heard.length===1?"song":"songs"} made up your recorded listening this period.`};
 const profile:BloomListeningProfile={timeZone:item.timeZone,audibleMs:total,activeDays:safeDays,recordingCount:heard.length,artistCount:currentArtists.size,
  ...(safeDays?{averageActiveDayMs:total/safeDays}:{}),repeatListeningShare,listeningIdentity,
  ...(!context.discoveryHistoryIncomplete?{discoveryListeningShare}:{}),...(daily||{}),...recordedSources(context.sources,total),
  genres,genreCount:genres.length,unknownGenreMs,returningRecordingCount:returningIds.size,returningArtistCount:artistsReturning.size,
  ...(!context.discoveryHistoryIncomplete?{discoveredRecordingCount:discoveredIds.size,discoveredArtistCount:artistsDiscovered.size}:{}),
  ...(timedTotal?{peakHour:peak.hour,hourBands}:{peakHour:null}),
  comparison:previous&&previousTotal>0?{periodLabel:previous.periodLabel,audibleMs:previousTotal,changeMs:total-previousTotal,
    sharedRecordingCount:heard.filter(row=>previousIds.has(row.id)).length,sharedArtistCount:[...currentArtists].filter(key=>previousArtistKeys.has(key)).length}:null};
 return {profile,discoveredIds,returningIds,artistsReturning,artistsDiscovered};
}

/** New measurements never bypass the sequential chapter reveal. */
export function discloseBloomListening(profile:BloomListeningProfile|undefined,kinds:ReadonlySet<string>,completed=false):BloomListeningProfile|undefined {
 if(!profile)return undefined;
 if(completed)return profile;
 const result:BloomListeningProfile={timeZone:profile.timeZone};
 if(kinds.has("time"))result.audibleMs=profile.audibleMs;
 if(kinds.has("days"))result.activeDays=profile.activeDays;
 if(kinds.has("breadth"))result.recordingCount=profile.recordingCount;
 if(kinds.has("artist")||kinds.has("artists"))result.artistCount=profile.artistCount;
 if(kinds.has("artist-continuity"))result.returningArtistCount=profile.returningArtistCount;
 if(kinds.has("returns")){result.returningRecordingCount=profile.returningRecordingCount;result.returningArtistCount=profile.returningArtistCount;}
 if(kinds.has("discoveries")){result.discoveredRecordingCount=profile.discoveredRecordingCount;result.discoveredArtistCount=profile.discoveredArtistCount;}
 if(kinds.has("genres")){result.genres=profile.genres;result.genreCount=profile.genreCount;result.unknownGenreMs=profile.unknownGenreMs;}
 if(kinds.has("pattern")){result.peakHour=profile.peakHour;result.hourBands=profile.hourBands;}
 if(kinds.has("period-comparison"))result.comparison=profile.comparison;
 if(kinds.has("average-day"))result.averageActiveDayMs=profile.averageActiveDayMs;
 if(kinds.has("replay-share"))result.repeatListeningShare=profile.repeatListeningShare;
 if(kinds.has("discovery-share"))result.discoveryListeningShare=profile.discoveryListeningShare;
 if(kinds.has("peak-day"))result.peakDay=profile.peakDay;
 if(kinds.has("listening-streak"))result.longestStreak=profile.longestStreak;
 // Per-month durations would give away the later peak-month and two-act
 // reveals when only the count of active months has opened.
 if(kinds.has("half-year-shift"))result.months=profile.months;
 if(kinds.has("weekend-rhythm"))result.weekendListeningShare=profile.weekendListeningShare;
 if(kinds.has("listening-character"))result.listeningIdentity=profile.listeningIdentity;
 if(kinds.has("listening-source")){result.sources=profile.sources;result.unknownSourceMs=profile.unknownSourceMs;}
 return Object.keys(result).length>1?result:undefined;
}
