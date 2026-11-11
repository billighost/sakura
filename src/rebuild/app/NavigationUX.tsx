"use client";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useOffline } from "next/offline";
import { useMusic } from "./MusicContext";
import { MusicScreens } from "./MusicScreens";
import {enterOfflineShell,installOfflineNavigation,localRouteSnapshot,musicRoute,rememberMusicRoute,subscribeLocalRoute} from "./offlineNavigation";
import { Blossom } from "./Brand";
import s from "./ink.module.css";
const BloomPage=dynamic(()=>import("../bloom/BloomPage").then(module=>module.BloomPage),{loading:MusicRouteLoading});

/** Keep navigation available while account restoration is still in progress. */
export function OfflineNavigationController(){
 const pathname=usePathname(),router=useRouter();
 const music=useMusic(),frameworkOffline=useOffline();
 useEffect(()=>installOfflineNavigation(()=>music.offline||frameworkOffline),[music.offline,frameworkOffline]);
 useEffect(()=>{if(music.offline||frameworkOffline||!navigator.onLine)enterOfflineShell();},[music.offline,frameworkOffline]);
 useEffect(()=>{
  if(music.booting||!music.account?.id||music.offline||frameworkOffline)return;
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string;addEventListener?:typeof window.addEventListener;removeEventListener?:typeof window.removeEventListener}}).connection;
  const canWarm=()=>navigator.onLine&&document.visibilityState==="visible"&&!connection?.saveData&&!/^(slow-)?2g$/.test(connection?.effectiveType||"");
  const pending:string[]=[];
  for(const href of ["/home","/discover","/search","/library","/profile","/liked","/library/downloaded"])if(href!==location.pathname)pending.push(href);
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,idle:number|undefined;
  const cancel=()=>{if(timer!==undefined)clearTimeout(timer);if(idle!==undefined)window.cancelIdleCallback(idle);timer=undefined;idle=undefined;};
  const schedule=()=>{
   cancel();if(stopped||!pending.length||!canWarm())return;
   // Warm one route in idle time after startup rather than requesting seven
   // routes while the visible page is still loading.
   timer=setTimeout(()=>{timer=undefined;const warm=()=>{idle=undefined;if(stopped||!canWarm())return;const href=pending.shift();if(href)router.prefetch(href);schedule();};if(typeof window.requestIdleCallback==="function")idle=window.requestIdleCallback(warm,{timeout:10000});else warm();},2000);
  };
  schedule();document.addEventListener("visibilitychange",schedule);window.addEventListener("online",schedule);connection?.addEventListener?.("change",schedule);
  return()=>{stopped=true;cancel();document.removeEventListener("visibilitychange",schedule);window.removeEventListener("online",schedule);connection?.removeEventListener?.("change",schedule);};
 },[router,music.booting,music.account?.id,music.offline,frameworkOffline]);
 useEffect(()=>{rememberMusicRoute(pathname);const controlled=()=>rememberMusicRoute(location.pathname);navigator.serviceWorker?.addEventListener("controllerchange",controlled);return()=>navigator.serviceWorker?.removeEventListener("controllerchange",controlled);},[pathname]);
 return null;
}

export function RouteTransition({children}:{children:ReactNode}){
 const pathname=usePathname(),element=useRef<HTMLDivElement>(null);
 const localPath=useSyncExternalStore(subscribeLocalRoute,localRouteSnapshot,()=>"");
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
