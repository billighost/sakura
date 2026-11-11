"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import type {BloomPreparedStory,BloomRecap} from "./uiTypes";
import {chapterHold} from "./story";
import {sameBloomStory,mergeBloomRefresh,bloomProgressRecord,restoredBloomIndex} from "./refresh";
import {BloomDirectorStaging,BloomStoryChangedError} from "./directorStaging";
import {retainArtwork} from "../player/imageCache";
import {bloomArtworkWarmUrls} from "./artworkWarmup";

function prepareArtwork(prepared:BloomPreparedStory|null,index:number){
 for(const url of bloomArtworkWarmUrls(prepared,index))void retainArtwork(url).catch(()=>{});
}

export function useBloomDirector({initial,onPrepare,onReveal,onComplete,storageKey}:{initial:BloomRecap;onPrepare?:()=>Promise<BloomPreparedStory>;onReveal:(id:string)=>Promise<BloomRecap>;onComplete:()=>Promise<BloomRecap>;storageKey?:string}){
 const [recap,setRecap]=useState(initial),[index,setIndex]=useState(0),[begun,setBegun]=useState(false),[finished,setFinished]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[autoplay,setAutoplay]=useState(false),[paused,setPaused]=useState(false),[reading,setReading]=useState(false),[hidden,setHidden]=useState(false),[elapsed,setElapsed]=useState(0),[resumeIndex,setResumeIndex]=useState(0);
 const state=useRef({recap,index,begun,finished}),lock=useRef(false),alive=useRef(true),generation=useRef(0),clock=useRef({index:-1,elapsed:0}),callbacks=useRef({onPrepare,onReveal,onComplete}),loaded=useRef(initial);
 const failedAction=useRef<{target:number}|{commitTarget:number}|{complete:true}|null>(null),replayFromStart=useRef(false);
 const loadedScope=useRef(storageKey);
 const staging=useRef<BloomDirectorStaging|null>(null);
 function createStaging(value:BloomRecap){return new BloomDirectorStaging(value,{prepare:callbacks.current.onPrepare?()=>callbacks.current.onPrepare!():undefined,reveal:id=>callbacks.current.onReveal(id),complete:()=>callbacks.current.onComplete()});}
 useEffect(()=>{callbacks.current={onPrepare,onReveal,onComplete};},[onPrepare,onReveal,onComplete]);
 useEffect(()=>{
  let stored:unknown;if(storageKey)try{stored=JSON.parse(localStorage.getItem(storageKey)||"{}");}catch{}
  const current=sameBloomStory(state.current.recap,initial)?mergeBloomRefresh(state.current.recap,initial):initial;
  setResumeIndex(replayFromStart.current?0:restoredBloomIndex(current,stored));
 },[initial,storageKey]);
 useEffect(()=>{
  const sameOwner=loadedScope.current===storageKey;
  if(loaded.current===initial&&sameOwner)return;
  loaded.current=initial;
  loadedScope.current=storageKey;
  if(sameOwner&&sameBloomStory(state.current.recap,initial)){
   staging.current!.refresh(initial);
   const merged=mergeBloomRefresh(state.current.recap,initial);state.current={...state.current,recap:merged};setRecap(merged);return;
  }
  staging.current!.cancel();staging.current=createStaging(initial);generation.current++;lock.current=false;failedAction.current=null;replayFromStart.current=false;
  state.current={recap:initial,index:0,begun:false,finished:false};clock.current={index:-1,elapsed:0};
  setRecap(initial);setIndex(0);setBegun(false);setFinished(false);setBusy(false);setError(null);setElapsed(0);setPaused(true);
 },[initial,storageKey]);
 // Next's Activity hides routes without destroying their state. Cancel private
 // staging and later writes while retaining only actual server receipts.
 useLayoutEffect(()=>{
  alive.current=true;
  if(!staging.current)staging.current=createStaging(state.current.recap);
  return()=>{
   // Advance the current numeric epoch; this ref does not point to a DOM node.
   // eslint-disable-next-line react-hooks/exhaustive-deps
   alive.current=false;generation.current++;lock.current=false;failedAction.current=null;replayFromStart.current=false;
   const confirmed=staging.current!.confirmed;staging.current!.cancel();staging.current=null;
   state.current={recap:confirmed,index:0,begun:false,finished:false};clock.current={index:-1,elapsed:0};
   setRecap(confirmed);setIndex(0);setBegun(false);setFinished(false);setBusy(false);setError(null);setElapsed(0);setReading(false);setPaused(false);
  };
 },[]);
 useEffect(()=>{const change=()=>setHidden(document.hidden);change();document.addEventListener("visibilitychange",change);return()=>document.removeEventListener("visibilitychange",change);},[]);

 const acceptReceipt=useCallback((result:BloomRecap,epoch:number,owner:BloomDirectorStaging)=>{
  if(!alive.current||epoch!==generation.current||staging.current!==owner)return;
  const merged=mergeBloomRefresh(state.current.recap,result);state.current={...state.current,recap:merged};setRecap(merged);
 },[]);
 const fail=useCallback((problem:unknown,action:NonNullable<typeof failedAction.current>,epoch:number,owner:BloomDirectorStaging)=>{
  if(!alive.current||epoch!==generation.current||staging.current!==owner)return;
  if(problem instanceof BloomStoryChangedError&&problem.incoming.id===state.current.recap.id){
   owner.cancel();
   const value=problem.incoming;
   staging.current=new BloomDirectorStaging(value,{prepare:callbacks.current.onPrepare?()=>callbacks.current.onPrepare!():undefined,reveal:id=>callbacks.current.onReveal(id),complete:()=>callbacks.current.onComplete()});
   generation.current++;lock.current=false;replayFromStart.current=false;
   state.current={recap:value,index:0,begun:false,finished:false};clock.current={index:-1,elapsed:0};
   setRecap(value);setIndex(0);setBegun(false);setFinished(false);setBusy(false);setElapsed(0);setReading(false);setResumeIndex(0);
   failedAction.current={target:0};
   if(storageKey)try{localStorage.removeItem(storageKey);}catch{}
  }else failedAction.current=action;
  setError(problem);setPaused(true);
 },[storageKey]);
 const commit=useCallback((target:number,epoch=generation.current,owner=staging.current!)=>{
  void owner.commitThrough(target).then(result=>acceptReceipt(result,epoch,owner)).catch(problem=>{
   fail(problem,{commitTarget:Math.max(target,state.current.index)},epoch,owner);
  });
 },[acceptReceipt,fail]);
 const paint=useCallback((value:BloomRecap,target:number)=>{
  state.current={recap:value,index:target,begun:true,finished:false};failedAction.current=null;
  clock.current={index:target,elapsed:0};setRecap(value);setIndex(target);setBegun(true);setFinished(false);setElapsed(0);
  if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify(bloomProgressRecord(value,target)));}catch{}
 },[storageKey]);
 const enter=useCallback(async(target:number)=>{
  if(lock.current||!alive.current)return;
  const current=state.current.recap,owner=staging.current!;
  if(target<0||target>=current.chapters.length)return;
  const epoch=generation.current;
  const cached=owner.scene(current,target);
  if(cached){setError(null);paint(cached,target);commit(target,epoch,owner);void owner.prepare().then(value=>prepareArtwork(value,target)).catch(()=>{});return;}
  lock.current=true;setBusy(true);setError(null);
  try{
   const prepared=await owner.prepare();
   if(!alive.current||epoch!==generation.current||staging.current!==owner)return;
   const staged=owner.scene(state.current.recap,target);
   // Older embedded story fixtures may supply only the original reveal API.
   const ready=staged||mergeBloomRefresh(state.current.recap,await owner.commitThrough(target));
   if(!alive.current||epoch!==generation.current||staging.current!==owner)return;
   if(!ready.chapters[target]?.revealed)throw new Error("This part of your Bloom could not open. Try again.");
   paint(ready,target);prepareArtwork(prepared,target);commit(target,epoch,owner);
  }catch(problem){fail(problem,{target},epoch,owner);}
  finally{if(epoch===generation.current){lock.current=false;if(alive.current)setBusy(false);}}
 },[paint,commit,fail]);
 const entryTarget=useCallback(()=>{
  let stored:unknown;if(storageKey)try{stored=JSON.parse(localStorage.getItem(storageKey)||"{}");}catch{}
  return replayFromStart.current?0:restoredBloomIndex(state.current.recap,stored);
 },[storageKey]);
 // Called by the explicit Enter action, during the world's entrance animation.
 const prepareBegin=useCallback(()=>{const target=entryTarget();void staging.current!.prepare().then(value=>prepareArtwork(value,target)).catch(()=>{});},[entryTarget]);
 const begin=useCallback(()=>{const target=entryTarget();replayFromStart.current=false;return enter(target);},[enter,entryTarget]);
 const complete=useCallback(()=>{
  const owner=staging.current!,epoch=generation.current;
  setError(null);
  void owner.complete().then(result=>{
   acceptReceipt(result,epoch,owner);
   if(alive.current&&epoch===generation.current&&staging.current===owner){failedAction.current=null;if(storageKey)try{localStorage.removeItem(storageKey);}catch{}}
  }).catch(problem=>{
   fail(problem,{complete:true},epoch,owner);
  });
 },[acceptReceipt,storageKey,fail]);
 const next=useCallback(async()=>{
  if(lock.current||!alive.current)return;const current=state.current;
  if(current.index!==index)return;
  if(!current.begun||current.finished)return;
  if(current.index<current.recap.chapters.length-1){await enter(current.index+1);return;}
  // The finale already has its real facts; saving completion must not hold its
  // artwork behind the network. Only a confirmed receipt marks it completed.
  const value=staging.current!.finale(current.recap);state.current={...current,recap:value,finished:true};setRecap(value);setFinished(true);setElapsed(0);complete();
 },[index,enter,complete]);
 const previous=useCallback(()=>{if(lock.current||!state.current.begun||state.current.index!==index||state.current.finished!==finished)return;if(state.current.finished){state.current={...state.current,finished:false};setFinished(false);setElapsed(0);return;}if(state.current.index>0)void enter(state.current.index-1);},[index,finished,enter]);
 const jump=useCallback((target:number)=>{if(state.current.begun&&state.current.recap.chapters[target]?.revealed)void enter(target);},[enter]);
 useEffect(()=>{
  if(!autoplay||paused||reading||hidden||busy||!begun||finished)return;
  if(clock.current.index!==index)clock.current={index,elapsed:0};
  const activeClock=clock.current,started=performance.now(),hold=chapterHold(recap.chapters[index],recap.experience);
  const timer=setTimeout(()=>void next(),Math.max(0,hold-clock.current.elapsed));
  return()=>{clearTimeout(timer);activeClock.elapsed+=performance.now()-started;if(alive.current&&clock.current===activeClock)setElapsed(activeClock.elapsed);};
 },[autoplay,paused,reading,hidden,busy,begun,finished,index,recap,next]);
 function replay(){if(lock.current)return;generation.current++;failedAction.current=null;replayFromStart.current=true;state.current={...state.current,index:0,begun:false,finished:false};clock.current={index:-1,elapsed:0};setIndex(0);setBegun(false);setFinished(false);setReading(false);setPaused(false);setError(null);setElapsed(0);setResumeIndex(0);}
 function retry(){const failed=failedAction.current;failedAction.current=null;setError(null);if(failed&&"commitTarget" in failed)commit(failed.commitTarget);else if(failed&&"target" in failed)void enter(failed.target);else if(failed&&"complete" in failed)complete();}
 return {recap,index,begun,finished,busy,error,autoplay,paused,reading,hidden,elapsed,resumeIndex,setAutoplay,setPaused,setReading,prepareBegin,begin,next,previous,jump,replay,retry,motionPaused:paused||hidden||reading};
}
