"use client";
import {useSyncExternalStore} from "react";

function subscribe(listener:()=>void){
 const query=matchMedia("(prefers-color-scheme: dark)");
 query.addEventListener("change",listener);
 return()=>query.removeEventListener("change",listener);
}
const systemDark=()=>matchMedia("(prefers-color-scheme: dark)").matches;
/** Follow idle OS theme changes while keeping the server's first paint stable. */
export function useBloomPalette(theme:string){
 const dark=useSyncExternalStore(subscribe,systemDark,()=>false);
 return theme==="dark"||theme==="system"&&dark?"dark":"light";
}
