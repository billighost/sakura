"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";

import { useId, type CSSProperties } from "react";
import { BloomLettering } from "../Lettering";
import type { BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin } from "../stableTrig";
import s from "./world.module.css";

// The paper, scenery and characters are original illustrations. Detail tiers
// change actual rendered geometry; only the small, authored guides move.
const details = {
  1: { pines: 3, reeds: 9, clouds: 3, stones: 9, fibres: 14, spirits: 1, lights: 0 },
  2: { pines: 5, reeds: 16, clouds: 5, stones: 16, fibres: 25, spirits: 2, lights: 4 },
  3: { pines: 8, reeds: 25, clouds: 7, stones: 24, fibres: 38, spirits: 3, lights: 8 },
  4: { pines: 12, reeds: 38, clouds: 10, stones: 36, fibres: 58, spirits: 5, lights: 14 },
  5: { pines: 17, reeds: 55, clouds: 14, stones: 51, fibres: 84, spirits: 7, lights: 22 },
} as const;

const pineSites = [
  [1232, 497, 1.6, -7], [1174, 580, .97, 8], [1220, 659, 1.25, -8],
  [1048, 615, .7, 12], [1314, 759, 1.25, -14], [937, 721, .6, 9],
  [1039, 302, .49, 4], [1169, 314, .5, -4], [1260, 260, .62, 12],
  [843, 331, .4, -4], [1301, 413, .7, 11], [1275, 159, .69, -11],
  [1126, 685, .61, 0], [811, 775, .53, -9], [169, 766, .47, -7],
  [348, 793, .35, 7], [1312, 302, .42, -5],
] as const;

function grain(n: number) {
  const value = stableSin(n * 71.37 + 18.49) * 19381.193;
  return value - Math.floor(value);
}

