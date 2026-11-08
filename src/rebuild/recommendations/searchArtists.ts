import {activeTasteFeedback,tasteExcluded,type ListeningEvidence,type TasteFeedback,type TasteSettings,type TasteTrack} from "./personalization";
import {initialTasteGenreWeights} from "./initialTaste";

export interface SearchArtistCandidate {id:string;name:string;reference?:{provider:string;id:string}}
export interface SearchArtistSuggestion {id:string;name:string;reason:string;source:"chosen"|"saved"|"listening"|"genres"|"catalog"}
const normalized=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
const positive=(value:number|undefined)=>Number.isFinite(value)?Math.max(0,value||0):0;
const dated=(value:string|number|undefined)=>typeof value==="number"?value:typeof value==="string"?Date.parse(value):NaN;
export function searchPrimaryArtistId(track:TasteTrack):string|null {
 const credits=track.artistCredits||[],primary=credits.find(credit=>credit.role==="primary")||credits.find(credit=>credit.role===undefined);
 // A known primary credit with no linked ID remains unknown. The display card's
 // first linked artist can be a featured guest and cannot inherit that history.
 return primary?primary.artistId||null:credits.length?null:track.artistId||null;
}

/** Search entry points use artist identity and audible listening, never a skip
 * judgment or completion score. Same-name artists do not share measurements. */
export function rankSearchArtists(artists:readonly SearchArtistCandidate[],tracks:readonly TasteTrack[],options:{settings?:TasteSettings;history?:readonly ListeningEvidence[];likedIds?:readonly string[];feedback?:readonly TasteFeedback[];nowMs?:number;limit?:number}={}) :SearchArtistSuggestion[]{
 const settings=options.settings||{},now=options.nowMs??Date.now(),feedback=activeTasteFeedback(options.feedback||[],now),likes=new Set(options.likedIds||[]);
 const history=new Map((settings.learnFromListening===false?[]:options.history||[]).map(row=>[row.recordingId,row]));
 const eligible=[...new Map(tracks.map(track=>[track.id,track])).values()].filter(track=>!tasteExcluded(track,feedback,now)&&(settings.explicitContent!==false||!(track.explicit||track.metadata?.explicit==="explicit")));
 const recordings=new Map<string,TasteTrack[]>(),measurements=new Map<string,{audibleMs:number;returnCount:number;last:number;saved:number;requested:number}>(),genreWeights=new Map<string,number>();
 for(const genre of initialTasteGenreWeights(settings,feedback,now))genreWeights.set(normalized(genre.name),genre.weight*1.5);
 for(const genre of settings.seedGenres||[])genreWeights.set(normalized(genre),4);
 for(const track of eligible){
  const artistId=searchPrimaryArtistId(track);if(!artistId)continue;
  recordings.set(artistId,[...(recordings.get(artistId)||[]),track]);
  const heard=history.get(track.id),previous=measurements.get(artistId)||{audibleMs:0,returnCount:0,last:NaN,saved:0,requested:0},stamp=dated(heard?.lastPlayedAt);
  const audible=positive(heard?.audibleMs),saved=likes.has(track.id)?1:0,influence=feedback.some(item=>item.target==="recording"&&item.targetId===track.id&&item.kind==="less")?.2:1,requested=feedback.some(item=>item.target==="recording"&&item.targetId===track.id&&item.kind==="love")?1:0;
  measurements.set(artistId,{audibleMs:previous.audibleMs+audible*influence,returnCount:previous.returnCount+(audible>0&&positive(heard?.playCount)>1?influence:0),saved:previous.saved+saved*influence,requested:previous.requested+requested,last:Number.isFinite(stamp)&&stamp<=now?Math.max(Number.isFinite(previous.last)?previous.last:0,stamp):previous.last});
  const genres=[...new Set((track.genres||[]).map(normalized).filter(Boolean))],weight=((saved?3:0)+Math.log1p(audible/60000))*influence+(requested?3:0);
  for(const genre of genres)genreWeights.set(genre,(genreWeights.get(genre)||0)+weight/Math.max(1,genres.length));
 }
 const selections=settings.seedArtistSelections||[],selectedNames=new Set(selections.map(selection=>normalized(selection.name))),legacyNames=new Set((settings.seedArtists||[]).map(normalized).filter(name=>!selectedNames.has(name))),maximumGenre=Math.max(1,...genreWeights.values());
 const ranked=[...new Map(artists.map(artist=>[artist.id,artist])).values()].flatMap(artist=>{
  if(!artist.name.trim()||!recordings.has(artist.id)||feedback.some(item=>item.target==="artist"&&item.targetId===artist.id&&(item.kind==="block"||item.kind==="snooze")))return [];
  const chosen=selections.some(selection=>selection.reference.provider===artist.reference?.provider&&selection.reference.id===artist.reference.id)||legacyNames.has(normalized(artist.name));
  const data=measurements.get(artist.id)!,related=Math.max(0,...recordings.get(artist.id)!.flatMap(track=>(track.genres||[]).map(genre=>(genreWeights.get(normalized(genre))||0)/maximumGenre)));
  const loved=feedback.some(item=>item.target==="artist"&&item.targetId===artist.id&&item.kind==="love"),less=feedback.some(item=>item.target==="artist"&&item.targetId===artist.id&&item.kind==="less");
  const recency=Number.isFinite(data.last)?Math.exp(-(now-data.last)/(30*86400000)):0;
  let score=(chosen?7:0)+(data.saved?4+Math.min(2,Math.log1p(data.saved)):0)+Math.log1p(data.audibleMs/60000)*.7+Math.min(3,data.returnCount)*.18+recency*.5+related*.8+(loved||data.requested?4:0);
  if(less)score*=.2;
  const source:SearchArtistSuggestion["source"]=chosen||loved||data.requested?"chosen":data.saved?"saved":data.audibleMs>0?"listening":related>0?"genres":"catalog";
  const reason=source==="chosen"?(chosen||loved?"An artist you chose":"From your song choices"):source==="saved"?"From songs you liked":source==="listening"?(data.returnCount>0?"From songs you heard again":"From your recorded listening"):source==="genres"?"From genres in your music and choices":"From the catalog";
  return [{id:artist.id,name:artist.name,reason,source,score}];
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 // Avoid duplicate-looking search buttons; keep the highest ranked identity
 // without ever merging another same-name artist's evidence into it.
 const names=new Set<string>();return ranked.filter(artist=>{const name=normalized(artist.name);if(names.has(name))return false;names.add(name);return true;}).slice(0,Math.max(0,Math.min(12,options.limit??6))).map(artist=>({id:artist.id,name:artist.name,reason:artist.reason,source:artist.source}));
}
