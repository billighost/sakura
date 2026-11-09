"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";

import { useId, type CSSProperties } from "react";
import type { BloomWorldProps, BloomQuality } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin, stableCos } from "../stableTrig";
import s from "./world.module.css";

const TIERS = {
  1: { stars: 19, pins: 6, ribs: 5, fibres: 12, ticks: 18, constellations: 1, layers: 3 },
  2: { stars: 36, pins: 9, ribs: 7, fibres: 23, ticks: 30, constellations: 2, layers: 4 },
  3: { stars: 63, pins: 13, ribs: 9, fibres: 43, ticks: 48, constellations: 3, layers: 5 },
  4: { stars: 105, pins: 19, ribs: 13, fibres: 73, ticks: 72, constellations: 5, layers: 6 },
  5: { stars: 171, pins: 28, ribs: 17, fibres: 121, ticks: 108, constellations: 8, layers: 8 },
} satisfies Record<BloomQuality, { stars: number; pins: number; ribs: number; fibres: number; ticks: number; constellations: number; layers: number }>;

function scatter(n: number) {
  const value = stableSin(n * 94.719 + 31.2) * 29183.71;
  return value - Math.floor(value);
}

function Star({ x, y, size, colour = "var(--cosmos-gold)", folded = false }: { x: number; y: number; size: number; colour?: string; folded?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 20})`}>
    <path d="M0-20 5-6 19-6 8 3 12 18 0 9-13 17-8 3-19-6-5-7Z" fill={colour} stroke="var(--cosmos-ink)" strokeWidth=".8"/>
    {folded && <><path d="M0-20 0 9 12 18 8 3 19-6 5-6Z" fill="#fff6d1" opacity=".24"/><path d="M0-20 0 1 19-6M0 1-13 17M0 1-19-6M0 1 12 18" fill="none" stroke="#263444" strokeWidth=".7" opacity=".35"/></>}
  </g>;
}

function Pin({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return <g><circle cx={x + 1} cy={y + 2} r={r + 1} fill="#091827" opacity=".38"/><circle cx={x} cy={y} r={r} fill="var(--cosmos-gold)" stroke="#65533a" strokeWidth="1"/><path d={`M${x - r * .5} ${y + r * .3} ${x + r * .5} ${y - r * .3}`} stroke="#7c673f" strokeWidth="1"/><path d={`M${x - r * .6} ${y - r * .3}q${r * .5}-${r * .6} ${r * 1.1} 0`} fill="none" stroke="#f9e6ad" strokeWidth=".7"/></g>;
}

/** Original cut-paper contours, never font outlines. */
const LETTERS: Record<string, string> = {
  P: "M4 78 2 5 30 3Q58 4 56 25Q57 49 19 47L21 79ZM19 17 20 34 30 34Q41 34 41 25Q41 16 29 17Z",
  A: "M0 79 24 3 40 2 65 77 46 80 40 59 21 59 15 78ZM25 44 36 43 30 22Z",
  E: "M3 4 54 2 55 18 21 19 21 32 49 32 48 48 22 48 21 64 56 64 55 79 3 77Z",
  R: "M3 79 2 4 29 3Q57 3 57 25Q57 42 44 46L63 77 42 80 25 50 20 50 21 78ZM19 17 20 35 29 35Q41 36 41 25Q42 16 29 17Z",
  C: "M57 7 49 23Q40 15 29 19Q15 21 17 44Q17 65 30 65Q43 65 50 57L60 71Q49 83 29 81Q0 80 0 42Q-1 4 29 1Q44-2 57 7Z",
  O: "M31 0Q61 0 62 40Q62 82 30 82Q0 81 0 40Q1 0 31 0ZM31 18Q17 18 17 40Q17 63 30 65Q44 64 44 41Q44 18 31 18Z",
  S: "M57 7 49 23Q28 11 20 23Q18 29 36 33Q62 39 60 59Q60 80 32 82Q13 82 0 72L8 57Q25 68 37 64Q47 61 42 54Q40 50 23 46Q-1 40 2 20Q6-2 33 0Q47 0 57 7Z",
  M: "M2 79 2 3 19 2 37 35 53 3 72 3 73 79 55 78 55 34 39 60 33 60 18 33 18 80Z",
};

function PaperTitle({ small = false }: { small?: boolean }) {
  return <svg className={s.title} viewBox="0 0 490 172" aria-hidden="true">
    <g transform="translate(72 1) scale(.71)">
      {"PAPER".split("").map((letter, i) => <g key={i} transform={`translate(${i * 72} ${i % 2 ? 2 : 0}) rotate(${i % 2 ? .9 : -.5})`}>
        <path d={LETTERS[letter]} fill="#061a2b" opacity=".6" transform="translate(3 5)" fillRule="evenodd"/>
        <path d={LETTERS[letter]} fill="var(--cosmos-title)" fillRule="evenodd"/>
        <path d="M10 8 12 71M12 8 43 8" stroke="#fff5d1" strokeWidth="1.1" opacity=".3" fill="none"/>
      </g>)}
    </g>
    <g transform="translate(10 82)">
      {"COSMOS".split("").map((letter, i) => <g key={i} className={s.titleLetter} style={{ "--letter-delay": `${i * .09}s` } as CSSProperties} transform={`translate(${i * 78} ${i % 2 ? 2 : 0}) rotate(${i % 2 ? .6 : -.6})`}>
        <path d={LETTERS[letter]} fill="#071727" transform="translate(3 5)" fillRule="evenodd"/>
        <path d={LETTERS[letter]} fill="var(--cosmos-title)" stroke="#e9d0a6" strokeWidth=".7" fillRule="evenodd"/>
        <path d={`M8 9 10 71M10 9 ${letter === "M" ? 62 : 47} 9`} fill="none" stroke="#fff6d5" strokeWidth="1.2" opacity=".34"/>
      </g>)}
    </g>
    {!small && <><path d="M91 70H198M274 70H382" stroke="var(--cosmos-gold)" opacity=".65"/><Star x={238} y={70} size={10} colour="var(--cosmos-coral)" folded/></>}
  </svg>;
}

function Definitions({ id }: { id: string }) {
  return <defs>
    <linearGradient id={`${id}-dome`} x1="0" y1="0" x2="1" y2=".9"><stop stopColor="#617898"/><stop offset=".44" stopColor="#354e6c"/><stop offset="1" stopColor="#213752"/></linearGradient>
    <linearGradient id={`${id}-cream`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#f5e9ca"/><stop offset=".46" stopColor="#dfceaa"/><stop offset="1" stopColor="#cbb98e"/></linearGradient>
    <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#87693e"/><stop offset=".32" stopColor="#d7b477"/><stop offset=".65" stopColor="#b0884b"/><stop offset="1" stopColor="#f0d899"/></linearGradient>
    <linearGradient id={`${id}-sky`} x1="0" y1="0" x2=".3" y2="1"><stop stopColor="#1b3049"/><stop offset=".72" stopColor="#274465"/><stop offset="1" stopColor="#4b657b"/></linearGradient>
    <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7 7 0M-1 1 1-1M6 8 8 6" stroke="#efe2bc" opacity=".13" strokeWidth=".7"/></pattern>
    <clipPath id={`${id}-aperture`}><path d="M250 690 250 455Q258 94 705 78Q1154 94 1163 455V690Z"/></clipPath>
  </defs>;
}

function Sky({ id, quality, progress, listening }: { id: string; quality: BloomQuality; progress: number; listening?: BloomListeningProfile }) {
  const tier = TIERS[quality];
  const constellationCount = listening?.artistCount == null ? tier.constellations : Math.min(tier.constellations,Math.max(0,listening.artistCount));
  return <g className={s.sky}>
    <path d="M0 0H1440V900H0Z" fill={`url(#${id}-sky)`}/>
    <path d="M64 101Q431-122 1132 66L1399 262 1286 407Q1007 271 648 167Q327 121 64 245Z" fill="#365775" opacity=".6"/>
    <path d="M-18 514Q380 194 1439 583L1440 675Q728 384 0 618Z" fill="#738b91" opacity=".13"/>
    {Array.from({ length: tier.fibres }, (_, n) => <path key={`f${n}`} d={`M${scatter(n * 3) * 1440} ${scatter(n * 3 + 1) * 900}l${3 + scatter(n * 7) * 19} ${scatter(n * 5) * 3}`} stroke="#f4deb5" opacity={.025 + scatter(n * 9) * .065} strokeWidth=".6"/>)}
    <g className={s.skyStars}>
      {Array.from({ length: tier.stars }, (_, n) => {
        const x = scatter(n * 7 + 1) * 1410 + 15, y = scatter(n * 7 + 2) * 750 + 20;
        return n % 7 === 0 ? <Star key={n} x={x} y={y} size={3 + scatter(n * 11) * 6} colour={n % 3 ? "#d7c397" : "#be9289"} folded={quality >= 3}/> : <g key={n} opacity={.25 + scatter(n) * .55}><path d={`M${x - 2} ${y}h4m-2-2v4`} stroke="#f6e7bb" strokeWidth=".7"/>{quality >= 4 && <circle cx={x} cy={y} r="4" fill="none" stroke="#e0c698" strokeWidth=".45" opacity=".5"/>}</g>;
      })}
    </g>
    {Array.from({ length: constellationCount }, (_, n) => {
      const x = 70 + scatter(n * 23) * 1120, y = 70 + scatter(n * 13) * 470;
      const points = Array.from({ length: 4 + n % 3 }, (_, i) => `${x + i * 26 + scatter(i + n) * 13},${y + scatter(i * 4 + n) * 53}`).join(" ");
      return <g key={`c${n}`} className={s.constellation} style={{ "--constellation-delay": `${.2 + n * .13}s` } as CSSProperties} opacity={.14 + progress * .36}><polyline points={points} stroke="#ead0a0" strokeWidth=".8" fill="none"/>{points.split(" ").map((point, i) => { const [px, py] = point.split(",").map(Number); return <circle key={i} cx={px} cy={py} r="2.3" fill="#dfc69a"/>; })}</g>;
    })}
    {quality >= 3 && <g opacity=".19" stroke="#c0c8b4" fill="none" strokeWidth=".8"><path d="M52 442Q280 93 677 63Q1090 40 1390 315M80 474Q315 150 696 116Q1042 101 1353 337"/><path d="M701 24 703 109M601 29 613 121M802 25 791 120"/>{Array.from({ length: 19 }, (_, n) => <path key={n} d={`M${112 + n * 64} ${440 - stableSin(n / 19 * Math.PI) * 300}l7-12`} />)}</g>}
  </g>;
}

