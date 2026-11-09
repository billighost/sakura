import type {CSSProperties} from "react";
import s from "./world.module.css";

/** Leaf shutters reveal the same painted river the story later follows. */
export function JunglePrelude({id,quality}:{id:string;quality:number}){
 return <div className={s.prelude} aria-hidden="true">
  <div className={s.preludeNight}/>
  <svg className={s.riverAwakening} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
   <defs><linearGradient id={`${id}-opening-current`} x2="0" y2="1"><stop stopColor="#f0e6ad"/><stop offset=".5" stopColor="#9dcfb7"/><stop offset="1" stopColor="#d4dea3"/></linearGradient><radialGradient id={`${id}-opening-firefly`}><stop stopColor="#fff7c8"/><stop offset=".3" stopColor="#d4e6a6" stopOpacity=".75"/><stop offset="1" stopColor="#b7d99a" stopOpacity="0"/></radialGradient></defs>
   <path className={s.firstCurrent} d="M850 453C786 504 1047 506 1001 560C934 632 544 577 604 654C659 735 1236 675 1231 789C1219 889 804 947 820 1020" fill="none" stroke={`url(#${id}-opening-current)`} strokeWidth="3" strokeLinecap="round"/>
   <path className={s.currentEcho} d="M850 453C786 504 1047 506 1001 560C934 632 544 577 604 654C659 735 1236 675 1231 789C1219 889 804 947 820 1020" fill="none" stroke="#d6e9b4" strokeWidth="15" opacity=".13"/>
   {Array.from({length:quality*4+8},(_,n)=>{const x=690+Math.sin(n*1.7)*330,y=230+n*24;return <g className={s.openingFirefly} key={n} style={{"--fly-delay":`${n*.065}s`,"--fly-dx":`${Math.cos(n)*40}px`,"--fly-dy":`${-20-n%5*11}px`} as CSSProperties}><circle cx={x} cy={y} r="22" fill={`url(#${id}-opening-firefly)`}/><circle cx={x} cy={y} r={n%3?1.5:2.3} fill="#faf3bd"/></g>;})}
  </svg>
  <div className={`${s.leafShutter} ${s.leafShutterLeft}`}><svg viewBox="0 0 600 1000" preserveAspectRatio="none"><defs><linearGradient id={`${id}-shutter`}><stop stopColor="#0b2927"/><stop offset=".65" stopColor="#1c5142"/><stop offset="1" stopColor="#66896a"/></linearGradient></defs><path d="M0 0H360Q610 100 535 240Q619 381 540 488Q600 655 512 783Q569 935 357 1000H0Z" fill={`url(#${id}-shutter)`}/><path d="M90-40Q205 377 473 1060" stroke="#a2b47c" strokeWidth="3" fill="none" opacity=".6"/>{Array.from({length:12},(_,n)=><path key={n} d={`M${105+n*29} ${n*87}Q${236+n*17} ${n*87-68} ${447+n%3*23} ${n*87-102}M${105+n*29} ${n*87}Q${67+n*3} ${n*87+94} 0 ${n*87+126}`} stroke="#9eb585" strokeWidth="1" opacity=".2" fill="none"/>)}</svg></div>
  <div className={`${s.leafShutter} ${s.leafShutterRight}`}><svg viewBox="0 0 600 1000" preserveAspectRatio="none"><path d="M0 0H360Q610 100 535 240Q619 381 540 488Q600 655 512 783Q569 935 357 1000H0Z" fill={`url(#${id}-shutter)`}/><path d="M90-40Q205 377 473 1060" stroke="#a2b47c" strokeWidth="3" fill="none" opacity=".6"/>{Array.from({length:12},(_,n)=><path key={n} d={`M${105+n*29} ${n*87}Q${236+n*17} ${n*87-68} ${447+n%3*23} ${n*87-102}M${105+n*29} ${n*87}Q${67+n*3} ${n*87+94} 0 ${n*87+126}`} stroke="#9eb585" strokeWidth="1" opacity=".2" fill="none"/>)}</svg></div>
  <svg className={s.openingLeaf} viewBox="0 0 100 50"><path d="M3 33C14 2 67-5 91 13C82 33 48 46 3 33Z" fill="#d2b576"/><path d="M3 33Q38 20 91 13M25 28 35 10M47 22 59 5M26 28 43 37M53 22 69 28" fill="none" stroke="#806b41" strokeWidth="1.2"/></svg>
 </div>;
}
