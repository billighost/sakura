"use client";
import {useEffect,useRef,useState,type ComponentProps} from "react";
import Link from "next/link";
import {useMusic} from "../app/MusicContext";
import {allowSpeculativePrefetch,type PrefetchConnection} from "../app/prefetchPolicy";
import {BloomWarmupWindow} from "./speculation";
import {useBloomPreparation,useBloomSpeculativeOwnership} from "./useBloomPreparation";

/** Viewport/intent preparation shares a bounded slot and yields to playback,
 * connection policy, hidden pages, and the explicit story entrance. */
export function BloomReadyLink({id,enabled=true,...props}:ComponentProps<typeof Link>&{id:string;enabled?:boolean}){
 const music=useMusic(),node=useRef<HTMLAnchorElement>(null),current=useRef(music),windowRef=useRef<BloomWarmupWindow|null>(null),[warm,setWarm]=useState(false),[intent,setIntent]=useState(false);
 useEffect(()=>{current.current=music;},[music]);
 useEffect(()=>{
  if(!enabled||!node.current)return;
  const window=new BloomWarmupWindow(setWarm);windowRef.current=window;
  const connection=(navigator as Navigator&{connection?:PrefetchConnection&EventTarget}).connection;
  const policy=()=>window.policy(allowSpeculativePrefetch({online:navigator.onLine&&!current.current.offline,visible:document.visibilityState!=="hidden",playback:current.current.preparingTrack?"resolving":current.current.status,connection}));
  const observer=new IntersectionObserver(values=>window.viewport(values.some(value=>value.isIntersecting)),{rootMargin:"240px"});observer.observe(node.current);policy();
  document.addEventListener("visibilitychange",policy);globalThis.window.addEventListener("online",policy);globalThis.window.addEventListener("offline",policy);connection?.addEventListener("change",policy);
  return()=>{observer.disconnect();window.dispose();if(windowRef.current===window)windowRef.current=null;document.removeEventListener("visibilitychange",policy);globalThis.window.removeEventListener("online",policy);globalThis.window.removeEventListener("offline",policy);connection?.removeEventListener("change",policy);};
 },[enabled]);
 useEffect(()=>{windowRef.current?.policy(allowSpeculativePrefetch({online:navigator.onLine&&!music.offline,visible:document.visibilityState!=="hidden",playback:music.preparingTrack?"resolving":music.status,connection:(navigator as Navigator&{connection?:PrefetchConnection}).connection}));},[music.offline,music.status,music.preparingTrack]);
 const key=music.account?`${music.account.id}:${id}`:null,owned=useBloomSpeculativeOwnership(key,enabled&&warm,intent?1:0);
 useBloomPreparation(music.account?.id||null,id,undefined,false,owned,"speculative");
 return <Link {...props} ref={node} onPointerEnter={event=>{windowRef.current?.intent("pointer",true);setIntent(true);props.onPointerEnter?.(event);}} onPointerLeave={event=>{windowRef.current?.intent("pointer",false);setIntent(false);props.onPointerLeave?.(event);}} onFocus={event=>{windowRef.current?.intent("focus",true);setIntent(true);props.onFocus?.(event);}} onBlur={event=>{windowRef.current?.intent("focus",false);setIntent(false);props.onBlur?.(event);}} onTouchStart={event=>{windowRef.current?.intent("touch",true);setIntent(true);props.onTouchStart?.(event);}} onTouchEnd={event=>{windowRef.current?.intent("touch",false);setIntent(false);props.onTouchEnd?.(event);}} onTouchCancel={event=>{windowRef.current?.intent("touch",false);setIntent(false);props.onTouchCancel?.(event);}}/>;
}
