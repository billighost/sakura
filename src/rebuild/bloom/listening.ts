import type {RecordingCard} from "../data/catalog";
import type {BloomListeningProfile} from "./uiTypes";
import type {BloomWindow} from "./calendar";

export interface BloomListeningRow {
 id:string;audible_ms:number|string;plays:number;first_ever:Date|string|null;
 first_in_period?:Date|string|null;
}
export interface BloomListeningContext {
 hours?:readonly {hour:number;audibleMs:number}[];
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
 const heard=rows.filter(row=>positive(row.audible_ms)>0),byId=new Map(cards.map(card=>[card.id,card]));
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
 const previous=context.previous,previousRows=previous?.rows.filter(row=>positive(row.audible_ms)>0)||[],previousTotal=previousRows.reduce((sum,row)=>sum+positive(row.audible_ms),0);
 const previousIds=new Set(previousRows.map(row=>row.id)),previousCards=new Map(previous?.cards.map(card=>[card.id,card])||[]);
 const previousArtistKeys=new Set(previousRows.flatMap(row=>{const card=previousCards.get(row.id),key=card?bloomArtistKey(card):null;return key?[key]:[];}));
 const profile:BloomListeningProfile={timeZone:item.timeZone,audibleMs:total,activeDays:Math.max(0,activeDays),recordingCount:heard.length,artistCount:currentArtists.size,
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
 return Object.keys(result).length>1?result:undefined;
}
