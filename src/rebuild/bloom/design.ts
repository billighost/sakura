import type {BloomDesign,BloomItem} from "./uiTypes";
import {BLOOM_WORLDS,isBloomWorld} from "./worlds/registry";

const designs:BloomDesign[]=BLOOM_WORLDS.map(world=>world.id);
const DAY=86400000;

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
 const {year,month}=localDate(value,timeZone);
 return year*12+month-1;
}

function localDate(value:string|Date,timeZone:string){
 const date=value instanceof Date?value:new Date(value);
 if(Number.isNaN(date.getTime()))throw new Error("Bloom design requires a valid date");
 const parts=new Intl.DateTimeFormat("en-US",{year:"numeric",month:"numeric",day:"numeric",timeZone}).formatToParts(date);
 return {year:Number(parts.find(part=>part.type==="year")?.value),month:Number(parts.find(part=>part.type==="month")?.value),day:Number(parts.find(part=>part.type==="day")?.value)};
}

function rotatingDesign(index:number):BloomDesign{
 const cycle=Math.floor(index/designs.length),position=((index%designs.length)+designs.length)%designs.length;
 return cycleOrder(cycle)[position];
}

export function bloomDesignForMonth(value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 return rotatingDesign(localMonth(value,timeZone));
}

/** Each cadence owns a complete, deterministic world rotation. Weekly Blooms
 * must advance every week rather than inheriting one design for the month. */
export function bloomDesignForPeriod(period:BloomItem["period"],value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 const date=localDate(value,timeZone);
 if(period==="monthly")return rotatingDesign(date.year*12+date.month-1);
 if(period==="yearly")return rotatingDesign(date.year);
 const monday=Math.floor(Date.UTC(date.year,date.month-1,date.day)/DAY/7);
 return rotatingDesign(monday);
}

export function legacyBloomDesignForMonth(value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 const index=localMonth(value,timeZone);
 return cycleOrder(Math.floor(index/3),["herbarium","nocturne","risograph"])[index%3];
}

export function bloomDesignForItem(item:Pick<BloomItem,"periodStart"|"timeZone"|"worldId"|"version">&Partial<Pick<BloomItem,"period">>){
 if(isBloomWorld(item.worldId)||["herbarium","nocturne","risograph"].includes(item.worldId||""))return item.worldId!;
 if(item.version===1)return legacyBloomDesignForMonth(item.periodStart,item.timeZone);
 // Version 2 predates cadence-aware worlds. Preserve its original fallback so
 // old snapshots without a stored world do not visually change on revisit.
 if(item.version===2||!item.period)return bloomDesignForMonth(item.periodStart,item.timeZone);
 return bloomDesignForPeriod(item.period,item.periodStart,item.timeZone);
}
