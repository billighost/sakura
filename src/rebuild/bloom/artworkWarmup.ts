import type {BloomPreparedStory} from "./uiTypes";
import {responsiveArtworkSources} from "../player/imageUrl";

/** Warm the next visible sleeves without downloading the entire story at once. */
export function bloomArtworkWarmUrls(prepared:BloomPreparedStory|null,index:number,limit=6){
 if(!prepared)return [];
 const chapters=prepared.chapters;
 const nearby=[chapters[index],chapters[index+1],...chapters.filter(chapter=>["top-song","song-countdown","top-artist"].includes(chapter.id))].filter(Boolean);
 const urls=new Set<string>();
 for(const chapter of nearby){
  const candidates=[chapter.relatedRecording?.coverUrl,...(chapter.recordings||[]).map(entry=>entry.recording.coverUrl),...(chapter.artists||[]).flatMap(artist=>[artist.imageUrl,...artist.recordings.map(entry=>entry.recording.coverUrl)])];
  for(const raw of candidates){
   if(typeof raw!=="string"||!raw)continue;
   const sources=responsiveArtworkSources(raw,true);
   // A 640px sleeve covers a typical phone chapter at retina density. The
   // image's responsive source set still chooses a larger file when needed.
   const medium=sources.srcSet?.split(", ").find(source=>source.endsWith(" 640w"));
   const url=medium?medium.slice(0,-5):sources.src;
   if(url)urls.add(url);
   if(urls.size>=limit)return [...urls];
  }
 }
 return [...urls];
}
