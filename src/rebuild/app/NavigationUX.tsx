"use client";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Blossom } from "./Brand";
import s from "./ink.module.css";

export function RouteTransition({children}:{children:ReactNode}){
 const pathname=usePathname(),router=useRouter(),element=useRef<HTMLDivElement>(null);
 useEffect(()=>{for(const href of ["/home","/discover","/search","/library","/profile"])router.prefetch(href);},[router]);
 useLayoutEffect(()=>{
  const node=element.current;
  if(!node)return;
  const motion=matchMedia("(prefers-reduced-motion: reduce)");
  if(motion.matches||node.closest("[data-reduced-motion]")||typeof node.animate!=="function")return;
  // Keep the router subtree stable: Activity owns cached pages and their state.
  // Animate only this frame once per committed route, never per resource update.
  const entrance=node.animate([
   {opacity:.45,transform:"translateY(9px) scale(.996)",filter:"blur(2px)"},
   {opacity:1,transform:"none",filter:"none"},
  ],{duration:380,easing:"cubic-bezier(.2,.72,.2,1)"});
  const settle=()=>entrance.cancel();
  motion.addEventListener("change",settle);
  return()=>{motion.removeEventListener("change",settle);entrance.cancel();};
 },[pathname]);
 return <div ref={element} className={s.routeTransition} data-route-path={pathname}>{children}</div>;
}

export function MusicRouteLoading(){
 return <div className={s.routeLoading} role="status" aria-live="polite"><div className={s.loadingBlossom}><Blossom/></div><div><span>A little path is opening.</span><b>Your music is just beyond the petals.</b></div><i/><i/><i/></div>;
}
