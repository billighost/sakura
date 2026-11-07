"use client";

import { useId, type CSSProperties } from "react";
import type { BloomSceneKind, BloomWorldProps } from "../types";
import s from "./world.module.css";

const detail = [0, 5, 9, 15, 23, 34] as const;
const musicScenes: readonly BloomSceneKind[] = ["songs", "song-winner", "artist-songs", "discoveries", "finale"];
const leafSites = [
  [-67, -144, -32], [-27, -177, 27], [15, -215, -23], [63, -195, 25],
  [-94, -96, -41], [-50, -116, 23], [7, -135, -21], [53, -125, 24],
  [99, -145, 44], [-62, -66, -28], [-20, -83, 36], [37, -81, -26],
  [72, -52, 37], [11, -51, -18], [-96, -166, -32], [84, -233, 32],
] as const;

function noise(index: number) {
  const value = Math.sin(index * 43.83 + 15.31) * 19421.471;
  return value - Math.floor(value);
}

function Definitions({ id, quality }: { id: string; quality: number }) {
  return <defs>
    <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--paper-light)"/><stop offset=".53" stopColor="var(--paper)"/><stop offset="1" stopColor="var(--paper-deep)"/></linearGradient>
    <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--sky)"/><stop offset=".75" stopColor="var(--sky-low)"/><stop offset="1" stopColor="var(--paper)"/></linearGradient>
    <linearGradient id={`${id}-pool`} x1="0" y1="0" x2=".1" y2="1"><stop stopColor="#88aa9a"/><stop offset=".5" stopColor="#517c77"/><stop offset="1" stopColor="#365b66"/></linearGradient>
    <linearGradient id={`${id}-cloud`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#283b50"/><stop offset=".75" stopColor="#3e5056"/><stop offset="1" stopColor="#768178"/></linearGradient>
    <pattern id={`${id}-fibre`} width="97" height="79" patternUnits="userSpaceOnUse"><path d="M8 11h17M37 54h8M63 25h11M14 69h7M85 61h9" stroke="#866f46" strokeWidth=".6" opacity=".14"/><circle cx="41" cy="27" r=".7" fill="#93723c" opacity=".17"/><circle cx="21" cy="48" r=".55" fill="#65513d" opacity=".13"/></pattern>
    <pattern id={`${id}-trellis`} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M0 15 15 0 30 15 15 30Z" fill="none" stroke="#af915b" strokeWidth=".9"/><path d="M11 15 15 11 19 15 15 19Z" fill="#d4bb89"/></pattern>
    <symbol id={`${id}-leaf`} viewBox="-13 -31 26 42"><path d="M0 9Q-20-9-1-30Q20-15 0 9Z" fill="var(--leaf)" stroke="var(--leaf-ink)" strokeWidth=".7"/><path d="M0 8-1-27M0-2-7-10M-1-11 6-19" stroke="#dddcad" strokeWidth=".65" opacity=".55" fill="none"/></symbol>
    <symbol id={`${id}-flower`} viewBox="-27 -30 54 60">
      <g fill="var(--rose)" stroke="#984e4c" strokeWidth=".65"><path d="M0 2Q-19-18-2-27Q14-25 7-6Z"/><path d="M2 3Q11-23 25-11Q29 2 10 10Z"/><path d="M2 6Q29 6 15 23Q3 29-3 13Z"/><path d="M-2 6Q-5 31-20 14Q-22 1-7-1Z"/><path d="M-2 4Q-31 2-19-16Q-7-21 0-6Z"/></g>
      <g fill="#e6c37b"><circle r="4.1"/><circle cx="-4" cy="-2" r="1.2"/><circle cx="5" cy="1" r="1.1"/></g>
      {quality >= 4 && <g stroke="#f5d7b5" strokeWidth=".7" fill="none"><path d="M-1-8-2-21M9-3 21-9M6 11 13 20M-8 7-17 14M-9-5-18-12"/></g>}
    </symbol>
    <symbol id={`${id}-fruit`} viewBox="-16 -22 32 42"><path d="M-4-13-4-20 0-17 4-21 5-13Q22-8 12 9Q0 25-12 9Q-21-7-4-13Z" fill="#b85c4c" stroke="#763e39" strokeWidth="1"/><path d="M-4-10Q-15-2-9 8" fill="none" stroke="#edab79" strokeWidth="1.5"/><path d="M2-11Q8-4 8 4" fill="none" stroke="#763e39" strokeWidth=".8"/></symbol>
    <symbol id={`${id}-tree`} viewBox="-125 -270 250 305">
      <path d="M-14 29-7-67-42-127-81-191-57-169-19-113-3-85 1-165 32-227 21-193 14-141 17-93 54-153 103-207 85-169 41-111 15-62 4 29Z" fill="#76613f" stroke="#524931" strokeWidth="1.1"/>
      <path d="M-4 27 0-52M-10-80-42-125M12-88 25-128M1-153 13-191" fill="none" stroke="#b69661" strokeWidth="2"/>
      {leafSites.slice(0, quality >= 4 ? 16 : quality >= 2 ? 12 : 8).map(([x, y, rotate], index) => <g key={index} transform={`translate(${x} ${y}) rotate(${rotate})`}>
        {[0, 1, 2, ...(quality >= 3 ? [3, 4] : [])].map(n => <use key={n} href={`#${id}-leaf`} x={-9 + n * 8} y={n % 2 * 9} width={24} height={40} transform={`rotate(${(n - 2) * 27})`}/>)}
      </g>)}
      {[[-55,-136],[41,-122],[81,-184],[-7,-191]].slice(0,quality >= 3 ? 4 : 2).map(([x,y],index)=><use key={index} href={`#${id}-fruit`} x={x-13} y={y-17} width="26" height="34"/>)}
      {quality >= 5 && <g fill="#b4bc8b" opacity=".7">{Array.from({length:24},(_,i)=><circle key={i} cx={noise(i+61)*185-90} cy={noise(i+201)*150-224} r={.9+noise(i+300)}/>)}</g>}
    </symbol>
    <symbol id={`${id}-cypress`} viewBox="-42 -260 84 290"><path d="M-4 29V-48L-18-63-29-103-21-96-36-145-28-138-31-183-19-184-15-221-4-255 6-229 13-204 23-177 19-159 33-128 29-115 38-75 24-45 7-25 6 29Z" fill="#345f4e" stroke="#294f42" strokeWidth="1.1"/><path d="M0 20-2-234M-4-151-20-169M-1-113 19-149M-3-73-22-108M0-37 25-83" stroke="#81966a" fill="none" strokeWidth="1"/>{quality>=3&&<path d="M-14-210-10-219M9-193 14-179M-23-156-17-164M23-131 26-117M-25-103-20-93M-8-64-13-79M19-74 15-58" stroke="#b5b281" strokeWidth=".8" fill="none"/>}</symbol>
    <symbol id={`${id}-lotus`} viewBox="-32 -25 64 55"><ellipse cx="0" cy="21" rx="28" ry="6" fill="#739272"/><path d="M-1 20Q-20 8-23-8Q-6-4 0 8Q-6-7 0-22Q13-6 10 8Q21-6 29-5Q23 14 5 21Z" fill="#dfa0a1" stroke="#a46162" strokeWidth=".8"/><path d="M0-17V18M-18-3 0 18 23 1" stroke="#f2c8b5" strokeWidth="1.1" fill="none"/></symbol>
    <symbol id={`${id}-cloudform`} viewBox="0 0 430 140"><path d="M0 121Q11 72 60 85Q43 19 99 28Q132-13 170 23Q207-12 244 20Q286 1 301 44Q338 16 363 63Q405 48 430 120Z" fill={`url(#${id}-cloud)`}/><path d="M24 106Q37 88 57 105M70 63Q83 46 104 62M118 43Q139 18 162 43M211 49Q231 32 252 54M293 76Q312 56 332 80M353 106Q376 88 397 104" fill="none" stroke="#a7b2a4" strokeWidth="1.1" opacity=".24"/></symbol>
    <symbol id={`${id}-bird`} viewBox="0 0 50 25"><path d="M1 12Q12 0 24 15Q39-2 49 4Q36 6 25 22Q13 9 1 12Z" fill="#f2e6c3" stroke="#bba97c" strokeWidth=".4"/></symbol>
  </defs>;
}