function ListeningOrbit({ listening, quality }: { listening: BloomListeningProfile; quality: BloomQuality }) {
  const count = Math.min(quality + 3,Math.max(0,listening.artistCount || 0));
  const shared = Math.min(count,Math.max(0,listening.comparison?.sharedArtistCount || 0));
  const returning = Math.min(count,Math.max(0,listening.returningArtistCount || 0));
  const discovered = Math.min(count,Math.max(0,listening.discoveredArtistCount || 0));
  return <svg viewBox="-74 -74 148 148" aria-hidden="true" data-listening-motif="artist-orbit" data-orbit-artists={count} data-shared-links={shared}>
    <circle r="60" fill="none" stroke="#d7c298" strokeWidth=".7" opacity=".65"/>
    {listening.peakHour != null && <g transform={`rotate(${listening.peakHour / 24 * 360})`}><path d="M0-63V-52" stroke="#efe2bc" strokeWidth="2"/><path d="m-4-68 4 5 4-5" fill="none" stroke="#e0bc75"/></g>}
    {Array.from({length:count},(_,n)=>{const angle=n / Math.max(1,count) * Math.PI * 2 - Math.PI / 2,x=stableCos(angle) * 47,y=stableSin(angle) * 47;return <g key={n}>
      {n < shared && <path d={`M0 0 ${x} ${y}`} fill="none" stroke="#d7c298" strokeWidth="1.1"/>}
      {n < returning && <circle cx={x} cy={y} r="13" fill="none" stroke="#adc1b4" strokeWidth=".8"/>}
      <Star x={x} y={y} size={n < discovered ? 11 : 8} colour={n < discovered ? "#c7978e" : "#d9c395"} folded/>
    </g>;})}
    <Star x={0} y={0} size={16} colour="#e0bc75" folded/>
    {shared > 1 && <circle r="25" fill="none" stroke="#b2c0ac" strokeWidth=".7" strokeDasharray="2 5"/>}
  </svg>;
}

