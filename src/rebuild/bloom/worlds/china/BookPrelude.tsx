import type {CSSProperties} from "react";
import type {BloomQuality} from "../types";
import s from "./world.module.css";

/** The cover, leaves and birds all belong to the landscape's book. */
export function BookMount({id}:{id:string}) {
 return <g className={s.bookMount}>
  <path d="M37 66Q358 5 717 61Q1055 3 1403 66L1421 854Q1061 809 717 859Q358 803 19 854Z" fill="#17271f" stroke="#b99c64" strokeWidth="3"/>
  {[0,1,2].map(n=><path key={n} d={`M${48+n*6} ${62+n*5}Q373 ${27+n*6} 717 ${75+n*3}Q1056 ${24+n*6} ${1392-n*6} ${62+n*5}L${1402-n*6} ${836-n*5}Q1047 ${795-n*4} 717 ${845-n*4}Q373 ${795-n*4} ${38+n*6} ${836-n*5}Z`} fill={n%2?"#a89c7c":"#ddd2ae"} stroke="#857b61" strokeWidth=".7"/>)}
  <path d="M79 61Q382 22 718 64Q1048 23 1361 61V840Q1044 803 718 846Q385 803 79 840Z" fill="var(--ink-paper)"/>
  <path d="M79 61H1361V840H79Z" fill={`url(#${id}-fibres)`}/>
  <path d="M700 65Q727 377 700 843H731Q713 382 731 65Z" fill="#786e49" opacity=".12"/>
  <path d="M719 65Q711 423 719 846" fill="none" stroke="#827650" strokeWidth="1.5" opacity=".38"/>
  <path d="M92 75Q380 40 694 77M743 77Q1060 40 1347 75M92 826Q380 788 694 829M743 829Q1060 788 1347 826" fill="none" stroke="#bba675" strokeWidth="1.2" opacity=".55"/>
 </g>;
}

function Crane() {
 return <svg viewBox="-80 -65 160 130" aria-hidden="true">
  <path className={s.craneWing} d="M-5 9Q-29-39-71-48Q-49-17-37 1Q-19 22 0 14Z" fill="#e9e5ce" stroke="#a9b3a0" strokeWidth="1"/>
  <path d="M-30-11-56-31M-22-7-46-29M-18 1-34-18" fill="none" stroke="#899886" strokeWidth="1.2"/>
  <path className={s.craneWingOther} d="M-1 11Q25-39 62-43Q49-13 28 7Q13 20-1 15Z" fill="#faf0d7" stroke="#a9b3a0" strokeWidth="1"/>
  <path d="M19 2 44-21M26-5 53-30" fill="none" stroke="#929d8a" strokeWidth="1.1"/>
  <path d="M-16 15Q-4 24 11 13Q14 8 18-1Q22-9 26-5Q32 1 32 9" fill="none" stroke="#ede8d5" strokeWidth="8" strokeLinecap="round"/>
  <path d="m30 6 16 4-16 2" fill="#cda868"/><circle cx="29" cy="5" r="3" fill="#b9654d"/><circle cx="30" cy="6" r=".9" fill="#243a30"/>
  <path d="m-13 19-28 16 5-10-10 2 23-14" fill="#344b40"/><path d="m-11 21-18 23m21-25-14 25" stroke="#8a7959" strokeWidth="1.6" fill="none"/>
 </svg>;
}

export function BookPrelude({quality,id}:{quality:BloomQuality;id:string}) {
 return <>
  <div className={s.bookNight} aria-hidden="true"/>
  <div className={s.bookPrelude} aria-hidden="true">
   <div className={s.bookHalo}/>
   <div className={s.lacquerBook}>
    <div className={s.closedBook}>
     <svg viewBox="0 0 340 440">
      <defs><linearGradient id={`${id}-prelude-lacquer`} x2="1" y2="1"><stop stopColor="#1b413a"/><stop offset=".55" stopColor="#132c28"/><stop offset="1" stopColor="#31584a"/></linearGradient></defs>
      <rect x="8" y="8" width="324" height="424" rx="4" fill={`url(#${id}-prelude-lacquer)`} stroke="#c6ac75" strokeWidth="2"/>
      <rect x="23" y="23" width="294" height="394" rx="2" fill="none" stroke="#c5ac76" strokeWidth=".8"/>
      <path d="M40 46h34M40 46v34m260-34h-34m34 0v34M40 394h34m-34 0v-34m260 34h-34m34 0v-34" stroke="#c5ac76" fill="none" strokeWidth="2"/>
      <circle cx="170" cy="204" r="91" fill="none" stroke="#b79d69" strokeWidth=".7"/>
      <circle cx="170" cy="204" r="84" fill="none" stroke="#b79d69" strokeWidth=".5"/>
      <path d="m74 248 37-51 23 14 30-92 21 35 22 3 57 91M84 257q82-26 169 0M112 277q63-21 124-2m-115 24q42-8 77-1" fill="none" stroke="#d0b780" strokeWidth="1.7"/>
      <path d="m159 218 7-49 13 10 13-8m-53 55 21-56m26 31 25 27" fill="none" stroke="#ad955f" strokeWidth=".8"/>
      <path d="M251 111q10-16 21-1q8-19 23-15m-68 25q7-10 15 1q7-12 15-8" stroke="#d8c492" strokeWidth="1.2" fill="none"/>
      <rect x="141" y="338" width="57" height="44" fill="#a95742" opacity=".8"/><path d="M151 347h37v25h-37Zm9 0v25m16-25v25m-25-13h37" stroke="#dac490" strokeWidth="1" fill="none"/>
     </svg>
    </div>
    {Array.from({length:quality>2?5:3},(_,n)=><i key={n} className={s.turningLeaf} style={{"--leaf-delay":`${1.8+n*.32}s` } as CSSProperties}><span/><b/></i>)}
   </div>
  </div>
  <div className={s.craneFlight} aria-hidden="true">{Array.from({length:quality>2?4:2},(_,n)=><div key={n} className={s.bookCrane} style={{"--flight-x":`${22+n*4}vw`,"--flight-y":`${-26+n*3}vh`,"--crane-delay":`${2.4+n*.28}s`,"--crane-scale":`${.72-n*.11}`} as CSSProperties}><Crane/></div>)}</div>
 </>;
}
