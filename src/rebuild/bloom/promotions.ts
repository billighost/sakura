import type {BloomPeriod,BloomShelfItem} from "./uiTypes";

const DAY=86_400_000;
const prominence:Record<BloomPeriod,number>={weekly:1,monthly:2,yearly:3};
const dayFormats=new Map<string,Intl.DateTimeFormat>();
export type BloomPromotionPhase="anticipation"|"launch"|"reminder"|"closing";
export interface BloomPromotion {
 item:BloomShelfItem;phase:BloomPromotionPhase;key:string;eyebrow:string;
 title:string;detail:string;action:string;href:string;timing:string;
}

/** Compare local calendar days, not 24-hour durations: DST days can be shorter
 * or longer, and the listener's time zone can differ from the device's. */
function localDay(value:number,timeZone:string){
 let format=dayFormats.get(timeZone);
 if(!format){format=new Intl.DateTimeFormat("en",{year:"numeric",month:"numeric",day:"numeric",timeZone});if(dayFormats.size>=20)dayFormats.delete(dayFormats.keys().next().value!);dayFormats.set(timeZone,format);}
 const parts=format.formatToParts(new Date(value));
 const part=(type:string)=>Number(parts.find(value=>value.type===type)?.value);
 return Date.UTC(part("year"),part("month")-1,part("day"))/DAY;
}
function offset(item:BloomShelfItem,time:number){return localDay(time,item.timeZone)-localDay(Date.parse(item.publishAt),item.timeZone);}
function copyIndex(value:string,size:number){let hash=2166136261;for(const char of value)hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0)%size;}

function campaign(item:BloomShelfItem,time:number):{phase:BloomPromotionPhase;day:number;untilClose:number}|null{
 const publish=Date.parse(item.publishAt),expiry=Date.parse(item.expiresAt);
 if(!Number.isFinite(time)||!Number.isFinite(publish)||!Number.isFinite(expiry)||item.completed||item.status==="empty"||item.status==="expired"||item.status==="archived")return null;
 try{
  const day=offset(item,time),untilClose=localDay(expiry,item.timeZone)-localDay(time,item.timeZone);
  if(item.status==="locked"&&time<publish){
   const lead=item.period==="weekly"?1:item.period==="monthly"?3:14;
   return day>=-lead&&day<0?{phase:"anticipation",day,untilClose}:null;
  }
  // Stale cached readiness never makes an unopened or expired story actionable.
  if(item.status!=="available"||time<publish||time>=expiry)return null;
  if(day===0)return {phase:"launch",day,untilClose};
  const openingRun=item.period==="weekly"?1:item.period==="monthly"?3:14;
  const milestones=item.period==="weekly"?[]:item.period==="monthly"?[7,14]:[30,60,90,120,180,240,270,300,330];
  const closingDays=item.period==="weekly"?0:item.period==="monthly"?3:7;
  if(closingDays&&untilClose<=closingDays)return {phase:"closing",day,untilClose};
  return day<=openingRun||milestones.includes(day)?{phase:"reminder",day,untilClose}:null;
 }catch{return null;}
}

export function bloomPromotions(items:readonly BloomShelfItem[],now=new Date()):BloomPromotion[]{
 const time=now.getTime();
 return items.flatMap(item=>{
  const moment=campaign(item,time);if(!moment)return [];
  const {phase,day,untilClose}=moment,period=item.period==="weekly"?"week":item.period==="monthly"?"month":"year";
  const key=`${item.id}:${phase}:${day}`;
  const anticipation=["Your soundtrack is about to bloom.","A little anticipation. A whole world of music.","The next chapter has your name on it."];
  const reminder=["Your music has a story. Come see it.","The songs you lived with deserve their moment.","There's a world waiting in your listening."];
  const timing=phase==="anticipation"?day===-1?"Opens tomorrow":`Opens in ${-day} days`:phase==="launch"?"Just opened today":phase==="closing"?untilClose===1?"Last day to open":`Closes in ${untilClose} days`:day===1?"Opened yesterday":"Ready when you are";
  const title=phase==="anticipation"?anticipation[copyIndex(key,anticipation.length)]:phase==="launch"?`Your ${period} in music is ready.`:phase==="closing"?`One more chance to open your ${period}.`:reminder[copyIndex(key,reminder.length)];
  const detail=phase==="anticipation"?item.period==="yearly"?"A year of saved listening is becoming your biggest Bloom. Songs, artists, discoveries and a world made for your music.":`The music you save this ${period} becomes an illustrated story. Come back for the reveal.`:item.period==="yearly"?"Your biggest listening story of the year: the songs you returned to, the artists you kept close, and the moments behind the music.":item.period==="monthly"?"A month of music, with more moments to uncover. Step into your listening world and meet the songs and artists behind it.":"Your songs, your artists, your listening moments. Step into an illustrated world made from the music you saved.";
  return [{item,phase,key,eyebrow:`${item.period.toUpperCase()} BLOOM`,title,detail,action:phase==="anticipation"?"See what's coming":"Check your Sakura Bloom",href:phase==="anticipation"?`/bloom?period=${item.period}`:`/bloom/${encodeURIComponent(item.id)}`,timing}];
 }).sort((a,b)=>prominence[b.item.period]-prominence[a.item.period]||Number(b.phase==="launch")-Number(a.phase==="launch")||Date.parse(b.item.publishAt)-Date.parse(a.item.publishAt));
}

/** Wake the mounted home banner at the next local day or access boundary. */
export function nextBloomPromotionBoundary(items:readonly BloomShelfItem[],now=new Date()):string|undefined{
 const time=now.getTime();if(!Number.isFinite(time))return undefined;
 const candidates:number[]=[];
 for(const item of items){
  if(item.status!=="available"&&item.status!=="locked"&&item.status!=="empty")continue;
  for(const date of [item.publishAt,item.expiresAt]){const stamp=Date.parse(date);if(stamp>time)candidates.push(stamp);}
  try{
   const today=localDay(time,item.timeZone);let low=time+1,high=time+2*DAY;
   while(low<high){const middle=Math.floor((low+high)/2);if(localDay(middle,item.timeZone)<=today)low=middle+1;else high=middle;}
   candidates.push(high);
  }catch{ /* An invalid cached item cannot break the rest of Home. */ }
 }
 return candidates.length?new Date(Math.min(...candidates)).toISOString():undefined;
}
