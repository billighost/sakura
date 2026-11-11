"use client";
import {useEffect,type RefObject} from "react";

/** Cropped branches and scenery keep their artwork without spending frames. */
export function useBloomViewportMotion(element:RefObject<HTMLElement|null>){
 useEffect(()=>{
  const root=element.current;
  if(!root||typeof IntersectionObserver!=="function")return;
  const states=new Map<HTMLElement|SVGElement,string>();
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    const target=entry.target as HTMLElement|SVGElement;
    target.style.animationPlayState=entry.isIntersecting?states.get(target)||"":"paused";
   }
  },{root:root.closest<HTMLElement>("[data-bloom-scroll]"),rootMargin:"48px",threshold:0});
  let frame=0;
  const scan=()=>{
   frame=0;
   for(const animation of root.getAnimations({subtree:true})){
    // A reveal transition reaches its final appearance even outside the
    // viewport; only decorative keyframes sleep until their scenery is visible.
    if("transitionProperty" in animation||animation.effect?.getComputedTiming().iterations!==Infinity)continue;
    const target=(animation.effect as KeyframeEffect|null)?.target;
    if(!(target instanceof HTMLElement||target instanceof SVGElement)||states.has(target))continue;
    states.set(target,target.style.animationPlayState);observer.observe(target);
   }
   for(const target of states.keys())if(!root.contains(target)){observer.unobserve(target);states.delete(target);}
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};
  const mutations=new MutationObserver(schedule);
  mutations.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["data-opening-phase","data-scene","data-quality"]});
  root.addEventListener("animationstart",schedule,true);scan();
  return()=>{mutations.disconnect();observer.disconnect();root.removeEventListener("animationstart",schedule,true);if(frame)cancelAnimationFrame(frame);for(const [target,state] of states)target.style.animationPlayState=state;};
 },[element]);
}