function Dome({ id, quality, open }: { id: string; quality: BloomQuality; open: boolean }) {
  const tier = TIERS[quality];
  return <g className={s.dome} data-open={open}>
    <path d="M242 718 250 455Q252 89 705 73Q1158 91 1171 455L1180 718Z" fill="#081827" opacity=".6" transform="translate(13 18)"/>
    <path d="M240 712 249 455Q255 87 705 73Q1158 89 1172 455L1180 713Z" fill={`url(#${id}-dome)`} stroke="#bda57b" strokeWidth="2"/>
    <path d="M268 689 276 452Q287 111 705 100Q1124 118 1145 452L1154 689Z" fill="#10263c" stroke="#7690a1" strokeWidth="1.2"/>
    <g clipPath={`url(#${id}-aperture)`} opacity=".75">
      <path d="M265 277Q660 79 1165 278V385Q641 227 265 388Z" fill="#7c8c91" opacity=".2"/>
      {Array.from({ length: tier.ribs }, (_, n) => <path key={n} d={`M${285 + n / (tier.ribs - 1) * 844} 705Q${630 + n * 8} 320 705 89`} stroke={n % 2 ? "#203a50" : "#658194"} strokeWidth={quality >= 4 ? 1.5 : 2.3} fill="none" opacity=".5"/>)}
      <path d="M265 397Q705 191 1163 397M258 509Q715 307 1169 508M251 617Q705 465 1176 617" fill="none" stroke="#95a3a0" strokeWidth="1" opacity=".4"/>
    </g>
    <g className={s.domeLeft}>
      <path d="M247 694 250 455Q264 108 704 79L702 233Q356 287 348 684Z" fill={`url(#${id}-dome)`} stroke="#99a8a9" strokeWidth="1.2"/>
      <path d="M263 678Q268 217 691 92L691 210Q367 265 359 677Z" fill={`url(#${id}-hatch)`}/>
      <path d="M262 681Q271 220 694 93M285 681Q296 268 695 143M310 681Q329 310 695 197" fill="none" stroke="#a1afa9" strokeWidth=".7" opacity=".6"/>
    </g>
    <g className={s.domeRight}>
      <path d="M705 79Q1156 98 1173 456L1180 696 1080 688Q1069 287 707 235Z" fill={`url(#${id}-dome)`} stroke="#899ba5" strokeWidth="1.2"/>
      <path d="M716 99Q1131 160 1156 681M716 145Q1104 198 1130 685M716 198Q1070 244 1101 685" fill="none" stroke="#a1afa9" strokeWidth=".7" opacity=".6"/>
    </g>
    <path d="M237 686 1185 686 1208 734 209 734Z" fill={`url(#${id}-gold)`} stroke="#5e5e52" strokeWidth="1.5"/>
    <path d="M238 695 1180 695M224 726 1197 726" stroke="#efdeb5" opacity=".6"/>
    {Array.from({ length: tier.pins }, (_, n) => <Pin key={n} x={247 + n / (tier.pins - 1) * 924} y={709} r={3.8}/>)}
    <path d="M650 704 656 741 753 741 760 704Z" fill="#bb9760" stroke="#716448"/>
    <Pin x={704} y={721} r={8}/>
    <path d="M265 457Q273 118 705 87Q1136 117 1160 457" stroke="#d5be8d" strokeWidth="1" fill="none" opacity=".75"/>
  </g>;
}

