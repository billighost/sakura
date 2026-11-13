/** Coordinate only passive account projections. Mutations and playback writer
 * ownership remain with their callers; cached observations expire at 15s. */
export const PASSIVE_SYNC_PATHS=new Set(["/api/v2/settings","/api/v2/library/state","/api/v2/taste","/api/v2/listening-session"]);
type Snapshot={value:unknown;at:number;version:string};
type Message={accountId:string;type:"result"|"query"|"invalidate";key:string;at?:number;value?:unknown;version?:string};
type Channel={postMessage:(message:Message)=>void;close:()=>void;onmessage:((event:{data:Message})=>void)|null};
type Locks={request:<T>(name:string,options:{signal:AbortSignal},callback:()=>Promise<T>)=>Promise<T>};
export interface AccountReadEnvironment {now?:()=>number;channel?:Channel|null;locks?:Locks|null;storage?:Pick<Storage,"getItem"|"setItem">|null;wait?:(ms:number)=>Promise<void>}
export interface AccountReadOptions {signal?:AbortSignal;force?:boolean;minRequestedAt?:number}
const abortError=()=>new DOMException("Account synchronization stopped","AbortError");
export class AccountReadCoordinator {
 private snapshots=new Map<string,Snapshot>();private pending=new Map<string,Promise<unknown>>();private versions=new Map<string,string>();private controllers=new Set<AbortController>();private disposed=false;private periodicFloor=0;
 private now:()=>number;private channel:Channel|null;private locks:Locks|null;private storage:Pick<Storage,"getItem"|"setItem">|null;private wait:(ms:number)=>Promise<void>;private lastPeriodicAt:number;
 constructor(private accountId:string,environment:AccountReadEnvironment={}){
  this.now=environment.now||Date.now;this.lastPeriodicAt=this.now();this.wait=environment.wait||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  this.channel=environment.channel===undefined?(typeof BroadcastChannel!=="undefined"?new BroadcastChannel("sakura-account-sync:"+accountId) as unknown as Channel:null):environment.channel;
  this.locks=environment.locks===undefined?(typeof navigator!=="undefined"&&navigator.locks?navigator.locks as unknown as Locks:null):environment.locks;
  this.storage=environment.storage===undefined?(()=>{try{return typeof localStorage!=="undefined"?localStorage:null;}catch{return null;}})():environment.storage;
  for(const key of PASSIVE_SYNC_PATHS)this.versions.set(key,"initial");
  if(this.channel)this.channel.onmessage=event=>this.receive(event.data);
 }
 private version(key:string){return this.versions.get(key)||"initial";}
 private fresh(key:string,minimum=0){const value=this.snapshots.get(key);return value&&value.at>=Math.max(minimum,this.periodicFloor)&&value.version===this.version(key)&&this.now()-value.at>=0&&this.now()-value.at<15000?value:undefined;}
 /** Call once at the beginning of an allowed visible periodic refresh. This
  * advances eligibility, without invalidating another tab's simultaneous read. */
 requireFreshSince(boundary=this.now()){
  if(!Number.isFinite(boundary)||boundary<0)throw new RangeError("Invalid synchronization boundary");
  if(boundary>=this.periodicFloor||this.now()<this.periodicFloor)this.periodicFloor=boundary;
 }
 /** Timer callbacks can arrive twice or early. Keep the periodic boundary
  * independent of initial-response latency and focus/reconnection bursts. */
 advancePeriodicBoundary(){
  const now=this.now();
  if(now>=this.lastPeriodicAt&&now-this.lastPeriodicAt<15000)return false;
  this.lastPeriodicAt=now;this.requireFreshSince(now);return true;
 }
 private send(message:Omit<Message,"accountId">){try{this.channel?.postMessage({accountId:this.accountId,...message});}catch{/* A channel failure must not prevent independent reconciliation. */}}
 private receive(message:Message){
  if(this.disposed||!message||message.accountId!==this.accountId||typeof message.key!=="string"||!PASSIVE_SYNC_PATHS.has(message.key))return;
  if(message.type==="invalidate"){if(typeof message.version==="string"&&(this.version(message.key)==="initial"||message.version>this.version(message.key))){this.versions.set(message.key,message.version);this.snapshots.delete(message.key);}return;}
  if(message.type==="query"){const cached=this.fresh(message.key);if(cached)this.send({type:"result",key:message.key,...cached});return;}
  if(message.type==="result"&&typeof message.version==="string"&&typeof message.at==="number"&&this.now()-message.at>=0&&this.now()-message.at<15000){if(this.version(message.key)==="initial"||message.version>this.version(message.key))this.versions.set(message.key,message.version);if(message.version===this.version(message.key)){const old=this.snapshots.get(message.key);if(!old||!this.fresh(message.key)||old.at<=message.at)this.snapshots.set(message.key,{value:message.value,at:message.at,version:message.version});}}
 }
 invalidate(prefix="/api/v2/"){
  const stamp=Math.max(this.now(),...Array.from(this.versions.values(),value=>Number(value.split(":")[0])||0))+1,version=String(stamp).padStart(16,"0")+":"+(typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():Math.random());
  for(const key of PASSIVE_SYNC_PATHS)if(key.startsWith(prefix)){this.versions.set(key,version);this.snapshots.delete(key);this.send({type:"invalidate",key,version});}
 }
 async read<T>(key:string,loader:(signal:AbortSignal)=>Promise<T>,options:AccountReadOptions={}):Promise<T>{
  if(this.disposed||options.signal?.aborted)throw options.signal?.reason??abortError();
  if(options.minRequestedAt!==undefined&&(!Number.isFinite(options.minRequestedAt)||options.minRequestedAt<0))throw new RangeError("Invalid synchronization boundary");
  if(!PASSIVE_SYNC_PATHS.has(key))return loader(options.signal||new AbortController().signal);
  if(options.force)this.invalidate(key);
  let operation=this.pending.get(key) as Promise<T>|undefined;
  if(!operation){const cached=this.fresh(key,options.minRequestedAt);if(cached)return cached.value as T;
   const controller=new AbortController();this.controllers.add(controller);
   const execute=async()=>{
    if(this.disposed||controller.signal.aborted)throw controller.signal.reason??abortError();
    const cached=this.fresh(key,options.minRequestedAt);if(cached)return cached.value as T;
    // A previous lock owner may have completed before its BroadcastChannel
    // task is delivered. Ask it for its response, with bounded crash recovery.
    try{const marker=JSON.parse(this.storage?.getItem("sakura-v2-sync-read:"+this.accountId+":"+key)||"null");if(this.channel&&marker?.version===this.version(key)&&marker.at>=Math.max(options.minRequestedAt??0,this.periodicFloor)&&this.now()-marker.at>=0&&this.now()-marker.at<15000){this.send({type:"query",key});await this.wait(30);const response=this.fresh(key,options.minRequestedAt);if(response)return response.value as T;}}catch{}
    for(let attempt=0;attempt<2;attempt++){
     if(this.disposed||controller.signal.aborted)throw controller.signal.reason??abortError();
     const version=this.version(key),requestedAt=this.now(),value=await loader(controller.signal);if(this.disposed||controller.signal.aborted)throw controller.signal.reason??abortError();
     if(version!==this.version(key)){const fresh=this.fresh(key,options.minRequestedAt);if(fresh)return fresh.value as T;continue;}
     const snapshot={value,at:requestedAt,version};this.snapshots.set(key,snapshot);try{this.storage?.setItem("sakura-v2-sync-read:"+this.accountId+":"+key,JSON.stringify({at:snapshot.at,version}));}catch{}this.send({type:"result",key,...snapshot});return value;
    }
    throw abortError();
   };
   operation=(async()=>{
    if(this.locks){let acquired=false;const waiting=new AbortController(),timer=setTimeout(()=>waiting.abort(),2000),cancel=()=>waiting.abort(controller.signal.reason);controller.signal.addEventListener("abort",cancel,{once:true});
     try{return await this.locks.request("sakura-account-sync:"+this.accountId+":"+key,{signal:waiting.signal},async()=>{acquired=true;clearTimeout(timer);await this.wait(0);return execute();});}
     catch(error){if(acquired||controller.signal.aborted||this.disposed)throw error;return execute();}
     finally{clearTimeout(timer);controller.signal.removeEventListener("abort",cancel);}
    }
    return execute();
   })();this.pending.set(key,operation);void operation.finally(()=>{this.controllers.delete(controller);if(this.pending.get(key)===operation)this.pending.delete(key);}).catch(()=>{});
  }
  // An initial request can have begun before a periodic boundary advanced
  // while it was pending. Finish it, then share one qualifying replacement.
  // A slow but newly requested response is usable even when it is too old to
  // retain in the 15s cache; do not endlessly retry physical service latency.
  const eligible=operation.then(()=>{if(this.disposed)throw abortError();const snapshot=this.snapshots.get(key);return snapshot&&snapshot.version===this.version(key)&&snapshot.at>=Math.max(options.minRequestedAt??0,this.periodicFloor)?snapshot.value as T:this.read(key,loader,{...options,signal:undefined,force:false});});
  if(!options.signal)return eligible;
  return new Promise<T>((resolve,reject)=>{const signal=options.signal!,cancel=()=>reject(signal.reason??abortError());signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();eligible.then(value=>{if(!signal.aborted)resolve(value);},reject).finally(()=>signal.removeEventListener("abort",cancel)).catch(()=>{});});
 }
 dispose(){this.disposed=true;for(const controller of this.controllers)controller.abort(abortError());this.controllers.clear();this.snapshots.clear();this.pending.clear();if(this.channel){this.channel.onmessage=null;this.channel.close();}}
}
