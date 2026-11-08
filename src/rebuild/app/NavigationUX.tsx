"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Blossom } from "./Brand";
import s from "./ink.module.css";

export function RouteTransition({children}:{children:ReactNode}){
 const pathname=usePathname(),router=useRouter();
 useEffect(()=>{for(const href of ["/home","/discover","/search","/library","/profile"])router.prefetch(href);},[router]);
 return <div key={pathname} className={s.routeTransition}>{children}</div>;
}

export function MusicRouteLoading(){
 return <div className={s.routeLoading} role="status" aria-live="polite"><div className={s.loadingBlossom}><Blossom/></div><div><span>A little path is opening.</span><b>Your music is just beyond the petals.</b></div><i/><i/><i/></div>;
}