function FloralBorder({ id, quality, portrait = false }: { id: string; quality: number; portrait?: boolean }) {
  const width = portrait ? 430 : 1400, height = portrait ? 1000 : 1000;
  const edge = portrait ? 11 : 30, inner = portrait ? 21 : 64;
  const count = portrait ? detail[quality] + 8 : detail[quality] * 2 + 10;
  return <g className={s.borderArt}>
    <path d={`M${edge} ${edge}H${width-edge}V${height-edge}H${edge}ZM${inner} ${inner}V${height-inner}H${width-inner}V${inner}Z`} fill="#c7b784" fillRule="evenodd"/>
    <rect x={edge} y={edge} width={width-edge*2} height={height-edge*2} fill="none" stroke="#b29758" strokeWidth="2"/>
    <rect x={inner} y={inner} width={width-inner*2} height={height-inner*2} fill="none" stroke="#a7884b" strokeWidth="2"/>
    <rect x={inner-5} y={inner-5} width={width-inner*2+10} height={height-inner*2+10} fill="none" stroke="#eddda9" strokeWidth="1"/>
    {[0,1].map(side=><g key={side}>{Array.from({length:count},(_,i)=>{
      const y=70+i*(height-140)/count, x=side?width-(edge+inner)/2:(edge+inner)/2;
      return <g key={i} transform={`translate(${x} ${y}) rotate(${side?180:0})`}>
        <path d="M0-16Q14-7 0 17Q-10 29 1 39" fill="none" stroke="#637349" strokeWidth=".9"/>
        <use href={`#${id}-leaf`} x="-12" y="-6" width={portrait?12:19} height={portrait?19:31} transform="rotate(-43)"/>
        {i%2===0&&<use href={`#${id}-flower`} x={portrait?-7:-12} y={portrait?-8:-14} width={portrait?14:25} height={portrait?16:28}/>}
      </g>;
    })}</g>)}
    {[0,1].map(side=><g key={side}>{Array.from({length:Math.ceil(count*(portrait?.32:1.1))},(_,i)=>{
      const total=Math.ceil(count*(portrait?.32:1.1)),x=65+i*(width-130)/Math.max(1,total-1),y=side?height-(edge+inner)/2:(edge+inner)/2;
      return <g key={i} transform={`translate(${x} ${y}) rotate(${side?180:0})`}><path d="M-18 0Q-6-10 8 2L22 0" stroke="#66754c" strokeWidth=".85" fill="none"/><use href={`#${id}-leaf`} x="-11" y="-13" width={portrait?13:19} height={portrait?20:30} transform="rotate(70)"/>{i%2===0&&<use href={`#${id}-flower`} x="-10" y="-11" width={portrait?16:21} height={portrait?18:24}/>}</g>;
    })}</g>)}
    {quality>=4&&[0,1,2,3].map(corner=><g key={corner} transform={`translate(${corner%2?width-inner:inner} ${corner>1?height-inner:inner}) rotate(${corner*90})`}><path d="M0 60Q21 40 5 22Q-13 6 7-8Q25-18 46 0" stroke="#927743" strokeWidth="1.4" fill="none"/><use href={`#${id}-flower`} x="-18" y="-18" width="36" height="40"/></g>)}
  </g>;
}