function Telescope({ id, quality }: { id: string; quality: BloomQuality }) {
  return <g className={s.telescope}>
    <path d="M112 164 56 309M112 164 163 309M112 164 100 316" stroke="#081723" strokeWidth="13" strokeLinecap="round"/>
    <path d="M109 161 52 305M111 161 160 305M112 161 99 313" stroke="#b69764" strokeWidth="7" strokeLinecap="round"/>
    <path d="M53 292 159 292M70 260 144 260" stroke="#7e816f" strokeWidth="2"/>
    <path d="M102 177 121 177 125 91 105 91Z" fill={`url(#${id}-gold)`} stroke="#263a46"/>
    <g transform="rotate(-24 116 92)">
      <path d="M28 73 208 73 207 113 27 113Z" fill={`url(#${id}-cream)`} stroke="#172d42" strokeWidth="1.8"/>
      <path d="M28 73 208 73 208 81 28 83Z" fill="#fff0ca" opacity=".45"/>
      <path d="M28 104 208 103 207 114 27 113Z" fill="#8f957e"/>
      <path d="M176 67 218 67 218 119 176 119Z" fill={`url(#${id}-gold)`} stroke="#122c42" strokeWidth="1.5"/>
      <ellipse cx="218" cy="93" rx="12" ry="26" fill="#142b44" stroke="#bb9e6c" strokeWidth="3"/>
      <ellipse cx="219" cy="92" rx="7" ry="19" fill="#687c8f"/><path d="M218 77Q224 92 216 106" stroke="#b9c4b0" strokeWidth="2" fill="none"/>
      <path d="M28 79 2 82 2 105 28 107Z" fill="#b79c70" stroke="#173147"/><path d="M4 80V107" stroke="#e3cf9c" strokeWidth="4"/>
      {[48, 72, 158].map(x => <path key={x} d={`M${x} 74V114`} stroke="#ad8850" strokeWidth="5"/>)}
      {quality >= 3 && <g fill="none" stroke="#776c55" strokeWidth=".6"><path d="M83 92h66M83 97h49M90 87h48"/>{Array.from({length:quality * 4},(_,n)=><path key={n} d={`M${83+n*3} 77v${n%4===0?7:3}`}/>)}</g>}
    </g>
    <Pin x={112} y={154} r={12}/>
  </g>;
}

