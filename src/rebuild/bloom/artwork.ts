import {responsiveArtworkSources,sameOriginArtworkUrl} from "../player/imageUrl";
import type {BloomPreparedStory} from "./uiTypes";

/** Older saved cards keep artwork under metadata, as the chapter renderer does. */
export function bloomRecordingArtwork(recording:Record<string,unknown>|null|undefined){
 const metadata=recording?.metadata as Record<string,unknown>|undefined;
 const raw=recording?.coverUrl||metadata?.coverUrl;
 return typeof raw==="string"&&raw?raw:undefined;
}

/** Preparation and the chapter share one concrete display source. Saved sources
 * remain valid at another DPR offline; an export still requests original pixels. */
export function bloomDisplayArtwork(raw:string,viewportWidth=390,pixelRatio=2,saved?:string){
 const sources=responsiveArtworkSources(raw,true);
 const variants=(sources.srcSet||"").split(", ").map(value=>{
  const match=/^(.*) (\d+)w$/.exec(value);return match?{url:match[1],width:Number(match[2])}:null;
 }).filter((value):value is {url:string;width:number}=>value!==null);
 const allowed=[sources.src,...variants.map(value=>value.url)];
 if(saved&&allowed.includes(saved))return saved;
 const viewport=Number.isFinite(viewportWidth)&&viewportWidth>0?viewportWidth:390;
 const ratio=Number.isFinite(pixelRatio)&&pixelRatio>0?Math.min(pixelRatio,4):2;
 const required=(viewport<=750?viewport*.7:340)*ratio;
 return variants.find(value=>value.width>=required)?.url||variants.at(-1)?.url||sameOriginArtworkUrl(raw)!;
}

export function bloomPreparedArtwork(prepared:BloomPreparedStory,rawUrls:readonly string[],options:{viewportWidth?:number;pixelRatio?:number;offline?:boolean}={}){
 return Object.fromEntries(rawUrls.map(raw=>[raw,bloomDisplayArtwork(raw,options.viewportWidth,options.pixelRatio,options.offline?prepared.artwork?.[raw]:undefined)]));
}
