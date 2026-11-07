import type { BloomQuality } from "./worlds/types";
export type BloomPerformance = "auto" | "1" | "2" | "3" | "4" | "5";
export const BLOOM_QUALITY_LEVELS = [
 {tier:1,name:"Essential",description:"Beautiful still detail and a lighter world."},
 {tier:2,name:"Gentle",description:"More illustration, subtle movement and atmosphere."},
 {tier:3,name:"Rich",description:"Deep scenery, animated branches and painted light."},
 {tier:4,name:"Cinematic",description:"Dense worlds, layered motion and elaborate reveals."},
 {tier:5,name:"Maximum",description:"Every flourish: the fullest artwork, depth and motion."},
] as const;
export interface BloomDeviceHints {cores?:number;memory?:number;saveData?:boolean;frameMs?:number}
export function deviceBloomTier(hints:BloomDeviceHints):BloomQuality {
 const cores=hints.cores??4,memory=hints.memory??4;
 let tier:BloomQuality=cores>=12&&memory>=8?5:cores>=8&&memory>=4?4:cores>=4&&memory>=4?3:cores>=4?2:1;
 if(hints.memory!==undefined&&memory<=2)tier=Math.min(tier,2) as BloomQuality;
 if(hints.saveData)tier=Math.min(tier,2) as BloomQuality;
 if(hints.frameMs!==undefined){if(hints.frameMs>36)tier=Math.min(tier,2) as BloomQuality;else if(hints.frameMs>24)tier=Math.min(tier,3) as BloomQuality;}
 return tier;
}
export function selectedBloomTier(setting:unknown,automatic:BloomQuality):BloomQuality {return typeof setting==="string"&&/^[1-5]$/.test(setting)?Number(setting) as BloomQuality:automatic;}
