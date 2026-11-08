import type {BloomShelfItem} from "./uiTypes";

const priority={weekly:0,monthly:1,yearly:2};
/** One ready story and the nearest opening keep Home quiet, across all periods. */
export function bloomShelfItems(items:readonly BloomShelfItem[],now=new Date()):BloomShelfItem[]{
 const time=now.getTime();
 const current=items.filter(item=>(item.status==="available"||item.status==="empty")&&Date.parse(item.publishAt)<=time&&Date.parse(item.expiresAt)>time)
  .sort((a,b)=>Number(a.status==="empty")-Number(b.status==="empty")||priority[a.period]-priority[b.period]||Date.parse(b.publishAt)-Date.parse(a.publishAt))[0];
 const upcoming=items.filter(item=>item.status==="locked"&&Date.parse(item.publishAt)>time)
  .sort((a,b)=>Date.parse(a.publishAt)-Date.parse(b.publishAt)||priority[a.period]-priority[b.period])[0];
 return [current,upcoming].filter((item):item is BloomShelfItem=>Boolean(item));
}

export function bloomOpeningDate(value:string,timeZone:string){
 return new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",timeZone,timeZoneName:"short"}).format(new Date(value));
}
