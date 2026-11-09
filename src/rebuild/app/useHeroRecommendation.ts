"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {musicTrack,type MusicTrack} from "./types";
import {requestJson} from "./errors";
import {HERO_REFRESH_MS} from "../recommendations/hero";

export interface HeroRecommendation {track:MusicTrack;reason:string;lane:"familiar"|"similar"|"explore"|"fresh"}
interface HeroState {item:HeroRecommendation|null;ready:boolean;refreshAt:number}
const visitedHeroes=new Map<string,HeroState>();
const empty=():HeroState=>({item:null,ready:false,refreshAt:0});
function parseHero(raw:Record<string,unknown>):HeroState {
 if(raw.item!==null&&(!raw.item||typeof raw.item!=="object"))throw new Error("Hero response unavailable");
 const value=raw.item as Record<string,unknown>|null;
 const item=value?{track:musicTrack(value.track as Record<string,unknown>),reason:typeof value.reason==="string"?value.reason:"Selected for your recommendations.",
  lane:(["familiar","similar","explore","fresh"].includes(String(value.lane))?value.lane:"similar") as HeroRecommendation["lane"]}:null;
 const now=Date.now(),at=Number(raw.refreshAt);
 return {item,ready:true,refreshAt:Number.isFinite(at)?Math.max(now+1000,Math.min(now+HERO_REFRESH_MS,at)):now+HERO_REFRESH_MS};
}

/** Refresh only the hero, preserving the listener's feed order and scroll position. */
export function useHeroRecommendation({accountId,cacheKey,surface,mode,hold}:{
 accountId:string;cacheKey:string;surface:"home"|"discover";mode:"balanced"|"familiar"|"explore";hold:()=>boolean;
}){
 const [state,setState]=useState<HeroState>(()=>visitedHeroes.get(cacheKey)||empty());
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
   const controller=new AbortController();request.current=controller;
   try{
    const raw=await requestJson<Record<string,unknown>>("/api/v2/feed/hero?"+new URLSearchParams({surface,mode}),{signal:controller.signal},{accountId,context:"page"});
    if(!active||controller.signal.aborted)return;
    const next=parseHero(raw);visitedHeroes.set(cacheKey,next);
    while(visitedHeroes.size>8)visitedHeroes.delete(visitedHeroes.keys().next().value!);
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
   for(const key of visitedHeroes.keys())if(key.startsWith(accountId+":"))visitedHeroes.delete(key);
   request.current?.abort();request.current=null;pending.current=null;clearTimer();
   // Clear the old explanation immediately, even when the listener erased data
   // offline or the new response fails. No stale fallback should reappear.
   const cleared={item:null,ready:true,refreshAt:0};stateRef.current=cleared;setState(cleared);
   void refresh(true);
  };
  const afterInteraction=()=>setTimeout(release,0);
  document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
  window.addEventListener("focusout",afterInteraction);window.addEventListener("pointerup",afterInteraction);window.addEventListener("pointercancel",afterInteraction);
  for(const name of ["sakura-taste-updated","sakura-personalization-cleared","sakura-listening-erased"])window.addEventListener(name,changed);
  void refresh();
  return ()=>{
   active=false;clearTimer();request.current?.abort();request.current=null;pending.current=null;
   document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);
   window.removeEventListener("focusout",afterInteraction);window.removeEventListener("pointerup",afterInteraction);window.removeEventListener("pointercancel",afterInteraction);
   for(const name of ["sakura-taste-updated","sakura-personalization-cleared","sakura-listening-erased"])window.removeEventListener(name,changed);
  };
 },[accountId,cacheKey,surface,mode,release]);
 return {...state,release};
}