function Pavilion({ id, quality, close = false }: { id: string; quality: number; close?: boolean }) {
  return <g className={s.pavilion}>
    <path d={close?"M124 846V189H1276V846Z":"M915 769V319H1237V765Z"} fill="#d5b3a0" stroke="#967d63" strokeWidth="2"/>
    <path d={close?"M150 825V216H1249V825Z":"M934 748V337H1218V747Z"} fill="var(--paper-light)" stroke="#b39b73" strokeWidth="1.2"/>
    <path d={close?"M110 206 134 147H1266L1290 206ZM104 846 139 819H1261L1298 846Z":"M894 338 920 297H1235L1257 338ZM897 769 928 744H1230L1250 769Z"} fill="#e9d6af" stroke="#a08a62" strokeWidth="1.7"/>
    <path d={close?"M157 807V312Q183 290 211 279Q239 264 271 290Q300 267 330 291Q362 269 388 293Q420 270 448 293Q482 269 511 293Q542 269 571 293Q604 269 634 291Q664 262 695 277Q719 290 748 310V807ZM781 807V316Q807 288 833 278Q860 263 889 291Q916 267 944 291Q973 269 1001 293Q1032 269 1061 293Q1092 269 1121 292Q1150 267 1177 278Q1206 287 1242 315V807Z":"M957 735V434Q972 414 990 407Q1004 388 1018 408Q1033 392 1049 409Q1065 389 1082 406Q1097 389 1114 408Q1132 395 1149 408Q1166 391 1185 416L1193 437V735Z"} fill="var(--paper)" stroke="#ac9371" strokeWidth="1.6"/>
    {(close?[143,744,1241]:[950,1066,1195]).map((x,i)=><g key={x}><path d={`M${x} ${close?259:391}h20v${close?561:357}h-20Z`} fill="#ece0bf" stroke="#a58d68" strokeWidth="1.1"/><path d={`M${x-6} ${close?260:391}h32v16h-32ZM${x-7} ${close?801:730}h34v17h-34Z`} fill="#c9b285" stroke="#a58d68" strokeWidth=".8"/>{quality>=3&&<path d={`M${x+7} ${close?296:432}v${close?480:283}M${x+14} ${close?296:432}v${close?480:283}`} fill="none" stroke="#c3ac81" strokeWidth=".65"/>}{i===0&&<path d={`M${x+10} ${close?207:338}v${close?48:51}`} stroke="#af955c" strokeWidth="1.4"/>}</g>)}
    {quality>=2&&<path d={close?"M131 170H1268M123 186H1278M118 829H1282M131 837H1268":"M920 310H1238M910 327H1248M918 757H1235"} fill="none" stroke="#a38a63" strokeWidth="1"/>}
    {quality>=4&&<g stroke="#aa8d65" strokeWidth=".7" opacity=".64" fill="none">{Array.from({length:close?48:18},(_,i)=><path key={i} d={close?`M${160+i*23} 221v28h13v-28`:`M${943+i*15} 344v16h8v-16`}/>)}</g>}
    {!close&&<><path d="M966 663H1185V726H966Z" fill={`url(#${id}-trellis)`} stroke="#ad945c"/><path d="M1066 295V278H1084V294" fill="#c1a063" stroke="#927b49"/><path d="M1075 279Q1060 266 1075 244Q1090 268 1075 279Z" fill="#cbae69" stroke="#927b49"/></>}
  </g>;
}

