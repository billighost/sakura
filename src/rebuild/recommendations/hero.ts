import {orderPersonalizedTracks,rankPersonalizedTracks,type PersonalizationOptions,type RankedTrack,type TasteTrack} from "./personalization";

export const HERO_REFRESH_MS=10*60*1000;
const SHORTLIST_SIZE=16;
function seedOffset(value:string){let hash=2166136261;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}

/** Rotate a small, ranked selection; keep each account's two gardens distinct. */
export function personalizedHeroPicks<T extends TasteTrack>(tracks:readonly T[],options:PersonalizationOptions={}){
 const now=options.nowMs??Date.now(),bucket=Math.floor(now/HERO_REFRESH_MS),seed=options.seed||"hero";
 // Ranking noise stays constant between windows. The rotation, rather than a
 // tiny score perturbation, ensures the highest-scoring song isn't always first.
 const rank=(surface:"home"|"discover")=>orderPersonalizedTracks(rankPersonalizedTracks(tracks,{...options,surface,seed:seed+":hero:"+surface}),options.settings,SHORTLIST_SIZE);
 const homePool=rank("home"),discoverPool=rank("discover");
 const choose=(pool:RankedTrack<T>[],surface:string)=>pool.length?pool[(bucket+seedOffset(seed+":"+surface))%pool.length]:null;
 const home=choose(homePool,"home");
 const different=discoverPool.filter(item=>item.track.id!==home?.track.id);
 const discover=choose(different.length?different:discoverPool,"discover");
 return {home,discover,refreshAt:(bucket+1)*HERO_REFRESH_MS};
}
