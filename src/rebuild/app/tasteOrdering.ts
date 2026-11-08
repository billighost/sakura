import type {TasteFeedback} from "../recommendations/personalization";

/** Canonical UTC stamps retain PostgreSQL microseconds when replies race. */
export function tasteStamp(value:string|number|null|undefined):string|null {
 if(value==null)return null;
 if(typeof value==="string"){
  const precise=value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/);
  if(precise&&Number.isFinite(Date.parse(value)))return precise[1]+"."+(precise[2]||"").padEnd(6,"0")+"Z";
 }
 const time=typeof value==="number"?value:Date.parse(value);
 return Number.isFinite(time)?new Date(time).toISOString().replace(/\.(\d{3})Z$/,(_match,fraction:string)=>"."+fraction+"000Z"):null;
}
export const tasteTargetKey=(choice:Pick<TasteFeedback,"target"|"targetId">)=>choice.target+":"+choice.targetId;

/** A clear's reply cannot replace choices or undo actions committed after it. */
export function retainedFeedback(current:readonly TasteFeedback[],remaining:readonly TasteFeedback[],cutoff:string,removed:ReadonlyMap<string,string>):TasteFeedback[] {
 const result=new Map(remaining.map(choice=>[tasteTargetKey(choice),choice]));
 for(const choice of current){const stamp=tasteStamp(choice.updatedAt),prior=result.get(tasteTargetKey(choice));if(stamp&&stamp>cutoff&&(!prior||stamp>=(tasteStamp(prior.updatedAt)||"")))result.set(tasteTargetKey(choice),choice);}
 for(const [key,stamp]of removed){const prior=result.get(key);if(stamp>cutoff&&(!prior||stamp>=(tasteStamp(prior.updatedAt)||"")))result.delete(key);}
 return [...result.values()];
}