function Garden({ id, quality, progress, scene, cover }: { id: string; quality: number; progress: number; scene: BloomSceneKind; cover: boolean }) {
  const music=musicScenes.includes(scene), close=music||scene==="artist"||scene==="artists",opening=scene==="opening";
  const pool=scene==="time"||scene==="comparison"||scene==="returns";
  return <g>
    <rect x="65" y="65" width="1270" height="869" fill={`url(#${id}-paper)`}/>
    <path d="M65 64H1335V370Q1080 298 838 357Q501 345 65 447Z" fill={`url(#${id}-sky)`}/>
    <g className={s.hills} opacity={close?.32:.9}><path d="M64 329Q155 283 272 303Q393 338 485 288Q580 234 677 298Q799 309 887 281Q1014 265 1102 335Q1237 299 1336 307V510H64Z" fill="#a4aa76"/><path d="M64 395Q195 305 325 401Q479 375 590 348Q746 297 860 370Q1057 422 1157 346Q1274 326 1336 393V564H64Z" fill="#89996c"/><path d="M64 426Q245 379 355 471Q558 404 766 446Q918 400 1105 466Q1220 412 1336 431V600H64Z" fill="#698667"/>{quality>=3&&<g fill="none" stroke="#65784d" strokeWidth="1" opacity=".42"><path d="M69 347Q181 296 266 323M364 330Q437 338 493 296M670 317Q757 333 834 302M1013 301Q1075 321 1104 350M1147 374Q1258 342 1325 403"/></g>}</g>
    <g className={s.clouds} opacity={.78-progress*.61}><use href={`#${id}-cloudform`} x="70" y="72" width="538" height="178"/><use href={`#${id}-cloudform`} x="443" y="90" width="505" height="167"/>{quality>=3&&<use href={`#${id}-cloudform`} x="863" y="71" width="471" height="156"/>}</g>
    <g className={s.gardenGround} opacity={close?.39:1}><path d="M65 581Q409 544 776 582Q1075 565 1335 622V935H65Z" fill="#92996a"/><path d="M76 897 403 620 576 613 198 935H64Z" fill="#d5c699" stroke="#a79875" strokeWidth="1.4"/><path d="M423 608 548 610 1088 931 868 934Z" fill="#d6c49a" stroke="#ad9970" strokeWidth="1.4"/><path d="M536 630H913V913H306Z" fill="#627f68" stroke="#8e9c73" strokeWidth="2"/>
      {quality>=2&&<g stroke="#9c8d6a" strokeWidth=".8" opacity=".65" fill="none">{Array.from({length:detail[quality]},(_,i)=><path key={i} d={`M${81+i*12} ${917-i*10}l${110-i*2} 0M${512+i*12} ${638+i*8}l${110+i*3} 0`}/>)}</g>}
    </g>
    <g className={`${s.pool} ${pool?s.poolClose:""}`}>
      <path d="M625 626 1066 626 1279 887 331 887Z" fill="#d2c397" stroke="#ad9468" strokeWidth="1.7"/><path d="M638 640H1049L1238 864H378Z" fill={`url(#${id}-pool)`} stroke="#5e7d6d" strokeWidth="1.4"/>
      {Array.from({length:detail[quality]},(_,i)=><path key={i} d={`M${472+noise(i+8)*392} ${662+i*5.4}q${20+noise(i+61)*41} -${2+noise(i+37)*4} ${74+noise(i+85)*62} 0`} fill="none" stroke={i%3===0?"#d3c5a1":"#99b3a1"} strokeWidth={i%4===0?1.6:.65} opacity=".52"/>)}
      {quality>=2&&[[586,731],[960,780],[732,840],[1110,849],[912,687]].slice(0,quality).map(([x,y],i)=><use key={i} href={`#${id}-lotus`} x={x-22} y={y-20} width="46" height="40"/>)}
    </g>
    <Pavilion id={id} quality={quality} close={close}/>
    {!close&&!cover&&<g className={s.readingTerrace}>
      <path d={opening?"M328 391H912L957 788H306Z":"M275 239H789V835H275Z"} fill={`url(#${id}-paper)`}/>
      <path d={opening?"M311 791H957L977 807H295Z":"M265 837H800L819 854H249Z"} fill="#dbc89d" stroke="#b99f72" strokeWidth="1"/>
      {!opening&&<>
        <path d="M249 266Q282 200 529 151Q776 200 814 266Z" fill="#e6d6b4" stroke="#ad9162" strokeWidth="1.4"/>
        <path d="M258 260Q315 211 529 169Q751 216 806 260M266 253Q359 214 529 191Q706 218 797 253" fill="none" stroke="#b9a175" strokeWidth="1.1"/>
        <path d="M239 269H821V281H239Z" fill="#d3bb8e" stroke="#a98d5d" strokeWidth="1"/>
        <path d="M529 150V133M520 132H538M523 130Q516 119 529 104Q542 119 535 130Z" stroke="#a98a47" strokeWidth="1" fill="#c0a360"/>
        <path d="M279 334Q312 290 345 309Q369 282 395 309Q422 282 449 309Q477 282 505 309Q532 280 561 309Q589 281 617 309Q645 281 673 309Q706 288 743 335" fill="none" stroke="#b49b73" strokeWidth="1.2"/>
        <path d="M273 287V831M789 287V831" stroke="#c8af80" strokeWidth="13"/><path d="M274 287V831M790 287V831" stroke="#a78c60" strokeWidth="1"/>
        <path d="M260 286H286V300H260ZM776 286H802V300H776ZM260 817H286V834H260ZM776 817H802V834H776Z" fill="#d1b88a" stroke="#b09365" strokeWidth="1"/>
        {quality>=3&&<path d="M268 314V801M282 315V801M782 315V801M796 315V801" stroke="#b9a074" strokeWidth=".7" fill="none"/>}
      </>}
      {quality>=4&&<path d={opening?"M321 797H964M330 802H970":"M263 845H807M258 850H813"} stroke="#aa915f" strokeWidth=".7" fill="none"/>}
    </g>}
    <g className={s.sideTrees}>
      <g className={s.leftTrees}>
        <use href={`#${id}-tree`} x="-27" y="351" width="290" height="487"/>
        <use href={`#${id}-cypress`} x="185" y="317" width="72" height="421"/>
        {quality>=2&&<use href={`#${id}-tree`} x="31" y="234" width="145" height="264" opacity=".65"/>}
      </g>
      <g className={s.rightTrees}>
        <use href={`#${id}-tree`} x="1170" y="387" width="250" height="440" transform="rotate(-6 1265 700)"/>
        {quality>=2&&<use href={`#${id}-cypress`} x="1115" y="348" width="68" height="363"/>}
        {quality>=4&&<use href={`#${id}-cypress`} x="1249" y="318" width="64" height="293"/>}
      </g>
    </g>
    {quality>=3&&<g className={s.flowers}>{Array.from({length:detail[quality]},(_,i)=>{const x=i%2?1140+noise(i+119)*130:89+noise(i+191)*174,y=785+noise(i+18)*128;return <g key={i} transform={`translate(${x} ${y}) rotate(${noise(i+218)*30-15})`}><path d="M0 23Q-8 7 1-18" fill="none" stroke="#526c46" strokeWidth="1.2"/><use href={`#${id}-leaf`} x="-16" y="-2" width="19" height="29" transform="rotate(-35)"/><use href={`#${id}-flower`} x="-12" y="-27" width="24" height="28"/></g>;})}</g>}
    {quality>=4&&<g className={s.flyingBirds}>{[0,1,2,3,4].map(i=><use key={i} href={`#${id}-bird`} x={951+i*50} y={201+Math.sin(i)*21} width={27-i*2} height="15"/>)}</g>}
    {quality>=5&&<g fill="#e7d9a9" opacity=".25">{Array.from({length:120},(_,i)=><circle key={i} cx={80+noise(i+912)*1240} cy={80+noise(i+771)*827} r={noise(i+522)*1.3+.3}/>)}</g>}
    <rect x="65" y="65" width="1270" height="869" fill={`url(#${id}-fibre)`} pointerEvents="none"/>
  </g>;
}

