import type {BloomDesign,BloomItem} from "./uiTypes";

const designs:BloomDesign[]=["herbarium","nocturne","risograph"];

function seed(value:number){
 let hash=2166136261;
 for(const character of `sakura-bloom:${value}`){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return hash>>>0;
}

function rawQuarterOrder(quarter:number){
 const order=[...designs];let state=seed(quarter);
 for(let index=order.length-1;index>0;index--){
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  const target=state%(index+1);[order[index],order[target]]=[order[target],order[index]];
 }
 return order;
}

function quarterOrder(quarter:number){
 const order=rawQuarterOrder(quarter),previousLast=rawQuarterOrder(quarter-1)[2];
 if(order[0]===previousLast)[order[0],order[1]]=[order[1],order[0]];
 return order;
}

export function bloomDesignForMonth(value:string|Date,timeZone="Africa/Lagos"):BloomDesign{
 const date=value instanceof Date?value:new Date(value);
 if(Number.isNaN(date.getTime()))throw new Error("Bloom design requires a valid date");
 const parts=new Intl.DateTimeFormat("en-US",{year:"numeric",month:"numeric",timeZone}).formatToParts(date);
 const year=Number(parts.find(part=>part.type==="year")?.value),month=Number(parts.find(part=>part.type==="month")?.value);
 const quarter=year*4+Math.floor((month-1)/3);
 return quarterOrder(quarter)[(month-1)%3];
}

export function bloomDesignForItem(item:Pick<BloomItem,"periodStart"|"timeZone">){
 return bloomDesignForMonth(item.periodStart,item.timeZone);
}
