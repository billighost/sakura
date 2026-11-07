import type {BloomDesign,BloomItem} from "./uiTypes";
import {BLOOM_WORLDS,isBloomWorld} from "./worlds/registry";

const designs:BloomDesign[]=BLOOM_WORLDS.map(world=>world.id);

function seed(value:number){
 let hash=2166136261;
 for(const character of `sakura-bloom:${value}`){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return hash>>>0;
}

function rawCycleOrder(cycle:number,palette:readonly BloomDesign[]=designs){
 const order=[...palette];let state=seed(cycle);
 for(let index=order.length-1;index>0;index--){
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  const target=state%(index+1);[order[index],order[target]]=[order[target],order[index]];
 }
 return order;
}

function cycleOrder(cycle:number,palette:readonly BloomDesign[]=designs){
 const order=rawCycleOrder(cycle,palette),previousLast=rawCycleOrder(cycle-1,palette)[palette.length-1];
 if(order[0]===previousLast)[order[0],order[1]]=[order[1],order[0]];
 return order;
}

function localMonth(value:string|Date,timeZone:string){
 const date=value instanceof Date?value:new Date(value);
 if(Number.isNaN(date.getTime()))throw new Error("Bloom design requires a valid date");
 const parts=new Intl.DateTimeFormat("en-US",{year:"numeric",month:"numeric",timeZone}).formatToParts(date);
 const year=Number(parts.find(part=>part.type==="year")?.value),month=Number(parts.find(part=>part.type==="month")?.value);
 return year*12+month-1;
}

export function bloomDesignForMonth(value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 const index=localMonth(value,timeZone),cycle=Math.floor(index/designs.length);
 return cycleOrder(cycle)[index%designs.length];
}

export function legacyBloomDesignForMonth(value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 const index=localMonth(value,timeZone);
 return cycleOrder(Math.floor(index/3),["herbarium","nocturne","risograph"])[index%3];
}

export function bloomDesignForItem(item:Pick<BloomItem,"periodStart"|"timeZone"|"worldId"|"version">){
 if(isBloomWorld(item.worldId)||["herbarium","nocturne","risograph"].includes(item.worldId||""))return item.worldId!;
 return item.version===1?legacyBloomDesignForMonth(item.periodStart,item.timeZone):bloomDesignForMonth(item.periodStart,item.timeZone);
}
