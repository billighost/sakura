import type {BloomDesign} from "./uiTypes";
import {bloomWorld} from "./worlds/registry";
import {BLOOM_COVER_REVISION} from "./coverRevision";

/** Card artwork is rendered once at build-authoring time, never while scrolling. */
export function bloomCoverImage(design:BloomDesign,theme:"light"|"dark"){
 const world=bloomWorld(design).id,base=`/bloom/covers/${world}-${theme}`;
 return {src:`${base}-480.webp?v=${BLOOM_COVER_REVISION}`,srcSet:`${base}-480.webp?v=${BLOOM_COVER_REVISION} 480w, ${base}-960.webp?v=${BLOOM_COVER_REVISION} 960w`,width:960,height:720};
}