function PortraitGarden({ id, quality, scene, progress }: { id: string; quality: number; scene: BloomSceneKind; progress: number }) {
  const music=musicScenes.includes(scene)||scene==="artist"||scene==="artists";
  return <g>
    <rect x="20" y="20" width="390" height="960" fill={`url(#${id}-paper)`}/>
    <path d="M20 20H410V215Q264 179 20 230Z" fill={`url(#${id}-sky)`}/>
    <g opacity={.79-progress*.6}><use href={`#${id}-cloudform`} x="25" y="29" width="301" height="101"/>{quality>=3&&<use href={`#${id}-cloudform`} x="218" y="26" width="202" height="80"/>}</g>
    <path d="M20 177Q100 139 175 183Q290 150 410 195V247H20Z" fill="#91a174" opacity={music?.38:.75}/>
    <path d="M20 887Q165 862 410 897V978H20Z" fill="#80956d" opacity=".6"/>
    <path d="M20 233 63 194H367L410 233Z" fill="#e7d4b0" stroke="#ba9f73" strokeWidth="1.2" opacity={music?1:.44}/>
    {music&&<><path d="M29 235H401M38 248H392" stroke="#ac9164" strokeWidth=".9"/><path d="M39 255V909M391 255V909" stroke="#c8b38c" strokeWidth="8"/><path d="M40 255V909M390 255V909" stroke="#af9367" strokeWidth=".9"/><path d="M48 308Q80 259 121 282Q147 254 170 282Q194 254 215 281Q238 254 263 282Q285 254 313 282Q352 258 383 310" stroke="#bca379" fill="none" strokeWidth="1.3"/></>}
    <g className={s.portraitTrees}><use href={`#${id}-tree`} x="-101" y="360" width="146" height="480"/><use href={`#${id}-tree`} x="385" y="483" width="146" height="425"/>{quality>=3&&<use href={`#${id}-cypress`} x="384" y="221" width="27" height="203"/>}</g>
    <path d="M83 922H340L392 978H36Z" fill="#91aca0" stroke="#81977c" strokeWidth="1"/>
    {quality>=2&&[0,1,2,3].slice(0,quality-1).map(i=><use key={i} href={`#${id}-lotus`} x={93+i*65} y={933+(i%2)*15} width="35" height="30"/>)}
    {quality>=4&&<g className={s.flowers}>{Array.from({length:quality*2},(_,i)=><use key={i} href={`#${id}-flower`} x={i%2?385:23} y={794+(i%5)*28} width="22" height="25"/>)}</g>}
    <rect x="20" y="20" width="390" height="960" fill={`url(#${id}-fibre)`}/>
  </g>;
}