function Orrery({ id, quality }: { id: string; quality: BloomQuality }) {
  const tier = TIERS[quality];
  return <g className={s.orrery}>
    <path d="M71 304 282 304 261 328 91 328Z" fill="#091925" opacity=".45" transform="translate(6 9)"/>
    <path d="M77 293 274 293 263 316 87 316Z" fill={`url(#${id}-cream)`} stroke="#384f58"/>
    <path d="M104 279 245 279 272 292 79 292Z" fill="#c5ad80" stroke="#465256"/>
    <path d="M164 164H184V278H164Z" fill={`url(#${id}-gold)`} stroke="#566050"/>
    <path d="M170 170V271" stroke="#f3dca9" opacity=".75"/>
    <g className={s.paperArms}>
      <ellipse cx="174" cy="139" rx="155" ry="71" fill="none" stroke="#091c2c" strokeWidth="7"/>
      <ellipse cx="172" cy="136" rx="153" ry="68" fill="none" stroke="#bea16b" strokeWidth="3"/>
      <ellipse cx="172" cy="136" rx="118" ry="52" fill="none" stroke="#87988d" strokeWidth="1.5"/>
      {quality >= 3 && <ellipse cx="172" cy="136" rx="79" ry="35" fill="none" stroke="#d7b57a" strokeWidth="1.1"/>}
      <path d="M27 115 173 143 270 78M66 183 173 143 314 171" fill="none" stroke="#cdb68a" strokeWidth="3.3"/>
      <path d="M36 121 173 148 273 85" fill="none" stroke="#506c70" strokeWidth="1"/>
      {Array.from({length:tier.ticks},(_,n)=>{const angle=n/tier.ticks*Math.PI*2;return <path key={n} d={`M${172+stableCos(angle)*153} ${136+stableSin(angle)*68}l${-stableCos(angle)*(n%3===0?8:4)} ${-stableSin(angle)*(n%3===0?5:3)}`} stroke="#ebd2a3" strokeWidth=".7"/>;})}
      <g transform="translate(269 77)"><circle r="27" fill="#ba8e82" stroke="#20384a" strokeWidth="1.5"/><path d="M0-27Q27-3 0 27" fill="#e3b5a0"/><path d="M-24-9Q-3 6 26-9M-24 10Q0 25 24 10" fill="none" stroke="#795b63" opacity=".6"/><path d="M-4-23V23" stroke="#e5bead" opacity=".55" strokeWidth=".8"/></g>
      <g transform="translate(34 115)"><circle r="18" fill="#88a19d" stroke="#20384a" strokeWidth="1.5"/><path d="M0-18Q17-3 0 18" fill="#b7c1a4"/><path d="M-16-5 14 7" stroke="#627d77"/></g>
      <g transform="translate(308 171)"><ellipse rx="32" ry="8" fill="#c8b38f" stroke="#253c4b" transform="rotate(-18)"/><circle r="14" fill="#cfae68" stroke="#253c4b"/><path d="M0-14Q13 1 0 14" fill="#efd09b"/><path d="M278 179 338 163" stroke="#dfc599" strokeWidth="2"/></g>
      <circle cx="172" cy="136" r="39" fill="#ceac66" stroke="#e6d2a2" strokeWidth="1.5"/>
      <path d="M172 98Q216 135 172 175" fill="#ebca81"/>
      <path d="M146 110Q166 107 181 122M148 136Q171 126 193 138M153 159Q172 154 189 161" fill="none" stroke="#ac8348" opacity=".6"/>
      <Pin x={172} y={136} r={5}/>
    </g>
    <g fill="none" stroke="#977e4e" opacity=".6" strokeWidth=".7"><path d="M95 298H255M105 308H245"/><path d="M147 283h51"/>{quality>=4&&Array.from({length:12},(_,n)=><path key={n} d={`M${110+n*12} 300v10`}/>)}</g>
  </g>;
}

