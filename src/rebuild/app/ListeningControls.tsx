"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { needsMediaVolumeGain } from "../audio/engine";
import { Blossom } from "./Brand";
import s from "./listening-controls.module.css";
function clock(ms:number){const seconds=Math.floor(Math.max(0,ms)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;}
export function PlaybackRibbon({positionMs,durationMs,onSeek,disabled=false,compact=false,label="Playback position"}:{positionMs:number;durationMs:number;onSeek:(ms:number)=>void;disabled?:boolean;compact?:boolean;label?:string}){
 const dragging=useRef(false);const [preview,setPreview]=useState<number|null>(null);
 const max=Math.max(1,durationMs);const value=Math.max(0,Math.min(preview??positionMs,max));const percent=value/max*100;
 return <div className={`${s.ribbon} ${compact?s.compact:""}`}><div className={s.ribbonTrack} style={{"--progress":`${percent}%`} as CSSProperties}>
  <svg viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path className={s.ghostStroke} d="M0 23C30 18 55 27 80 23S130 16 160 22S210 28 240 22S270 8 294 21S330 31 360 23S410 17 440 22S480 28 510 22S555 19 600 23"/><path className={s.stem} d="M0 23C55 21 90 24 150 23S220 22 275 23S340 24 405 23S515 21 600 23"/></svg>
  <div className={s.played}><svg viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 23C30 18 55 27 80 23S130 16 160 22S210 28 240 22S270 8 294 21S330 31 360 23S410 17 440 22S480 28 510 22S555 19 600 23"/></svg></div><span className={s.ribbonBloom}><Blossom/></span>
  <input type="range" min={0} max={max} step={100} value={value} disabled={disabled||!durationMs} aria-label={label} aria-valuetext={`${clock(value)} of ${clock(durationMs)}`} title="Drag to seek · ← / → 5 seconds · Shift + ← / → 1 second" onPointerDown={e=>{dragging.current=true;setPreview(Number(e.currentTarget.value));e.currentTarget.setPointerCapture(e.pointerId);}} onChange={e=>{const next=Number(e.target.value);if(dragging.current)setPreview(next);else onSeek(next);}} onPointerUp={e=>{if(!dragging.current)return;dragging.current=false;onSeek(Number(e.currentTarget.value));setPreview(null);}} onPointerCancel={()=>{dragging.current=false;setPreview(null);}} onKeyDown={e=>{let next:number|undefined;if(e.key==="ArrowLeft"||e.key==="ArrowDown")next=value-(e.shiftKey?1000:5000);else if(e.key==="ArrowRight"||e.key==="ArrowUp")next=value+(e.shiftKey?1000:5000);else if(e.key==="Home")next=0;else if(e.key==="End")next=durationMs;else if(e.key==="PageUp")next=value+10000;else if(e.key==="PageDown")next=value-10000;if(next!==undefined){e.preventDefault();e.stopPropagation();onSeek(Math.max(0,Math.min(durationMs,next)));}}}/>
 </div><div className={s.times}><span>{clock(positionMs)}</span>{!compact&&<em>follow the little thread</em>}<span>{clock(durationMs)}</span></div></div>;
}
const subscribeVolumeDevice=()=>()=>{};
const fixedNativeVolume=()=>typeof navigator!=="undefined"&&needsMediaVolumeGain();
const serverNativeVolume=()=>false;
function VolumeMark(){
 return <svg className={s.volumeMark} width="30" height="30" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <path className={s.volumeSpeaker} d="M7.5 14h4.5l6-5v18l-6-5H7.5Z"/>
  <g className={s.volumeWaves}><path d="M22 13a8 8 0 0 1 0 10"/><path d="M26 9.5a13 13 0 0 1 0 17"/></g>
  <path className={s.volumeQuietStroke} pathLength="1" d="M8.5 28Q18.5 18 28.5 8"/>
  <g className={s.volumePetals} stroke="var(--ink-petal,#bc8293)" strokeWidth=".65" fill="var(--ink-petal,#bc8293)">
   <path d="M5 8C1 6 1 2 4 2c1 0 1 1 2 1 1-1 3 0 3 1 0 2-2 3-4 4Z"/>
   <path d="M29 31c0-4 3-7 5-5 1 1 0 2 0 2 1 1 0 3-1 3-2 1-3 0-4 0Z"/>
   <path className={s.volumeQuietStem} d="M5 29q7 4 15 3" fill="none"/>
  </g>
 </svg>;
}
export function VolumeControl({value,onChange,compact=false,label="Volume",nativePlayback=false}:{value:number;onChange:(value:number)=>void;compact?:boolean;label?:string;nativePlayback?:boolean}){
 const fixedVolume=useSyncExternalStore(subscribeVolumeDevice,fixedNativeVolume,serverNativeVolume),deviceVolume=nativePlayback&&fixedVolume;
 const last=useRef(.8);const bounded=Math.max(0,Math.min(1,value));const percent=Math.round(bounded*100),muted=bounded===0;
 // Every visible surface follows slider/settings changes before restoring sound.
 useEffect(()=>{if(bounded>0)last.current=bounded;},[bounded]);
 function mute(){if(bounded>0){last.current=bounded;onChange(0);}else onChange(last.current||.8);}
 return <div className={`${s.volume} ${compact?s.volumeCompact:""}`} data-muted={muted} data-device-volume={deviceVolume||undefined}><button type="button" className={s.muteButton} aria-label={muted?"Unmute audio":"Mute audio"} aria-pressed={muted} title={muted?"Unmute · bring the sound back":"Mute · let the sound rest"} onClick={mute}><VolumeMark/>{!compact&&<span>{label}</span>}</button>{deviceVolume?<span className={s.deviceVolume}>{muted?"Muted":"Use device volume"}</span>:<><div className={s.volumeBranch}><svg viewBox="0 0 150 38" aria-hidden="true"><path className={s.stem} d="M5 28Q60 27 143 10"/>{Array.from({length:10},(_,i)=><ellipse key={i} cx={16+i*13} cy={i%2?25-i*.8:17-i*.8} rx={3+i*.35} ry={5+i*.4} transform={`rotate(${i%2?50:-45} ${16+i*13} ${i%2?25-i*.8:17-i*.8})`} className={bounded>=(i+1)/10?s.litPetal:s.quietPetal}/>)}</svg><input aria-label={label} aria-valuetext={muted?"Muted":`${percent} percent`} type="range" min={0} max={1} step={.01} value={bounded} onChange={e=>onChange(Number(e.target.value))}/></div><span className={s.volumeValue} aria-hidden="true">{muted?"muted":percent+"%"}</span></>}</div>;
}
export function GardenSlider({value,onChange,label,min=0,max=1,step=.05,valueText}:{value:number;onChange:(value:number)=>void;label:string;min?:number;max?:number;step?:number;valueText?:string}){
 const bounded=Math.max(min,Math.min(max,value)),percent=(bounded-min)/Math.max(.001,max-min)*100;
 return <div className={s.gardenSlider} style={{"--progress":`${percent}%`} as CSSProperties}><svg viewBox="0 0 360 46" preserveAspectRatio="none" aria-hidden="true"><path className={s.stem} d="M8 30C65 22 115 35 170 24S280 29 352 16"/>{[45,95,145,195,245,295,340].map((x,i)=><path key={x} className={percent>=(i+1)/7*100?s.litPetal:s.quietPetal} d={`M${x} 26q-17 -18 -21 -5q7 12 21 5m0 0q12 15 19 5q-7 -11 -19 -5`}/>)}</svg><span className={s.gardenBloom}><Blossom/></span><input type="range" min={min} max={max} step={step} value={bounded} aria-label={label} aria-valuetext={valueText||Math.round(percent)+" percent"} onChange={e=>onChange(Number(e.target.value))}/></div>;
}
