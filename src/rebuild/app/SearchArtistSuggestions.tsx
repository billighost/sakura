"use client";
import {useMusic} from "./MusicContext";
import {useResource} from "./resources";
import {Icon} from "./Icon";
import {LoadingRows,LoadError} from "./Elements";
import type {SearchArtistSuggestion} from "../recommendations/searchArtists";
import s from "./search-artists.module.css";

export function SearchArtistSuggestions({onChoose}:{onChoose:(name:string)=>void}){
 const {account}=useMusic(),resource=useResource<{artists:SearchArtistSuggestion[];learningEnabled:boolean}>(account?.id||null,"/api/v2/search/suggestions");
 // A newer exclusion or learning choice invalidates the suggestions immediately.
 // Do not leave the old artists visible if refreshing fails while offline.
 const data=resource.updatedAt>0?resource.data:undefined,artists=Array.isArray(data?.artists)?data.artists:[];
 const sourceNames:Record<SearchArtistSuggestion["source"],string>={chosen:"artists you chose",saved:"songs you liked",listening:"your saved listening",genres:"genres in your music and choices",catalog:"the catalog"};
 const sources=[...new Set(artists.map(artist=>sourceNames[artist.source]||"the catalog"))];
 const origins=sources.length>1?`${sources.slice(0,-1).join(", ")} and ${sources[sources.length-1]}`:sources[0];
 return <section className={s.suggestions} aria-label="Artist suggestions">
  <h2>A few places to begin.</h2>
  {!data&&!resource.error&&account?<LoadingRows/>:resource.error&&!data?<LoadError message={resource.error} retry={resource.retry}/>:artists.length?<>
   <p>From {origins}.</p>
   <div className={s.artists}>{artists.map(artist=><button key={artist.id} type="button" onClick={()=>onChoose(artist.name)} aria-label={`Search for ${artist.name}`}><span><b dir="auto">{artist.name}</b><small>{artist.reason}</small></span><Icon name="arrow" size={16}/></button>)}</div>
  </>:<p>Search for a song, artist, or album to begin.</p>}
 </section>;
}
