"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {BloomRecap} from "./uiTypes";
import {chapterHold} from "./story";
import {sameBloomStory,mergeBloomRefresh,bloomProgressRecord,restoredBloomIndex} from "./refresh";

export function useBloomDirector({initial,onReveal,onComplete,storageKey}:{initial:BloomRecap;onReveal:(id:string)=>Promise<BloomRecap>;onComplete:()=>Promise<BloomRecap>;storageKey?:string}){
 const [recap,setRecap]=useState(initial),[index,setIndex]=useState(0),[begun,setBegun]=useState(false),[finished,setFinished]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[autoplay,setAutoplay]=useState(false),[paused,setPaused]=useState(false),[reading,setReading]=useState(false),[hidden,setHidden]=useState(false),[elapsed,setElapsed]=useState(0);
 const state=useRef({recap,index,begun,finished}),lock=useRef(false),alive=useRef(true),generation=useRef(0),clock=useRef({index:-1,elapsed:0}),callbacks=useRef({onReveal,onComplete}),loaded=useRef(initial);
 const failedAction=useRef<{target:number}|{complete:true}|null>(null);
 useEffect(()=>{callbacks.current={onReveal,onComplete};},[onReveal,onComplete]);
 useEffect(()=>{
  if(loaded.current===initial)return;
  if(sameBloomStory(state.current.recap,initial)){loaded.current=initial;const merged=mergeBloomRefresh(state.current.recap,initial);state.current={...state.current,recap:merged};setRecap(merged);return;}
  loaded.current=initial;generation.current++;lock.current=false;failedAction.current=null;
  state.current={recap:initial,index:0,begun:false,finished:false};clock.current={index:-1,elapsed:0};
  setRecap(initial);setIndex(0);setBegun(false);setFinished(false);setBusy(false);setError(null);setElapsed(0);setPaused(true);
 },[initial]);
 useEffect(()=>{const epoch=generation.current;alive.current=true;return()=>{alive.current=false;generation.current=epoch+1;};},[]);
 useEffect(()=>{const change=()=>setHidden(document.hidden);change();document.addEventListener("visibilitychange",change);return()=>document.removeEventListener("visibilitychange",change);},[]);
 const enter=useCallback(async(target:number)=>{
  if(lock.current)return;const current=state.current.recap;if(target<0||target>=current.chapters.length)return;
  lock.current=true;setBusy(true);setError(null);const epoch=generation.current;
  try{const chapter=current.chapters[target];const result=chapter.revealed?current:await callbacks.current.onReveal(chapter.id);
   if(!alive.current||epoch!==generation.current)return;
   if(!sameBloomStory(current,result)||result.chapters[target]?.id!==chapter.id||!result.chapters[target]?.revealed)throw new Error("This part of your Bloom has changed. Open the story again to continue.");
   const merged=mergeBloomRefresh(state.current.recap,result);
   state.current={recap:merged,index:target,begun:true,finished:false};failedAction.current=null;
   clock.current={index:target,elapsed:0};setRecap(merged);setIndex(target);setBegun(true);setFinished(false);setElapsed(0);
   if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify(bloomProgressRecord(merged,target)));}catch{}
  }catch(problem){if(alive.current&&epoch===generation.current){failedAction.current={target};setError(problem);setPaused(true);}}finally{if(epoch===generation.current){lock.current=false;if(alive.current)setBusy(false);}}
 },[storageKey]);
 const begin=useCallback(()=>{let stored:unknown;if(storageKey)try{stored=JSON.parse(localStorage.getItem(storageKey)||"{}");}catch{}return enter(restoredBloomIndex(state.current.recap,stored));},[enter,storageKey]);
 const next=useCallback(async()=>{
  if(lock.current)return;const current=state.current;
  if(!current.begun){await begin();return;}
  if(current.index<current.recap.chapters.length-1){await enter(current.index+1);return;}
  lock.current=true;setBusy(true);setError(null);const epoch=generation.current;
  try{const result=await callbacks.current.onComplete();if(alive.current&&epoch===generation.current){if(!sameBloomStory(current.recap,result)||!result.completed||result.chapters.some(chapter=>!chapter.revealed))throw new Error("This Bloom could not be finished. Open the story again to continue.");state.current={...current,recap:result,finished:true};failedAction.current=null;setRecap(result);setFinished(true);setElapsed(0);if(storageKey)try{localStorage.removeItem(storageKey);}catch{}}}catch(problem){if(alive.current&&epoch===generation.current){failedAction.current={complete:true};setError(problem);setPaused(true);}}finally{if(epoch===generation.current){lock.current=false;if(alive.current)setBusy(false);}}
 },[begin,enter,storageKey]);
 const previous=useCallback(()=>{if(state.current.finished){state.current={...state.current,finished:false};setFinished(false);setElapsed(0);return;}if(state.current.index>0)void enter(state.current.index-1);},[enter]);
 const jump=useCallback((target:number)=>{if(state.current.recap.chapters[target]?.revealed)void enter(target);},[enter]);
 useEffect(()=>{
  if(!autoplay||paused||reading||hidden||busy||!begun||finished)return;
  if(clock.current.index!==index)clock.current={index,elapsed:0};
  const activeClock=clock.current,started=performance.now(),hold=chapterHold(recap.chapters[index],recap.experience);
  const timer=setTimeout(()=>void next(),Math.max(0,hold-clock.current.elapsed));
  return()=>{clearTimeout(timer);activeClock.elapsed+=performance.now()-started;if(alive.current&&clock.current===activeClock)setElapsed(activeClock.elapsed);};
 },[autoplay,paused,reading,hidden,busy,begun,finished,index,recap,next]);

 function replay(){setFinished(false);setPaused(false);void enter(0);}
 return {recap,index,begun,finished,busy,error,autoplay,paused,reading,hidden,elapsed,setAutoplay,setPaused,setReading,begin,next,previous,jump,replay,retry:()=>void (failedAction.current&&"target" in failedAction.current?enter(failedAction.current.target):next()),motionPaused:paused||hidden||reading};
}
