import {localRead,localWrite} from "./offline";
import {requestJson} from "./errors";
import type {ListeningSession,SessionDraft,SessionRecord} from "./sessionState";
import {localId} from "./sessionState";

const prefix="sakura-v2-listening:";
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
 constructor(private accountId:string,private deviceId:string,private restore:(state:ListeningSession)=>void){}
 private save(){
  if(!this.draft)return;const draft={...this.draft};
  try{localStorage.setItem(prefix+this.accountId,JSON.stringify(draft));}catch{}
  this.writes=this.writes.catch(()=>{}).then(()=>localWrite(this.accountId,"listening-session",draft));
  void this.writes.catch(()=>{});
 }
 async start(){
  let cached:SessionDraft|undefined;try{const raw=localStorage.getItem(prefix+this.accountId);if(raw)cached=JSON.parse(raw);}catch{}
  const disk=await localRead<SessionDraft>(this.accountId,"listening-session").catch(()=>undefined);
  if(this.stopped)return;
  if(disk&&(!cached||disk.savedAt>cached.savedAt))cached=disk;
  if(cached?.state&&Array.isArray(cached.state.queue)&&this.sequence===0){this.draft=cached;this.explicit=Boolean(cached.pending&&cached.intent);this.restore(cached.state);}
  this.ready=true;
  await this.refresh().catch(()=>{});
 }
 change(state:ListeningSession,explicit=true){
  if(this.stopped)return;
  this.sequence++;this.explicit ||= explicit;
  this.draft={state,revision:this.draft?.revision||0,deviceId:this.deviceId,updatedAt:this.draft?.updatedAt||0,pending:true,savedAt:Date.now(),intent:this.explicit};
  this.save();if(this.timer)clearTimeout(this.timer);
  this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},explicit?250:1000);
 }
 private adopt(record:SessionRecord){this.draft={...record,pending:false,savedAt:Date.now()};this.explicit=false;this.save();this.restore(record.state);}
 async refresh(){
  if(this.stopped||this.request)return;
  const before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{session:SessionRecord|null}>("/api/v2/listening-session",{signal:this.controller.signal},{context:"save",accountId:this.accountId});
   if(this.stopped||before!==this.sequence)return;
   const remote=data.session;if(!remote||!remote.state)return;
   if(this.draft?.pending&&this.explicit&&this.draft.savedAt>remote.updatedAt){this.draft.revision=remote.revision;this.save();return;}
   if(!this.draft||remote.revision>this.draft.revision)this.adopt(remote);
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  await this.flush();
 }
 async flush(keepalive=false):Promise<void>{
  if(this.stopped||!this.ready)return;
  if(this.request){await this.request.catch(()=>{});if(!keepalive)return this.flush();}
  if(!this.draft?.pending)return;
  const sent=this.draft,before=this.sequence,explicit=this.explicit;
  const request=(async()=>{
   const data=await requestJson<{accepted:boolean;session:SessionRecord|null}>("/api/v2/listening-session",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:sent.state,revision:sent.revision,deviceId:this.deviceId}),signal:this.controller.signal,keepalive},{context:"save",accountId:this.accountId});
   if(this.stopped||!data.session?.state)return;
   if(data.accepted){if(this.draft){this.draft.revision=data.session.revision;this.draft.updatedAt=data.session.updatedAt;if(before===this.sequence){this.draft.pending=false;this.explicit=false;}this.save();}}
   else if(explicit||before!==this.sequence){if(this.draft){this.draft.revision=data.session.revision;this.save();}}
   else this.adopt(data.session);
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  if(this.draft?.pending&&!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},250);}
 }
 stop(){this.stopped=true;this.controller.abort();if(this.timer)clearTimeout(this.timer);}
}