function Chart({ id, quality, variant = 0 }: { id: string; quality: BloomQuality; variant?: number }) {
  return <g className={s.chart}>
    <path d="M4 12 201 2 226 284 24 298Z" fill="#0b2033" opacity=".65" transform="translate(7 8)"/>
    <path d="M4 12 201 2 226 284 24 298Z" fill={`url(#${id}-cream)`} stroke="#9a875e" strokeWidth="1.2"/>
    <path d="M14 26 188 18 209 271 36 283Z" fill="none" stroke="#876e4c" strokeWidth=".8"/>
    <path d="M106 9 125 290" stroke="#f8efd1" opacity=".6" strokeWidth="2"/>
    <path d="M108 9 127 291" stroke="#6e715b" opacity=".3" strokeWidth=".9"/>
    <g transform="translate(118 145) rotate(-4)" stroke="#667b77" strokeWidth=".7" fill="none">
      <circle r="79"/><circle r="61"/><circle r="27"/><ellipse rx="77" ry="39" transform={`rotate(${variant ? -28 : 32})`}/>
      <path d="M-86 0H86M0-89V89M-55-66 55 66M-55 66 55-66"/>
      {Array.from({length:TIERS[quality].ticks/3},(_,n)=>{const a=n/(TIERS[quality].ticks/3)*Math.PI*2;return <path key={n} d={`M${stableCos(a)*79} ${stableSin(a)*79} ${stableCos(a)*(n%3===0?69:74)} ${stableSin(a)*(n%3===0?69:74)}`}/>;})}
      <path d="M-40 34-12 5 3 25 28-18 43-33M-25-49-7-36 18-53 47-25" stroke="#b58e51" strokeWidth="1.1"/>
      {[-40,-12,3,28,43].map((x,n)=><circle key={n} cx={x} cy={[34,5,25,-18,-33][n]} r="2.1" fill="#b4864c" stroke="none"/>)}
    </g>
    <path d="M43 41H117M45 46H91M54 253H148M56 258H127" stroke="#8c805f" strokeWidth="1" opacity=".6"/>
    <Star x={169} y={50} size={9} colour="#b59865" folded/>
    <Pin x={15} y={21} r={3}/><Pin x={195} y={14} r={3}/>
  </g>;
}