/** Fixed Latin display letters are painted paths; names and facts stay in children. */
function PaintedTitle({ id, quality }: { id: string; quality: number }) {
  return <svg className={s.paintedTitle} viewBox="0 0 620 185" aria-hidden="true">
    <path d="M44 132Q142 146 246 136T447 137Q492 144 544 131" fill="none" stroke="#b49b60" strokeWidth="1.4"/>
    <g fill="none" stroke="var(--title-ink)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
      <path d="M59 34Q54 71 55 121M59 85Q76 56 98 78Q113 109 83 121Q66 126 56 105"/>
      <path d="M143 31Q128 85 140 123Q147 128 157 119"/>
      <path d="M207 70Q179 68 178 98Q177 128 206 125Q234 126 235 95Q235 69 207 70Z"/>
      <path d="M286 72Q259 68 257 99Q256 127 285 125Q313 126 312 97Q312 70 286 72Z"/>
      <path d="M337 79 336 122M339 87Q354 65 370 79Q379 88 376 122M378 87Q394 62 410 80Q419 88 416 122"/>
    </g>
    {quality>=3&&<g fill="none" stroke="#dfb77d" strokeWidth="1.2" opacity=".7"><path d="M55 35 52 116M141 35Q132 87 140 118M197 75Q182 82 185 109M278 75Q264 82 264 110M340 82V117M381 82 381 115"/></g>}
    <path d="M427 127Q463 92 465 57Q471 36 495 29M452 105Q478 105 496 78M464 64Q445 51 450 34M482 36 493 19" stroke="#6e8052" strokeWidth="2.2" fill="none"/>
    <use href={`#${id}-leaf`} x="458" y="23" width="23" height="37" transform="rotate(-39 469 42)"/>
    <use href={`#${id}-leaf`} x="481" y="71" width="27" height="43" transform="rotate(51 494 92)"/>
    <use href={`#${id}-flower`} x="479" y="5" width="39" height="44"/>
    {quality>=4&&<use href={`#${id}-fruit`} x="497" y="61" width="28" height="37"/>}
  </svg>;
}

