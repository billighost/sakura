"use client";

import { useLayoutEffect, useRef } from "react";

/** iOS standalone windows can expose a layout viewport taller than the visible app. */
export function useVisibleViewport() {
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const element=ref.current,viewport=window.visualViewport;
  if(!element||!viewport)return;
  const mobile=matchMedia("(max-width:650px)");
  let frame:number|undefined;
  const update=()=>{
   if(!mobile.matches){element.style.removeProperty("--sakura-viewport-height");element.style.removeProperty("--sakura-viewport-top");return;}
   element.style.setProperty("--sakura-viewport-height",`${viewport.height}px`);
   element.style.setProperty("--sakura-viewport-top",`${viewport.offsetTop}px`);
  };
  const schedule=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=undefined;update();});};
  update();
  viewport.addEventListener("resize",schedule);viewport.addEventListener("scroll",schedule);
  window.addEventListener("resize",schedule);mobile.addEventListener("change",schedule);
  return()=>{if(frame!==undefined)cancelAnimationFrame(frame);viewport.removeEventListener("resize",schedule);viewport.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);mobile.removeEventListener("change",schedule);};
 },[]);
 return ref;
}
