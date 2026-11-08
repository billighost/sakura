/** Shared recommendation rules. This file has no database or browser dependency. */
import {FEED_DEFAULTS} from "../app/feedPreferences";
export interface TasteTrack {
  id:string; title?:string; artists:string[]; artistId?:string|null;
  artistCredits?:{artistId?:string|null;name:string;reference?:{provider:string;id:string}}[];
  genres?:string[]; durationMs?:number|null; explicit?:boolean;
  metadata?:Record<string,unknown>; popularity?:number; releaseDate?:string|null;
}
export interface TasteSettings {
  discovery?:number;artistVariety?:number;repeatTolerance?:number;newReleaseBias?:number;deepCutBias?:number;
  timeAware?:boolean;learnFromListening?:boolean;explicitContent?:boolean;privateSession?:boolean;
  seedArtists?:readonly string[];seedGenres?:readonly string[];
  seedArtistSelections?:readonly {name:string;reference:{provider:string;id:string}}[];timeZone?:string;
}
export interface ListeningEvidence {
  recordingId:string;audibleMs:number;playCount:number;completedCount:number;skippedCount:number;
  lastPlayedAt?:string|number;hours?:number[];hourWeights?:{hour:number;audibleMs:number}[];
}
export interface TasteFeedback {
  target:"recording"|"artist";targetId:string;kind:"love"|"less"|"block"|"snooze";expiresAt?:string|number|null;
}
export interface PersonalizationOptions {
  likedIds?:readonly string[];settings?:TasteSettings;history?:readonly ListeningEvidence[];feedback?:readonly TasteFeedback[];
  nowMs?:number;seed?:string;limit?:number;surface?:"home"|"discover";mode?:"balanced"|"familiar"|"explore";
  evidenceTracks?:readonly TasteTrack[];
}
export interface RankedTrack<T extends TasteTrack> {track:T;score:number;reason:string;lane:"familiar"|"similar"|"explore"|"fresh";familiarArtist:boolean;heard:boolean}
const DAY=86400000;
const normal=(value:string)=>value.normalize("NFKC").trim().toLowerCase();
const amount=(value:number|undefined,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
const stamp=(value:string|number|null|undefined)=>typeof value==="number"?value:typeof value==="string"?Date.parse(value):NaN;
function primaryKeys(track:TasteTrack):string[]{
  const primary=track.artistCredits?.[0];
  const id=track.artistId||primary?.artistId;
  const ref=primary?.reference;
  return [...(id?[`id:${id}`]:[]),...(ref?[`ref:${ref.provider}:${ref.id}`]:[]),...(!id&&!ref?[`name:${normal(track.artists[0]||"")}`]:[])];
}
/** This is a diversity bucket only, never a merge of durable artist identities. */
export function artistDiversityKey(track:TasteTrack):string{return normal(track.artists[0]||track.artistId||track.id);}
export function activeTasteFeedback(feedback:readonly TasteFeedback[],nowMs=Date.now()):TasteFeedback[]{
  return feedback.filter(item=>item.expiresAt==null||(Number.isFinite(stamp(item.expiresAt))&&stamp(item.expiresAt)>nowMs));
}
export function tasteExcluded(track:TasteTrack,feedback:readonly TasteFeedback[],nowMs=Date.now()):boolean{
  const artistIds=new Set([track.artistId,...(track.artistCredits||[]).map(credit=>credit.artistId)].filter(Boolean));
  return activeTasteFeedback(feedback,nowMs).some(item=>(item.kind==="block"||item.kind==="snooze")&&
    (item.target==="recording"?item.targetId===track.id:artistIds.has(item.targetId)));
}
function deterministicNoise(value:string):number{
  let hash=2166136261;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619);}return (hash>>>0)/4294967296;
}
export function recentRelease(releaseDate:string|null|undefined,nowMs=Date.now()):boolean{
  if(typeof releaseDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate))return false;
  const date=Date.parse(releaseDate+"T00:00:00Z");
  return Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===releaseDate&&date<=nowMs&&nowMs-date<=90*DAY;
}
export function rankPersonalizedTracks<T extends TasteTrack>(tracks:readonly T[],options:PersonalizationOptions={}):RankedTrack<T>[]{
  const settings=options.settings||{},now=options.nowMs??Date.now(),feedback=activeTasteFeedback(options.feedback||[],now);
  const candidates=[...new Map(tracks.map(track=>[track.id,track])).values()].filter(track=>
    (settings.explicitContent!==false||!(track.explicit||track.metadata?.explicit==="explicit"))&&!tasteExcluded(track,feedback,now));
  const liked=new Set(options.likedIds||[]),history=new Map((settings.learnFromListening===false?[]:options.history||[]).map(item=>[item.recordingId,item]));
  const artistWeights=new Map<string,number>(),genreWeights=new Map<string,number>(),hourGenres=new Map<string,number>();
  let currentHour=0;
  try{currentHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:settings.timeZone||"Africa/Lagos",hour:"numeric",hourCycle:"h23"}).format(new Date(now)));}catch{currentHour=new Date(now).getUTCHours();}
  const add=(map:Map<string,number>,key:string,value:number)=>{if(value>0&&Number.isFinite(value))map.set(key,(map.get(key)||0)+value);};
  const evidenceTracks=options.evidenceTracks?[...new Map(options.evidenceTracks.map(track=>[track.id,track])).values()].filter(track=>
    !tasteExcluded(track,feedback,now)&&(settings.explicitContent!==false||!(track.explicit||track.metadata?.explicit==="explicit"))):candidates;
  for(const track of evidenceTracks){
    const evidence=history.get(track.id),plays=Math.max(1,evidence?.playCount||0);
    const skipRate=Math.min(1,(evidence?.skippedCount||0)/plays),completion=Math.min(1,(evidence?.completedCount||0)/plays);
    // A short abandoned play supplies little positive taste evidence. A skip alone is not a dislike.
    const listened=evidence?Math.log1p(Math.max(0,evidence.audibleMs)/60000)*(1-skipRate*.7)*(1+completion*.35):0;
    const weight=(liked.has(track.id)?3:0)+listened;
    const deliberate=feedback.find(item=>item.target==="recording"&&item.targetId===track.id);
    const positive=weight*(deliberate?.kind==="less"?.2:1)+(deliberate?.kind==="love"?3:0);
    for(const key of primaryKeys(track))add(artistWeights,key,positive);
    for(const genre of track.genres||[])add(genreWeights,normal(genre),positive/Math.max(1,(track.genres||[]).length));
    if(settings.timeAware!==false&&evidence){
      const byHour=evidence.hourWeights||evidence.hours?.map(hour=>({hour,audibleMs:evidence.audibleMs/Math.max(1,evidence.hours!.length)}))||[];
      for(const item of byHour)if(item.hour===currentHour&&item.audibleMs>0)for(const genre of track.genres||[])add(hourGenres,normal(genre),Math.log1p(item.audibleMs/60000));
    }
  }
  const seeded=new Set((settings.seedArtists||[]).map(normal)),selections=settings.seedArtistSelections||[];
  for(const genre of settings.seedGenres||[])add(genreWeights,normal(genre),4);
  const maximumGenre=Math.max(1,...genreWeights.values()),maximumArtist=Math.max(1,...artistWeights.values()),maximumHour=Math.max(1,...hourGenres.values());
  let discovery=amount(settings.discovery,FEED_DEFAULTS.discovery);
  if(options.surface==="discover")discovery=Math.min(1,discovery+.2);
  if(options.mode==="familiar")discovery=Math.min(.15,discovery);
  if(options.mode==="explore")discovery=Math.max(.85,discovery);
  const repeat=amount(settings.repeatTolerance,FEED_DEFAULTS.repeatTolerance),releaseBias=amount(settings.newReleaseBias,FEED_DEFAULTS.newReleaseBias),deepCuts=amount(settings.deepCutBias,FEED_DEFAULTS.deepCutBias);
  return candidates.map(track=>{
    const evidence=history.get(track.id),heard=Boolean(evidence&&evidence.audibleMs>=30000),keys=primaryKeys(track);
    const artistAffinity=Math.max(0,...keys.map(key=>artistWeights.get(key)||0))/maximumArtist;
    const exactSeed=selections.some(selection=>(track.artistCredits||[]).some(credit=>credit.reference?.provider===selection.reference.provider&&credit.reference.id===selection.reference.id));
    const seededArtist=selections.length?exactSeed:track.artists.some(artist=>seeded.has(normal(artist)))||Boolean(track.artistId&&seeded.has(normal(track.artistId)));
    const familiarArtist=artistAffinity>0||seededArtist;
    const matchingGenre=(track.genres||[]).slice().sort((a,b)=>(genreWeights.get(normal(b))||0)-(genreWeights.get(normal(a))||0))[0];
    const genreAffinity=matchingGenre?(genreWeights.get(normal(matchingGenre))||0)/maximumGenre:0;
    const hourAffinity=settings.timeAware!==false?Math.max(0,...(track.genres||[]).map(genre=>(hourGenres.get(normal(genre))||0)/maximumHour)):0;
    const last=stamp(evidence?.lastPlayedAt),recent=Number.isFinite(last)&&last<=now?Math.exp(-(now-last)/(3*DAY)):0;
    const plays=Math.max(1,evidence?.playCount||0),complete=Math.min(1,(evidence?.completedCount||0)/plays),skips=Math.min(1,(evidence?.skippedCount||0)/plays);
    const trackFeedback=feedback.filter(item=>item.target==="recording"?item.targetId===track.id:track.artistId===item.targetId||track.artistCredits?.some(credit=>credit.artistId===item.targetId));
    const fresh=recentRelease(track.releaseDate,now),popular=amount(track.popularity,.35);
    const affinity=artistAffinity*.8+genreAffinity*.85+(seededArtist ? .65 : 0)+hourAffinity*.35;
    let score=affinity+(familiarArtist?(1-discovery)*1.8:discovery*1.5)+(heard?(1-discovery)*.8:discovery*.9)+
      (liked.has(track.id)?1.35:0)+complete*.35-skips*.4-recent*(1-repeat)*1.4+(fresh?releaseBias*.9:0)+
      (familiarArtist&&!heard&&!liked.has(track.id)?deepCuts*1.1:0)+
      (1-popular)*deepCuts*.05+popular*(1-deepCuts)*.15+deterministicNoise(`${options.seed||new Date(now).toISOString().slice(0,10)}:${track.id}`)*.25;
    if(trackFeedback.some(item=>item.kind==="love"))score+=1;
    if(trackFeedback.some(item=>item.kind==="less"))score-=2;
    let reason:string,lane:RankedTrack<T>["lane"];
    if(fresh&&familiarArtist){reason=`A recent release from ${track.artists[0]||"an artist in your world"}`;lane="fresh";}
    else if(liked.has(track.id)){reason="A song you have liked";lane="familiar";}
    else if(complete>.5&&heard){reason="You often listen to this one all the way through";lane="familiar";}
    else if(familiarArtist&&!heard){reason=`Another side of ${track.artists[0]||"an artist you enjoy"}`;lane="similar";}
    else if(hourAffinity>.3&&matchingGenre){reason=`More ${matchingGenre}, a sound you play around this time`;lane="similar";}
    else if(genreAffinity>0&&matchingGenre){reason=`Connected by your interest in ${matchingGenre}`;lane="similar";}
    else if(heard){reason="A song from your listening history";lane="familiar";}
    else {reason=artistWeights.size||seeded.size||selections.length||genreWeights.size?"An artist to explore alongside your preferences":"A starting point for your recommendations";lane="explore";}
    return {track,score,reason,lane,familiarArtist,heard};
  }).sort((a,b)=>b.score-a.score||a.track.id.localeCompare(b.track.id));
}
/** Greedy sequencing balances relevance with artist spacing and gentle genre continuity. */
export function orderPersonalizedTracks<T extends TasteTrack>(ranked:readonly RankedTrack<T>[],settings:TasteSettings={},limit=ranked.length):RankedTrack<T>[]{
  const pending=ranked.map(item=>({item,key:artistDiversityKey(item.track),genres:(item.track.genres||[]).map(normal)}));
  const ordered:RankedTrack<T>[]=[],counts=new Map<string,number>(),variety=amount(settings.artistVariety,FEED_DEFAULTS.artistVariety),lastArtists:string[]=[];
  let previous:{key:string;genres:Set<string>}|undefined;
  const bound=Math.max(0,Math.min(ranked.length,Math.floor(limit)));
  while(pending.length&&ordered.length<bound){
    let best=0,bestScore=-Infinity;
    const alternate=variety>=.5&&previous&&pending.some(item=>item.key!==previous!.key);
    for(let index=0;index<pending.length;index++){
      const choice=pending[index],key=choice.key,adjacent=previous&&key===previous.key;
      if(alternate&&adjacent)continue;
      const shared=previous&&choice.genres.some(genre=>previous!.genres.has(genre));
      const score=choice.item.score-(adjacent?1.2+variety*2:0)-(lastArtists.includes(key)?variety*.8:0)-Math.log1p(counts.get(key)||0)*variety*.65+(shared ? .13 : 0);
      if(score>bestScore){best=index;bestScore=score;}
    }
    const next=pending.splice(best,1)[0];ordered.push(next.item);counts.set(next.key,(counts.get(next.key)||0)+1);
    previous={key:next.key,genres:new Set(next.genres)};lastArtists.push(next.key);if(lastArtists.length>3)lastArtists.shift();
  }
  return ordered;
}
export function planLocalQueue<T extends TasteTrack>(tracks:readonly T[],options:PersonalizationOptions={}):T[]{
  return orderPersonalizedTracks(rankPersonalizedTracks(tracks,options),options.settings,options.limit??30).map(item=>item.track);
}
