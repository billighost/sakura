"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";

import { useId, type CSSProperties } from "react";
import type { BloomQuality, BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin, stableCos } from "../stableTrig";
import s from "./world.module.css";

const LEAD = "#283d3b";
const GLASS = ["#8aa99a", "#b8c8a8", "#597e76", "#b4d0c5", "#cfad7b", "#bd7e85", "#7398a4", "#dec69b"];
const detail = [
  { leaves: 6, flowers: 2, veins: false, facets: false, bubbles: 0, ribs: 3, lights: 0 },
  { leaves: 9, flowers: 3, veins: false, facets: true, bubbles: 5, ribs: 5, lights: 1 },
  { leaves: 12, flowers: 4, veins: true, facets: true, bubbles: 10, ribs: 7, lights: 2 },
  { leaves: 16, flowers: 6, veins: true, facets: true, bubbles: 22, ribs: 9, lights: 4 },
  { leaves: 22, flowers: 9, veins: true, facets: true, bubbles: 45, ribs: 13, lights: 7 },
] as const;
const random = (n: number) => { const f = stableSin(n * 73.13 + 31.9) * 43758.5453; return f - Math.floor(f); };

function paneColour(index: number, amount: number, variant: number, listening?: BloomListeningProfile) {
  if (!listening?.genres) return GLASS[(index + variant) % 4];
  const position = (index + .5) / Math.max(1,amount);
  let share = 0;
  for (const genre of listening.genres) {
    share += Math.max(0,Math.min(1,genre.share));
    if (position < share) return GLASS[Array.from(genre.name).reduce((sum,letter)=>sum + letter.charCodeAt(0),0) % GLASS.length];
  }
  return "#c1bfab";
}

function Leaf({ x, y, angle, scale = 1, colour, quality }: { x: number; y: number; angle: number; scale?: number; colour: string; quality: BloomQuality }) {
  return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    <path d="M0 0C-24-20-24-57 0-91C24-57 23-19 0 0Z" fill={colour} stroke={LEAD} strokeWidth="2.9" strokeLinejoin="round"/>
    {quality > 1 && <><path d="M0-3 0-88 13-55 12-28Z" fill="#f8eed4" opacity=".24"/><path d="M0-3-15-31-9-62 0-88Z" fill="#264f4b" opacity=".12"/></>}
    <path d="M0-4Q-2-49 0-87" fill="none" stroke={LEAD} strokeWidth="1.4"/>
    {quality >= 3 && <g fill="none" stroke={LEAD} strokeWidth=".65" opacity=".72"><path d="M0-24-13-35M0-42-13-53M0-61-9-69M0-31 14-45M0-53 10-63"/><path d="M-8-31Q-19-47-9-66M7-17Q19-39 9-59" stroke="#f7eccf" opacity=".8"/></g>}
    {quality >= 4 && <g fill="#f3ecd2" opacity=".4">{[0, 1, 2].map(n => <circle key={n} cx={-5 + n * 4} cy={-25 - n * 17} r={1.1 - n * .2}/>)}</g>}
  </g>;
}

