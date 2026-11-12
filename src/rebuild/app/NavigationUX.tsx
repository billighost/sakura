"use client";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useOffline } from "next/offline";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useMusic } from "./MusicContext";
import { loadResource } from "./resources";
import { allowSpeculativePrefetch, createRouteShellPrefetch, PrefetchQueue, routePrefetchTargets, type PrefetchConnection } from "./prefetchPolicy";
import { feedTasteKey, feedViewKey } from "./feedIdentity";
import { prefetchPersonalizedFeed } from "./PersonalizedFeed";
import { prefetchHeroRecommendation } from "./useHeroRecommendation";
import { MusicScreens } from "./MusicScreens";
import {enterOfflineShell,installOfflineNavigation,localRouteSnapshot,musicRoute,rememberMusicRoute,subscribeLocalRoute} from "./offlineNavigation";
import { Blossom } from "./Brand";
import s from "./ink.module.css";
const BloomPage=dynamic(()=>import("../bloom/BloomPage").then(module=>module.BloomPage),{loading:MusicRouteLoading});

/** Keep navigation available while account restoration is still in progress. */
export function OfflineNavigationController(){
 const pathname=usePathname(),router=useRouter();
 const music=useMusic(),frameworkOffline=useOffline();
 const current=useRef(music),prefetch=useRef<PrefetchQueue|null>(null);
 useLayoutEffect(()=>{current.current=music;},[music]);
 const accountId=music.account?.id,tasteKey=feedTasteKey(music.settings);
 useEffect(()=>installOfflineNavigation(()=>music.offline||frameworkOffline),[music.offline,frameworkOffline]);
 useEffect(()=>{if(music.offline||frameworkOffline||!navigator.onLine)enterOfflineShell();},[music.offline,frameworkOffline]);
 useEffect(()=>{
  if(!accountId||music.booting||music.offline||frameworkOffline)return;
  const connection=(navigator as Navigator&{connection?:PrefetchConnection&{addEventListener?:typeof window.addEventListener;removeEventListener?:typeof window.removeEventListener}}).connection;
  const canWarm=()=>allowSpeculativePrefetch({online:navigator.onLine&&!current.current.offline&&!frameworkOffline,visible:document.visibilityState!=="hidden",playback:current.current.preparingTrack?"resolving":current.current.status,connection});
  const queue=new PrefetchQueue(canWarm);
  prefetch.current=queue;
  // Installed Next 16.4 requires kind when options include onInvalidate.
  const warmShell=createRouteShellPrefetch(queue,(href,options)=>router.prefetch(href,{...options,kind:PrefetchKind.AUTO}),location.origin);
  const warm=(href:string,priority=0)=>{
   warmShell(href,priority+2);
   const targets=routePrefetchTargets(href,location.origin);
   for(const path of targets.paths)queue.enqueue(accountId+":"+path,async signal=>{signal.throwIfAborted();await loadResource(accountId,path);},priority);
   if(targets.surface){
    const surface=targets.surface,settings=current.current.settings,key=feedViewKey(accountId,surface,"balanced",settings);
    queue.enqueue("feed:"+key,signal=>prefetchPersonalizedFeed(accountId,surface,settings,signal),priority+1);
    queue.enqueue("hero:"+key,signal=>prefetchHeroRecommendation(accountId,surface,settings,signal),priority);
   }
  };
  const intent=(event:Event)=>{
   const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[href]"):null;
   if(!anchor||anchor.hasAttribute("download")||anchor.target&&anchor.target!=="_self")return;
   warm(anchor.href,10);
  };
  const dataRoutes=new Set(["/home","/discover","/library","/bloom"]);
  const pending=["/home","/discover","/search","/library","/profile","/liked","/library/downloaded","/bloom"]
   .filter(href=>href!==location.pathname);
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,idle:number|undefined;
  const cancel=()=>{if(timer!==undefined)clearTimeout(timer);if(idle!==undefined)window.cancelIdleCallback(idle);timer=undefined;idle=undefined;};
  const schedule=()=>{
   cancel();if(stopped||!pending.length||!canWarm())return;
   // Preserve the mobile loading budget: warm one shell (and, where useful,
   // its read-only data) in idle time instead of starting every route at once.
   timer=setTimeout(()=>{timer=undefined;const run=()=>{idle=undefined;if(stopped||!canWarm())return;const href=pending.shift();if(href){if(dataRoutes.has(href))warm(href);else warmShell(href);}schedule();};if(typeof window.requestIdleCallback==="function")idle=window.requestIdleCallback(run,{timeout:10000});else run();},2000);
  };
  const resume=()=>{queue.resume();schedule();};
  schedule();
  document.addEventListener("pointerover",intent);document.addEventListener("focusin",intent);document.addEventListener("pointerdown",intent);
  document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
  connection?.addEventListener?.("change",resume);
  return()=>{stopped=true;cancel();queue.dispose();if(prefetch.current===queue)prefetch.current=null;document.removeEventListener("pointerover",intent);document.removeEventListener("focusin",intent);document.removeEventListener("pointerdown",intent);document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);connection?.removeEventListener?.("change",resume);};
 },[accountId,music.booting,music.offline,frameworkOffline,tasteKey,router]);
 useEffect(()=>{prefetch.current?.resume();},[music.status,music.offline,music.preparingTrack]);
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