function Definitions({ id, rich }: { id: string; rich: boolean }) {
  return <defs>
    <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--japan-paper-light)"/><stop offset=".46" stopColor="var(--japan-paper)"/><stop offset="1" stopColor="var(--japan-paper-deep)"/></linearGradient>
    <linearGradient id={`${id}-gutter`}><stop stopColor="#493e28" stopOpacity="0"/><stop offset=".38" stopColor="#493e28" stopOpacity=".08"/><stop offset=".5" stopColor="#493e28" stopOpacity=".24"/><stop offset=".6" stopColor="#fff9dc" stopOpacity=".17"/><stop offset="1" stopColor="#fff9dc" stopOpacity="0"/></linearGradient>
    <linearGradient id={`${id}-ink`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--japan-indigo)" stopOpacity=".68"/><stop offset="1" stopColor="var(--japan-indigo)" stopOpacity=".06"/></linearGradient>
    <linearGradient id={`${id}-lake`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--japan-celadon)" stopOpacity=".02"/><stop offset=".65" stopColor="var(--japan-celadon)" stopOpacity=".43"/><stop offset="1" stopColor="var(--japan-indigo)" stopOpacity=".26"/></linearGradient>
    <radialGradient id={`${id}-moon`}><stop stopColor="var(--japan-moon)" stopOpacity=".7"/><stop offset=".48" stopColor="var(--japan-moon)" stopOpacity=".13"/><stop offset="1" stopColor="var(--japan-moon)" stopOpacity="0"/></radialGradient>
    <linearGradient id={`${id}-cover`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#223949"/><stop offset=".6" stopColor="#1b2c3c"/><stop offset="1" stopColor="#101c2a"/></linearGradient>
    <linearGradient id={`${id}-lantern`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#c86a39"/><stop offset=".28" stopColor="#f3bc65"/><stop offset=".61" stopColor="#fbd997"/><stop offset="1" stopColor="#ca7f48"/></linearGradient>
    <pattern id={`${id}-cloth`} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M0 18 18 0 36 18 18 36Z" fill="none" stroke="#b99b65" strokeWidth=".5" opacity=".14"/><path d="M12 18 18 12 24 18 18 24Z" fill="none" stroke="#b99b65" strokeWidth=".4" opacity=".12"/></pattern>
    <pattern id={`${id}-fibres`} width="87" height="73" patternUnits="userSpaceOnUse"><path d="M9 5h13m31 8h7M20 52h8m45-14h6M41 69h14M3 30h5" stroke="#6e5a3c" strokeWidth=".55" opacity=".13"/><circle cx="54" cy="47" r=".7" fill="#705539" opacity=".2"/><circle cx="22" cy="19" r=".5" fill="#705539" opacity=".14"/></pattern>
    <symbol id={`${id}-cloud`} viewBox="0 0 230 74"><path d="M4 48Q16 29 36 37Q34 15 65 21Q82-3 106 15Q124 1 143 19Q169 7 180 27Q204 23 217 43L229 52Q193 58 165 51Q144 64 119 51Q86 60 61 47Q36 58 4 48Z" fill="var(--japan-mist)"/><path d="M17 45Q32 34 48 44Q70 60 91 47M101 31Q119 21 129 35Q137 49 159 39M169 42Q189 33 201 45" stroke="var(--japan-indigo)" strokeWidth=".8" opacity=".3" fill="none"/></symbol>
    <symbol id={`${id}-pine`} viewBox="-82 -165 164 186">
      <path d="M-12 19-5-46-31-76-49-119-30-93-3-69 10-102 44-147 27-107 14-64 3-34 5 19Z" fill="var(--japan-ink)"/><path d="M-2-57-51-86M14-78 57-104M-29-91-57-125M28-107 71-128M-3-39 43-52" stroke="var(--japan-ink)" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <g fill="var(--japan-pine)" stroke="var(--japan-ink)" strokeWidth="1"><path d="M-72-121Q-49-151-17-124L-24-114Q-44-116-54-108Z"/><path d="M-53-92Q-40-124-10-93L-15-85-33-86-47-79Z"/><path d="M11-135Q29-165 57-145L65-135 46-133 31-126Z"/><path d="M44-121Q70-151 80-126L72-113 64-115 52-110Z"/><path d="M28-96Q58-123 75-100L69-89 54-87 37-81Z"/><path d="M13-54Q38-81 60-57L53-49 34-47 20-42Z"/></g>
      {rich && <g stroke="var(--japan-ink)" strokeWidth=".65" opacity=".55"><path d="M-59-123-46-130M-50-120-43-136M-38-121-31-130M-43-94-32-104M-28-96-24-106M26-137 33-149M38-135 43-149M48-137 49-150M60-126 68-137M69-121 74-132M43-98 49-110M56-96 58-110M28-55 36-67M40-55 46-66"/><path d="M-4 10-1-35M13-77 29-112" fill="none" stroke="var(--japan-paper)"/></g>}
    </symbol>
    <symbol id={`${id}-boat`} viewBox="0 0 160 65"><path d="M4 42Q65 61 153 34L132 55Q71 72 28 54Z" fill="var(--japan-indigo)"/><path d="M35 45 75 4 95 44" fill="var(--japan-paper-light)" stroke="var(--japan-ink)" strokeWidth="1.2"/><path d="M75 3V50M78 7 116 35H78" fill="none" stroke="var(--japan-ink)" strokeWidth="1.3"/><path d="M28 60Q83 67 144 56" stroke="var(--japan-indigo)" opacity=".35" fill="none"/></symbol>
  </defs>;
}

function BookPaper({ id, fibres }: { id: string; fibres: number }) {
  return <g className={s.bookPaper}>
    <path d="M91 126Q374 102 692 130Q1000 93 1323 126L1324 822Q1004 799 696 832Q367 802 91 826Z" fill="#142534" opacity=".9"/>
    {[0, 1, 2, 3].map(n => <path key={n} d={`M${107 - n * 3} ${112 + n * 5}Q389 ${88 + n * 5} 697 ${124 + n * 5}Q1005 ${92 + n * 5} ${1302 + n * 4} ${111 + n * 5}L${1306 + n * 4} ${799 + n * 5}Q995 ${774 + n * 5} 697 ${809 + n * 5}Q387 ${776 + n * 5} ${105 - n * 3} ${802 + n * 5}Z`} fill={n % 2 ? "#cbb890" : "#e4d2aa"} stroke="#806948" strokeWidth=".6"/>)}
    <path d="M115 104Q404 89 695 121Q980 85 1298 105L1298 791Q983 775 697 819Q386 779 115 796Z" fill={`url(#${id}-paper)`}/>
    <path d="M115 104Q404 89 695 121Q980 85 1298 105L1298 791Q983 775 697 819Q386 779 115 796Z" fill={`url(#${id}-fibres)`}/>
    <path d="M149 132Q414 119 669 148L669 780Q407 750 148 769ZM724 145Q1005 117 1267 133V768Q994 751 724 784Z" fill="none" stroke="var(--japan-ochre)" strokeWidth="1" opacity=".35"/>
    <path d="M685 125Q710 429 686 818H714Q688 430 712 123Z" fill={`url(#${id}-gutter)`}/>
    <path d="M698 127Q689 429 699 814" fill="none" stroke="#8b7755" strokeWidth=".85" opacity=".4"/>
    {[167, 291, 424, 564, 701].map((y, n) => <g key={y}><ellipse cx="123" cy={y} rx="3" ry="2.3" fill="#735b3d"/><path d={`M122 ${y}Q82 ${y - 24} 103 ${y - 39}Q139 ${y - 35} 122 ${y}`} fill="none" stroke="#d9c28e" strokeWidth="2.2"/><path d={`M122 ${y}Q87 ${y - 21} 104 ${y - 34}`} fill="none" stroke="#806648" strokeWidth=".5"/><path d={`M123 ${y - 34}V${y + (n === 4 ? 23 : 65)}`} stroke="#dcc799" strokeWidth="1.5"/></g>)}
    {Array.from({ length: fibres }, (_, n) => <path key={n} d={`M${157 + grain(n * 3) * 1090} ${143 + grain(n * 7) * 629}l${4 + grain(n * 11) * 11} ${grain(n) * 2 - 1}`} stroke="#8c734a" strokeWidth={n % 9 === 0 ? 1 : .45} opacity={.1 + grain(n * 5) * .12}/>)}
    <path d="M121 776Q144 765 171 775M1276 129l-19 7m28 635-12-3M656 800l-10-4" stroke="#8b693d" strokeWidth="2" opacity=".2" fill="none"/>
  </g>;
}

function Landscape({ id, tier, morning, courtyard }: { id: string; tier: typeof details[1] | typeof details[2] | typeof details[3] | typeof details[4] | typeof details[5]; morning: number; courtyard: boolean }) {
  return <g className={s.landscape}>
    <circle cx="1094" cy="261" r="138" fill={`url(#${id}-moon)`}/>
    <circle cx="1094" cy="261" r="55" fill="var(--japan-moon)" opacity={.36 + morning * .2}/>
    <path d="M751 396 854 280 887 303 972 194 1114 368 1196 268 1297 402V525H752Z" fill="var(--japan-indigo)" opacity=".13"/>
    <path d="M802 479 889 399 948 449 1083 273 1238 438 1298 417V598H798Z" fill={`url(#${id}-ink)`}/>
    <path d="M1040 326 1083 273 1135 337 1107 319 1084 334 1068 315Z" fill="var(--japan-paper-light)" opacity=".7"/>
    <g stroke="var(--japan-indigo)" fill="none" opacity=".35" strokeLinecap="round"><path d="M1083 284 1061 351 1000 434M1092 314 1138 394 1156 435M919 413 887 436M1136 411l45 42M1160 452l51 15" strokeWidth="1.2"/><path d="M1097 373 1126 391m-42-68-12 44m-51 41-22 43m178-5 29 14" strokeWidth=".65"/></g>
    <path d="M786 523Q902 505 1041 534Q1166 565 1298 543V703Q1120 669 983 706Q902 730 761 702Z" fill={`url(#${id}-lake)`}/>
    <g fill="none" stroke="var(--japan-indigo)" strokeLinecap="round" opacity=".3"><path d="M873 557q74-12 139 0m-62 21q82-8 157-2m-92 28q101-18 203-4m-197 34q73-9 117-5m-330 39q82-15 145-8M846 612l53-3" strokeWidth="1"/>
      {tier.reeds > 20 && Array.from({length: Math.floor(tier.reeds / 3)}, (_, n) => <path key={n} d={`M${805 + grain(n * 8) * 448} ${541 + grain(n * 11) * 145}q${10 + grain(n * 7) * 55} -3 ${29 + grain(n * 17) * 70} -1`} strokeWidth=".55"/>)}
    </g>
    <g className={s.mountainClouds}>{Array.from({length: tier.clouds}, (_, n) => <use key={n} href={`#${id}-cloud`} x={765 + grain(n * 5) * 425} y={185 + grain(n * 13) * 338} width={103 + grain(n * 7) * 154} height="55" opacity={.25 + grain(n * 3) * .32}/>)}</g>
    <path d="M115 731Q290 706 465 745Q646 789 839 738Q1010 685 1298 738L1298 791Q976 775 700 816Q390 779 115 796Z" fill="var(--japan-celadon)" opacity=".35"/>
    <path d="M117 774Q299 713 492 763Q681 813 863 753Q1065 687 1297 769" stroke="var(--japan-ink)" strokeWidth="1.3" fill="none" opacity=".43"/>
    <path d="M168 767Q351 704 485 749Q602 790 753 760Q863 738 989 738" stroke="var(--japan-ochre)" strokeWidth="15" opacity=".3" fill="none"/>
    <path d="M168 767Q351 704 485 749Q602 790 753 760Q863 738 989 738" stroke="var(--japan-ink)" strokeWidth=".9" opacity=".36" fill="none" strokeDasharray="4 9"/>
    {pineSites.slice(0, tier.pines).map(([x, y, scale, angle], n) => <use key={n} href={`#${id}-pine`} x={x - scale * 82} y={y - scale * 165} width={scale * 164} height={scale * 186} transform={`rotate(${angle} ${x} ${y})`} opacity={n > 5 ? .54 : .9}/>)}
    {Array.from({length: tier.stones}, (_, n) => <path key={n} d={`M${188 + grain(n * 7) * 1038} ${757 + grain(n * 11) * 33}q${4 + grain(n * 13) * 8} -8 ${12 + grain(n * 19) * 8} -1q-5 5 -14 2Z`} fill="var(--japan-indigo)" opacity={.16 + grain(n) * .2}/>)}
    {Array.from({length: tier.reeds}, (_, n) => {
      const x = 820 + grain(n * 11) * 467, y = 753 + grain(n * 7) * 24, tall = 13 + grain(n * 17) * 34;
      return <g key={n} fill="none" stroke="var(--japan-pine)" strokeWidth=".85" opacity=".6"><path d={`M${x} ${y}q-5 -${tall / 2} -${tall / 3} -${tall}M${x} ${y}q2 -${tall} ${tall / 4} -${tall + 7}`}/>{n % 4 === 0 && <path d={`M${x - tall / 3} ${y - tall}l-4 -8m3 10 6 -7`} strokeWidth="1.2"/>}</g>;
    })}
    <use href={`#${id}-boat`} x="914" y="580" width="109" height="45" opacity={courtyard ? .15 : .65}/>
    <g className={s.courtyard} opacity={courtyard ? .9 : .3}>
      <path d="M937 675h189v61H937Z" fill="var(--japan-paper-light)" stroke="var(--japan-ink)" strokeWidth="1"/>
      <path d="M919 678Q959 660 979 626Q1032 641 1084 626Q1103 658 1144 678L1131 685H932Z" fill="var(--japan-indigo)" stroke="var(--japan-ink)" strokeWidth="1.3"/>
      <path d="M942 667Q981 658 1032 651Q1083 659 1118 668M965 674h135" stroke="var(--japan-paper)" opacity=".36" strokeWidth="1.1" fill="none"/>
      <path d="M957 684v49m39-49v50m39-48v48m41-49v49m30-47v47" stroke="var(--japan-vermilion)" strokeWidth="4"/>
      <path d="M960 699h142m-142 13h142M981 687v44m42-44v44m42-44v44" stroke="var(--japan-ink)" strokeWidth=".8" opacity=".45"/>
      <path d="M922 739h219l15 8H909Z" fill="var(--japan-ink)" opacity=".6"/>
    </g>
    <g fill="var(--japan-vermilion)" opacity=".7"><path d="M1260 678h19v28h-19Z"/><path d="M1254 674h31v4h-31Z"/><path d="M1267 706v26" stroke="var(--japan-ink)" strokeWidth="2"/><path d="M1264 682v18m5-18v18m5-18v18" stroke="var(--japan-paper)" strokeWidth=".6"/></g>
    <g className={s.pageBirds} fill="none" stroke="var(--japan-indigo)" strokeWidth="1.4" strokeLinecap="round"><path d="M918 243q10-10 19 0 12-12 24-4M887 263q6-7 14 0 8-9 18-2M969 230q7-9 13-1 8-7 15-1"/></g>
  </g>;
}

function Lantern({ id, amused }: { id: string; amused: boolean }) {
  return <svg viewBox="0 0 190 250" aria-hidden="true">
    <defs><radialGradient id={`${id}-guide-light`}><stop stopColor="#f4ba62" stopOpacity=".42"/><stop offset="1" stopColor="#f4ba62" stopOpacity="0"/></radialGradient></defs>
    <ellipse cx="90" cy="121" rx="94" ry="105" fill={`url(#${id}-guide-light)`}/>
    <g className={s.lanternBody}>
      <path d="M47 62Q54 23 94 33Q113 26 131 57L139 155Q130 193 91 187Q55 195 41 156Z" fill={`url(#${id}-lantern)`} stroke="#372b25" strokeWidth="3"/>
      <path d="M42 75Q86 85 135 75M42 94Q92 109 137 94M42 118Q84 136 138 121M42 145Q89 161 138 147M49 166Q90 181 134 164" fill="none" stroke="#855339" strokeWidth="1.7" opacity=".6"/>
      <path d="M69 42Q47 119 70 179M94 35Q80 118 95 184M111 39Q124 119 113 181" fill="none" stroke="#fff1b6" strokeWidth="1" opacity=".55"/>
      <path d="M48 55Q84 47 131 55L130 65Q89 56 48 64Z" fill="#282b2a"/><path d="M53 177Q91 184 131 174L127 188Q91 199 57 189Z" fill="#282b2a"/>
      <path d="M72 42Q62 17 79 12Q104 2 108 34" fill="none" stroke="#282b2a" strokeWidth="4"/>
      <path d="M48 87 38 111 52 125 47 135 35 117 32 108Z" fill="var(--japan-paper-light)" stroke="#4e3529" strokeWidth="1.3"/>
      <path d={amused ? "M73 108q8-13 16 0m17-1q9-12 17 0" : "M73 102q6-10 12-1v13q-7 8-12-1Zm34-1q6-10 12 0v12q-7 8-12-1Z"} fill={amused ? "none" : "#24282a"} stroke="#24282a" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M83 140Q98 159 113 139Q110 162 96 166Q84 159 83 140Z" fill="#522c27"/><path d="M93 158Q99 152 106 158L108 170Q98 181 91 169Z" fill="#b65448" stroke="#582f2a" strokeWidth="1"/>
      <path d="M66 126q5-4 10 1m41-1q5-3 9 0" stroke="#bb6948" strokeWidth="3" opacity=".6" strokeLinecap="round"/>
      <path d="M43 151Q26 141 16 153M134 145q16-16 31-8" fill="none" stroke="#332d26" strokeWidth="3" strokeLinecap="round"/>
      <path d="M13 153l-5-5m6 5-8 3m8-3-3 7M165 136l6-7m-6 7 9-2m-9 2 8 5" stroke="#332d26" strokeWidth="2" strokeLinecap="round"/>
    </g>
    <g className={s.lanternFeet} stroke="#302e28" fill="var(--japan-paper-light)" strokeWidth="2.4"><path d="M71 187q-7 18-16 23l-12 4q-7 9 8 9l21-4 9-25"/><path d="M112 187q3 15 15 23l13 2q8 8-6 10l-24-5-9-22"/></g>
    <ellipse cx="91" cy="230" rx="57" ry="5" fill="#4c3c28" opacity=".1"/>
  </svg>;
}

function ObjectSpirit({ type, rich }: { type: number; rich: boolean }) {
  return <svg viewBox="0 0 150 170" aria-hidden="true">
    {type % 3 === 0 ? <g>
      <path d="M21 80Q53 13 121 24L132 83 84 101Z" fill="#b86b4e" stroke="#3a342a" strokeWidth="2"/>
      <path d="M84 101 21 80M84 101 37 54M84 101 60 37M84 101 86 26M84 101 111 27M84 101 132 83" stroke="#ecd4a7" strokeWidth="1.2"/><path d="M84 99V131" stroke="#3a342a" strokeWidth="4"/><path d="M56 68q6-8 11 0m19-2q6-9 12 0M67 83q11 11 24-2" stroke="#332f28" strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M74 127q-6 14-19 16m36-14q9 13 23 13" stroke="#332f28" strokeWidth="2.5" fill="none"/>
      {rich && <g fill="none" stroke="#f1dcaa" strokeWidth=".8" opacity=".6"><path d="M42 65Q69 32 110 40M53 81Q80 55 126 59"/><path d="M43 60l10 3m17-21 4 8m23-13-1 9m22 8-6 5"/></g>}
    </g> : type % 3 === 1 ? <g>
      <path d="M44 73Q62 62 100 69Q126 99 106 128Q77 143 50 125Q31 106 44 73Z" fill="#a0b4a6" stroke="#30392f" strokeWidth="2"/>
      <path d="M43 86Q17 70 15 92Q10 103 39 108M108 81Q139 69 135 94Q137 112 111 113" fill="none" stroke="#30392f" strokeWidth="4"/><path d="M50 76 42 69h65l-7 8Z" fill="#738e83" stroke="#30392f" strokeWidth="1.5"/><path d="M69 68q-8-12 3-15 13-3 13 14" fill="#8ba193" stroke="#30392f" strokeWidth="1.5"/>
      <path d="M58 95q5-7 10 0m18-1q6-7 11 0M69 112q9 11 20-1" stroke="#30392f" strokeWidth="2.5" strokeLinecap="round" fill="none"/><path d="M53 128q-3 14-16 18m62-15q4 13 19 16" stroke="#30392f" strokeWidth="3" fill="none"/>
      {rich && <g fill="none" stroke="#d6e0b8" strokeWidth="1"><path d="M52 108q3 16 14 20m-11-43q16-8 44-1M78 120q12 4 19-4"/><path d="M78 78q-5 3-7 8m15-9q-1 6 5 8"/></g>}
    </g> : <g>
      <path d="M60 118 73 45 87 48 75 119Z" fill="#b8a17a" stroke="#302c25" strokeWidth="2"/><path d="M70 49Q46 22 73 9Q87 0 106 13Q91 26 86 48Z" fill="#343a33"/><path d="M72 39Q83 34 94 31" stroke="#788678" strokeWidth="2" fill="none"/><path d="M62 83q-6-10-13-5m34 1q13-8 18-1" fill="none" stroke="#302c25" strokeWidth="2"/><path d="M67 62q2-3 4 0m7 2q3-3 5 1M67 74q5 5 11 0" fill="none" stroke="#302c25" strokeWidth="1.8"/><path d="M60 119q-10 15-22 17m36-15q4 14 17 17" stroke="#302c25" strokeWidth="3" fill="none"/><path d="M30 146q31-14 64 1" stroke="#363c35" strokeWidth="3" strokeLinecap="round" fill="none"/>
      {rich && <path d="M73 19q5 5 9 21m-10-22q-13 5-4 15M98 11q-10 10-12 18" fill="none" stroke="#a2a586" strokeWidth=".8"/>}
    </g>}
    <ellipse cx="76" cy="153" rx="44" ry="4" fill="#513f2a" opacity=".12"/>
  </svg>;
}

function InkTitle() {
  return <svg className={s.inkTitle} viewBox="0 0 580 170" aria-hidden="true">
    <g className={s.inkWords} fill="none" stroke="var(--japan-title)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M35 124Q68 42 58 26Q50 17 45 29M39 110C70 63 115 80 96 112Q74 143 44 119" strokeWidth="9"/>
      <path d="M120 124Q151 54 145 30Q137 19 132 38Q129 81 119 120Q122 139 143 116" strokeWidth="7"/>
      <path d="M183 83C149 84 144 127 176 129C207 130 226 81 193 80Q171 81 168 100" strokeWidth="8.5"/>
      <path d="M253 81C225 76 208 116 235 129C263 141 294 91 271 83Q246 73 237 98" strokeWidth="8"/>
      <path d="M293 126 312 83Q317 72 320 82L314 104Q351 62 351 89L337 124Q376 64 385 88L375 116Q371 137 395 120" strokeWidth="8"/>
      <path d="M29 146Q194 127 395 145" strokeWidth="1.8" opacity=".54"/>
      <path d="M399 143Q453 160 491 133Q517 113 552 138" strokeWidth="2.5" opacity=".72"/>
    </g>
    <path d="M488 121q5-18 12-25m-12 25q-21-6-22-20 14-1 23 16m-1 4q17-15 29-9-10 14-28 10" stroke="var(--japan-title)" fill="none" strokeWidth="1.2" opacity=".7"/>
  </svg>;
}

function ListeningMarks({ listening, quality, cover = false }: { listening?: BloomListeningProfile; quality: BloomWorldProps["quality"]; cover?: boolean }) {
  const arrivals = Math.min(quality + 2, Math.max(0, listening?.discoveredArtistCount ?? 0));
  const shared = Math.min(quality + 1, Math.max(0, listening?.comparison?.sharedArtistCount ?? 0));
  return <g className={s.listeningMarks}>
    {arrivals > 0 && <g data-listening-motif="new-path-lanterns" data-motif-count={arrivals}>
      {Array.from({ length: arrivals }, (_, n) => <g key={n} transform={`translate(${cover ? 153 + n * 54 : 792 + n * 74} ${cover ? 503 + n % 2 * 15 : 750 + n % 2 * 16}) scale(${cover ? .65 : .75})`}>
        <path d="M0 24V-11M-12-10H12" stroke={cover ? "#cfb47f" : "var(--japan-ink)"} strokeWidth="1.5" fill="none"/>
        <path d="M-10-8Q0-13 10-8V10Q0 17-10 10Z" fill="#e2a25d" stroke="#735637" strokeWidth="1"/>
        <path d="M-5-8V12M0-9V14M5-8V12" stroke="#f3d194" strokeWidth=".7" opacity=".8"/>
        <path d="M-9 11H9M0 14V19" stroke="#6a4f34" strokeWidth="1.5"/>
      </g>)}
    </g>}
    {shared > 0 && <g data-listening-motif="continuity-bookmarks" data-motif-count={shared}>
      {Array.from({ length: shared }, (_, n) => <path key={n} d={cover ? `M${112 + n * 25} 638v42l7-6 7 6v-43Z` : `M${139 + n * 24} 769v39l7-6 7 6v-37Z`} fill={n % 2 ? "#8aa59a" : "#b46d54"} stroke="#cfb785" strokeWidth=".6" opacity=".84"/>)}
    </g>}
  </g>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, listening, children, experience }: BloomWorldProps) {
  const id = `japan-${useId().replace(/:/g, "")}`;
  const tier = details[quality];
  const hour = listening?.peakHour;
  const morning = hour == null ? Math.max(0, Math.min(1, (progress - .67) / .33)) : Math.max(0, stableSin((hour - 6) / 12 * Math.PI));
  const companions = listening?.returningArtistCount === undefined ? tier.spirits - 1 : Math.min(tier.spirits, Math.max(0, listening.returningArtistCount));
  const music = ["songs", "song-winner", "artist-songs", "discoveries", "returns", "genres", "finale"].includes(scene);
  const courtyard = ["artist", "artist-songs", "artists", "returns"].includes(scene);
  const opening = scene === "opening" || view === "cover";
  const style = { "--japan-dawn": morning, "--japan-travel": `${(progress - .5) * 9}%`, "--world-accent": "#ba6146" } as CSSProperties;
  return <div className={s.world} data-experience={experience?.composition} style={style} data-scene={scene} data-view={view} data-theme={theme} data-quality={quality} data-motion={reducedMotion ? "still" : "full"} data-music={music} data-courtyard={courtyard} data-opening={opening}>
    <div className={s.tableGrain} aria-hidden="true"/>
    <svg className={s.bookArt} viewBox="0 0 1400 900" preserveAspectRatio="none" aria-hidden="true">
      <Definitions id={id} rich={quality >= 3}/>
      <BookPaper id={id} fibres={tier.fibres}/>
      <Landscape id={id} tier={tier} morning={morning} courtyard={courtyard}/>
      <ListeningMarks listening={listening} quality={quality}/>
      <g className={s.marginOrnaments} fill="none" stroke="var(--japan-ochre)" opacity=".55" strokeWidth=".9"><path d="M163 171h31m-16-15v31M1250 736h-31m16-15v31"/><path d="M174 170q20-27 39-7-9 17-26 8m1034 565q-17 21-30 1 12-15 25-3"/></g>
      <g className={s.pageNumber} fill="var(--japan-vermilion)" opacity=".52"><path d="M1186 155h34v41h-34Z"/><path d="M1191 160h24v31h-24Z" fill="none" stroke="var(--japan-paper)" strokeWidth=".8"/><path d="M1196 166v20m7-21v21m7-19v17" stroke="var(--japan-paper)" strokeWidth="1.5"/></g>
    </svg>
    <div className={s.coverArtwork} aria-hidden="true">
      <svg viewBox="0 0 660 740" className={s.coverObject}>
        <path d="M64 70 588 42 606 674 79 704Z" fill="#071320" opacity=".7"/>
        {[0, 1, 2, 3].map(n => <path key={n} d={`M${77 + n * 2} ${59 + n * 3} 575 ${41 + n * 3} 583 ${648 + n * 5} 81 ${675 + n * 4}Z`} fill={n % 2 ? "#b6a17b" : "#dec89d"} stroke="#6e634b" strokeWidth=".6"/>)}
        <path d="M59 39 573 24 586 649 75 680Z" fill={`url(#${id}-cover)`} stroke="#8f7957" strokeWidth="1.3"/>
        <path d="M59 39 573 24 586 649 75 680Z" fill={`url(#${id}-cloth)`}/>
        <path d="M91 69 546 54 556 621 106 649Z" fill="none" stroke="#b2955e" strokeWidth="1" opacity=".45"/>
        <path d="M110 91 530 78 537 601 118 625Z" fill="none" stroke="#b2955e" strokeWidth=".6" opacity=".3"/>
        {[104, 225, 356, 501, 609].map(y => <g key={y}><path d={`M73 ${y}Q34 ${y - 8} 44 ${y - 32}Q64 ${y - 40} 71 ${y}`} fill="none" stroke="#d6be84" strokeWidth="3"/><circle cx="73" cy={y} r="3" fill="#bf9d66"/></g>)}
        <path d="M413 93 513 91 517 299 417 302Z" fill="#ddcba3" stroke="#c0a87e" strokeWidth="2"/>
        <path d="M427 106h73v183h-73Z" fill="none" stroke="#887147" strokeWidth=".7"/>
        <g transform="translate(449 121)" fill="none" stroke="#34403b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M0 0V31H13Q25 31 25 22Q24 15 5 15M2 0H13Q25 0 23 9Q22 16 3 15"/>
          <path d="M12 43Q-2 43-1 59Q-2 75 12 75Q27 75 26 59Q27 43 12 43Z"/>
          <path d="M12 87Q-2 87-1 103Q-2 119 12 119Q27 119 26 103Q27 87 12 87Z"/>
          <path d="M1 132V164M25 132 2 152M12 143 27 164"/>
          <path d="M-8 173H35" strokeWidth=".6" opacity=".5"/>
        </g>
        <path d="M151 360Q209 291 263 333Q291 367 355 323Q395 287 470 328" fill="none" stroke="#b49b66" strokeWidth="2" opacity=".5"/>
        <path d="M168 398Q223 362 274 391Q322 422 368 390Q412 363 482 396" fill="none" stroke="#b49b66" strokeWidth="1" opacity=".3"/>
        <circle cx="274" cy="386" r="89" fill="none" stroke="#b49b66" strokeWidth=".7" opacity=".32"/>
        <path d="M186 490Q282 437 395 467Q443 489 500 482L502 526Q390 508 312 536Q236 557 180 533Z" fill="#9ba988" opacity=".16"/>
        <use href={`#${id}-pine`} x="93" y="355" width="199" height="228" opacity=".6"/>
        <use href={`#${id}-boat`} x="330" y="491" width="122" height="51" opacity=".6"/>
        <ListeningMarks listening={listening} quality={quality} cover/>
        <path d="M96 668 566 640" stroke="#e0c289" strokeWidth=".6" opacity=".38"/>
      </svg>
      <div className={s.coverInk}><InkTitle/><BloomLettering text="THE LANTERN BOOK" style="paper" className={s.coverSubtitle}/></div>
    </div>
    {view === "poster" && <div className={s.posterInk} aria-hidden="true"><InkTitle/><BloomLettering text="THE LANTERN BOOK" style="paper" className={s.coverSubtitle}/></div>}
    <div className={s.content}><ListeningPainting world="japan" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
    <div className={s.lanternGuide} key={`guide-${scene}`} aria-hidden="true"><Lantern id={id} amused={scene === "song-winner" || scene === "finale"}/></div>
    {!opening && companions > 0 && <div className={s.procession} key={`procession-${scene}`} aria-hidden="true" data-listening-motif={listening?.returningArtistCount === undefined ? undefined : "returning-procession"} data-motif-count={companions}>{Array.from({length: companions}, (_, n) => <div className={s.objectSpirit} key={n} style={{"--spirit-x": `${n < 3 ? 4 + n * 9 : 70 + (n - 3) * 8}%`, "--spirit-size": `${n % 3 === 2 ? 64 : 74}px`, "--spirit-delay": `${.15 + n * .13}s`, "--spirit-turn": `${n % 2 ? 3 : -3}deg`} as CSSProperties}><ObjectSpirit type={n} rich={quality >= 4}/></div>)}</div>}
    {quality >= 2 && <div className={s.paperLights} aria-hidden="true">{Array.from({length: tier.lights}, (_, n) => <i key={n} style={{left: `${68 + grain(n * 3) * 23}%`, top: `${22 + grain(n * 7) * 51}%`, "--light-delay": `${n * .12}s`, "--light-size": `${1.5 + grain(n * 5) * 2}px`} as CSSProperties}/>)}</div>}
    {!opening && !reducedMotion && <div className={s.pageTurn} key={`page-${scene}-${stage}`} aria-hidden="true"><i/><i/><i/></div>}
    <div className={s.dawnWash} aria-hidden="true"/>
  </div>;
}
