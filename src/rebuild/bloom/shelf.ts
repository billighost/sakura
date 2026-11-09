import type {BloomShelfItem} from "./uiTypes";
import {bloomPromotions} from "./promotions";

const priority={weekly:0,monthly:1,yearly:2};
/** Keep a ready story beside the next opening, while giving monthly and annual
 * campaign moments their turn instead of always burying them behind weekly. */
export function bloomShelfItems(items:readonly BloomShelfItem[],now=new Date()):BloomShelfItem[]{
 const time=now.getTime();
 const featured=bloomPromotions(items,now)[0]?.item.id;
 const current=items.filter(item=>(item.status==="available"||item.status==="empty")&&Date.parse(item.publishAt)<=time&&Date.parse(item.expiresAt)>time)
  .sort((a,b)=>Number(a.status==="empty")-Number(b.status==="empty")||Number(b.id===featured)-Number(a.id===featured)||Number(Boolean(a.completed))-Number(Boolean(b.completed))||priority[a.period]-priority[b.period]||Date.parse(b.publishAt)-Date.parse(a.publishAt))[0];
 const upcoming=items.filter(item=>item.status==="locked"&&Date.parse(item.publishAt)>time)
  .sort((a,b)=>Number(b.id===featured)-Number(a.id===featured)||Date.parse(a.publishAt)-Date.parse(b.publishAt)||priority[a.period]-priority[b.period])[0];
 return [current,upcoming].filter((item):item is BloomShelfItem=>Boolean(item));
}

export function bloomOpeningDate(value:string,timeZone:string){
 return new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",timeZone,timeZoneName:"short"}).format(new Date(value));
}
