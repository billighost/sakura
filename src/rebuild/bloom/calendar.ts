/** Calendar windows are shared with the client, but availability is enforced by
 * the server. Dates identify local calendar periods, never rolling durations. */
export type BloomPeriod = "weekly" | "monthly" | "yearly";
export type BloomStatus = "locked" | "available" | "expired" | "empty";
export const DEFAULT_BLOOM_TIME_ZONE = "Africa/Lagos";
const DAY = 86400000;
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", {timeZone:value}).format(0); return true; } catch { return false; }
}
function parts(value:Date, timeZone:string) {
  const entries=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(value);
  const values=Object.fromEntries(entries.filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));
  return {year:values.year,month:values.month,day:values.day,hour:values.hour,minute:values.minute,second:values.second};
}
const dateKey=(date:Date)=>date.toISOString().slice(0,10);
const shift=(date:Date,days:number)=>new Date(date.getTime()+days*DAY);
/** Find a local midnight, including offset changes at daylight-saving edges. */
function midnight(date:Date,timeZone:string):Date {
  const target=date.getTime();let guess=target;
  for(let i=0;i<6;i++){
    const p=parts(new Date(guess),timeZone),represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const delta=target-represented;if(!delta)return new Date(guess);guess+=delta;
  }
  // Rare zones skip local midnight. Use the first representable instant of the
  // desired date rather than rejecting a valid IANA timezone.
  const desired=dateKey(date);let low=target-36*3600000,high=target+36*3600000;
  for(let i=0;i<30;i++){const middle=Math.floor((low+high)/2),p=parts(new Date(middle),timeZone);
    const local=dateKey(new Date(Date.UTC(p.year,p.month-1,p.day)));
    if(local<desired)low=middle+1;else high=middle;
  }
  return new Date(high);
}
export interface BloomWindow {
  id:string; period:BloomPeriod; periodStart:string; periodEnd:string;
  publishAt:string; expiresAt:string; timeZone:string; status:Exclude<BloomStatus,"empty">;
}
export function bloomWindow(id:string,now:Date=new Date(),timeZone=DEFAULT_BLOOM_TIME_ZONE):BloomWindow {
  if(!validTimeZone(timeZone)||!Number.isFinite(now.getTime()))throw new Error("Invalid Bloom calendar");
  const match=/^(weekly|monthly|yearly)-(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(id);
  if(!match)throw new Error("Invalid Bloom ID");
  const period=match[1] as BloomPeriod,year=Number(match[2]),month=Number(match[3]||1),day=Number(match[4]||1);
  if(year<2000||year>2100||month<1||month>12||day<1||day>31||
    (period==="weekly"&&!match[4])||(period==="monthly"&&(!match[3]||match[4]))||(period==="yearly"&&match[3]))throw new Error("Invalid Bloom ID");
  const start=new Date(Date.UTC(year,month-1,day));
  if(start.getUTCMonth()!==month-1||start.getUTCDate()!==day||(period==="weekly"&&start.getUTCDay()!==1))throw new Error("Invalid Bloom period");
  const end=period==="weekly"?shift(start,7):new Date(Date.UTC(year,period==="monthly"?month:12,1));
  const expiry=period==="weekly"?shift(end,6):period==="monthly"?shift(new Date(Date.UTC(year,month+1,1)),-7):new Date(Date.UTC(year+2,0,1));
  const publishAt=midnight(end,timeZone),expiresAt=midnight(expiry,timeZone);
  return {id,period,periodStart:midnight(start,timeZone).toISOString(),periodEnd:publishAt.toISOString(),publishAt:publishAt.toISOString(),expiresAt:expiresAt.toISOString(),timeZone,
    status:now<publishAt?"locked":now>=expiresAt?"expired":"available"};
}
export function currentBloomId(period:BloomPeriod,now:Date=new Date(),timeZone=DEFAULT_BLOOM_TIME_ZONE):string {
  if(!validTimeZone(timeZone))throw new Error("Invalid timezone");
  const p=parts(now,timeZone),date=new Date(Date.UTC(p.year,p.month-1,p.day));
  if(period==="weekly")return `weekly-${dateKey(shift(date,-((date.getUTCDay()+6)%7)))}`;
  return `${period}-${String(p.year)}${period==="monthly"?`-${String(p.month).padStart(2,"0")}`:""}`;
}
export function bloomWindows(period:BloomPeriod,now:Date=new Date(),timeZone=DEFAULT_BLOOM_TIME_ZONE):BloomWindow[] {
  const current=bloomWindow(currentBloomId(period,now,timeZone),now,timeZone);
  const p=parts(new Date(current.periodStart),timeZone),date=new Date(Date.UTC(p.year,p.month-1,p.day));
  const previous=period==="weekly"?`weekly-${dateKey(shift(date,-7))}`:period==="monthly"?`monthly-${dateKey(new Date(Date.UTC(p.year,p.month-2,1))).slice(0,7)}`:`yearly-${p.year-1}`;
  return [bloomWindow(previous,now,timeZone),current];
}
