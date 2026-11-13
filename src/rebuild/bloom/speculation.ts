export const BLOOM_SPECULATIVE_LIMITS={maxRecordings:12,maxAudioBytes:48*1024*1024};
export const BLOOM_WARMUP_LIFETIME_MS=30000;

/** One viewport/intent window expires even if a page stays mounted all day. */
export class BloomWarmupWindow {
 private visible=false;private intents=new Set<string>();private allowed=false;private until=0;
 private timer:ReturnType<typeof setTimeout>|undefined;private last=false;
 constructor(private notify:(active:boolean)=>void,private lifetime=BLOOM_WARMUP_LIFETIME_MS,private now=()=>performance.now()){}
 private expire(){const remaining=this.until-this.now();if(remaining>0){this.timer=setTimeout(()=>this.expire(),Math.max(1,remaining));return;}this.paint();}
 private open(){this.until=this.now()+this.lifetime;clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),this.lifetime);}
 private paint(){const active=this.allowed&&(this.visible||this.intents.size>0)&&this.now()<this.until;if(active!==this.last){this.last=active;this.notify(active);}}
 viewport(visible:boolean){if(visible&&!this.visible)this.open();this.visible=visible;this.paint();}
 intent(kind:string,active:boolean){if(active)this.open();if(active)this.intents.add(kind);else this.intents.delete(kind);this.paint();}
 policy(allowed:boolean){this.allowed=allowed;this.paint();}
 dispose(){clearTimeout(this.timer);this.visible=false;this.intents.clear();this.until=0;this.paint();}
}

type Request={key:string;priority:number;notify:(granted:boolean)=>void;granted:boolean|null};
/** At most one speculative story is owned; an explicit detail takes priority. */
export class BloomSpeculationPool {
 private requests=new Map<symbol,Request>();private explicit=new Map<symbol,string>();
 private selected:string|undefined;
 private paint(){
  const explicitKeys=new Set(this.explicit.values());
  const candidate=[...this.requests.values()].filter(request=>!explicitKeys.size||explicitKeys.has(request.key)).sort((a,b)=>b.priority-a.priority)[0];
  this.selected=candidate?.key;
  for(const request of this.requests.values()){const granted=request.key===candidate?.key;if(granted!==request.granted){request.granted=granted;request.notify(granted);}}
 }
 request(key:string,priority:number,notify:Request["notify"]){const token=Symbol(key);this.requests.set(token,{key,priority,notify,granted:null});this.paint();return()=>{this.requests.delete(token);this.paint();};}
 detail(key:string){const token=Symbol(key);this.explicit.set(token,key);this.paint();return()=>{this.explicit.delete(token);this.paint();};}
 allows(key:string){return this.selected===key;}
}
export const bloomSpeculationPool=new BloomSpeculationPool();
