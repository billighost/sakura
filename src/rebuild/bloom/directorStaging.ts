import {discloseBloomListening} from "./listening";
import {mergeBloomRefresh,sameBloomStory} from "./refresh";
import type {BloomPreparedStory,BloomRecap} from "./uiTypes";

interface Callbacks {
 prepare?:()=>Promise<BloomPreparedStory>;
 reveal:(id:string)=>Promise<BloomRecap>;
 complete:()=>Promise<BloomRecap>;
}
export class BloomStoryChangedError extends Error {
 constructor(readonly incoming:BloomRecap){super("This listening story has changed. Open Bloom again to continue.");this.name="BloomStoryChangedError";}
}

/** Staged facts are private to this viewing. Only real sequential receipts
 * advance confirmed progress, and a cancelled owner cannot start more writes. */
export class BloomDirectorStaging {
 confirmed:BloomRecap;
 private prepared:BloomPreparedStory|null=null;
 private preparation:Promise<BloomPreparedStory>|null=null;
 private writes:Promise<BloomRecap>|null=null;
 private completion:Promise<BloomRecap>|null=null;
 private cancelled=false;
 private requested=-1;

 constructor(initial:BloomRecap,private callbacks:Callbacks){
  this.confirmed=initial;
  if(initial.completed)this.prepared={story:initial,chapters:initial.chapters,listening:initial.listening};
 }

 cancel(){this.cancelled=true;this.prepared=null;}
 private active(){if(this.cancelled)throw new Error("This Bloom viewing has closed.");}
 refresh(incoming:BloomRecap){
  if(!sameBloomStory(this.confirmed,incoming))throw new BloomStoryChangedError(incoming);
  this.confirmed=mergeBloomRefresh(this.confirmed,incoming);
 }

 prepare(){
  this.active();
  if(this.prepared)return Promise.resolve(this.prepared);
  if(this.preparation)return this.preparation;
  if(!this.callbacks.prepare)return Promise.resolve(null);
  const task=this.callbacks.prepare().then(result=>{
   this.active();
   if(!sameBloomStory(this.confirmed,result.story))throw new BloomStoryChangedError(result.story);
   if(result.chapters.length!==this.confirmed.chapters.length||result.chapters.some((chapter,index)=>chapter.id!==this.confirmed.chapters[index].id||!chapter.stat))throw new Error("This part of your Bloom has changed. Open the story again to continue.");
   this.refresh(result.story);this.prepared=result;return result;
  });
  this.preparation=task;
  void task.finally(()=>{if(this.preparation===task)this.preparation=null;}).catch(()=>{});
  return task;
 }

 /** A cached next scene is synchronous, even while its reveal write is slow.
  * Future facts never enter the displayed recap or its chapter rail. */
 scene(current:BloomRecap,target:number):BloomRecap|null {
  this.active();
  if(target<0||target>=current.chapters.length||current.chapters.slice(0,target).some(chapter=>!chapter.revealed))return null;
  if(current.chapters[target]?.revealed)return current;
  const chapter=this.prepared?.chapters[target];
  if(!chapter||!sameBloomStory(current,this.prepared!.story))return null;
  const chapters=current.chapters.map((item,index)=>index===target?{...chapter,revealed:true}:item);
  const kinds=new Set(chapters.filter(item=>item.revealed).flatMap(item=>[item.kind||"",item.id]));
  return {...current,chapters,listening:discloseBloomListening(this.prepared?.listening,kinds)};
 }

 finale(current:BloomRecap):BloomRecap {
  this.active();
  if(current.chapters.some(chapter=>!chapter.revealed))throw new Error("Open every chapter before finishing this Bloom.");
  return {...current,listening:this.prepared?.listening||current.listening};
 }

 commitThrough(target:number):Promise<BloomRecap>{
  this.active();
  this.requested=Math.max(this.requested,target);
  if(this.writes)return this.writes;
  const run=async()=>{
   while(true){
    this.active();
    const index=this.confirmed.chapters.findIndex((chapter,index)=>index<=this.requested&&!chapter.revealed);
    if(index<0)return this.confirmed;
    const chapter=this.confirmed.chapters[index],result=await this.callbacks.reveal(chapter.id);
    // Retain a receipt already committed by the server, even if the viewing
    // closed while the request was in flight. No later write may then start.
    if(!sameBloomStory(this.confirmed,result))throw new BloomStoryChangedError(result);
    if(result.chapters[index]?.id!==chapter.id||!result.chapters[index]?.revealed||result.chapters.slice(0,index).some(item=>!item.revealed))throw new Error("This part of your Bloom could not be saved. Open the story again to continue.");
    this.refresh(result);
   }
  };
  const task=Promise.resolve().then(run);this.writes=task;
  void task.finally(()=>{if(this.writes===task)this.writes=null;}).catch(()=>{});
  return task;
 }

 complete():Promise<BloomRecap>{
  this.active();
  if(this.confirmed.completed)return Promise.resolve(this.confirmed);
  if(this.completion)return this.completion;
  const run=async()=>{
   await this.commitThrough(this.confirmed.chapters.length-1);this.active();
   const result=await this.callbacks.complete();
   if(!sameBloomStory(this.confirmed,result))throw new BloomStoryChangedError(result);
   if(!result.completed||result.chapters.some(chapter=>!chapter.revealed))throw new Error("This Bloom could not be finished. Open the story again to continue.");
   this.refresh(result);return this.confirmed;
  };
  const task=run();this.completion=task;
  void task.finally(()=>{if(this.completion===task)this.completion=null;}).catch(()=>{});
  return task;
 }
}
