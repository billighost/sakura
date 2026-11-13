"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import {bloomOpeningScore,playBloomOpening,type OpeningPerformance} from "./openingAudio";
import {openingSampleCache} from "./openingSamples";
import type {BloomDesign} from "./uiTypes";

type Options={world:BloomDesign;active:boolean;muted:boolean;paused:boolean;seed?:number};
type Session={context:AudioContext;performance:OpeningPerformance|null;endTimer:ReturnType<typeof setTimeout>|null;world:BloomDesign;seed:number;sampleController:AbortController};
let lastSampleRate=48000;
function audioConstructor(){return window.AudioContext||(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;}
const subscribeAvailability=()=>()=>{};
const availableSnapshot=()=>typeof window!=="undefined"&&Boolean(audioConstructor());
const serverAvailability=()=>false;

/** Native audio stays inside the opening's lifecycle and gesture boundary. */
export function useBloomOpeningAudio({world,active,muted,paused,seed=0}:Options){
 const available=useSyncExternalStore(subscribeAvailability,availableSnapshot,serverAvailability),[playing,setPlaying]=useState(false);
 const configuration=useRef({world,active,muted,paused,seed}),session=useRef<Session|null>(null),generation=useRef(0),alive=useRef(false),manuallyStopped=useRef(false),completed=useRef(false),tails=useRef(new Map<ReturnType<typeof setTimeout>,Session>()),warmControllers=useRef(new Map<number,AbortController>());
 const cancelWarm=useCallback((except?:number)=>{for(const [rate,controller]of warmControllers.current)if(rate!==except){controller.abort();warmControllers.current.delete(rate);}},[]);
 const warm=useCallback(()=>{cancelWarm();const options=configuration.current;if(!alive.current||!options.active||options.muted||options.paused||document.hidden||manuallyStopped.current||completed.current||!audioConstructor())return;for(const rate of new Set([lastSampleRate,44100,48000])){const controller=new AbortController();warmControllers.current.set(rate,controller);void openingSampleCache.prepare(options.seed,rate,controller.signal).catch(()=>{});}},[cancelWarm]);
 const dispose=useCallback((entry:Session)=>{entry.sampleController.abort();if(entry.endTimer)clearTimeout(entry.endTimer);entry.context.onstatechange=null;entry.performance?.dispose();void entry.context.close().catch(()=>{});},[]);
 const release=useCallback((seconds:number)=>{
  generation.current++;const entry=session.current;session.current=null;if(alive.current)setPlaying(false);if(!entry)return;
  entry.sampleController.abort();
  if(entry.endTimer)clearTimeout(entry.endTimer);entry.context.onstatechange=null;
  if(seconds===0||entry.context.state!=="running"){dispose(entry);return;}
  entry.performance?.fade(seconds);
  const timer=setTimeout(()=>{tails.current.delete(timer);dispose(entry);},seconds*1000+35);tails.current.set(timer,entry);
 },[dispose]);
 const scheduleEnd=useCallback((entry:Session)=>{
  if(entry.endTimer)clearTimeout(entry.endTimer);if(!entry.performance)return;
  entry.endTimer=setTimeout(()=>{if(session.current!==entry||entry.context.state!=="running")return;session.current=null;completed.current=true;if(alive.current)setPlaying(false);dispose(entry);},Math.max(0,entry.performance.endsAt-entry.context.currentTime)*1000+80);
 },[dispose]);
 const unlock=useCallback(()=>{
  const options=configuration.current;
  if(!alive.current||!options.active||options.muted||options.paused||document.hidden||manuallyStopped.current||completed.current)return;
  const Constructor=audioConstructor();if(!Constructor)return;
  let entry=session.current;
  if(entry&&(entry.world!==options.world||entry.seed!==options.seed)){release(.08);entry=null;}
  if(!entry){try{entry={context:new Constructor({latencyHint:"playback"}),performance:null,endTimer:null,world:options.world,seed:options.seed,sampleController:new AbortController()};session.current=entry;}catch{return;}}
  if(entry.sampleController.signal.aborted){entry={...entry,sampleController:new AbortController()};session.current=entry;}
  cancelWarm(entry.context.sampleRate);
  lastSampleRate=entry.context.sampleRate;
  const owned=entry,epoch=generation.current;
  // resume is invoked synchronously within the gesture. Scheduling waits for
  // its result so rejected or late browser permission cannot start a score.
  void owned.context.resume().then(async()=>{
   const current=configuration.current;
   if(!alive.current||generation.current!==epoch||session.current!==owned||!current.active||current.muted||current.paused||document.hidden||manuallyStopped.current)return;
   if(!owned.performance){const samples=await openingSampleCache.prepare(owned.seed,owned.context.sampleRate,owned.sampleController.signal);const latest=configuration.current;if(!alive.current||generation.current!==epoch||session.current!==owned||!latest.active||latest.muted||latest.paused||document.hidden||manuallyStopped.current||owned.context.state!=="running")return;if(!owned.performance)owned.performance=playBloomOpening(owned.context,bloomOpeningScore(owned.world,owned.seed),samples);}
   setPlaying(owned.context.state==="running");scheduleEnd(owned);
   owned.context.onstatechange=()=>{
    if(!alive.current||session.current!==owned)return;
    setPlaying(owned.context.state==="running");
    if(owned.context.state==="running")scheduleEnd(owned);
    else if(owned.endTimer){clearTimeout(owned.endTimer);owned.endTimer=null;}
    if(owned.context.state==="closed"){session.current=null;completed.current=true;dispose(owned);}
   };
  }).catch(()=>{if(session.current===owned&&generation.current===epoch)release(0);});
 },[dispose,release,scheduleEnd,cancelWarm]);
 const stop=useCallback(()=>{manuallyStopped.current=true;cancelWarm();release(.6);},[release,cancelWarm]);
 // Finishing the welcome is a single performance. Only this explicit sound
 // action restarts it; tapping Enter or an unrelated control does not.
 const play=useCallback(()=>{completed.current=false;manuallyStopped.current=false;unlock();},[unlock]);

 useEffect(()=>{
  // Activity keeps refs when leaving a route, but returning is a new welcome.
  alive.current=true;completed.current=false;manuallyStopped.current=false;const pendingTails=tails.current;
  return()=>{alive.current=false;cancelWarm();release(0);for(const [timer,entry] of pendingTails){clearTimeout(timer);dispose(entry);}pendingTails.clear();};
 },[dispose,release,cancelWarm]);
 useEffect(()=>{
  const previous=configuration.current;configuration.current={world,active,muted,paused,seed};
  if(previous.world!==world||previous.seed!==seed){completed.current=false;manuallyStopped.current=false;}
  if(!active){manuallyStopped.current=false;completed.current=false;release(.6);return;}
  if(muted){release(.08);return;}
  const entry=session.current;
  if(entry&&(entry.world!==world||entry.seed!==seed)){release(.08);manuallyStopped.current=false;}
  if(paused||document.hidden){generation.current++;entry?.sampleController.abort();if(entry?.endTimer)clearTimeout(entry.endTimer);if(entry?.context.state==="running")void entry.context.suspend().catch(()=>{});return;}
  if(session.current||navigator.userActivation?.hasBeenActive)unlock();
 },[world,active,muted,paused,seed,release,unlock]);
 useEffect(()=>{warm();return()=>cancelWarm();},[active,muted,paused,seed,warm,cancelWarm]);
 useEffect(()=>{
  if(!active)return;
  const gesture=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('dialog[open][data-bloom-design]')&&!event.target.closest('[data-bloom-action="sound"],input,button[aria-label="Close Sakura Bloom"]'))unlock();};
  const visibility=()=>{
   if(document.hidden){cancelWarm();generation.current++;const entry=session.current;entry?.sampleController.abort();if(entry?.endTimer)clearTimeout(entry.endTimer);if(entry?.context.state==="running")void entry.context.suspend().catch(()=>{});setPlaying(false);}
   else if(!configuration.current.paused){warm();unlock();}
  };
  document.addEventListener("pointerdown",gesture,true);document.addEventListener("keydown",gesture,true);document.addEventListener("visibilitychange",visibility);
  return()=>{document.removeEventListener("pointerdown",gesture,true);document.removeEventListener("keydown",gesture,true);document.removeEventListener("visibilitychange",visibility);};
 },[active,unlock,warm,cancelWarm]);
 return {unlock,play,stop,available,playing:playing&&active&&!muted&&!paused};
}
