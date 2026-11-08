import {localRead,localWrite} from "./offline";
import {requestJson} from "./errors";
import type {ListeningSession,SessionDraft,SessionRecord} from "./sessionState";
import {localId} from "./sessionState";

const prefix="sakura-v2-listening:";
function storedDraft(value:unknown):SessionDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as SessionDraft,state=draft.state;
 if(!state||!Array.isArray(state.queue)||state.queue.length>80||!Number.isSafeInteger(draft.revision)||draft.revision<0||!Number.isFinite(draft.savedAt)||!Number.isFinite(draft.updatedAt))return;
 const seen=new Set<string>();
 for(const entry of state.queue){const track=entry?.track;if(!entry||typeof entry.entryId!=="string"||seen.has(entry.entryId)||!track||typeof track.id!=="string"||typeof track.title!=="string"||!Array.isArray(track.artists)||!track.artists.every(name=>typeof name==="string")||!track.reference||typeof track.reference.id!=="string"||!Number.isFinite(track.durationMs)||track.durationMs<0)return;seen.add(entry.entryId);}
 if(state.currentEntryId!==null&&!seen.has(state.currentEntryId)||!Number.isSafeInteger(state.positionMs)||state.positionMs<0||state.positionMs>21600000||state.sleepUntil!==null&&(!Number.isSafeInteger(state.sleepUntil)||state.sleepUntil<0))return;
 const pending=draft.pending===true,intent=pending&&draft.intent===true;
 return {...draft,pending,intent,intentAt:intent?(Number.isFinite(draft.intentAt)?draft.intentAt:draft.savedAt):undefined,state:{...state,sleepUntil:state.sleepUntil&&state.sleepUntil>Date.now()?state.sleepUntil:null}};
}
export function deviceIdentity(){
 try{const saved=localStorage.getItem("sakura-v2-device");if(saved&&/^[a-f0-9-]{36}$/i.test(saved))return saved;}catch{}
 const id=localId();try{localStorage.setItem("sakura-v2-device",id);}catch{}return id;
}
export class ListeningSync {
 private draft:SessionDraft|null=null;
 private stopped=false;
 private request:Promise<void>|null=null;
 private controller=new AbortController();
 private sequence=0;
 private explicit=false;
 private writes=Promise.resolve();
 private timer:ReturnType<typeof setTimeout>|null=null;
 private ready=false;
 private clockOffset=0;
 private clockKnown=false;
 private intentStartedAt:number|null=null;
 constructor(private accountId:string,private deviceId:string,private restore:(state:ListeningSession)=>void){}
 private save(){
  if(!this.draft)return;const draft={...this.draft};
  try{localStorage.setItem(prefix+this.accountId,JSON.stringify(draft));}catch{}
  this.writes=this.writes.catch(()=>{}).then(()=>localWrite(this.accountId,"listening-session",draft));
  void this.writes.catch(()=>{});
 }
 async start(){
  let cached:SessionDraft|undefined;try{const raw=localStorage.getItem(prefix+this.accountId);if(raw)cached=storedDraft(JSON.parse(raw));}catch{}
  const disk=storedDraft(await localRead<SessionDraft>(this.accountId,"listening-session").catch(()=>undefined));
  if(this.stopped)return;
  if(disk&&(!cached||disk.savedAt>cached.savedAt))cached=disk;
  if(cached?.state&&Array.isArray(cached.state.queue)&&this.sequence===0){this.draft=cached;this.explicit=Boolean(cached.pending&&cached.intent);if(Number.isFinite(cached.clockOffset)){this.clockOffset=cached.clockOffset!;this.clockKnown=true;}this.restore(cached.state);}
  this.ready=true;
  await this.refresh().catch(()=>{});
 }
 change(state:ListeningSession,explicit=true){
  if(this.stopped)return;
  this.sequence++;this.explicit ||= explicit;
  const now=Date.now(),intentAt=explicit?now+this.clockOffset:this.draft?.intentAt;
  if(explicit)this.intentStartedAt=typeof performance!=="undefined"?performance.now():null;
  this.draft={state,revision:this.draft?.revision||0,deviceId:this.deviceId,updatedAt:this.draft?.updatedAt||0,pending:true,savedAt:now,intent:this.explicit,intentAt,clockOffset:this.clockKnown?this.clockOffset:undefined};
  this.save();if(this.timer)clearTimeout(this.timer);
  this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},explicit?250:1000);
 }
 private calibrate(serverTime:unknown){
  if(typeof serverTime!=="number"||!Number.isFinite(serverTime))return;
  const offset=serverTime-Date.now();this.clockOffset=offset;this.clockKnown=true;
  if(this.draft){if(this.explicit){
   this.draft.intentAt=this.intentStartedAt!==null&&typeof performance!=="undefined"?serverTime-Math.max(0,performance.now()-this.intentStartedAt):(this.draft.intentAt??this.draft.savedAt)+offset-(Number.isFinite(this.draft.clockOffset)?this.draft.clockOffset!:0);
  }this.draft.clockOffset=offset;this.save();}
 }
 private adopt(record:SessionRecord){this.draft={...record,pending:false,savedAt:Date.now(),clockOffset:this.clockKnown?this.clockOffset:undefined};this.explicit=false;this.intentStartedAt=null;this.save();this.restore(record.state);}
 async refresh(){
  if(this.stopped||this.request)return;
  const before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{session:SessionRecord|null;serverTime?:number}>("/api/v2/listening-session",{signal:this.controller.signal},{context:"save",accountId:this.accountId});
   if(this.stopped)return;this.calibrate(data.serverTime);if(before!==this.sequence)return;
   const remote=data.session;if(!remote||!remote.state)return;
   if(this.draft?.pending&&this.explicit&&(this.draft.intentAt||this.draft.savedAt)>remote.updatedAt){this.draft.revision=remote.revision;this.save();return;}
   if(!this.draft||remote.revision>this.draft.revision)this.adopt(remote);
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  await this.flush();
 }
 async flush(keepalive=false):Promise<void>{
  if(this.stopped||!this.ready)return;
  if(this.request){await this.request.catch(()=>{});return this.flush(keepalive);}
  if(!this.draft?.pending)return;
  const sent=this.draft,before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{accepted:boolean;session:SessionRecord|null;serverTime?:number}>("/api/v2/listening-session",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:sent.state,revision:sent.revision,deviceId:this.deviceId}),signal:this.controller.signal,keepalive},{context:"save",accountId:this.accountId});
   if(this.stopped||!data.session?.state)return;
   this.calibrate(data.serverTime);
   if(data.accepted){if(this.draft){this.draft.revision=data.session.revision;this.draft.updatedAt=data.session.updatedAt;if(before===this.sequence){this.draft.pending=false;this.explicit=false;this.intentStartedAt=null;}this.save();}}
   else if(this.explicit&&(this.draft?.intentAt??this.draft?.savedAt??0)>data.session.updatedAt){if(this.draft){this.draft.revision=data.session.revision;this.save();}}
   else this.adopt(data.session);
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  if(this.draft?.pending&&!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},250);}
 }
 stop(){this.stopped=true;this.controller.abort();if(this.timer)clearTimeout(this.timer);}
}
