import type {BloomDesign} from "../uiTypes";
import {bloomWorld} from "./registry";

/** Preload just the assigned authored world, using the same module imports as
 * WorldStage. Opening scores are synthesized locally and need no audio file. */
export function preloadBloomWorld(design:BloomDesign){
 switch(bloomWorld(design).id){
  case "sakura":return import("./sakura/World");
  case "jungle":return import("./jungle/World");
  case "disco":return import("./disco/World");
  case "japan":return import("./japan/World");
  case "china":return import("./china/World");
  case "korea":return import("./korea/World");
  case "india":return import("./india/World");
  case "ocean":return import("./ocean/World");
  case "cosmos":return import("./cosmos/World");
  case "glass":return import("./glass/World");
 }
}
