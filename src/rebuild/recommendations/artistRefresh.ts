import type {ArtistSelection} from "../data/artistSelection";

const nameKey=(name:string)=>name.normalize("NFKC").trim().toLocaleLowerCase("en");
const referenceKey=(artist:ArtistSelection)=>`${artist.reference.provider}:${artist.reference.id}`;
/** Recent explicit/listening interests lead each bounded refresh. The remaining
 * slots rotate through every choice rather than permanently dropping the tail. */
export function planArtistCatalogRefresh(chosen:readonly ArtistSelection[],names:readonly string[],interested:readonly ArtistSelection[],nowMs:number){
  const priority=[...new Map(interested.map(artist=>[referenceKey(artist),artist])).values()].slice(0,4),priorityKeys=new Set(priority.map(referenceKey));
  const exact=[...new Map([...chosen,...interested].map(artist=>[referenceKey(artist),artist])).values()];
  const exactNames=new Set(exact.map(artist=>nameKey(artist.name)));
  const legacy=[...new Map(names.filter(name=>!exactNames.has(nameKey(name))).map(name=>[nameKey(name),name])).values()];
  const pool=[...exact.filter(artist=>!priorityKeys.has(referenceKey(artist))).map(artist=>({artist,name:artist.name})),...legacy.map(name=>({artist:undefined,name}))];
  const remaining=20-priority.length,start=pool.length?Math.floor(nowMs/(30*60*1000))*remaining%pool.length:0;
  const selected=Array.from({length:Math.min(remaining,pool.length)},(_,index)=>pool[(start+index)%pool.length]);
  return {artistSelections:[...priority,...selected.flatMap(item=>item.artist?[item.artist]:[])],artists:selected.filter(item=>!item.artist).map(item=>item.name)};
}