export default function IndiaWorld({ scene, stage, progress, quality, reducedMotion, view, theme, children }: BloomWorldProps) {
  const id=`miniature-${useId().replace(/:/g,"")}`;
  const dawn=Math.max(0,Math.min(1,progress)),cover=view==="cover",still=reducedMotion||quality===1||view==="poster";
  const music=musicScenes.includes(scene),opening=scene==="opening",artist=scene==="artist"||scene==="artists";
  const style={"--dawn":dawn,"--sky":dawn>.66?"#a8aea0":"#5f7272","--sky-low":dawn>.66?"#dbc99f":"#9ba48a","--rose":dawn>.66?"#d79695":"#c57f83"} as CSSProperties;
  return <div className={s.world} data-theme={theme} data-scene={scene} data-stage={stage} data-view={view} data-quality={quality} data-motion={still?"still":"full"} data-music={music} data-artist={artist} data-opening={opening} style={style}>
    <svg className={s.landscapeArt} viewBox="0 0 1400 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><Definitions id={id} quality={quality}/><Garden id={id} quality={quality} progress={dawn} scene={scene} cover={cover}/><FloralBorder id={id} quality={quality}/></svg>
    <svg className={s.portraitArt} viewBox="0 0 430 1000" preserveAspectRatio="none" aria-hidden="true"><PortraitGarden id={id} quality={quality} scene={scene} progress={dawn}/><FloralBorder id={id} quality={quality} portrait/></svg>
    <div className={s.dawnLight} aria-hidden="true"/>
    {(opening||cover||view==="poster")&&<div className={s.titleObject}><PaintedTitle id={id} quality={quality}/><span>MONSOON MINIATURE</span><i>A GARDEN PAINTED FROM MUSIC</i></div>}
    {!cover&&<div className={s.content}>{children}</div>}
    {cover&&children&&<div className={s.coverContent}>{children}</div>}
    {!still&&quality>=2&&<div key={`${scene}-${stage}`} className={s.entrance} aria-hidden="true"><i/><i/></div>}
    {!still&&quality>=3&&!["songs","song-winner","artist","artist-songs","artists","finale"].includes(scene)&&<div className={s.rain} aria-hidden="true">{Array.from({length:quality>=5?19:quality>=4?12:7},(_,i)=><i key={i} style={{"--rain-x":`${7+noise(i+18)*84}%`,"--rain-y":`${12+noise(i+77)*16}%`,"--rain-delay":`${noise(i+53)*1.9}s`} as CSSProperties}/>)}</div>}
    {quality>=5&&!still&&<div className={s.pigmentMotes} aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} style={{left:`${8+noise(i+81)*84}%`,top:`${29+noise(i+82)*58}%`,animationDelay:`${noise(i+67)*2}s`} as CSSProperties}/>)}</div>}
    {!cover&&scene!=="opening"&&<span className={s.folioNumber} aria-hidden="true">{String(Math.max(1,stage)).padStart(2,"0")} · THE GARDEN FOLIO</span>}
  </div>;
}
