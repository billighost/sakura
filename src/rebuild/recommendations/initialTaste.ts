import type {TasteFeedback,TasteSettings,TasteTrack} from "./personalization";

export interface InitialTasteArtist {
 key:string;name:string;reference?:{provider:string;id:string};
 recordings:{id:string;artistId:string|null;artistIds?:string[];genres:string[]}[];
}
/** A catalog-based starting recipe, never a synthetic listening record. */
export interface InitialTasteProfile {
 version:1;origin:"chosen-artists";signature:string;artists:InitialTasteArtist[];
 genres:{name:string;weight:number}[];recordingCount:number;
}
const normal=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
export function initialTasteArtists(settings:TasteSettings):Omit<InitialTasteArtist,"recordings">[]{
 const selections=settings.seedArtistSelections||[],names=new Set(selections.map(artist=>normal(artist.name)));
 const artists=[...selections.map(artist=>({key:`ref:${artist.reference.provider}:${artist.reference.id}`,name:artist.name,reference:artist.reference})),
  ...(settings.seedArtists||[]).filter(name=>!names.has(normal(name))).map(name=>({key:`name:${normal(name)}`,name}))];
 return [...new Map(artists.map(artist=>[artist.key,artist])).values()].slice(0,20);
}
export function initialTasteSignature(settings:TasteSettings):string {
 const recipe=JSON.stringify([initialTasteArtists(settings).map(artist=>[artist.key,normal(artist.name)]).sort((a,b)=>a[0].localeCompare(b[0])),settings.explicitContent!==false]);
 let hash=2166136261;for(let i=0;i<recipe.length;i++){hash^=recipe.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,"0");
}
const tags=(values:readonly unknown[])=>{const unique=new Map<string,string>();for(const name of values)if(typeof name==="string"&&name.trim()&&name.length<=80&&!unique.has(normal(name)))unique.set(normal(name),name.trim());return [...unique.values()].slice(0,12);};
function catalogGenreWeights(artists:readonly InitialTasteArtist[],feedback:readonly TasteFeedback[]=[],nowMs=Date.now()){
 const blocked=feedback.filter(item=>(item.kind==="block"||item.kind==="snooze")&&(item.expiresAt==null||Number(item.expiresAt)>nowMs||Date.parse(String(item.expiresAt))>nowMs));
 const genres=new Map<string,{name:string;weight:number}>();
 for(const artist of artists){
  const recordings=artist.recordings.filter(recording=>!blocked.some(item=>item.target==="recording"?item.targetId===recording.id:item.targetId===recording.artistId||recording.artistIds?.includes(item.targetId)));
  for(const recording of recordings)for(const name of recording.genres){const key=normal(name),prior=genres.get(key);genres.set(key,{name:prior?.name||name,weight:(prior?.weight||0)+1/Math.max(1,recordings.length)/Math.max(1,recording.genres.length)});}
 }
 const maximum=Math.max(1,...[...genres.values()].map(genre=>genre.weight));
 return [...genres.values()].map(genre=>({...genre,weight:genre.weight/maximum})).sort((a,b)=>b.weight-a.weight||a.name.localeCompare(b.name)).slice(0,12);
}
export function buildInitialTasteProfile(tracks:readonly TasteTrack[],settings:TasteSettings):InitialTasteProfile {
 const candidates=[...new Map(tracks.map(track=>[track.id,track])).values()].filter(track=>settings.explicitContent!==false||!(track.explicit||track.metadata?.explicit==="explicit"));
 const artists=initialTasteArtists(settings).map(artist=>{
  const recordings=candidates.flatMap(track=>{
   const credits=track.artistCredits||[],primary=credits.find(credit=>credit.role==="primary")||credits.find(credit=>credit.role===undefined);
   const name=primary?.name||(!credits.length?track.artists[0]:undefined),reference=primary?.reference;
   const matches=artist.reference?reference?.provider===artist.reference.provider&&reference.id===artist.reference.id:name&&normal(name)===normal(artist.name);
   return matches?[{id:track.id,artistId:primary?primary.artistId||null:credits.length?null:track.artistId||null,artistIds:[...new Set([track.artistId,...credits.map(credit=>credit.artistId)].filter((id):id is string=>Boolean(id)))].slice(0,30),genres:tags(track.genres||[])}]:[];
  }).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,8);
  return {...artist,recordings};
 });
 return {version:1,origin:"chosen-artists",signature:initialTasteSignature(settings),artists,genres:catalogGenreWeights(artists),recordingCount:new Set(artists.flatMap(artist=>artist.recordings.map(recording=>recording.id))).size};
}
/** Browser mirrors are untrusted and cannot carry history, URLs or extra fields. */
export function normalizeInitialTasteProfile(value:unknown):InitialTasteProfile|undefined {
 if(!value||typeof value!=="object"||Array.isArray(value))return;
 const raw=value as Record<string,unknown>;if(raw.version!==1||raw.origin!=="chosen-artists"||typeof raw.signature!=="string"||!/^[a-f0-9]{8}$/.test(raw.signature)||!Array.isArray(raw.artists)||raw.artists.length>20)return;
 const artists:InitialTasteArtist[]=[];
 for(const value of raw.artists){
  if(!value||typeof value!=="object")return;const artist=value as Record<string,unknown>;
  if(typeof artist.key!=="string"||artist.key.length>180||typeof artist.name!=="string"||!artist.name.trim()||artist.name.length>120||!Array.isArray(artist.recordings)||artist.recordings.length>8)return;
  const reference=artist.reference as {provider?:unknown;id?:unknown}|undefined;
  if(reference&&(typeof reference.provider!=="string"||!['deezer','spotify'].includes(reference.provider)||typeof reference.id!=="string"||reference.id.length>80))return;
  const recordings:InitialTasteArtist["recordings"]=[];
  for(const value of artist.recordings){if(!value||typeof value!=="object")return;const track=value as Record<string,unknown>;if(typeof track.id!=="string"||!track.id||track.id.length>120||!(track.artistId==null||typeof track.artistId==="string"&&track.artistId.length<=120)||!Array.isArray(track.genres)||track.genres.length>12)return;const artistIds=Array.isArray(track.artistIds)?track.artistIds:[];if(artistIds.length>30||artistIds.some(id=>typeof id!=="string"||!id||id.length>120))return;recordings.push({id:track.id,artistId:typeof track.artistId==="string"?track.artistId:null,artistIds:[...new Set(artistIds)] as string[],genres:tags(track.genres)});}
  artists.push({key:artist.key,name:artist.name,...(reference?{reference:{provider:reference.provider as string,id:reference.id as string}}:{}),recordings:[...new Map(recordings.map(track=>[track.id,track])).values()]});
 }
 return {version:1,origin:"chosen-artists",signature:raw.signature,artists,genres:catalogGenreWeights(artists),recordingCount:new Set(artists.flatMap(artist=>artist.recordings.map(track=>track.id))).size};
}
export function initialTasteGenreWeights(settings:TasteSettings,feedback:readonly TasteFeedback[]=[],nowMs=Date.now()){
 const profile=normalizeInitialTasteProfile(settings.initialTasteProfile);return profile?.signature===initialTasteSignature(settings)?catalogGenreWeights(profile.artists,feedback,nowMs):[];
}