function Flower({ x, y, radius = 54, quality, seed = 1, blush = false }: { x: number; y: number; radius?: number; quality: BloomQuality; seed?: number; blush?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${radius / 54})`}>
    {Array.from({ length: 5 }, (_, n) => <g key={n} transform={`rotate(${n * 72 + seed * 5})`}>
      <path d="M0 2C-17-8-34-23-25-46C-18-65 2-68 14-54C31-36 20-12 0 2Z" fill={blush ? ["#cc8d94", "#d9a3a1", "#b77682"][n % 3] : ["#d6cda4", "#e2d8b0", "#b2c6ad"][n % 3]} stroke={LEAD} strokeWidth="2.7"/>
      {quality > 1 && <path d="M0-1-18-29-9-56 6-52 14-30Z" fill={blush ? "#f3c4b7" : "#fff3c9"} opacity=".32" stroke={LEAD} strokeWidth=".8"/>}
      {quality >= 3 && <><path d="M0-5Q-11-25-7-50M-1-17Q8-30 10-45" fill="none" stroke={LEAD} strokeWidth=".75" opacity=".65"/><path d="M-18-39Q-24-25-11-16" fill="none" stroke="#fff4d8" strokeWidth="1.3" opacity=".6"/></>}
    </g>)}
    <circle r="13" fill="#c59b59" stroke={LEAD} strokeWidth="2.6"/>
    <circle r="7" fill="#8b7445" opacity=".62"/>
    {quality >= 3 && Array.from({ length: 9 }, (_, n) => <circle key={n} cx={stableCos(n * .698) * 7} cy={stableSin(n * .698) * 7} r="1.2" fill="#efdb9b"/>)}
  </g>;
}

/** A complete botanical panel, with all material detail grouped into one pane. */
function BotanicalPane({ id, quality, variant = 0, daylight, listening }: { id: string; quality: BloomQuality; variant?: number; daylight: number; listening?: BloomListeningProfile }) {
  const tier = detail[quality - 1];
  const flowers = listening?.discoveredRecordingCount == null ? tier.flowers : Math.min(tier.flowers,Math.max(0,listening.discoveredRecordingCount));
  const joints = Math.min(quality + 2,Math.max(0,listening?.returningArtistCount || 0));
  return <g>
    <defs><clipPath id={`${id}-pane`}><path d="M12 716V208C12 72 89 5 208 5C327 5 402 80 402 208V716Z"/></clipPath></defs>
    <path d="M-1 729V207C-1 63 89-10 208-10C335-10 417 66 417 207V729Z" fill="#233d39" stroke="#152e2b" strokeWidth="3"/>
    <path d="M12 716V208C12 72 89 5 208 5C327 5 402 80 402 208V716Z" fill="#c4c8aa" stroke="#a79968" strokeWidth="3"/>
    <g clipPath={`url(#${id}-pane)`} data-listening-motif={listening?.genres ? "genre-glass" : undefined}>
      <path d="M0 0H420V745H0Z" fill={variant % 2 ? "#d2cab0" : "#b6c8b9"}/>
      {Array.from({ length: tier.ribs }, (_, n) => <path key={n} d={`M${n * 420 / tier.ribs} 0Q${n * 420 / tier.ribs + 15} 340 ${n * 420 / tier.ribs - 5} 745`} stroke="#47756c" opacity=".13" strokeWidth={quality >= 4 ? 20 : 34} fill="none"/>)}
      <path d="M-6 243Q85 205 214 242Q348 278 430 224V330Q325 368 215 326Q96 283-6 340Z" fill="#769791" stroke={LEAD} strokeWidth="2.8"/>
      <path d="M-7 590Q114 550 203 592Q336 620 428 567V744H-7Z" fill="#88a195" stroke={LEAD} strokeWidth="3"/>
      <path d="M5 260Q112 222 214 257Q339 291 421 245M8 282Q119 247 216 280Q325 309 418 270M-4 598Q123 563 220 610Q320 632 420 591" fill="none" stroke="#e3dfc3" strokeWidth="1" opacity=".55"/>
      <path d="M206 738Q166 588 193 494Q212 397 169 309Q126 215 205 64" fill="none" stroke={LEAD} strokeWidth="10"/>
      <path d="M206 738Q166 588 193 494Q212 397 169 309Q126 215 205 64" fill="none" stroke="#a7a770" strokeWidth="4.8"/>
      <path d="M187 512Q67 451 42 344M183 611Q312 533 344 424M167 324Q277 286 308 172" fill="none" stroke={LEAD} strokeWidth="5"/>
      <g className={s.solderJoints} data-listening-motif={joints > 0 ? "returning-stems" : undefined}>{Array.from({length:joints},(_,n)=><g key={n} transform={`translate(${181 + stableSin((650 - n * 79) / 91) * 20} ${650 - n * 79})`}><circle r="10" fill="#c2ad76" stroke={LEAD} strokeWidth="2"/><path d="M-4-3 4 3M-4 3 4-3" stroke="#f7e9bd" strokeWidth="1.2"/></g>)}</g>
      {Array.from({ length: 3 }, (_, group) => <g key={`leaves-${group}`} className={s.paneSegment} style={{ "--delay": `${group * .085}s`, "--pane-x": `${group % 2 ? -5 : 5}px`, "--pane-turn": `${group % 2 ? -1 : 1}deg` } as CSSProperties}>
        {Array.from({ length: tier.leaves }, (_, n) => {
          if (n % 3 !== group) return null;
          const y = 657 - n * 540 / tier.leaves;
          const x = 181 + stableSin(y / 91) * 20;
          const side = n % 2 ? 1 : -1;
          return <Leaf key={n} x={x} y={y} angle={side * (44 + random(n + variant) * 19)} scale={.75 + random(n + 15) * .5} colour={paneColour(n,tier.leaves,variant,listening)} quality={quality}/>;
        })}
      </g>)}
      {Array.from({ length: 3 }, (_, group) => <g key={`flowers-${group}`} className={s.paneSegment} style={{ "--delay": `${.22 + group * .085}s`, "--pane-x": `${group % 2 ? 6 : -6}px`, "--pane-turn": `${group % 2 ? 1 : -1}deg` } as CSSProperties}>
        {Array.from({ length: flowers }, (_, n) => n % 3 === group ? <Flower key={n} x={n % 2 ? 288 + random(n + 7) * 55 : 68 + random(n + 5) * 49} y={147 + n * 451 / Math.max(1,flowers)} radius={35 + random(n + 1) * 18} quality={quality} seed={n + variant} blush={n % 3 === 0}/> : null)}
      </g>)}
      <path d="M17 167Q127 80 201 94Q297 106 396 169M18 431Q120 481 200 450Q288 400 397 434" fill="none" stroke={LEAD} strokeWidth="2.4"/>
      <path d="M17 169Q119 86 201 99Q298 110 396 174M21 430Q117 475 201 446" fill="none" stroke="#ebd8a2" strokeWidth=".8" opacity=".6"/>
      {quality >= 4 && <g fill="none" stroke={LEAD} strokeWidth="1.8" opacity=".72">{Array.from({ length: quality === 5 ? 21 : 12 }, (_, n) => <path key={n} d={`M${22 + n * 18} 687l9-14 9 14-9 14Z`}/>)}</g>}
      {Array.from({ length: tier.bubbles }, (_, n) => <g key={n} opacity=".28"><circle cx={22 + random(n + variant * 51) * 374} cy={80 + random(n + 79) * 580} r={1 + random(n + 14) * 2} fill="#f6ecd1"/><path d={`M${23 + random(n + 12) * 373} ${51 + random(n + 89) * 594}q2-6 1-12`} fill="none" stroke="#f9f2d7" strokeWidth=".65"/></g>)}
      {quality >= 4 && <g fill="none" stroke="#ddcf9b" strokeWidth=".8" opacity=".45">{Array.from({ length: quality === 5 ? 12 : 6 }, (_, n) => <path key={n} d={`M${37 + n * 31} 710Q${70 + n * 20} 540 ${38 + n * 29} 360Q${42 + n * 30} 200 ${55 + n * 26} 57`}/>)}</g>}
      <path d="M0 0H420V745H0Z" fill="#193d36" opacity={.1 * (1 - daylight)}/>
      <path d="M0 0H420V745H0Z" fill="#f9e6a9" opacity={.03 + daylight * .08}/>
    </g>
    <path d="M22 709V209C22 82 97 15 208 15C319 15 392 87 392 209V709" fill="none" stroke="#ecdcb1" strokeWidth="1.1" opacity=".65"/>
    <path d="M-1 730H417M3 744H413" stroke="#ac9966" strokeWidth="4"/>
    <path d="M-14 754H431V771H-14Z" fill="#314c43" stroke="#20392f" strokeWidth="3"/>
    <path d="M-8 757H425" stroke="#ccbd8c" opacity=".68"/>
  </g>;
}

function GlassTitle({ id, compact = false }: { id: string; compact?: boolean }) {
  const letters = [
    "M7 10 43 8 42 68Q63 44 93 51Q135 53 137 102Q140 160 97 167Q68 172 40 151L39 163 7 165ZM42 103V133Q60 153 84 143Q105 136 103 107Q103 73 80 76Q54 77 42 103Z",
    "M154 6 193 9 190 127Q190 143 207 142L213 166Q178 181 155 158Q147 148 149 121Z",
    "M294 48Q349 46 352 105Q354 163 300 170Q244 177 235 124Q221 67 272 52ZM287 76Q260 81 267 117Q273 151 297 144Q323 139 318 106Q316 75 287 76Z",
    "M427 50Q483 46 487 108Q490 163 433 170Q379 174 371 120Q363 67 407 53ZM424 77Q397 79 404 118Q409 150 433 144Q459 138 453 107Q451 76 424 77Z",
    "M507 56 540 53 544 65Q564 43 589 51Q605 54 614 70Q641 43 669 52Q701 59 700 98L698 163 664 166 665 102Q666 77 649 79Q630 81 629 103L627 166 593 165 594 103Q595 78 578 79Q546 80 542 105L541 164 507 166Z",
  ];
  return <svg className={s.titleMark} viewBox="0 0 730 214" aria-hidden="true">
    <defs>{letters.map((d, n) => <clipPath key={n} id={`${id}-letter-${n}`}><path d={d} fillRule="evenodd"/></clipPath>)}</defs>
    {letters.map((d, n) => <g key={n} className={s.titleLetter} style={{ "--delay": `${n * .075}s` } as CSSProperties}>
      <path d={d} fill={GLASS[n + 1]} stroke={LEAD} strokeWidth="3.5" fillRule="evenodd"/>
      <g clipPath={`url(#${id}-letter-${n})`} stroke={LEAD} strokeWidth="1.5">
        <path d={`M${n * 145 - 8} 15l126 170 73-122-130-80Z`} fill={n % 2 ? "#d3ab8b" : "#a3c5b9"}/>
        <path d={`M${n * 145 - 5} 112l119-73 37 123-95 8Z`} fill={n % 2 ? "#bbc8a1" : "#cb9295"}/>
        <path d={`M${n * 145 + 19} 30l78 165M${n * 145 - 7} 85l103 78`} stroke="#f9eac9" strokeWidth=".7" opacity=".45"/>
      </g>
      <path d={d} fill="none" stroke={LEAD} strokeWidth="3.5" fillRule="evenodd"/>
    </g>)}
    <path d="M699 151Q735 129 715 97Q689 116 699 151Z" fill="#bd858b" stroke={LEAD} strokeWidth="2.5"/>
    <path d="M696 148 715 103" stroke={LEAD} strokeWidth="1"/>
    {!compact && <g fill="none" stroke="#9a9167" strokeWidth="1"><path d="M13 194H267M452 194H705"/><path d="m342 194 19-7 19 7-19 7Z"/></g>}
  </svg>;
}

function Palm({ x, y, flip = false, quality }: { x: number; y: number; flip?: boolean; quality: BloomQuality }) {
  const count = quality === 5 ? 11 : quality >= 3 ? 8 : 5;
  return <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
    <path d="M-37 2H39L29 88Q1 102-27 87Z" fill="#9e8269" stroke="#425d4f" strokeWidth="2.5"/><path d="M-42-1H43L41 10H-39Z" fill="#c4af87" stroke="#425d4f" strokeWidth="2"/><path d="M-24 17Q-22 50-17 78M25 18Q24 53 18 78" stroke="#d9c5a2" strokeWidth="1.4" opacity=".5"/>
    {Array.from({ length: count }, (_, n) => <g key={n} transform={`rotate(${(n - (count - 1) / 2) * 13})`}><path d={`M0 0Q${-13 + n * 2} -79 ${15 + n * 3} ${-137 - random(n + 40) * 60}`} fill="none" stroke="#425e4f" strokeWidth="3"/>{Array.from({ length: quality >= 4 ? 8 : 5 }, (_, p) => <Leaf key={p} x={p * 2} y={-24 - p * 16} angle={p % 2 ? 72 : -57} scale={.3 - p * .017} colour={GLASS[(n + p) % 4]} quality={quality}/>)}</g>)}
  </g>;
}

function RoseWindowOpening({id,quality}:{id:string;quality:BloomQuality}) {
  return <div className={s.roseWindowOpening} aria-hidden="true">
    <div className={s.glassNight}/>
    <svg className={s.roseTheatre} viewBox="0 0 1400 1000" preserveAspectRatio="xMidYMid slice">
      <defs><radialGradient id={`${id}-rose-light`}><stop stopColor="#f5e3bc" stopOpacity=".4"/><stop offset=".4" stopColor="#b2cbbb" stopOpacity=".15"/><stop offset="1" stopColor="#c19fa6" stopOpacity="0"/></radialGradient><linearGradient id={`${id}-rose-facet`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8e6c6" stopOpacity=".7"/><stop offset=".4" stopColor="#efd0b0" stopOpacity=".04"/><stop offset="1" stopColor="#b7d4c8" stopOpacity=".45"/></linearGradient></defs>
      <g className={s.roseAssembly}>
        <circle className={s.roseAura} cx="700" cy="418" r="350" fill={`url(#${id}-rose-light)`}/>
        <g className={s.roseLead} fill="none" stroke="#d7bd8b"><circle cx="700" cy="418" r="180" strokeWidth="2"/><circle cx="700" cy="418" r="192" strokeWidth=".75"/><circle cx="700" cy="418" r="202" strokeWidth=".5" strokeDasharray="1 9"/></g>
        {Array.from({length:12},(_,n)=><g key={n} transform={`translate(700 418) rotate(${n*30})`}><g className={s.roseShard} style={{"--shard-delay":`${n*.065}s`,"--shard-turn":`${n%2?34:-34}deg`,"--shard-distance":`${110+n%4*32}px`} as CSSProperties}>
          <path d="M0-28C-31-61-39-114 0-176C40-115 30-61 0-28Z" fill={GLASS[n%GLASS.length]} stroke="#233d39" strokeWidth="4"/>
          <path d="M0-30 0-173 25-114 15-70Z" fill={`url(#${id}-rose-facet)`}/><path d="M0-32V-173M0-72-21-106M0-106 20-137" stroke="#314d43" strokeWidth="1.2" fill="none"/><path d="M-15-137Q-27-111-15-91" stroke="#f7edd3" strokeWidth="1.4" fill="none" opacity=".7"/>
          {quality>=3&&<g fill="#eee5c9" opacity=".65"><circle cy="-148" r="1.5"/><circle cx="-12" cy="-114" r="1.2"/><circle cx="9" cy="-81" r="1"/></g>}
        </g></g>)}
        <g className={s.roseHeart}><Flower x={700} y={418} radius={47} quality={quality} blush/><circle cx="700" cy="418" r="56" fill="none" stroke="#cfb787" strokeWidth="1"/></g>
        <g className={s.solderGlints} stroke="#f4deb1" fill="none">{Array.from({length:6+quality},(_,n)=>{const angle=n*Math.PI*2/(6+quality),x=700+stableCos(angle)*181,y=418+stableSin(angle)*181;return <g key={n} style={{"--glint-delay":`${n*.11}s`} as CSSProperties} transform={`translate(${x} ${y})`}><path d="M-7 0H7M0-7V7" strokeWidth=".8"/><circle r="3" strokeWidth=".65"/></g>;})}</g>
      </g>
      <g className={s.prismaticFloor} opacity=".22"><path d="M621 578 527 977 849 976 779 579Z" fill="#e9cf91"/><path d="M524 538 278 954 507 975 656 575Z" fill="#c38d9a"/><path d="M853 544 1123 954 884 975 749 583Z" fill="#8fbbb2"/></g>
    </svg>
  </div>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, children, listening, experience, openingPhase }: BloomWorldProps) {
  const token = useId().replace(/:/g, "");
  const id = `glass-${token}`;
  const cover = view === "cover";
  const opening = scene === "opening" || cover;
  const finale = scene === "finale" || view === "poster";
  const music = ["songs", "artist-songs", "discoveries", "returns"].includes(scene);
  const still = reducedMotion || quality === 1 || view === "poster";
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const daylight = listening?.peakHour == null ? finale ? 1 : p : Math.max(.1, stableSin((listening.peakHour - 6) / 24 * Math.PI * 2));
  const tier = detail[quality - 1];
  const style = { "--daylight": daylight, "--floor": theme === "light" ? "#d4d6bc" : "#516c60" } as CSSProperties;
  const windowPositions = opening ? [{ x: 805, y: 55, scale: 1.02 }, { x: 1314, y: 198, scale: .58 }] : finale ? [{ x: -100, y: 72, scale: .65 }, { x: 1230, y: 74, scale: .65 }] : scene === "comparison" ? [{ x: 965, y: 50, scale: .97 }, { x: -233, y: 58, scale: .72 }] : scene === "song-winner" ? [{ x: 890, y: 38, scale: 1.05 }, { x: -153, y: 55, scale: .72 }] : scene === "time" || scene === "breadth" ? [{ x: -124, y: 45, scale: 1.06 }, { x: 1268, y: 100, scale: .74 }] : scene === "days" || scene === "pattern" || scene === "genres" ? [{ x: 1030, y: 152, scale: .86 }, { x: -189, y: 145, scale: .86 }] : [{ x: -132, y: 95, scale: .82 }, { x: 1190, y: 58, scale: .82 }];
  const portrait = opening ? { left: -174, right: 341, y: 118, scale: .63 } : scene === "song-winner" ? { left: -231, right: 344, y: 89, scale: .69 } : scene === "artist" || scene === "artists" ? { left: -178, right: 348, y: 221, scale: .54 } : scene === "days" || scene === "pattern" || scene === "genres" ? { left: -163, right: 345, y: 177, scale: .51 } : scene === "comparison" ? { left: -216, right: 345, y: 116, scale: .64 } : { left: -193, right: 345, y: 121, scale: .57 };

  return <div className={s.world} data-opening-phase={openingPhase} data-experience={experience?.composition} data-scene={scene} data-theme={theme} data-view={view} data-opening={opening} data-music={music} data-still={still} data-quality={quality} data-stage={stage} data-listening={Boolean(listening)} data-genre-pigments={listening?.genreCount} data-discovery-buds={listening?.discoveredRecordingCount == null ? undefined : Math.min(tier.flowers,listening.discoveredRecordingCount)} data-return-joints={listening?.returningArtistCount == null ? undefined : Math.min(quality + 2,listening.returningArtistCount)} data-hour-light={listening?.peakHour == null ? undefined : daylight.toFixed(3)} style={style}>
    <svg className={s.architecture} viewBox="0 0 1400 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id={`${id}-texture`} width="53" height="41" patternUnits="userSpaceOnUse"><path d="M3 8 13 7M39 24 48 25M19 36 22 34" stroke="#fff6da" strokeWidth=".6" opacity=".28"/><circle cx="31" cy="11" r=".8" fill="#214e46" opacity=".1"/></pattern></defs>
      <path d="M0 0H1400V1000H0Z" fill="var(--glass-room)"/>
      <path d="M0 685Q355 647 692 687Q1020 726 1400 688V1000H0Z" fill="var(--floor)"/>
      <path d="M0 739H1400M0 810H1400M0 911H1400" stroke="#76917a" strokeWidth="1.5" opacity=".37"/>
      {Array.from({ length: quality >= 4 ? 15 : 8 }, (_, n) => <path key={n} d={`M700 635 ${-390 + n * (quality >= 4 ? 156 : 310)} 1000`} stroke="#76917a" strokeWidth="1.4" opacity=".3"/>)}
      <path d="M0 0H1400V60Q1050 153 700 85Q350 28 0 112Z" fill="#2f5349"/>
      <path d="M0 100Q339 28 699 78Q1015 140 1400 49" fill="none" stroke="#a4aa7d" strokeWidth="4"/>
      <path d="M0 111Q339 41 699 90Q1015 151 1400 62" fill="none" stroke="#182f29" strokeWidth="8"/>
      {quality >= 3 && Array.from({ length: quality === 5 ? 28 : 17 }, (_, n) => <path key={n} d={`M${n * 90 - 100} -20Q${n * 77 - 30} 20 ${n * 70 + 60} 95`} fill="none" stroke="#bad1ac" strokeWidth="2.2" opacity=".22"/>)}
      <g className={s.dayGlass} opacity={.16 + daylight * .26}><path d="M0 85 370 20 219 721-40 900Z" fill="#efd096"/><path d="M1400 55 1110 15 1198 658 1440 836Z" fill="#a1c7b0"/></g>
      <g className={s.windows} key={`windows-${scene}`}>
        {windowPositions.map((position, n) => <g className={s.assemblingPane} key={n} style={{ "--delay": `${n * .14}s` } as CSSProperties} transform={`translate(${position.x} ${position.y}) scale(${position.scale})`}><BotanicalPane id={`${id}-window-${n}`} quality={quality} variant={n + (finale ? 1 : 0)} daylight={daylight} listening={listening}/></g>)}
      </g>
      {finale && <g className={s.lunette}>
        <path d="M285 180Q370-40 700-35Q1050-20 1120 180Z" fill="#95b4a0" stroke={LEAD} strokeWidth="9"/>
        <path d="M306 166Q400-20 700-18Q1001-7 1098 166Z" fill="#d0d2b0" stroke="#b5a77d" strokeWidth="2"/>
        {Array.from({ length: 9 }, (_, n) => <path key={n} d={`M700 166 ${353 + n * 87} ${20 + Math.abs(n - 4) * 24}`} stroke={LEAD} strokeWidth="3"/>)}
        <path d="M336 112Q696 15 1062 109M321 146Q700 81 1080 147" fill="none" stroke={LEAD} strokeWidth="3"/>
        <Flower x={700} y={124} radius={48} quality={quality} blush/>
        {[0, 1, 2, 3].map(n => <g key={n}><Leaf x={622 - n * 54} y={151 - n * 7} angle={-58} scale={.63} colour={GLASS[n]} quality={quality}/><Leaf x={778 + n * 54} y={151 - n * 7} angle={58} scale={.63} colour={GLASS[n]} quality={quality}/></g>)}
      </g>}
      <g className={s.floorGlass} opacity={opening ? .22 : .14 + daylight * .13}>
        <path d="M137 774 432 750 647 973 272 1010Z" fill="#c99183"/><path d="M714 774 875 770 1210 1040 974 1060Z" fill="#e4ca8e"/><path d="M1036 759 1159 749 1460 893 1450 979Z" fill="#93bab2"/><path d="M158 780 433 758M298 914 565 891M771 798 946 794M1113 803 1290 798" fill="none" stroke="#416a60" strokeWidth="2"/>
      </g>
      <g className={s.foreground}><Palm x={opening ? 1343 : 74} y={835} quality={quality}/><Palm x={opening ? 732 : 1330} y={916} flip quality={quality}/></g>
      {quality >= 4 && <g opacity=".38" fill="none" stroke="#e3d5ad" strokeWidth="1">{Array.from({ length: quality === 5 ? 23 : 12 }, (_, n) => <path key={n} d={`M${16 + random(n + 19) * 1370} ${832 + random(n + 41) * 153}q${8 + n % 8} -3 ${15 + n % 10} 0`}/>)}</g>}
      <path d="M0 0H1400V1000H0Z" fill={`url(#${id}-texture)`} opacity={quality >= 4 ? .6 : .25}/>
    </svg>
    <svg className={s.portraitArchitecture} viewBox="0 0 390 920" preserveAspectRatio={view === "poster" ? "none" : "xMidYMid slice"} aria-hidden="true">
      <path d="M0 0H390V920H0Z" fill="var(--glass-room)"/>
      <path d="M0 0H390V105Q198 143 0 96Z" fill="#2c5148"/>
      {quality > 1 && <g fill="none" stroke="#a1bc99" opacity=".31" strokeWidth="1.2">{Array.from({ length: quality === 5 ? 11 : 6 }, (_, n) => <path key={n} d={`M${n * (quality === 5 ? 38 : 72) - 15} -20Q${n * (quality === 5 ? 37 : 69) + 40} 51 ${n * (quality === 5 ? 35 : 65) + 2} 116`}/>)}</g>}
      <path d="M0 92Q180 147 390 103" fill="none" stroke="#b1b388" strokeWidth="3"/>
      <g key={`portrait-left-${scene}`} transform={`translate(${portrait.left} ${portrait.y}) scale(${portrait.scale})`}><BotanicalPane id={`${id}-portrait-left`} quality={quality} daylight={daylight} listening={listening}/></g>
      <g key={`portrait-right-${scene}`} transform={`translate(${portrait.right} ${portrait.y + 9}) scale(${portrait.scale})`}><BotanicalPane id={`${id}-portrait-right`} quality={quality} variant={1} daylight={daylight} listening={listening}/></g>
      <path d="M0 779Q191 743 390 786V920H0Z" fill="var(--floor)"/>
      <path d="M0 820H390M0 875H390M0 920 195 766 390 920M91 920 195 766 302 920" fill="none" stroke="#759478" strokeWidth="1" opacity=".42"/>
      <path d="m13 820 106-26 95 126H99Z" fill="#c99089" opacity=".17"/><path d="m251 804 41-12 90 96-50 25Z" fill="#e8c78d" opacity=".2"/>
      <g opacity=".85" transform="translate(-10 860) scale(.65)"><Palm x={0} y={0} quality={quality}/></g>
      <g opacity=".85" transform="translate(402 887) scale(.61)"><Palm x={0} y={0} flip quality={quality}/></g>
      {finale && <g><path d="M30 164Q80 103 195 107Q311 99 360 163Z" fill="#bfd0b5" stroke={LEAD} strokeWidth="3"/><path d="M38 162H353M195 161V109M104 162 138 115M277 162 250 111" stroke={LEAD} strokeWidth="2"/><Flower x={195} y={150} radius={25} quality={quality} blush/></g>}
    </svg>
    {opening && <div className={s.title} aria-hidden="true"><span className={s.titleLabel}>THE PRISMATIC GARDEN</span><GlassTitle id={id}/><span className={s.titleCaption}>your music, held in light</span></div>}
    {!opening && <div className={s.windowSeal} aria-hidden="true"><span>PRISMATIC GARDEN</span><svg viewBox="0 0 70 18"><path d="M0 9H22M48 9H70M25 9l10-6 10 6-10 6Z" fill="none" stroke="currentColor"/></svg></div>}
    <div className={s.content}><ListeningPainting world="glass" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
    {!still && <div className={s.lightPassage} aria-hidden="true" key={`lights-${scene}-${stage}`}>{Array.from({ length: tier.lights }, (_, n) => <i key={n} style={{ "--delay": `${n * .17}s`, "--light-x": `${n % 2 ? 80 - n * 2 : 8 + n * 2}%`, "--light-angle": `${n % 2 ? -18 + n * 2 : 19 + n * 2}deg`, "--light-colour": GLASS[(n + 3) % GLASS.length] } as CSSProperties}/>)}</div>}
    {!still && <div className={s.rosePane} key={`rose-${scene}-${stage}`} aria-hidden="true"><svg viewBox="0 0 72 92"><path d="M34 82C5 64-2 32 34 4C64 26 78 51 34 82Z" fill="#c49091" stroke={LEAD} strokeWidth="3"/><path d="m34 81 0-75 25 29-9 29Z" fill="#e9b6a5" opacity=".6" stroke={LEAD} strokeWidth="1"/><path d="M34 51 16 30M35 38 55 36" fill="none" stroke={LEAD}/></svg></div>}
    {openingPhase && <RoseWindowOpening id={id} quality={quality}/>}
  </div>;
}