function Architecture({ id, quality, progress }: { id: string; quality: BloomQuality; progress: number }) {
  const tier = TIERS[quality];
  return <g className={s.architecture}>
    <path d="M40 804 265 705 1181 705 1402 804V900H40Z" fill="#0f2335"/>
    <path d="M53 786 264 699 1181 699 1390 786 1356 826 80 826Z" fill="#7e9290"/>
    <path d="M79 795 1398 795 1351 843 35 843Z" fill="#2e4858"/>
    <path d="M72 824 1369 824 1428 872 14 872Z" fill="#516979"/>
    <path d="M82 829H1376M22 871H1420" stroke="#c2b595" opacity=".6"/>
    <path d="M642 44 657 30 755 30 770 44 755 59 657 59Z" fill={`url(#${id}-gold)`} stroke="#1f3443"/>
    <path d="M663 36H749M663 52H749" stroke="#f5e2b7" opacity=".5" strokeWidth=".7"/>
    <Star x={706} y={44} size={9} folded colour="#ead9ae"/>
    {Array.from({length:tier.layers},(_,n)=><g key={n}>
      <path d={`M${26+n*16} 873V${174+n*21}Q${61+n*19} ${40+n*23} ${247+n*20} ${34+n*21}H${1192-n*20}Q${1372-n*19} ${46+n*23} ${1416-n*16} ${180+n*21}V873H${1392-n*16}V${183+n*21}Q${1346-n*19} ${71+n*23} ${1190-n*20} ${61+n*21}H${249+n*20}Q${87+n*19} ${71+n*23} ${52+n*16} ${181+n*21}V873Z`} fill={n%3===0?"#76909a":n%3===1?"#c4b291":"#314b64"} stroke="#172d42" strokeWidth="1"/>
      <path d={`M${34+n*16} 806V${181+n*21}Q${69+n*19} ${52+n*23} ${249+n*20} ${43+n*21}H${1190-n*20}Q${1365-n*19} ${53+n*23} ${1408-n*16} ${183+n*21}V806`} stroke="#ece0b8" strokeWidth=".6" fill="none" opacity=".45"/>
    </g>)}
    {quality>=3&&<g stroke="#c4b698" fill="none" opacity=".42" strokeWidth=".8">
      {Array.from({length:tier.pins},(_,n)=><path key={n} d={`M${48+n*47} 86v12m-5-6h10M${50+n*47} 811v10m-5-5h10`}/>)}
    </g>}
    {quality>=2&&<g className={s.suspendedStars}>
      {[{x:157,y:157,size:21},{x:1288,y:209,size:27},{x:1117,y:133,size:13},{x:382,y:184,size:12}].slice(0,quality).map((p,n)=><g key={n}><path d={`M${p.x} 81V${p.y-p.size}`} stroke="#c0b795" strokeWidth=".7"/><Star {...p} colour={n%2?"#ceac75":"#a3b5a2"} folded/></g>)}
    </g>}
    <g className={s.finalAssembly} opacity={progress > .8 ? 1 : .32}>
      <path d="M135 745 245 778 437 727 533 782 729 732 851 776 1020 726 1233 760 1322 725" fill="none" stroke="#d6bd8f" strokeWidth="1.2"/>
      {[135,245,437,533,729,851,1020,1233,1322].map((x,n)=><Star key={n} x={x} y={[745,778,727,782,732,776,726,760,725][n]} size={n%2?7:12} folded colour={n%3===0?"#cc9589":"#dfc597"}/>)}
    </g>
  </g>;
}

function PaperAperture({ quality }: { quality: BloomQuality }) {
  return <svg className={s.paperAperture} viewBox="0 0 680 860" preserveAspectRatio="none" aria-hidden="true">
    <path d="M50 68 132 32 558 43 632 116 629 750 545 811 121 813 43 742Z" fill="#0a2135" stroke="#beac83" strokeWidth="2"/>
    <path d="M50 68 132 32 160 90 104 137 84 371 42 742Z" fill="#78928f"/>
    <path d="M632 116 558 43 529 99 585 151 590 370 629 750Z" fill="#87989d"/>
    <path d="M132 32 558 43 529 99 160 90Z" fill="#d1bb91"/>
    <path d="M43 742 121 813 545 811 629 750 577 719 521 759 152 758 100 711Z" fill="#617d80"/>
    <path d="M61 75 145 45 553 54 615 126M54 735 125 797 542 795 615 747" stroke="#eddbb1" fill="none" strokeWidth=".8" opacity=".7"/>
    {quality >= 3 && <g stroke="#d4c69f" opacity=".3" fill="none" strokeWidth=".7"><path d="M62 107 93 139 87 651 61 706M608 155 584 181 587 656 610 702"/>{Array.from({length:quality*6},(_,n)=><path key={n} d={`M${168+n*12} 58l4 15M${164+n*12} 789l4-15`}/>)}</g>}
    <Pin x={81} y={96}/><Pin x={600} y={129}/><Pin x={88} y={739}/><Pin x={592} y={749}/>
  </svg>;
}

