import type {CSSProperties} from "react";
import s from "./world.module.css";

/** A gilt lotus folio opens; its lotus becomes the garden's reflecting pool. */
export function IndiaPrelude({id,quality}:{id:string;quality:number}){
 return <div className={s.prelude} aria-hidden="true">
  <div className={s.preludeNight}/>
  <div className={s.folioLeaves}><div className={`${s.folioLeaf} ${s.folioLeafLeft}`}/><div className={`${s.folioLeaf} ${s.folioLeafRight}`}/></div>
  <svg className={s.lotusTheatre} viewBox="0 0 800 800" preserveAspectRatio="xMidYMid meet">
   <defs><radialGradient id={`${id}-lotus-aura`}><stop stopColor="#e6b785" stopOpacity=".42"/><stop offset="1" stopColor="#edc997" stopOpacity="0"/></radialGradient><linearGradient id={`${id}-lotus-pigment`} x2="0" y2="1"><stop stopColor="#eed1aa"/><stop offset=".45" stopColor="#d18a89"/><stop offset="1" stopColor="#7f475f"/></linearGradient></defs>
   <circle className={s.lotusAura} cx="400" cy="400" r="310" fill={`url(#${id}-lotus-aura)`}/>
   <g className={s.lotusHalo} fill="none" stroke="#d9b482"><circle cx="400" cy="400" r="206" strokeWidth="1"/><circle cx="400" cy="400" r="220" strokeWidth=".6"/><circle cx="400" cy="400" r="238" strokeWidth=".7" strokeDasharray="1 8"/>{Array.from({length:24},(_,n)=><g key={n} transform={`translate(400 400) rotate(${n*15})`}><path d="M0-246q-7-13 0-23q7 10 0 23Z" fill="#dab485" strokeWidth=".6"/><path d="M0-218 0-233" strokeWidth=".5"/></g>)}</g>
   <g className={s.lotusBloom}>
    {Array.from({length:12},(_,n)=><g key={n} transform={`translate(400 400) rotate(${n*30})`}><path className={s.lotusPetal} style={{"--lotus-delay":`${1+n*.065}s`} as CSSProperties} d="M0 0Q-61-70-40-139Q-25-170 0-193Q25-170 40-139Q61-70 0 0Z" fill={`url(#${id}-lotus-pigment)`} stroke="#e7bc8d" strokeWidth="1.1"/><path className={s.lotusPetal} style={{"--lotus-delay":`${1.1+n*.065}s`} as CSSProperties} d="M0-17Q-1-74 0-155M-4-35Q-28-71-27-106M4-35Q28-71 27-106" fill="none" stroke="#f0c9a0" strokeWidth=".7" opacity=".55"/></g>)}
    {Array.from({length:8},(_,n)=><g key={n} transform={`translate(400 400) rotate(${n*45+15})`}><path className={s.lotusInner} d="M0 0Q-37-28-23-69Q-11-94 0-112Q11-94 23-69Q37-28 0 0Z" fill="#e3b69c" stroke="#f3d8b0" strokeWidth=".7"/></g>)}
    <circle cx="400" cy="400" r="28" fill="#ae865a" stroke="#e9c995" strokeWidth="2"/><circle cx="400" cy="400" r="20" fill="#d7ba77"/>{Array.from({length:7},(_,n)=><circle key={n} cx={400+Math.cos(n*2.4)*13} cy={400+Math.sin(n*2.4)*13} r="2" fill="#876840"/>)}
   </g>
   <g className={s.lotusPigments}>{Array.from({length:quality*3+6},(_,n)=><circle key={n} cx={400+Math.cos(n*2.4)*(240+n%4*10)} cy={400+Math.sin(n*2.4)*(240+n%4*10)} r={n%3?2:3.5} fill={["#e5c186","#b0c7b0","#d1a1a1"][n%3]} style={{"--pigment-delay":`${n*.07}s`} as CSSProperties}/>)}</g>
  </svg>
  <div className={s.giltRevelation}/>
 </div>;
}
