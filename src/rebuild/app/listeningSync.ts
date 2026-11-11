import {localRead,localWriteOrdered,localDelete,localEntries} from "./offline";
import {requestJson} from "./errors";
import type {ListeningSession,SessionDraft,SessionRecord} from "./sessionState";
import {localId} from "./sessionState";

const prefix="sakura-v2-listening:";
const choicePrefix=(accountId:string)=>"sakura-v2-listening-choice:"+accountId+":";
const receiptPrefix=(accountId:string)=>"sakura-v2-listening-receipt:"+accountId+":";
interface ChoiceDraft extends SessionDraft {choiceId:string;choiceOrder:number}
interface ChoiceReceipt {throughSavedAt:number;record?:SessionRecord;superseded?:boolean}
function validState(value:unknown):value is ListeningSession {
 if(!value||typeof value!=="object")return false;const state=value as ListeningSession;
 if(!Array.isArray(state.queue)||state.queue.length>80)return false;const seen=new Set<string>();
 for(const entry of state.queue){const track=entry?.track;if(!entry||typeof entry.entryId!=="string"||seen.has(entry.entryId)||entry.localOnly!==undefined&&typeof entry.localOnly!=="boolean"||entry.context!==undefined&&(typeof entry.context!=="string"||!entry.context.trim()||entry.context.length>40)||entry.contextId!==undefined&&(typeof entry.contextId!=="string"||!entry.contextId.trim()||entry.contextId.length>120)||!track||typeof track.id!=="string"||typeof track.title!=="string"||!Array.isArray(track.artists)||!track.artists.every(name=>typeof name==="string")||!track.reference||typeof track.reference.id!=="string"||!Number.isFinite(track.durationMs)||track.durationMs<0)return false;seen.add(entry.entryId);}
 return !(state.currentEntryId!==null&&!seen.has(state.currentEntryId)||!Number.isSafeInteger(state.positionMs)||state.positionMs<0||state.positionMs>21600000||state.sleepUntil!==null&&(!Number.isSafeInteger(state.sleepUntil)||state.sleepUntil<0));
}
function serverRecord(value:unknown):SessionRecord|undefined {
 if(!value||typeof value!=="object")return;const record=value as SessionRecord;
 if(!validState(record.state)||typeof record.deviceId!=="string"||!record.deviceId||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isFinite(record.updatedAt)||record.updatedAt<0||record.choiceAt!==undefined&&(!Number.isFinite(record.choiceAt)||record.choiceAt<0))return;
 return record;
}
function choiceTime(record:SessionRecord){return Number.isFinite(record.choiceAt)&&record.choiceAt!>=0?record.choiceAt!:record.updatedAt;}
function storedDraft(value:unknown):ChoiceDraft|undefined {
 if(!value||typeof value!=="object")return;const draft=value as ChoiceDraft,state=draft.state;
 if(!validState(state)||!Number.isSafeInteger(draft.revision)||draft.revision<0||!Number.isFinite(draft.savedAt)||draft.savedAt<0||!Number.isFinite(draft.updatedAt)||draft.updatedAt<0)return;
 const pending=draft.pending===true,intent=pending&&draft.intent===true,intentAt=intent?(Number.isFinite(draft.intentAt)?draft.intentAt:draft.savedAt):undefined;
 const order=Number.isSafeInteger(draft.choiceOrder)&&draft.choiceOrder>=0?draft.choiceOrder:Math.max(0,Math.floor(intentAt??choiceTime(draft)));
 const choiceId=typeof draft.choiceId==="string"&&draft.choiceId&&draft.choiceId.length<240?draft.choiceId:"legacy:"+(draft.deviceId||"unknown")+":"+order;
 return {...draft,pending,intent,intentAt,choiceId,choiceOrder:order,state:{...state,sleepUntil:state.sleepUntil&&state.sleepUntil>Date.now()?state.sleepUntil:null}};
}
function newer(left:ChoiceDraft,right:ChoiceDraft){return left.choiceOrder-right.choiceOrder||(left.choiceId===right.choiceId?left.savedAt-right.savedAt||left.revision-right.revision:left.choiceId.localeCompare(right.choiceId));}
function readJson(name:string){try{return JSON.parse(localStorage.getItem(name)||"null");}catch{return undefined;}}
function mirrorEntries(prefix:string):Array<{name:string;value:unknown}>{
 const result:Array<{name:string;value:unknown}>=[];
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(prefix))result.push({name:name.slice(prefix.length),value:readJson(name)});}}catch{}
 return result;
}
function receipt(value:unknown):ChoiceReceipt|undefined {
 if(!value||typeof value!=="object")return;const result=value as ChoiceReceipt;
 if(!Number.isSafeInteger(result.throughSavedAt)||result.throughSavedAt<0||result.superseded!==true&&!serverRecord(result.record))return;
 return result;
}
function sameSubmittedState(left:ListeningSession,right:ListeningSession){
 const identity=(state:ListeningSession)=>[state.currentEntryId,state.positionMs,state.sleepUntil,state.queue.map(entry=>[entry.entryId,entry.track.id,entry.priority??"automatic",entry.localOnly===true,entry.context??null,entry.contextId??null])];
 return JSON.stringify(identity(left))===JSON.stringify(identity(right));
}
let playbackWriterId:string|undefined;
export function deviceIdentity(){return playbackWriterId??=localId();}
export class ListeningSync {
 private draft:ChoiceDraft|null=null;
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
 private order(){return Math.min(Number.MAX_SAFE_INTEGER,Math.max(Date.now(),this.draft?.choiceOrder||0,...mirrorEntries(choicePrefix(this.accountId)).map(entry=>storedDraft(entry.value)?.choiceOrder||0),storedDraft(readJson(prefix+this.accountId))?.choiceOrder||0)+1);}
 private stamp(){return Math.min(Number.MAX_SAFE_INTEGER,Math.max(Date.now(),(this.draft?.savedAt||0)+1,(storedDraft(readJson(prefix+this.accountId))?.savedAt||0)+1));}
 private save(){
  if(!this.draft)return;const draft={...this.draft},name=choicePrefix(this.accountId)+draft.choiceId;
  let mirrored=false;
  try{const previous=storedDraft(readJson(name));if(!previous||previous.savedAt<=draft.savedAt)localStorage.setItem(name,JSON.stringify(draft));mirrored=true;this.storageFailureReported=false;}catch{}
  try{const previous=storedDraft(readJson(prefix+this.accountId));if(!previous||newer(draft,previous)>=0)localStorage.setItem(prefix+this.accountId,JSON.stringify(draft));}catch{}
  this.writes=this.writes.catch(()=>{}).then(async()=>{
   try{
    await localWriteOrdered(this.accountId,"listening-choice:"+draft.choiceId,draft as unknown as Record<string,unknown>);
    await localWriteOrdered(this.accountId,"listening-session",draft as unknown as Record<string,unknown>,"choiceOrder");this.storageFailureReported=false;
    await this.compact(draft);
   }catch(error){if(!mirrored){if(!this.storageFailureReported){this.storageFailureReported=true;this.onStorageError?.(error);}throw error;}}
  });void this.writes.catch(()=>{});
 }
 private writeReceipt(choiceId:string,value:ChoiceReceipt){
  try{const previous=receipt(readJson(receiptPrefix(this.accountId)+choiceId));if(!previous||previous.throughSavedAt<=value.throughSavedAt)localStorage.setItem(receiptPrefix(this.accountId)+choiceId,JSON.stringify(value));}catch{}
  this.writes=this.writes.catch(()=>{}).then(()=>localWriteOrdered(this.accountId,"listening-receipt:"+choiceId,value as unknown as Record<string,unknown>,"throughSavedAt"));void this.writes.catch(()=>{});
 }
 private async compact(current:ChoiceDraft){
  const entries=await localEntries<unknown>(this.accountId,"listening-choice:");
  for(const entry of entries){const old=storedDraft(entry.value);if(!old||old.choiceId===current.choiceId||newer(old,current)>=0)continue;
   const retired:ChoiceReceipt={throughSavedAt:Number.MAX_SAFE_INTEGER,superseded:true};
   await localWriteOrdered(this.accountId,"listening-receipt:"+old.choiceId,retired as unknown as Record<string,unknown>,"throughSavedAt");
   try{localStorage.setItem(receiptPrefix(this.accountId)+old.choiceId,JSON.stringify(retired));localStorage.removeItem(choicePrefix(this.accountId)+old.choiceId);}catch{}
   await localDelete(this.accountId,entry.name);
  }
 }
 private async localDraft(){
  const [legacy,choices,receipts]=await Promise.all([localRead<unknown>(this.accountId,"listening-session").catch(()=>undefined),localEntries<unknown>(this.accountId,"listening-choice:").catch(()=>[]),localEntries<unknown>(this.accountId,"listening-receipt:").catch(()=>[])]);
  const acknowledgments=new Map<string,ChoiceReceipt>();
  for(const entry of [...receipts.map(entry=>({name:entry.name.slice("listening-receipt:".length),value:entry.value})),...mirrorEntries(receiptPrefix(this.accountId))]){const clean=receipt(entry.value),old=acknowledgments.get(entry.name);if(clean&&(!old||clean.throughSavedAt>old.throughSavedAt))acknowledgments.set(entry.name,clean);}
  let latest:ChoiceDraft|undefined;
  for(const value of [legacy,readJson(prefix+this.accountId),...choices.map(entry=>entry.value),...mirrorEntries(choicePrefix(this.accountId)).map(entry=>entry.value)]){
   let clean=storedDraft(value);if(!clean)continue;const ack=acknowledgments.get(clean.choiceId);if(ack?.superseded)continue;
   if(ack?.record&&clean.savedAt<=ack.throughSavedAt)clean={...clean,...ack.record,state:{...ack.record.state,sleepUntil:ack.record.state.sleepUntil&&ack.record.state.sleepUntil>Date.now()?ack.record.state.sleepUntil:null},pending:false,intent:false,intentAt:undefined};
   if(!latest||newer(clean,latest)>0)latest=clean;
  }
  return latest;
 }
 private async reconcileLocal(){
  const before=this.sequence,cached=await this.localDraft();if(this.stopped||before!==this.sequence||!cached||this.draft&&newer(cached,this.draft)<=0)return;
  this.draft=cached;this.explicit=Boolean(cached.pending&&cached.intent);this.intentStartedAt=null;
  if(Number.isFinite(cached.clockOffset)){this.clockOffset=cached.clockOffset!;this.clockKnown=true;}
  this.sequence++;this.restore(cached.state);
 }
 async start(){
  const cached=await this.localDraft();if(this.stopped)return;
  if(cached&&this.sequence===0){this.draft=cached;this.explicit=Boolean(cached.pending&&cached.intent);if(Number.isFinite(cached.clockOffset)){this.clockOffset=cached.clockOffset!;this.clockKnown=true;}this.restore(cached.state);}
  this.ready=true;await this.refresh().catch(()=>{});
 }
 change(state:ListeningSession,explicit=true){
  if(this.stopped)return;
  const now=Date.now(),savedAt=this.stamp(),choiceOrder=explicit||!this.draft?this.order():this.draft.choiceOrder,choiceId=explicit||!this.draft?localId():this.draft.choiceId,intentAt=explicit?now+this.clockOffset:this.draft?.intentAt;
  this.sequence++;this.explicit ||= explicit;if(explicit)this.intentStartedAt=typeof performance!=="undefined"?performance.now():null;
  this.draft={state,revision:this.draft?.revision||0,deviceId:this.deviceId,updatedAt:this.draft?.updatedAt||0,choiceAt:this.draft?.choiceAt,choiceId,choiceOrder,pending:true,savedAt,intent:this.explicit,intentAt,clockOffset:this.clockKnown?this.clockOffset:undefined};
  this.save();if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},explicit?250:1000);
 }
 private calibrate(serverTime:unknown){
  if(typeof serverTime!=="number"||!Number.isFinite(serverTime))return;const offset=serverTime-Date.now();this.clockOffset=offset;this.clockKnown=true;
  if(this.draft){if(this.explicit)this.draft.intentAt=this.intentStartedAt!==null&&typeof performance!=="undefined"?serverTime-Math.max(0,performance.now()-this.intentStartedAt):(this.draft.intentAt??this.draft.savedAt)+offset-(Number.isFinite(this.draft.clockOffset)?this.draft.clockOffset!:0);this.draft.clockOffset=offset;this.save();}
 }
 private adopt(record:SessionRecord){
  if(this.draft)this.writeReceipt(this.draft.choiceId,{throughSavedAt:Number.MAX_SAFE_INTEGER,superseded:true});
  const choiceOrder=this.order(),savedAt=this.stamp();this.draft={...record,choiceId:localId(),choiceOrder,pending:false,savedAt,clockOffset:this.clockKnown?this.clockOffset:undefined};this.explicit=false;this.intentStartedAt=null;this.save();this.restore(record.state);
 }
 private rebaseOwnCheckpoint(record:SessionRecord):boolean {
  if(!this.draft)return false;const ownLiveWriter=record.deviceId===this.deviceId&&this.sequence>0,ownRestoredWriter=this.sequence===0&&this.draft.pending&&record.deviceId===this.draft.deviceId;
  if(!ownLiveWriter&&!ownRestoredWriter)return false;
  this.draft.revision=Math.max(this.draft.revision,record.revision);this.draft.updatedAt=Math.max(this.draft.updatedAt,record.updatedAt);this.draft.choiceAt=choiceTime(record);this.draft.pending=true;this.save();return true;
 }
 async refresh(){
  if(this.stopped||this.request)return;await this.writes.catch(()=>{});await this.reconcileLocal();if(this.stopped||this.request)return;const before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{session:unknown;serverTime?:number}>("/api/v2/listening-session",{signal:this.controller.signal},{context:"save",accountId:this.accountId});
   if(this.stopped)return;this.calibrate(data.serverTime);if(before!==this.sequence)return;
   if(data.session===null)return;const remote=serverRecord(data.session);if(!remote)throw new Error("The saved listening session is incomplete.");
   if(this.draft?.pending&&this.explicit&&(this.draft.intentAt??this.draft.savedAt)>choiceTime(remote)){this.draft.revision=remote.revision;this.save();return;}
   if(!this.draft||remote.revision>this.draft.revision){if(!this.rebaseOwnCheckpoint(remote))this.adopt(remote);}
  })();this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}await this.flush();
 }
 async flush(keepalive=false):Promise<void>{
  if(this.stopped||!this.ready)return;const pendingRequest=this.request;if(pendingRequest){await pendingRequest.catch(()=>{});return this.flush(keepalive);}
  if(!this.draft?.pending)return;await this.writes;await this.reconcileLocal();if(this.stopped||!this.draft?.pending)return;
  if(this.request){await this.request.catch(()=>{});return this.flush(keepalive);}const sent={...this.draft},before=this.sequence;
  const request=(async()=>{
   const data=await requestJson<{accepted:unknown;session:unknown;serverTime?:number}>("/api/v2/listening-session",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:sent.state,revision:sent.revision,deviceId:this.deviceId,explicit:sent.intent===true,...(sent.intent&&Number.isFinite(sent.intentAt)?{intentAt:Math.max(0,Math.floor(sent.intentAt!))}:{})}),signal:this.controller.signal,keepalive},{context:"save",accountId:this.accountId});
   if(this.stopped)return;
   if(typeof data.accepted!=="boolean")throw new Error("The listening session was not acknowledged.");
   if(data.accepted===false&&data.session===null){if(this.draft){this.draft.revision=0;this.save();}return;}
   const remote=serverRecord(data.session);if(!remote)throw new Error("The listening session receipt is incomplete.");
   if(data.accepted&&(remote.deviceId!==this.deviceId||remote.revision<=sent.revision||!sameSubmittedState(sent.state,remote.state)))throw new Error("The listening session receipt belongs to another save.");
   this.calibrate(data.serverTime);
   if(data.accepted){this.writeReceipt(sent.choiceId,{throughSavedAt:sent.savedAt,record:remote});if(this.draft){this.draft.revision=remote.revision;this.draft.updatedAt=remote.updatedAt;this.draft.choiceAt=choiceTime(remote);this.draft.deviceId=this.deviceId;if(before===this.sequence){this.draft.pending=false;this.explicit=false;this.intentStartedAt=null;}this.save();}}
   else if(this.rebaseOwnCheckpoint(remote)){/* Preserve a checkpoint recorded during an earlier save. */}
   else if(this.explicit&&(this.draft?.intentAt??this.draft?.savedAt??0)>choiceTime(remote)){if(this.draft){this.draft.revision=remote.revision;this.save();}}
   else this.adopt(remote);
  })();this.request=request;try{await request;}finally{if(this.request===request)this.request=null;}
  if(this.draft?.pending&&!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},250);}
 }
 stop(){this.stopped=true;this.controller.abort();if(this.timer)clearTimeout(this.timer);}
}
