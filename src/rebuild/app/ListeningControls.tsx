"use client";
import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { needsMediaVolumeGain } from "../audio/engine";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
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
export function VolumeControl({value,onChange,compact=false,label="Volume",nativePlayback=false}:{value:number;onChange:(value:number)=>void;compact?:boolean;label?:string;nativePlayback?:boolean}){
 const fixedVolume=useSyncExternalStore(subscribeVolumeDevice,fixedNativeVolume,serverNativeVolume),deviceVolume=nativePlayback&&fixedVolume;
 const last=useRef(.8);const bounded=Math.max(0,Math.min(1,value));const percent=Math.round(bounded*100);
 function mute(){if(bounded>0){last.current=bounded;onChange(0);}else onChange(last.current||.8);}
 return <div className={`${s.volume} ${compact?s.volumeCompact:""}`}><button type="button" aria-label={bounded>0?"Mute audio":"Unmute audio"} title={bounded>0?"Mute":"Unmute"} onClick={mute}><Icon name="volume" size={18}/>{!compact&&<span>{label}</span>}</button>{deviceVolume?<span className={s.deviceVolume}>Use device volume</span>:<><div className={s.volumeBranch}><svg viewBox="0 0 150 38" aria-hidden="true"><path className={s.stem} d="M5 28Q60 27 143 10"/>{Array.from({length:10},(_,i)=><ellipse key={i} cx={16+i*13} cy={i%2?25-i*.8:17-i*.8} rx={3+i*.35} ry={5+i*.4} transform={`rotate(${i%2?50:-45} ${16+i*13} ${i%2?25-i*.8:17-i*.8})`} className={bounded>=(i+1)/10?s.litPetal:s.quietPetal}/>)}</svg><input aria-label={label} aria-valuetext={percent===0?"Muted":`${percent} percent`} type="range" min={0} max={1} step={.01} value={bounded} onChange={e=>onChange(Number(e.target.value))}/></div><span className={s.volumeValue} aria-hidden="true">{percent===0?"quiet":percent+"%"}</span></>}</div>;
}
export function GardenSlider({value,onChange,label,min=0,max=1,step=.05,valueText}:{value:number;onChange:(value:number)=>void;label:string;min?:number;max?:number;step?:number;valueText?:string}){
 const bounded=Math.max(min,Math.min(max,value)),percent=(bounded-min)/Math.max(.001,max-min)*100;
 return <div className={s.gardenSlider} style={{"--progress":`${percent}%`} as CSSProperties}><svg viewBox="0 0 360 46" preserveAspectRatio="none" aria-hidden="true"><path className={s.stem} d="M8 30C65 22 115 35 170 24S280 29 352 16"/>{[45,95,145,195,245,295,340].map((x,i)=><path key={x} className={percent>=(i+1)/7*100?s.litPetal:s.quietPetal} d={`M${x} 26q-17 -18 -21 -5q7 12 21 5m0 0q12 15 19 5q-7 -11 -19 -5`}/>)}</svg><span className={s.gardenBloom}><Blossom/></span><input type="range" min={min} max={max} step={step} value={bounded} aria-label={label} aria-valuetext={valueText||Math.round(percent)+" percent"} onChange={e=>onChange(Number(e.target.value))}/></div>;
}
