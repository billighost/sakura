"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {type UserSettings} from "./types";

import {feedViewKey} from "./feedIdentity";

import {recommendationCacheVersion} from "./recommendationCache";
import {cachedHero,restoreHero,loadInitialHero,loadHero,invalidateRecommendationViews,type HeroState} from "./recommendationViews";
export type {HeroRecommendation} from "./recommendationViews";

/** Either prefetch lease shares the initial feed/hero envelope. */
export async function prefetchHeroRecommendation(accountId:string,surface:"home"|"discover",settings:UserSettings,signal:AbortSignal,mode:"balanced"|"familiar"|"explore"="balanced"){
 signal.throwIfAborted();
 if(typeof navigator!=="undefined"&&navigator.onLine===false)return;
 const key=feedViewKey(accountId,surface,mode,settings),saved=await restoreHero(accountId,key,signal);
 if(saved.ready&&saved.refreshAt>Date.now())return;
 await loadInitialHero(accountId,key,surface,mode,signal);
}

/** Refresh only the hero, preserving the listener's feed order and scroll position. */
export function useHeroRecommendation({accountId,cacheKey,surface,mode,hold}:{
 accountId:string;cacheKey:string;surface:"home"|"discover";mode:"balanced"|"familiar"|"explore";hold:()=>boolean;
}){
 const [state,setState]=useState<HeroState>(()=>cachedHero(accountId,cacheKey));
 const holdRef=useRef(hold);useEffect(()=>{holdRef.current=hold;},[hold]);
 const stateRef=useRef(state),pending=useRef<HeroState|null>(null),request=useRef<AbortController|null>(null);
 const refreshTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const release=useCallback(()=>{if(pending.current&&!holdRef.current()){const next=pending.current;pending.current=null;stateRef.current=next;setState(next);}},[]);
 useEffect(()=>{
  let active=true;
  const clearTimer=()=>{clearTimeout(refreshTimer.current);refreshTimer.current=undefined;};
  const schedule=(at:number)=>{clearTimer();refreshTimer.current=setTimeout(()=>void refresh(),Math.max(1000,at-Date.now()));};
  const refresh=async(force=false)=>{
   if(!active||!accountId||request.current||document.visibilityState==="hidden"||navigator.onLine===false)return;
   if(!force&&stateRef.current.refreshAt>Date.now()){schedule(stateRef.current.refreshAt);return;}
   const controller=new AbortController(),cacheVersion=recommendationCacheVersion(accountId);request.current=controller;
   try{
    const next=force||!stateRef.current.ready
      ? await loadInitialHero(accountId,cacheKey,surface,mode,controller.signal,force)
      : await loadHero(accountId,cacheKey,surface,mode,controller.signal);
    if(!active||controller.signal.aborted||recommendationCacheVersion(accountId)!==cacheVersion)return;
    if(holdRef.current())pending.current=next;else {pending.current=null;stateRef.current=next;setState(next);}
    schedule(next.refreshAt);
   }catch{
    // Retain an available song during temporary outages; the feed still has its
    // normal recovery controls. Resume the quiet hero refresh on reconnection.
    if(active&&!controller.signal.aborted)schedule(Date.now()+60000);
   }finally{if(request.current===controller)request.current=null;}
  };
  const resume=()=>{release();void refresh();};
  const changed=(event:Event)=>{
   const owner=(event as CustomEvent<{accountId?:string}>).detail?.accountId;
   if(owner&&owner!==accountId)return;
   invalidateRecommendationViews(accountId,event);
   request.current?.abort();request.current=null;pending.current=null;clearTimer();
   // Clear the old explanation immediately, even when the listener erased data
   // offline or the new response fails. No stale fallback should reappear.
   const cleared={item:null,ready:false,refreshAt:0};stateRef.current=cleared;setState(cleared);
   void refresh(true);
  };
  const afterInteraction=()=>setTimeout(release,0);
  document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
  window.addEventListener("focusout",afterInteraction);window.addEventListener("pointerup",afterInteraction);window.addEventListener("pointercancel",afterInteraction);
  for(const name of ["sakura-taste-updated","sakura-personalization-cleared","sakura-listening-erased","sakura-recommendations-cleared"])window.addEventListener(name,changed);
  void (async()=>{
   if(!stateRef.current.ready){const saved=await restoreHero(accountId,cacheKey);if(!active)return;
    if(saved.ready){stateRef.current=saved;setState(saved);}
   }
   await refresh();
  })();
  return ()=>{
   active=false;clearTimer();request.current?.abort();request.current=null;pending.current=null;
   document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);
   window.removeEventListener("focusout",afterInteraction);window.removeEventListener("pointerup",afterInteraction);window.removeEventListener("pointercancel",afterInteraction);
   for(const name of ["sakura-taste-updated","sakura-personalization-cleared","sakura-listening-erased","sakura-recommendations-cleared"])window.removeEventListener(name,changed);
  };
 },[accountId,cacheKey,surface,mode,release]);
 return {...state,release};
}
