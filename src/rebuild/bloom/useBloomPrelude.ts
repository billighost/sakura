"use client";
import {useCallback,useEffect,useRef,useState,type RefObject} from "react";
import type {BloomOpeningPhase} from "./worlds/types";

const OPENING_MS=7600;
const ENTER_MS=950;

/** The welcome never writes a bookmark. Only explicit entry starts the director. */
export function useBloomPrelude({canvas,begun,still,paused,identity,begin}:{canvas:RefObject<HTMLElement|null>;begun:boolean;still:boolean;paused:boolean;identity:string;begin:()=>Promise<void>}){
 const [phase,setPhase]=useState<BloomOpeningPhase>(still?"settled":"arriving");
 const [ready,setReady]=useState(false);
 const clock=useRef(0),entryLock=useRef(false),entryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),epoch=useRef(0),beginRef=useRef(begin);
 useEffect(()=>{beginRef.current=begin;},[begin]);
 useEffect(()=>{
  const currentEpoch=++epoch.current;clock.current=0;entryLock.current=false;
  // Reset in an effect because the same dialog can receive a regenerated story.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setPhase("arriving");setReady(false);
  return()=>{epoch.current=currentEpoch+1;clearTimeout(entryTimer.current);entryLock.current=false;};
 },[identity,begun]); // still is handled below without replaying the welcome.
 useEffect(()=>{
  const node=canvas.current;if(!node||begun)return;
  const detect=()=>{if(node.querySelector("[data-bloom-world] > [data-scene]")){setReady(true);observer.disconnect();}};
  const observer=new MutationObserver(detect);observer.observe(node,{childList:true,subtree:true});detect();
  return()=>observer.disconnect();
 },[canvas,begun,identity]);
 useEffect(()=>{
  // eslint-disable-next-line react-hooks/set-state-in-effect
  if(still&&phase==="arriving")setPhase("settled");
 },[still,phase]);
 useEffect(()=>{
  if(!ready||begun||paused||phase!=="arriving"||still)return;
  const start=performance.now();
  const timer=setTimeout(()=>setPhase("settled"),Math.max(0,OPENING_MS-clock.current));
  return()=>{clearTimeout(timer);clock.current+=performance.now()-start;};
 },[ready,begun,paused,phase,still]);
 const skip=useCallback(()=>{if(!entryLock.current)setPhase("settled");},[]);
 const cancel=useCallback(()=>{epoch.current++;clearTimeout(entryTimer.current);entryLock.current=false;},[]);
 const enter=useCallback(()=>{
  if(entryLock.current||begun)return;entryLock.current=true;setPhase("entering");
  const currentEpoch=epoch.current;
  const run=()=>{void beginRef.current().finally(()=>{if(epoch.current===currentEpoch){entryLock.current=false;setPhase("settled");}});};
  if(still)run();else entryTimer.current=setTimeout(run,ENTER_MS);
 },[begun,still]);
 return {phase:begun?"entered" as const:phase,entering:!begun&&phase==="entering",ready,skip,enter,cancel};
}
