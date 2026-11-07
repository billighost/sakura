"use client";
import {useEffect,useState} from "react";
import {deviceBloomTier,selectedBloomTier,type BloomPerformance} from "./performance";
import type {BloomQuality} from "./worlds/types";
let cachedTier:BloomQuality|undefined,detection:Promise<BloomQuality>|undefined;
function detect(){
 if(cachedTier)return Promise.resolve(cachedTier);if(detection)return detection;
 detection=new Promise<BloomQuality>(resolve=>{
  const nav=navigator as Navigator&{deviceMemory?:number;connection?:{saveData?:boolean}};
  const hints={cores:nav.hardwareConcurrency,memory:nav.deviceMemory,saveData:nav.connection?.saveData};
  const finish=(frameMs?:number)=>{cachedTier=deviceBloomTier({...hints,frameMs});resolve(cachedTier);};
  if(document.hidden){finish();return;}
  const samples:number[]=[];let last=0,done=false,raf=0;
  const timer=window.setTimeout(()=>{if(!done){done=true;cancelAnimationFrame(raf);finish();}},1800);
  const tick=(now:number)=>{if(done)return;if(document.hidden){done=true;clearTimeout(timer);finish();return;}if(last)samples.push(now-last);last=now;
   if(samples.length>=32){done=true;clearTimeout(timer);const sorted=samples.slice(4).sort((a,b)=>a-b);finish(sorted[Math.floor(sorted.length*.75)]);return;}raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);
 });return detection;
}
export function useBloomPerformance(setting:BloomPerformance|undefined){const [automatic,setAutomatic]=useState<BloomQuality>(()=>cachedTier??3);useEffect(()=>{let live=true;void detect().then(tier=>{if(live)setAutomatic(tier);});return()=>{live=false;};},[]);return {quality:selectedBloomTier(setting,automatic),automatic};}
