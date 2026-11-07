"use client";
import {useEffect,useRef,useState} from "react";
import type {BloomDesign} from "./uiTypes";
import type {BloomQuality} from "./worlds/types";
import {WorldStage} from "./worlds/WorldStage";
import {bloomWorld} from "./worlds/registry";
import s from "./cinema.module.css";
export function BloomCover({design,quality,theme}:{design:BloomDesign;quality:BloomQuality;theme:"light"|"dark"}){
 const element=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);const world=bloomWorld(design);
 useEffect(()=>{const node=element.current;if(!node)return;if(!("IntersectionObserver" in window)){const frame=requestAnimationFrame(()=>setVisible(true));return()=>cancelAnimationFrame(frame);}const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:"180px"});observer.observe(node);return()=>observer.disconnect();},[]);
 return <div ref={element} className={s.cardArt} style={{background:world.colours[0]}} aria-label={`${world.name} illustrated cover`}>{visible&&<WorldStage design={design} scene="opening" stage={0} progress={.14} quality={quality} reducedMotion view="cover" theme={theme}/>}</div>;
}
