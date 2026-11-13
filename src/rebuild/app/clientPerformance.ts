export type ClientJourney="startup"|"bootstrap"|"device_restore"|"navigation"|"playback";
export interface ClientMetric {name:string;value:number;at:number;kind:"journey"|"vital"|"longtask"|"interaction"}
const allowed=new Set(["startup","bootstrap","device_restore","navigation","playback","TTFB","FCP","LCP","CLS","INP","longtask","interaction"]);
/** Device-local numeric diagnostics. No account, URL, query, media or text data. */
export class ClientPerformanceJournal {
 private records:ClientMetric[]=[];private starts=new Map<ClientJourney,number>();
 constructor(private now=()=>performance.now()){}
 begin(name:ClientJourney){this.starts.set(name,this.now());}
 finish(name:ClientJourney){const start=this.starts.get(name);if(start===undefined)return;this.starts.delete(name);this.record(name,this.now()-start,"journey");}
 record(name:string,value:number,kind:ClientMetric["kind"]){if(!allowed.has(name)||!Number.isFinite(value)||value<0)return;this.records.push({name,value,kind,at:this.now()});if(this.records.length>128)this.records.splice(0,this.records.length-128);}
 snapshot(){return this.records.map(record=>({...record}));}
}
export const clientPerformance=new ClientPerformanceJournal();
export function beginClientJourney(name:ClientJourney){if(typeof window!=="undefined")clientPerformance.begin(name);}
export function finishClientJourney(name:ClientJourney){if(typeof window!=="undefined")clientPerformance.finish(name);}
export function installClientDiagnostics(){
 if(typeof window==="undefined")return ()=>{};
 const target=window as Window&{__sakuraClientMetrics?:()=>ClientMetric[]};target.__sakuraClientMetrics=()=>clientPerformance.snapshot();
 const observers:PerformanceObserver[]=[];
 if(process.env.NEXT_PUBLIC_SAKURA_PERFORMANCE_DIAGNOSTICS==="1"&&typeof PerformanceObserver!=="undefined"){
  for(const type of ["longtask","event"]){if(!PerformanceObserver.supportedEntryTypes.includes(type))continue;
   try{const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())clientPerformance.record(type==="event"?"interaction":"longtask",entry.duration,type==="event"?"interaction":"longtask");});observer.observe({type,buffered:true,...(type==="event"?{durationThreshold:40}:{})});observers.push(observer);}catch{}
  }
 }
 return ()=>{for(const observer of observers)observer.disconnect();delete target.__sakuraClientMetrics;};
}
