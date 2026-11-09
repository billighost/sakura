import type {CSSProperties} from "react";
import s from "./world.module.css";

/** The first blossom remains planted in the orchard after the aperture opens. */
export function SakuraPrelude({id,quality}:{id:string;quality:number}){
 return <div className={s.prelude} aria-hidden="true">
  <div className={s.preludeNight}/>
  <svg className={s.seedTheatre} viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid meet">
   <defs>
    <radialGradient id={`${id}-seed-light`}><stop stopColor="#ffe7bc" stopOpacity=".9"/><stop offset=".22" stopColor="#eab7aa" stopOpacity=".3"/><stop offset="1" stopColor="#ce9b94" stopOpacity="0"/></radialGradient>
    <linearGradient id={`${id}-seed-petal`} x2=".8" y2="1"><stop stopColor="#fff3db"/><stop offset=".52" stopColor="#efb9a9"/><stop offset="1" stopColor="#b96f7b"/></linearGradient>
   </defs>
   <g className={s.seedHalo}><circle cx="500" cy="390" r="180" fill={`url(#${id}-seed-light)`}/><circle cx="500" cy="390" r="92" fill="none" stroke="#f9d3ae" strokeWidth=".6" opacity=".25"/><circle cx="500" cy="390" r="125" fill="none" stroke="#f9d3ae" strokeWidth=".5" opacity=".1"/></g>
   <g className={s.seedStem} fill="none" strokeLinecap="round">
    <path d="M500 725Q505 658 477 609Q441 563 466 511Q493 459 500 393" stroke="#8e9b75" strokeWidth="3"/>
    <path d="M484 620Q441 615 408 577Q443 578 484 620ZM468 542Q512 534 538 504Q503 507 468 542Z" fill="#8b9c78" stroke="#c7cd9c" strokeWidth=".6"/>
    <path d="M490 669q-14-40-62-57m41-62q-23-27-59-28m81-61q29-8 52-32" stroke="#b6b68d" strokeWidth="1"/>
   </g>
   <g className={s.firstBlossom}>
    {Array.from({length:5},(_,n)=><g key={n} transform={`translate(500 390) rotate(${n*72})`}><path className={s.seedPetal} style={{"--seed-petal-delay":`${1.2+n*.17}s`} as CSSProperties} d="M0 0C-33-14-53-44-42-76Q-31-98-8-86L0-74 8-86Q33-98 44-76C53-46 31-15 0 0Z" fill={`url(#${id}-seed-petal)`}/><path className={s.seedPetalVein} d="M0-3Q-1-37-5-66M-7-12Q-21-38-28-53M8-12Q23-36 28-50" fill="none" stroke="#fff0d6" strokeWidth=".8" opacity=".54"/></g>)}
    <circle cx="500" cy="390" r="13" fill="#e9c48c"/><circle cx="500" cy="390" r="5" fill="#a77761"/>
    {Array.from({length:12},(_,n)=><g key={n} transform={`translate(500 390) rotate(${n*30})`}><path d="M0-8 0-23" stroke="#e4bb83" strokeWidth="1"/><circle cy="-25" r="2.3" fill="#ffebc0"/></g>)}
   </g>
   <g className={s.seedOrbit}>{Array.from({length:quality*3+6},(_,n)=><circle key={n} cx={500+Math.cos(n*2.4)*(110+n*7)} cy={390+Math.sin(n*2.4)*(80+n*7)} r={n%3?1.4:2.4} fill="#f7dbac" style={{"--spark-delay":`${n*.08}s`} as CSSProperties}/>)}</g>
  </svg>
  <svg className={s.seedInk} viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#b5b494" strokeLinecap="round"><path d="M130 920Q82 791 142 690Q201 589 177 477Q126 413 192 343Q234 321 272 333" strokeWidth="2"/><path d="M1304 951Q1363 791 1307 644Q1271 550 1314 461Q1335 398 1288 347Q1249 320 1218 336" strokeWidth="1.5"/></g></svg>
 </div>;
}
