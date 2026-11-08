"use client";
import {useEffect,type RefObject} from "react";

/** CSS pauses the keyframes; Web Animations also freezes camera/light transitions. */
export function usePausedWorldTransitions(canvas:RefObject<HTMLElement|null>,paused:boolean){
 useEffect(()=>{
  const root=canvas.current;if(!paused||!root)return;
  const held=new Set<Animation>();let frame=0;
  function pauseTransitions(){
   frame=0;
   const world=root!.querySelector<HTMLElement>("[data-bloom-world]");
   for(const animation of world?.getAnimations({subtree:true})||[]){
    if("transitionProperty" in animation&&animation.playState==="running"){
     held.add(animation);animation.pause();
    }
   }
  }
  pauseTransitions();
  // A lazy world or a late chapter reveal can introduce transitions while paused.
  const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(pauseTransitions);});
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style","data-scene","data-shot","data-theme"]});
  return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);for(const animation of held)if(animation.playState==="paused")animation.play();};
 },[canvas,paused]);
}
