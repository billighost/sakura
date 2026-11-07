"use client";
import { useRef, type CSSProperties } from "react";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import s from "./listening-controls.module.css";
function clock(ms:number){const seconds=Math.floor(Math.max(0,ms)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;}
export function PlaybackRibbon({positionMs,durationMs,onSeek,disabled=false,compact=false,label="Playback position"}:{positionMs:number;durationMs:number;onSeek:(ms:number)=>void;disabled?:boolean;compact?:boolean;label?:string}){
 const max=Math.max(1,durationMs);const value=Math.max(0,Math.min(positionMs,max));const percent=value/max*100;
 return <div className={`${s.ribbon} ${compact?s.compact:""}`}><div className={s.ribbonTrack} style={{"--progress":`${percent}%`} as CSSProperties}>
  <svg viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path className={s.ghostStroke} d="M0 23C30 18 55 27 80 23S130 16 160 22S210 28 240 22S270 8 294 21S330 31 360 23S410 17 440 22S480 28 510 22S555 19 600 23"/><path className={s.stem} d="M0 23C55 21 90 24 150 23S220 22 275 23S340 24 405 23S515 21 600 23"/></svg>
  <div className={s.played}><svg viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 23C30 18 55 27 80 23S130 16 160 22S210 28 240 22S270 8 294 21S330 31 360 23S410 17 440 22S480 28 510 22S555 19 600 23"/></svg></div><span className={s.ribbonBloom}><Blossom/></span>
  <input type="range" min={0} max={max} step={100} value={value} disabled={disabled||!durationMs} aria-label={label} aria-valuetext={`${clock(value)} of ${clock(durationMs)}`} onChange={e=>onSeek(Number(e.target.value))}/>
 </div><div className={s.times}><span>{clock(positionMs)}</span>{!compact&&<em>follow the little thread</em>}<span>{clock(durationMs)}</span></div></div>;
}
export function VolumeControl({value,onChange,compact=false,label="Volume"}:{value:number;onChange:(value:number)=>void;compact?:boolean;label?:string}){
 const last=useRef(.8);const bounded=Math.max(0,Math.min(1,value));const percent=Math.round(bounded*100);
 function mute(){if(bounded>0){last.current=bounded;onChange(0);}else onChange(last.current||.8);}
 return <div className={`${s.volume} ${compact?s.volumeCompact:""}`}><button type="button" aria-label={bounded>0?"Mute audio":"Unmute audio"} title={bounded>0?"Mute":"Unmute"} onClick={mute}><Icon name="volume" size={18}/>{!compact&&<span>{label}</span>}</button><div className={s.volumeBranch}><svg viewBox="0 0 150 38" aria-hidden="true"><path className={s.stem} d="M5 28Q60 27 143 10"/>{Array.from({length:10},(_,i)=><ellipse key={i} cx={16+i*13} cy={i%2?25-i*.8:17-i*.8} rx={3+i*.35} ry={5+i*.4} transform={`rotate(${i%2?50:-45} ${16+i*13} ${i%2?25-i*.8:17-i*.8})`} className={bounded>=(i+1)/10?s.litPetal:s.quietPetal}/>)}</svg><input aria-label={label} aria-valuetext={percent===0?"Muted":`${percent} percent`} type="range" min={0} max={1} step={.01} value={bounded} onChange={e=>onChange(Number(e.target.value))}/></div><span className={s.volumeValue} aria-hidden="true">{percent===0?"quiet":percent+"%"}</span></div>;
}
