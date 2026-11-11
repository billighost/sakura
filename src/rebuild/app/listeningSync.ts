import {localRead,localWrite} from "./offline";
import {requestJson} from "./errors";
import type {ListeningSession,SessionDraft,SessionRecord} from "./sessionState";
import {localId} from "./sessionState";

const prefix="sakura-v2-listening:";
function storedDraft(value:unknown):SessionDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as SessionDraft,state=draft.state;
 if(!state||!Array.isArray(state.queue)||state.queue.length>80||!Number.isSafeInteger(draft.revision)||draft.revision<0||!Number.isFinite(draft.savedAt)||!Number.isFinite(draft.updatedAt))return;
 const seen=new Set<string>();
 for(const entry of state.queue){const track=entry?.track;if(!entry||typeof entry.entryId!=="string"||seen.has(entry.entryId)||entry.localOnly!==undefined&&typeof entry.localOnly!=="boolean"||entry.context!==undefined&&(typeof entry.context!=="string"||!entry.context.trim()||entry.context.length>40)||entry.contextId!==undefined&&(typeof entry.contextId!=="string"||!entry.contextId.trim()||entry.contextId.length>120)||!track||typeof track.id!=="string"||typeof track.title!=="string"||!Array.isArray(track.artists)||!track.artists.every(name=>typeof name==="string")||!track.reference||typeof track.reference.id!=="string"||!Number.isFinite(track.durationMs)||track.durationMs<0)return;seen.add(entry.entryId);}
 if(state.currentEntryId!==null&&!seen.has(state.currentEntryId)||!Number.isSafeInteger(state.positionMs)||state.positionMs<0||state.positionMs>21600000||state.sleepUntil!==null&&(!Number.isSafeInteger(state.sleepUntil)||state.sleepUntil<0))return;
 const pending=draft.pending===true,intent=pending&&draft.intent===true;
 return {...draft,pending,intent,choiceAt:Number.isFinite(draft.choiceAt)&&draft.choiceAt!>=0?draft.choiceAt:undefined,intentAt:intent?(Number.isFinite(draft.intentAt)?draft.intentAt:draft.savedAt):undefined,state:{...state,sleepUntil:state.sleepUntil&&state.sleepUntil>Date.now()?state.sleepUntil:null}};
}
/** A routine position save cannot make an older song choice newer. Older
 * servers do not expose choiceAt, so their checkpoint time remains a fallback. */
function choiceTime(record:SessionRecord){return Number.isFinite(record.choiceAt)&&record.choiceAt!>=0?record.choiceAt!:record.updatedAt;}
let playbackWriterId:string|undefined;
/** Tabs need independent writers: a shared device ID cannot distinguish a
 * delayed save from another tab's deliberate song or seek choice. Keep this
 * identity stable through provider remounts, but never clone it from storage. */
export function deviceIdentity(){return playbackWriterId??=localId();}
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
 private storageFailureReported=false;
 constructor(private accountId:string,private deviceId:string,private restore:(state:ListeningSession)=>void,private onStorageError?:(error:unknown)=>void){}
 private save(){
  if(!this.draft)return;const draft={...this.draft};
  let mirrored=false;try{localStorage.setItem(prefix+this.accountId,JSON.stringify(draft));mirrored=true;this.storageFailureReported=false;}catch{}
  this.writes=this.writes.catch(()=>{}).then(async()=>{
   try{await localWrite(this.accountId,"listening-session",draft);this.storageFailureReported=false;}
   catch(error){if(!mirrored){if(!this.storageFailureReported){this.storageFailureReported=true;this.onStorageError?.(error);}throw error;}}
  });
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
  this.draft={state,revision:this.draft?.revision||0,deviceId:this.deviceId,updatedAt:this.draft?.updatedAt||0,choiceAt:this.draft?.choiceAt,pending:true,savedAt:now,intent:this.explicit,intentAt,clockOffset:this.clockKnown?this.clockOffset:undefined};
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
 /** A delayed checkpoint from this page is an acknowledgement, never a
  * command to rewind its live media. A pending restored draft can also finish
  * its previous page's save before switching to this page's writer identity. */
 private rebaseOwnCheckpoint(record:SessionRecord):boolean {
  if(!this.draft)return false;
  const ownLiveWriter=record.deviceId===this.deviceId&&this.sequence>0;
  const ownRestoredWriter=this.sequence===0&&this.draft.pending&&record.deviceId===this.draft.deviceId;
  if(!ownLiveWriter&&!ownRestoredWriter)return false;
  this.draft.revision=Math.max(this.draft.revision,record.revision);
  this.draft.updatedAt=Math.max(this.draft.updatedAt,record.updatedAt);
  this.draft.choiceAt=choiceTime(record);
  this.draft.pending=true;this.save();return true;
 }
 async refresh(){
  if(this.stopped||this.request)return;
  const before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{session:SessionRecord|null;serverTime?:number}>("/api/v2/listening-session",{signal:this.controller.signal},{context:"save",accountId:this.accountId});
   if(this.stopped)return;this.calibrate(data.serverTime);if(before!==this.sequence)return;
   const remote=data.session;if(!remote||!remote.state)return;
   if(this.draft?.pending&&this.explicit&&(this.draft.intentAt??this.draft.savedAt)>choiceTime(remote)){this.draft.revision=remote.revision;this.save();return;}
   if(!this.draft||remote.revision>this.draft.revision){if(!this.rebaseOwnCheckpoint(remote))this.adopt(remote);}
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  await this.flush();
 }
 async flush(keepalive=false):Promise<void>{
  if(this.stopped||!this.ready)return;
  const pendingRequest=this.request as Promise<void>|null;
  if(pendingRequest){await pendingRequest.catch(()=>{});return this.flush(keepalive);}
  if(!this.draft?.pending)return;
  // A synchronous mirror or a completed IndexedDB write must exist before
  // transmitting the draft. Closing a page during a failed request is safe.
  await this.writes;
  if(this.stopped||!this.draft?.pending)return;
  if(this.request){await this.request.catch(()=>{});return this.flush(keepalive);}
  const sent=this.draft,before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{accepted:boolean;session:SessionRecord|null;serverTime?:number}>("/api/v2/listening-session",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:sent.state,revision:sent.revision,deviceId:this.deviceId,explicit:sent.intent===true,...(sent.intent&&Number.isFinite(sent.intentAt)?{intentAt:Math.max(0,Math.floor(sent.intentAt!))}:{})}),signal:this.controller.signal,keepalive},{context:"save",accountId:this.accountId});
   if(this.stopped||!data.session?.state)return;
   this.calibrate(data.serverTime);
   if(data.accepted){if(this.draft){this.draft.revision=data.session.revision;this.draft.updatedAt=data.session.updatedAt;this.draft.choiceAt=choiceTime(data.session);this.draft.deviceId=this.deviceId;if(before===this.sequence){this.draft.pending=false;this.explicit=false;this.intentStartedAt=null;}this.save();}}
   else if(this.rebaseOwnCheckpoint(data.session)){/* Retry the latest local position against its acknowledged revision. */}
   else if(this.explicit&&(this.draft?.intentAt??this.draft?.savedAt??0)>choiceTime(data.session)){if(this.draft){this.draft.revision=data.session.revision;this.save();}}
   else this.adopt(data.session);
  })();
  this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  if(this.draft?.pending&&!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},250);}
 }
 stop(){this.stopped=true;this.controller.abort();if(this.timer)clearTimeout(this.timer);}
}