export default function CosmosWorld({ scene, stage, progress, quality, reducedMotion, view, theme, children, listening, experience }: BloomWorldProps) {
  const id = `cosmos-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const opening = scene === "opening" || view === "cover";
  const music = ["songs", "song-winner", "artist-songs", "discoveries", "returns", "finale"].includes(scene);
  const portrait = scene === "artist" || scene === "artists";
  const quiet = reducedMotion || quality === 1 || view === "poster";
  const completion = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const shot = opening ? "entrance" : scene === "song-winner" ? "aperture" : portrait ? "portrait" : scene === "finale" ? "panorama" : scene === "days" ? "calendar" : music || scene === "breadth" ? "gallery" : scene === "comparison" ? "chart" : "instrument";
  const style = { "--cosmos-completion": completion, "--cosmos-stage": stage, "--world-accent": "#a27849", "--world-ink": shot === "aperture" ? "#efe2bd" : "#243a47" } as CSSProperties;
  const hasOrbit = listening && (listening.artistCount != null || listening.peakHour != null);
  return <div className={s.world} data-experience={experience?.composition} data-scene={scene} data-view={view} data-theme={theme} data-quality={quality} data-motion={quiet ? "still" : "full"} data-shot={shot} data-opening={opening} data-music={music} data-portrait={portrait} data-listening={Boolean(listening)} data-calendar-pages={listening?.activeDays == null ? undefined : Math.min(quality + 3,listening.activeDays)} style={style}>
    <svg className={s.environment} viewBox="0 0 1440 900" preserveAspectRatio={view === "poster" ? "none" : "xMidYMid slice"} aria-hidden="true">
      <Definitions id={id}/><Sky id={id} quality={quality} progress={completion} listening={listening}/>
      <Architecture id={id} quality={quality} progress={completion}/>
      {!opening && <g className={s.stageDome}><Dome id={id} quality={quality} open/></g>}
    </svg>
    <div className={s.paperField} aria-hidden="true"><i/><i/><i/><i/></div>
    {scene === "song-winner" && <PaperAperture quality={quality}/>}
    {scene === "days" && <div className={s.calendarLeaves} aria-hidden="true">{Array.from({length:listening?.activeDays == null ? quality+3 : Math.min(quality + 3,Math.max(0,listening.activeDays))},(_,n)=><i key={n} style={{"--leaf":n,"--leaf-col":n%3,"--leaf-row":Math.floor(n/3)} as CSSProperties}><svg viewBox="0 0 56 70"><path d="M5 5H51V62L36 68H5Z" fill={n%2?"#b7c2ab":"#e5d4ae"} stroke="#425e66"/><path d="M9 19H46M14 9v11M42 9v11M14 31h8m10 0h8m-26 9h8m10 0h8m-26 9h8m10 0h8" fill="none" stroke="#516d70" strokeWidth=".8"/><path d="M36 68V57L51 62" fill="#b6a680"/></svg></i>)}</div>}
    {scene === "finale" && <div className={s.finaleTitle} aria-hidden="true"><PaperTitle small/></div>}
    <div className={s.topMark} aria-hidden="true"><svg viewBox="0 0 100 40"><path d="M1 20H32M67 20H99" stroke="currentColor"/><Star x={50} y={20} size={12} colour="currentColor" folded/></svg></div>
    <div className={s.instrumentIllustrations} aria-hidden="true">
      <svg className={s.telescopeObject} viewBox="0 0 260 340"><Telescope id={id} quality={quality}/></svg>
      <svg className={s.orreryObject} viewBox="0 0 350 350"><Orrery id={id} quality={quality}/></svg>
      <svg className={s.chartObject} viewBox="0 0 240 315"><Chart id={id} quality={quality}/></svg>
      {quality >= 3 && <svg className={s.secondChart} viewBox="0 0 240 315"><Chart id={id} quality={quality} variant={1}/></svg>}
    </div>
    {opening && <div className={s.openingIllustration} aria-hidden="true">
      <svg className={s.openingDome} viewBox="140 30 1150 820"><Dome id={id} quality={quality} open={view !== "cover"}/><g transform="translate(588 373) scale(.74)"><Orrery id={id} quality={quality}/></g></svg>
      <div className={s.openingTitle}><PaperTitle/></div>
      <div className={s.titleFooter}><svg viewBox="0 0 280 25"><path d="M0 13H94M186 13H280" stroke="currentColor"/><path d="M118 13 128 3 139 13 151 3 164 13 151 23 139 13 128 23Z" fill="none" stroke="currentColor"/></svg></div>
    </div>}
    {!opening && <div className={s.paperShutters} key={`${scene}-${stage}`} aria-hidden="true"><i/><i/></div>}
    <div className={s.content}><ListeningPainting world="cosmos" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
    <div className={`${s.guideStar} ${hasOrbit ? s.listeningOrbit : ""}`} key={`star-${scene}-${stage}`} aria-hidden="true">{hasOrbit ? <ListeningOrbit listening={listening} quality={quality}/> : <svg viewBox="-36 -36 72 72"><path d="M-27 10Q-38-5-13-27" fill="none" stroke="#d4b778" strokeWidth=".8" strokeDasharray="2 4"/><Star x={0} y={0} size={24} colour="#e0bc75" folded/><circle r="33" stroke="#d7c298" fill="none" strokeWidth=".6" opacity=".6"/></svg>}</div>
  </div>;
}
