"use client";
import {useCallback,useEffect,useRef,useSyncExternalStore} from "react";
/** Calendar access follows its deadline and rechecks when a suspended tab resumes. */
export function useBoundary(boundary:string|undefined,onCross:()=>void){
 const callback=useRef(onCross);useEffect(()=>{callback.current=onCross;},[onCross]);
 const snapshot=useCallback(()=>Boolean(boundary&&Date.now()>=Date.parse(boundary)),[boundary]);
 const subscribe=useCallback((listener:()=>void)=>{
  const date=boundary?Date.parse(boundary):NaN;if(!Number.isFinite(date))return()=>{};
  let crossed=false,timer:ReturnType<typeof setTimeout>|undefined;
  function check(){
   if(Date.now()>=date){if(!crossed){crossed=true;listener();callback.current();}}
   else timer=setTimeout(check,Math.min(2147483647,Math.max(1,date-Date.now()+1)));
  }
  timer=setTimeout(check,Math.min(2147483647,Math.max(0,date-Date.now()+1)));
  const visible=()=>{if(document.visibilityState==="visible"){if(timer)clearTimeout(timer);check();}};
  document.addEventListener("visibilitychange",visible);
  return()=>{if(timer)clearTimeout(timer);document.removeEventListener("visibilitychange",visible);};
 },[boundary]);
 return useSyncExternalStore(subscribe,snapshot,()=>false);
}

