"use client";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { openingSession } from "./openingSession";
import { sakuraPetalPath, sakuraPetalVeins } from "./Brand";
import { openingBranches, openingDepartures, openingDurationMs, openingFlowers } from "./openingArt";
import s from "./opening.module.css";

const motionSubscribe=(listener:()=>void)=>{const media=matchMedia("(prefers-reduced-motion: reduce)");media.addEventListener("change",listener);return()=>media.removeEventListener("change",listener);};
const motionSnapshot=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
const departureByFlower=new Map<number,number>(openingDepartures);
const flightByFlower=new Map<number,number>(openingDepartures.map(([flower],index)=>[flower,index]));
const airPaths=[
 "M-250 680C80 580 180 120 580 260S1050 370 1280 60",
 "M-220 530C190 500 215 180 550 180S920 380 1280 145",
 "M-180 240C110 170 200 330 450 310S860 100 1280 205",
 "M-210 390C100 250 320 540 660 400S1000 120 1250 330",
 "M-220 610C100 730 300 450 570 460S1020 410 1240 540",
 "M-210 100C100 20 180 200 420 140S790 5 1230 90",
 "M-160 820C160 670 390 790 680 625S1010 560 1280 710",
];

const OpeningArtwork=memo(function OpeningArtwork({id}:{id:string}) {
 return <>
  <svg viewBox="0 0 1000 760" className={s.drawing} aria-hidden="true" focusable="false" data-opening-tree>
   <defs>
    <radialGradient id={`${id}-wash`}><stop stopColor="var(--ink-petal,#d5ada8)" stopOpacity=".19"/><stop offset="1" stopColor="var(--ink-petal,#d5ada8)" stopOpacity="0"/></radialGradient>
    <linearGradient id={`${id}-wood`} x1="473" x2="504" gradientUnits="userSpaceOnUse"><stop stopColor="var(--ink-accent,#446b57)"/><stop offset="1" stopColor="color-mix(in srgb,var(--ink-accent,#446b57) 78%,var(--ink-text,#273b34))"/></linearGradient>
    <mask id={`${id}-trunk-reveal`} maskUnits="userSpaceOnUse" x="438" y="278" width="75" height="400"><path d={openingBranches[0][0]} pathLength="100" fill="none" stroke="white" strokeWidth="32" strokeLinecap="round" className={s.trunkReveal}/></mask>
    <linearGradient id={`${id}-petal-wash`} x1="-16" y1="-42" x2="13" y2="5" gradientUnits="userSpaceOnUse"><stop stopColor="color-mix(in srgb,var(--ink-petal,#d5ada8) 65%,var(--ink-bg,#f5f5ee))"/><stop offset=".5" stopColor="var(--ink-petal,#d5ada8)"/><stop offset="1" stopColor="color-mix(in srgb,var(--ink-petal,#d5ada8) 75%,var(--ink-accent,#446b57))"/></linearGradient>
    <g id={`${id}-petal`}>
     <path d={sakuraPetalPath} fill={`url(#${id}-petal-wash)`} stroke="color-mix(in srgb,var(--ink-petal,#d5ada8) 80%,var(--ink-text,#273b34))" strokeWidth=".55"/>
     <path d="M0 4C-7-1-21-10-23-24C-25-34-18-42-9-42C-16-33-12-14 0 4Z" fill="var(--ink-bg,#f5f5ee)" opacity=".22"/>
     <path d={sakuraPetalVeins} fill="none" stroke="var(--ink-bg,#f5f5ee)" strokeWidth=".75" strokeLinecap="round" opacity=".8"/>
    </g>
    <g id={`${id}-center`}>
     <circle r="8" fill="var(--ink-bg,#f5f5ee)" opacity=".5"/>
     <g stroke="var(--ink-accent,#446b57)" strokeWidth=".65" strokeLinecap="round" opacity=".75">{Array.from({length:12},(_,i)=><g key={i} transform={`rotate(${i*30+9})`}><path d={`M0-1Q${i%2?2:-2}-5 0-${i%3?9:12}`}/><circle cy={i%3?-9:-12} r="1.2" fill="var(--ink-accent,#446b57)" stroke="none"/></g>)}</g>
     <circle r="2.5" fill="var(--ink-accent,#446b57)"/>
    </g>
    <g id={`${id}-flower`}>{[0,72,144,216,288].map(angle=><use key={angle} href={`#${id}-petal`} transform={`rotate(${angle})`}/>)}<use href={`#${id}-center`}/></g>
   </defs>
   <ellipse className={s.wash} cx="496" cy="292" rx="438" ry="277" fill={`url(#${id}-wash)`}/>
   <g className={s.tree}>
    <path d="M493 673C484 646 482 627 489 605C499 572 494 551 483 529C464 490 471 468 476 442C482 419 473 398 469 383C460 352 442 319 444 284L451 282C448 321 471 345 485 380C499 420 485 454 484 480C484 501 501 517 502 542C507 568 505 588 498 612C491 638 501 652 506 671Z" fill={`url(#${id}-wood)`} mask={`url(#${id}-trunk-reveal)`}/>
    <g className={s.branches} fill="none" stroke="var(--ink-accent,#446b57)" strokeLinecap="round" strokeLinejoin="round">
     {openingBranches.map(([path,width,delay],i)=><path key={i} d={path} pathLength="100" strokeWidth={width} style={{"--grow-delay":`${delay}s`,"--grow-duration":i<3?"1.25s":".8s"} as CSSProperties} data-opening-branch/>)}
    </g>
    <g className={s.bark} fill="none" stroke="var(--ink-bg,#f5f5ee)" strokeWidth=".9" strokeLinecap="round"><path pathLength="100" d="M499 646Q491 606 499 585M493 551Q479 512 478 489M481 465Q487 437 478 414M440 493Q401 474 383 460M544 459Q584 444 608 421"/></g>
    <g className={s.buds} fill="var(--ink-petal,#d5ada8)" stroke="var(--ink-accent,#446b57)" strokeWidth=".5">
     {[[144,315,-30],[199,275,-12],[312,278,18],[362,250,-20],[451,239,12],[577,266,35],[686,288,-15],[805,336,15],[257,440,-20]].map(([x,y,angle],i)=><g key={i} transform={`translate(${x} ${y}) rotate(${angle})`}><g className={s.bud} style={{"--bloom-delay":`${1.25+i*.07}s`} as CSSProperties}><path d="M0 0C-8-8-8-21-1-25C7-20 9-8 0 0Z"/><path d="M0 0Q-2-10-1-20" fill="none" opacity=".4"/></g></g>)}
    </g>
   </g>
   <g className={s.ground} fill="none" stroke="var(--ink-accent,#446b57)" strokeLinecap="round"><path pathLength="100" d="M410 675Q489 663 570 675M465 682Q500 678 532 683"/><path pathLength="100" d="M496 657Q476 669 467 674M501 658Q514 667 522 673"/></g>
  </svg>
  {/* Each small sleeve caches its SVG while its HTML layer grows and turns. */}
  <div className={s.blossomField} aria-hidden="true"><div className={s.tree}>
   {openingFlowers.map(([x,y,scale,angle],i)=>{
    const departure=departureByFlower.get(i),flight=flightByFlower.get(i)||0;
    return <span key={i} className={s.flowerAnchor} style={{left:`${x/10}%`,top:`${y/7.6}%`,width:`${scale*10}%`,transform:`translate(-50%,-50%) rotate(${angle}deg)`}} data-opening-flower>
     <svg viewBox="-50 -50 100 100" className={s.flower} focusable="false" style={{"--bloom-delay":`${1.02+(1-y/700)*.82+(i%5)*.06}s`} as CSSProperties}>
      {departure===undefined?<use href={`#${id}-flower`}/>:<>{[0,72,144,216,288].map((rotation,petal)=><g key={petal} transform={`rotate(${rotation})`}><use href={`#${id}-petal`} className={petal===departure?s.departing:undefined} style={petal===departure?{"--flight-delay":`${2.92+flight*.035}s`} as CSSProperties:undefined}/></g>)}<use href={`#${id}-center`}/></>}
     </svg>
    </span>;
   })}
  </div></div>
  <svg className={s.wind} viewBox="0 0 1000 760" preserveAspectRatio="none" aria-hidden="true" focusable="false" data-opening-wind><g fill="none" stroke="var(--ink-accent,#446b57)" strokeLinecap="round">{airPaths.map((path,i)=><path key={i} d={path} pathLength="100" className={s.airLine} style={{"--air-order":i} as CSSProperties}/>)}</g></svg>
  <div className={s.flightField} aria-hidden="true" data-opening-flight-field>
   {openingDepartures.map(([flower,petal],i)=>{
    const [x,y,scale,rotation]=openingFlowers[flower];
    return <span key={i} className={s.flightAnchor} style={{"--source-x":(x-500)/1000,"--source-y":(y-380)/1000,"--petal-scale":scale,"--flight-delay":`${2.92+i*.035}s`,"--lift":`${-(7+i%4*3)}vh`,"--turn":`${150+i*27}deg`} as CSSProperties} data-opening-flight>
     <svg className={s.airPetal} viewBox="-50 -50 100 100" focusable="false"><g transform={`rotate(${rotation+petal*72})`}><path d={sakuraPetalPath} fill="var(--ink-petal,#d5ada8)" stroke="color-mix(in srgb,var(--ink-petal,#d5ada8) 80%,var(--ink-text,#273b34))" strokeWidth=".55"/><path d={sakuraPetalVeins} fill="none" stroke="var(--ink-bg,#f5f5ee)" strokeWidth=".8" opacity=".7"/></g></svg>
    </span>;
   })}
   {Array.from({length:18},(_,i)=><i key={i} className={s.pollen} style={{"--pollen-x":`${8+(i*17)%85}%`,"--pollen-y":`${12+(i*23)%70}%`,"--pollen-order":i} as CSSProperties}/>)}
  </div>
 </>;
});

