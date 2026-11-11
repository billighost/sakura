"use client";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useMusic } from "./MusicContext";
import { MusicScreens } from "./MusicScreens";
import { BloomPage } from "../bloom/BloomPage";
import {enterOfflineShell,installOfflineNavigation,localRouteSnapshot,musicRoute,rememberMusicRoute,subscribeLocalRoute} from "./offlineNavigation";
import { Blossom } from "./Brand";
import s from "./ink.module.css";

export function RouteTransition({children}:{children:ReactNode}){
 const pathname=usePathname(),router=useRouter(),element=useRef<HTMLDivElement>(null);
 const music=useMusic(),frameworkOffline=useOffline();
 const localPath=useSyncExternalStore(subscribeLocalRoute,localRouteSnapshot,()=>"");
 useEffect(()=>installOfflineNavigation(()=>music.offline||frameworkOffline),[music.offline,frameworkOffline]);
 useEffect(()=>{if(music.offline||frameworkOffline||!navigator.onLine)enterOfflineShell();},[music.offline,frameworkOffline]);
 useEffect(()=>{if(!navigator.onLine)return;for(const href of ["/home","/discover","/search","/library","/profile","/liked","/library/downloaded"])router.prefetch(href);},[router]);
 useEffect(()=>{rememberMusicRoute(pathname);const controlled=()=>rememberMusicRoute(location.pathname);navigator.serviceWorker?.addEventListener("controllerchange",controlled);return()=>navigator.serviceWorker?.removeEventListener("controllerchange",controlled);},[pathname]);
 useLayoutEffect(()=>{
  const node=element.current;
  if(!node)return;
  const motion=matchMedia("(prefers-reduced-motion: reduce)");
  if(motion.matches||node.closest("[data-reduced-motion]")||typeof node.animate!=="function")return;
  // Keep the router subtree stable: Activity owns cached pages and their state.
  // Animate only this frame once per committed route, never per resource update.
  const entrance=node.animate([
   {opacity:.45,transform:"translateY(9px) scale(.996)"},
   {opacity:1,transform:"none"},
  ],{duration:380,easing:"cubic-bezier(.2,.72,.2,1)"});
  const settle=()=>entrance.cancel();
  motion.addEventListener("change",settle);
  return()=>{motion.removeEventListener("change",settle);entrance.cancel();};
 },[pathname,localPath]);
 const route=localPath?musicRoute(localPath):null;
 return <div ref={element} className={s.routeTransition} data-route-path={localPath||pathname}>{route?(route[0]==="bloom"?<BloomPage id={route[1]}/>:<MusicScreens route={route}/>):children}</div>;
}

export function MusicRouteLoading(){
 return <div className={s.routeLoading} role="status" aria-live="polite"><div className={s.loadingBlossom}><Blossom/></div><div><span>A little path is opening.</span><b>Your music is just beyond the petals.</b></div><i/><i/><i/></div>;
}