export function SakuraOpening({reduced=false,autoPlay=true,preview=false}:{reduced?:boolean;autoPlay?:boolean;preview?:boolean}) {
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,"")+"-opening";
 const [mounted,setMounted]=useState(false),[open,setOpen]=useState(false),[epoch,setEpoch]=useState(0);
 const visible=useRef(false),systemReduced=useSyncExternalStore(motionSubscribe,motionSnapshot,()=>false),gentle=reduced||systemReduced;
 const show=useCallback(()=>{visible.current=true;document.documentElement.style.setProperty("--sakura-opening-display","flex");setOpen(true);},[]);
 const close=useCallback(()=>{openingSession.claim();visible.current=false;setOpen(false);if(typeof document!=="undefined"){delete document.documentElement.dataset.sakuraOpening;document.documentElement.style.removeProperty("--sakura-opening-display");}},[]);
 useLayoutEffect(()=>()=>{if(visible.current)close();},[close]);
 useEffect(()=>{if(open)delete document.documentElement.dataset.sakuraOpening;},[open]);
 useEffect(()=>{const timer=setTimeout(()=>{const pending=document.documentElement.dataset.sakuraOpening==="pending";setMounted(true);if((pending||autoPlay)&&openingSession.claim())show();else if(pending)close();},0);return()=>clearTimeout(timer);},[autoPlay,show,close]);
 useEffect(()=>{const replay=()=>{setEpoch(n=>n+1);show();};window.addEventListener("sakura-replay-opening",replay);return()=>window.removeEventListener("sakura-replay-opening",replay);},[show]);
 useEffect(()=>{if(!open)return;const timer=setTimeout(close,gentle?500:openingDurationMs+200);return()=>clearTimeout(timer);},[open,epoch,gentle,close]);
 useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==="Escape")close();};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[open,close]);
 if(mounted&&!open)return null;
 const firstPaintStyle={display:"var(--sakura-opening-display,none)",...preview?{"--ink-bg":"var(--p-bg)","--ink-text":"var(--p-text)","--ink-muted":"var(--p-muted)","--ink-line":"var(--p-line)","--ink-accent":"var(--p-accent)","--ink-petal":"var(--p-petal)"}:{}} as CSSProperties;
 return <div data-sakura-opening data-active={open||undefined} data-opening-gentle={gentle||undefined} className={s.opening} style={firstPaintStyle} key={epoch} role="status" aria-label="Sakura opening" onAnimationEnd={event=>{if(event.target===event.currentTarget)close();}}>
  <OpeningArtwork id={id}/>
  <div className={s.wordmark} aria-hidden="true"><span className={s.caption}>MUSIC, IN FULL BLOOM</span>sakura<span className={s.tagline}>let the world wait a little.</span></div>
  <button type="button" onClick={close} className={s.skip}>Skip</button>
 </div>;
}
