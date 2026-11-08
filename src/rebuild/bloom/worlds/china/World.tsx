"use client";

import { useId, type CSSProperties } from "react";
import { BloomLettering } from "../Lettering";
import type { BloomQuality, BloomSceneKind, BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin } from "../stableTrig";
import s from "./world.module.css";

// Prepared ink marks, rather than a live ink simulation. Detail changes the
// geometry as well as the moving groups; the paper clearing belongs to music.
const detail = {
  1: { ridges: 5, stipples: 9, pineNeedles: 4, reeds: 7, water: 5, birds: 0, mist: 0, washes: 0, flecks: 0 },
  2: { ridges: 9, stipples: 18, pineNeedles: 7, reeds: 12, water: 9, birds: 2, mist: 2, washes: 3, flecks: 0 },
  3: { ridges: 14, stipples: 32, pineNeedles: 11, reeds: 22, water: 15, birds: 3, mist: 3, washes: 6, flecks: 6 },
  4: { ridges: 21, stipples: 49, pineNeedles: 16, reeds: 34, water: 23, birds: 5, mist: 4, washes: 10, flecks: 12 },
  5: { ridges: 32, stipples: 78, pineNeedles: 23, reeds: 52, water: 34, birds: 8, mist: 6, washes: 16, flecks: 22 },
} as const;
type Detail = typeof detail[BloomQuality];
type Shot = "invitation" | "bank" | "water" | "gallery" | "solitude" | "grove" | "panorama";

const shots: Record<BloomSceneKind, Shot> = {
  opening: "invitation", time: "bank", comparison: "water", days: "water", breadth: "bank",
  songs: "gallery", "song-winner": "solitude", artist: "grove", "artist-songs": "gallery",
  artists: "grove", discoveries: "gallery", returns: "bank", genres: "water", pattern: "grove", finale: "panorama",
};
const grain = (n: number) => ((stableSin(n * 12.731 + 71.23) * 43758.547) % 1 + 1) % 1;
const pineCrowns = [[95, 25, 45, 18], [63, 59, 53, 19], [122, 82, 56, 20], [48, 109, 48, 18], [105, 142, 70, 23], [153, 178, 41, 15]] as const;
const mountainShape="M0 478Q29 404 68 361L79 289Q85 270 110 248L135 182 161 160Q179 119 196 59L216 44 240 0 262 23 283 31Q290 51 306 89L329 126 331 157Q342 175 371 205L381 261Q384 285 411 319Q460 380 482 478Z";

function InkTitle() {
  return <svg viewBox="0 0 630 215" className={s.inkTitle} aria-hidden="true">
    <g className={s.titleLetters} fill="var(--ink-title)">
      <path d="M32 31 53 26 49 112Q65 82 96 95Q126 104 115 146Q110 187 75 190Q51 190 37 180L23 186Q32 123 32 31ZM50 137Q49 174 77 174Q98 165 95 139Q92 105 74 110Q57 111 50 137Z"/>
      <path d="M144 30 164 19 158 147Q155 173 169 175L165 187Q135 196 137 154L144 30Z"/>
      <path d="M224 95Q254 93 269 119Q287 163 253 183Q226 201 203 181Q185 165 191 129Q198 102 224 95ZM224 111Q209 116 210 142Q210 178 233 177Q254 172 252 143Q250 110 224 111Z"/>
      <path d="M324 89Q355 92 369 117Q385 153 355 181Q332 196 306 181Q288 169 290 138Q292 101 324 89ZM327 106Q309 108 308 139Q307 171 331 173Q353 167 352 137Q348 107 327 106Z"/>
      <path d="M391 108 410 99 409 121Q429 88 451 104Q462 108 467 126Q486 92 512 107Q535 116 531 151L529 180 509 183 513 145Q515 119 500 121Q483 124 478 149L475 187 456 188 458 143Q460 117 445 118Q424 120 413 151L410 188 390 192 394 136Z"/>
      <path d="M521 190Q556 187 578 176Q593 163 605 161L609 163Q573 207 500 208Q405 216 276 208Q415 211 521 190Z" opacity=".78"/>
    </g>
    <g fill="var(--ink-paper)" opacity=".58">
      <path d="M42 42 40 87 43 72ZM42 139 43 166 45 151ZM151 36 147 120 149 70ZM218 103 207 122 208 118ZM244 173 234 180 246 178ZM314 100 305 119 308 115ZM359 137 362 153 363 143ZM401 118 400 154 403 132ZM466 150 465 171 468 160ZM522 122 525 151 526 140Z"/>
      <path d="M63 181 81 180 68 183ZM138 166 141 184 144 181ZM195 143 197 158 199 155ZM334 95 348 107 348 103ZM504 188 566 183 530 188Z"/>
    </g>
    <g className={s.titleAccent} fill="var(--ink-cinnabar)"><path d="M573 60 596 58 598 85 576 87Z"/><path d="M578 64 591 63 592 79 580 80Z" fill="none" stroke="var(--ink-paper)" strokeWidth="1"/><path d="M583 68h6m-6 6h6" fill="none" stroke="var(--ink-paper)" strokeWidth="1.5"/></g>
  </svg>;
}

function Definitions({ id, tier }: { id: string; tier: Detail }) {
  return <defs>
    <clipPath id={`${id}-paper`}><path d="M80 62H1360V839H80Z"/></clipPath>
    <linearGradient id={`${id}-silk`} x2="1" y2="0"><stop stopColor="var(--ink-silk-deep)"/><stop offset=".25" stopColor="var(--ink-silk)"/><stop offset=".8" stopColor="var(--ink-silk)"/><stop offset="1" stopColor="var(--ink-silk-deep)"/></linearGradient>
    <linearGradient id={`${id}-roller`} x2="1" y2="0"><stop stopColor="#443e31"/><stop offset=".23" stopColor="#8b7956"/><stop offset=".43" stopColor="#ae956b"/><stop offset=".74" stopColor="#65583f"/><stop offset="1" stopColor="#342f26"/></linearGradient>
    <linearGradient id={`${id}-mountain`} x2=".55" y2="1"><stop stopColor="var(--ink-mountain)" stopOpacity=".8"/><stop offset=".55" stopColor="var(--ink-mineral)" stopOpacity=".5"/><stop offset="1" stopColor="var(--ink-paper)" stopOpacity=".08"/></linearGradient>
    <linearGradient id={`${id}-bank`} x2=".2" y2="1"><stop stopColor="var(--ink-mineral)"/><stop offset="1" stopColor="var(--ink-mountain)"/></linearGradient>
    <linearGradient id={`${id}-wash`} x2=".5" y2="1"><stop stopColor="var(--ink-ink)" stopOpacity=".24"/><stop offset="1" stopColor="var(--ink-ink)" stopOpacity="0"/></linearGradient>
    <pattern id={`${id}-fibres`} width="83" height="67" patternUnits="userSpaceOnUse"><path d="M8 9h9m36 7 6 1M19 38l6-2m39 19 7 1M2 58h3" fill="none" stroke="var(--ink-ink)" strokeWidth=".5" opacity=".12"/><circle cx="45" cy="41" r=".75" fill="var(--ink-ink)" opacity=".1"/></pattern>
    <pattern id={`${id}-brocade`} width="28" height="28" patternUnits="userSpaceOnUse"><path d="M14 4Q20 14 14 24Q8 14 14 4ZM0 14h6m16 0h6" fill="none" stroke="#d8c390" strokeWidth=".6" opacity=".35"/></pattern>
    <symbol id={`${id}-pine`} viewBox="0 0 210 340">
      <path d="M94 332Q123 250 99 195Q87 155 93 116Q105 64 94 24L103 17Q122 74 109 123Q103 165 120 203Q147 257 113 334Z" fill="var(--ink-trunk)"/>
      <path d="M108 312Q122 257 102 213L44 115 50 110 107 181Q93 129 116 89L146 77 149 83 123 100Q112 132 113 166L165 173 169 180 117 177Q124 211 129 235" fill="var(--ink-trunk)"/>
      <path d="M102 257Q148 235 170 210L178 210Q160 243 122 271M102 185 59 144 26 138 26 130 66 134 107 163" fill="var(--ink-trunk)"/>
      <path d="M103 320Q125 264 103 209Q92 172 100 124Q113 66 99 34M114 173 160 177M54 119 103 184M121 254 164 226" fill="none" stroke="var(--ink-paper)" strokeWidth="1.5" opacity=".55"/>
      {pineCrowns.map(([cx, cy, rx, ry], i) => <g key={i}>
        <path d={`M${cx-rx} ${cy+6}Q${cx-rx-6} ${cy-ry/2} ${cx-rx/2} ${cy-ry/2}Q${cx-rx/2} ${cy-ry-8} ${cx+2} ${cy-ry}Q${cx+rx/2} ${cy-ry-7} ${cx+rx/2} ${cy-ry/2}Q${cx+rx+11} ${cy-ry/3} ${cx+rx} ${cy+6}Q${cx+rx/2} ${cy+ry/2} ${cx} ${cy+ry/3}Q${cx-rx/2} ${cy+ry/2} ${cx-rx} ${cy+6}Z`} fill="var(--ink-pine)" opacity={.82-i*.035}/>
        {Array.from({ length: tier.pineNeedles }, (_, n) => {
          const x = cx-rx+grain(n*19+i*31)*rx*2, y=cy+grain(n*11+i*17)*ry*.7;
          return <path key={n} d={`M${x} ${y}l-7 -${4+grain(n)*7}m7 ${4+grain(n)*7}l-2 -${9+grain(n*7)*6}m2 ${9+grain(n*7)*6}l6 -8m-6 8 9-3`} fill="none" stroke={n%3===0?"var(--ink-paper)":"var(--ink-ink)"} strokeWidth={n%3===0?.5:.75} opacity={n%3===0?.26:.52}/>;
        })}
        <path d={`M${cx-rx+6} ${cy+5}q${rx/2} -5 ${rx-11} -3m-${rx/3} 5 23-2`} fill="none" stroke="var(--ink-ink)" strokeWidth="1.5" opacity=".48"/>
      </g>)}
      {tier.ridges>10&&Array.from({length:10},(_,n)=><path key={n} d={`M${103+grain(n)*9} ${310-n*14}q3 -7 0 -12m-1 1-2-4`} fill="none" stroke="var(--ink-ink)" strokeWidth=".8" opacity=".38"/>)}
      {tier.ridges>18&&<g stroke="var(--ink-paper)" strokeWidth=".75" fill="none" opacity=".28"><path d="M99 253q-4 13-2 29m3-52q-4 9-1 18M91 134q-3 15 1 24M60 140l16 10m49 87 19-8M117 65q-3 15-7 27"/><path d="M106 287q5-11 2-22m-7-60-4-15m20-10 20-1M141 246l16-9"/></g>}
    </symbol>
    <symbol id={`${id}-boat`} viewBox="0 0 145 62"><path d="M8 38Q61 47 136 31Q119 54 62 52Q25 49 8 38Z" fill="var(--ink-trunk)"/><path d="M32 39Q39 22 55 20H87Q102 19 113 37Z" fill="var(--ink-paper)" stroke="var(--ink-ink)" strokeWidth="1.1"/><path d="M41 35Q48 22 57 23h29q10 0 19 13M36 39l79-2M9 42 7 58m-1-2 133-5" stroke="var(--ink-ink)" fill="none" strokeWidth="1"/><path d="M24 36V24l8-13m-8 14 15-1M20 33 36 57" stroke="var(--ink-ink)" fill="none" strokeWidth="2"/><circle cx="32" cy="14" r="3" fill="var(--ink-ink)"/><path d="M31 12l-7 2h14Z" fill="var(--ink-trunk)"/></symbol>
    <symbol id={`${id}-pavilion`} viewBox="0 0 230 170"><path d="M29 87 199 87v62H29Z" fill="var(--ink-paper)"/><path d="M10 86Q42 79 58 61L79 36Q111 44 152 36L174 60Q190 79 220 85L211 92 20 94Z" fill="var(--ink-trunk)"/><path d="M28 83Q75 68 111 59Q153 69 201 84M52 83q61-9 120-1M91 40l20 20 23-20" fill="none" stroke="var(--ink-paper)" strokeWidth="1.4" opacity=".56"/><path d="M41 94v51m38-52v51m36-52v53m37-53v53m32-51v50" stroke="var(--ink-trunk)" strokeWidth="5"/><path d="M43 118h139M44 130h136m-121-20v32m40-32v32m37-32v32m27-32v32" stroke="var(--ink-mountain)" strokeWidth="1"/><path d="M17 148h192l13 11H7Z" fill="var(--ink-mineral)"/><path d="M44 150 60 154m18-4 22 4m20-4 17 4m20-4 21 4" stroke="var(--ink-paper)" strokeWidth=".8"/></symbol>
    <symbol id={`${id}-rock`} viewBox="0 0 130 65"><path d="M0 49 19 27 34 22 50 0 81 6 104 27 115 31 130 54 105 63 20 63Z" fill="var(--ink-rock)"/><path d="M8 49 34 31 51 8 75 16 88 43 118 51M20 52 38 47 59 20M47 56 75 41 104 37M89 57l-12-14M18 58l13-6" fill="none" stroke="var(--ink-ink)" strokeWidth="1.6" opacity=".58"/><path d="M50 5 63 15 56 28 35 34Z" fill="var(--ink-paper)" opacity=".3"/></symbol>
  </defs>;
}

function Mountain({ id, tier, x, y, scale=1, seed=0, light=false }: { id:string; tier:Detail; x:number; y:number; scale?:number; seed?:number; light?:boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} className={s.mountain} opacity={light?.42:.84}>
    <defs><clipPath id={`${id}-peak-${seed}`}><path d={mountainShape}/></clipPath></defs>
    <path d={mountainShape} fill={`url(#${id}-mountain)`}/>
    <g clipPath={`url(#${id}-peak-${seed})`}>
      <path d="M213 42Q199 94 194 119L215 155 198 210Q164 233 159 261L177 294Q150 326 116 401L161 449Q175 358 213 313L205 276 231 228Q225 188 237 148L223 120 237 64Z" fill="var(--ink-ink)" opacity=".09"/>
      <path d="M272 59 257 102 282 142Q272 183 296 219L288 268 319 308Q335 361 363 421L385 411Q365 336 349 281L335 236 341 193 303 152Q295 112 272 59Z" fill="var(--ink-mineral)" opacity=".36"/>
      {tier.ridges>10&&Array.from({length:Math.ceil(tier.ridges/2)},(_,n)=>{
        const yy=178+n*15,xx=156+(n%5)*12;
        return <path key={n} d={`M${xx} ${yy}q-9 12 -18 15m17-10q4 19-13 30m-3-4q3 16-10 29m8-14-13 6m29-19-9 8`} fill="none" stroke="var(--ink-ink)" strokeWidth=".9" opacity=".3"/>;
      })}
      {tier.ridges>10&&Array.from({length:Math.ceil(tier.ridges/3)},(_,n)=>{
        const yy=160+n*26,xx=274+n*8;
        return <path key={n} d={`M${xx} ${yy}q-4 14 7 25l-3 17m6-27q7 14 9 27m-18 1q-1 14 6 19m5-44q3 11 12 16`} fill="none" stroke="var(--ink-ink)" strokeWidth="1" opacity=".26"/>;
      })}
    </g>
    <path d="M17 457Q54 390 83 355L101 294 123 269 142 199 169 178 198 78 220 66 239 22 256 39 277 45 296 105 313 131 320 175 356 211 370 268 400 329Q440 376 463 454" fill="none" stroke="var(--ink-mountain)" strokeWidth="2" opacity=".58"/>
    <path d="M240 12 251 77 238 126 275 173 271 218 310 265 318 327 357 400M206 77 184 141 194 185 166 229 168 282 140 322 118 386M282 50 288 115 309 149 291 200M84 349 110 369 119 396M381 279 345 311 352 348" fill="none" stroke="var(--ink-ink)" strokeWidth="1.6" opacity=".54"/>
    <path d="M237 88 227 143 243 181 229 228 245 260 235 319 250 362 243 417 258 459" fill="none" stroke="var(--ink-paper)" strokeWidth="10" opacity=".78"/>
    <path d="M244 88 233 144 249 181 234 228 250 260 239 319 254 362 248 417" fill="none" stroke="var(--ink-paper)" strokeWidth="3" opacity=".9"/>
    {Array.from({length:tier.ridges},(_,n)=>{
      const side=n%2?1:-1,y=116+grain(n*11+seed)*291,x=246+side*(24+grain(n*29+seed)*84),length=22+grain(n*23+seed)*70;
      return <path key={n} d={`M${x} ${y}q${side*8} -${length*.2} ${side*21} -${length*.34}q${side*-3} ${length*.35} ${side*13} ${length*.65}m-${side*4} -${length*.4}q${side*17} ${length*.1} ${side*24} ${length*.3}`} fill="none" stroke="var(--ink-ink)" strokeWidth={.8+grain(n*13)*1.6} opacity={.18+grain(n*31)*.3} strokeLinecap="round"/>;
    })}
    {Array.from({length:tier.stipples},(_,n)=>{
      const y=137+grain(n*3+seed)*319,spread=70+(y/478)*140,x=240+(grain(n*19+seed)-.5)*spread;
      return <path key={n} d={`M${x} ${y}l${3+grain(n*7)*5} -${2+grain(n*31)*4}`} stroke="var(--ink-ink)" strokeWidth={1+grain(n*47)*1.3} opacity={.12+grain(n*5)*.2} strokeLinecap="round"/>;
    })}
    {[[154,236,.21],[292,208,.19],[90,381,.24],[327,365,.25]].map(([px,py,k],n)=><use key={n} href={`#${id}-pine`} x={px-k*100} y={py-k*325} width={k*210} height={k*340} opacity={.48+n*.08}/>)}
  </g>;
}

function ListeningLandscapeMarks({ id, quality, listening, portrait = false }: { id: string; quality: BloomQuality; listening?: BloomListeningProfile; portrait?: boolean }) {
  const landmarks = Math.min(quality + 1, Math.max(0, listening?.comparison?.sharedArtistCount ?? 0));
  const arrivals = Math.min(quality + 1, Math.max(0, listening?.discoveredArtistCount ?? 0));
  const returns = listening?.returningRecordingCount ?? 0;
  const returnShare = returns / Math.max(1, listening?.recordingCount ?? returns);
  const genres = listening?.genres?.filter(genre => genre.share > 0).slice(0, quality + 1) ?? [];
  const current = portrait ? "M37 911Q140 875 238 900Q360 925 443 881" : "M313 815Q460 781 591 818Q780 869 972 790";
  return <g className={s.listeningLandscape}>
    {genres.length > 0 && <g data-listening-motif="mineral-genre-washes" fill="none" strokeLinecap="round">
      {genres.map((genre, n) => <path key={genre.name} d={portrait ? `M${368 + n * 9} ${588 + n * 18}q-29 41-14 74` : `M${1167 + n * 19} ${441 + n * 26}q-40 69-18 113`} stroke={["#7d9a89", "#8c849c", "#ab9973", "#7d9da7", "#b0837c", "#a4a888"][n]} strokeWidth={portrait ? 5 + genre.share * 13 : 8 + genre.share * 23} opacity=".2"/>)}
    </g>}
    {landmarks > 0 && <g data-listening-motif="recurring-pavilions" data-motif-count={landmarks}>
      {Array.from({ length: landmarks }, (_, n) => <use key={n} href={`#${id}-pavilion`} x={portrait ? 259 + n * 31 : 1009 + n * 49} y={portrait ? 851 - n % 2 * 27 : 717 - n % 2 * 42} width={portrait ? 49 : 69} height={portrait ? 37 : 51} opacity={.58 + n % 2 * .13}/>)}
    </g>}
    {returns > 0 && <g data-listening-motif="retraced-current" fill="none" stroke="var(--ink-water)" strokeLinecap="round">
      <path d={current} strokeWidth={1 + Math.min(1, returnShare) * 3} opacity=".5"/>
      <path d={current} transform="translate(0 8)" strokeWidth=".8" opacity=".32"/>
    </g>}
    {arrivals > 0 && <g data-listening-motif="new-route-boats" data-motif-count={arrivals}>
      {Array.from({ length: arrivals }, (_, n) => <use key={n} href={`#${id}-boat`} x={portrait ? 98 + n * 39 : 384 + n * 87} y={portrait ? 932 - n % 2 * 25 : 847 - n % 2 * 33} width={portrait ? 37 : 49} height={portrait ? 16 : 21} opacity={.49 + n % 2 * .12}/>)}
    </g>}
  </g>;
}

function Landscape({ id, tier, shot, portrait=false, listening, quality }: { id:string; tier:Detail; shot:Shot; portrait?:boolean; listening?:BloomListeningProfile; quality:BloomQuality }) {
  const water=shot==="water",grove=shot==="grove",gallery=shot==="gallery"||shot==="solitude",panorama=shot==="panorama";
  if(portrait)return <g>
    <Mountain id={id} tier={tier} x={gallery?345:260} y={gallery?112:139} scale={gallery?.72:.85} seed={19} light={gallery}/>
    {panorama&&<Mountain id={id} tier={tier} x={-89} y={628} scale={.63} seed={73} light/>}
    <path d="M-20 770Q40 688 112 715Q172 760 240 730Q333 688 500 807L520 940H-20Z" fill="var(--ink-mineral)" opacity=".12"/>
    <path d="M-10 906Q29 820 97 851Q156 891 209 855Q317 789 510 913L510 970H-10Z" fill={`url(#${id}-bank)`} opacity=".34"/>
    <path d="M25 862Q138 906 246 857Q373 791 490 905M70 891q140 28 258-15M18 933Q231 902 467 943" fill="none" stroke="var(--ink-water)" strokeWidth="1" opacity=".47"/>
    {!gallery&&<use href={`#${id}-pine`} x={grove?-71:-69} y={grove?532:665} width={grove?239:215} height={grove?386:350} className={s.nearPine}/>}
    {panorama&&<use href={`#${id}-pavilion`} x="278" y="817" width="98" height="74" opacity=".68"/>}
    <use href={`#${id}-boat`} x={water?292:183} y="838" width="65" height="28" opacity=".73"/>
    {[[17,892,87,43],[395,913,81,41],[95,936,62,31]].map(([x,y,w,h],n)=><use key={n} href={`#${id}-rock`} x={x} y={y} width={w} height={h} opacity=".54"/>)}
    {Array.from({length:Math.ceil(tier.water/2)},(_,n)=><path key={n} d={`M${60+grain(n*19)*320} ${864+grain(n*5)*64}q${16+grain(n)*28} -4 ${34+grain(n*13)*31} -1`} stroke="var(--ink-water)" strokeWidth=".7" opacity=".2" fill="none"/>)}
    <ListeningLandscapeMarks id={id} quality={quality} listening={listening} portrait/>
  </g>;
  return <g>
    <g className={s.distantLand}>
      <path d="M38 633 68 569 102 544 131 477 157 494 192 573 221 591 270 662ZM909 529 935 456 974 414 995 348 1020 351 1054 278 1080 311 1108 377 1139 414 1165 524Z" fill="var(--ink-mineral)" opacity=".18"/>
      <path d="M715 638q79-133 169-120l80 33q84-100 148-60l108 172Z" fill="var(--ink-mineral)" opacity=".14"/>
    </g>
    <g className={s.mountainPassage}>
      {!water&&<Mountain id={id} tier={tier} x={grove?874:gallery?1194:840} y={grove?44:gallery?180:40} scale={grove?1.04:gallery?.72:1.14} seed={13} light={gallery}/>}
      {!water&&<Mountain id={id} tier={tier} x={gallery?1165:1094} y={gallery?487:315} scale={gallery?.65:.71} seed={47} light/>}
      {(water||panorama)&&<Mountain id={id} tier={tier} x={water?1014:791} y={water?481:401} scale={water?.45:.63} seed={31} light={water}/>}
      {panorama&&<Mountain id={id} tier={tier} x={49} y={471} scale={.67} seed={91} light/>}
    </g>
    <g className={s.riverBanks}>
      <path d="M0 635Q78 597 160 635Q231 665 303 671Q419 675 497 716Q387 706 318 718Q249 750 150 729Q42 710 0 747Z" fill={`url(#${id}-bank)`} opacity=".44"/>
      <path d="M891 656Q994 601 1081 630Q1191 642 1268 706Q1372 760 1440 736V904H875Q1001 856 1110 836Q1204 819 1179 778Q1140 736 1036 722Z" fill={`url(#${id}-bank)`} opacity=".46"/>
      <path d="M0 856Q105 818 209 847Q317 857 375 899H0Z" fill="var(--ink-mineral)" opacity=".56"/>
      <path d="M0 689Q156 727 260 705Q327 682 475 719M899 669Q1008 653 1115 704Q1188 729 1204 770Q1270 819 1434 808M872 894Q1000 828 1117 837Q1291 855 1417 819" fill="none" stroke="var(--ink-mountain)" strokeWidth="1.2" opacity=".6"/>
      <path d="M100 802Q293 757 381 789Q545 842 720 779Q874 723 1006 760M369 810Q512 881 696 812Q879 747 965 787M376 733Q525 712 666 735Q739 752 848 715" fill="none" stroke="var(--ink-water)" strokeWidth="1.1" opacity=".42"/>
      {Array.from({length:tier.water},(_,n)=>{
        const x=310+grain(n*17)*733,y=726+grain(n*43)*153;
        return <path key={n} d={`M${x} ${y}q${19+grain(n*11)*42} -${2+grain(n)*4} ${45+grain(n*7)*55} -${grain(n*3)*3}`} fill="none" stroke="var(--ink-water)" strokeWidth={n%4===0?1:.6} opacity={.17+grain(n*5)*.16}/>;
      })}
      {[[28,703,151,76],[211,710,94,47],[1122,720,115,58],[1300,775,138,69],[882,852,96,48],[87,834,116,58]].map(([x,y,w,h],n)=><use key={n} href={`#${id}-rock`} x={x} y={y} width={w} height={h} opacity={.44+(n%3)*.12}/>)}
      {Array.from({length:tier.reeds},(_,n)=>{
        const right=n%2===0,x=right?1120+grain(n*11)*270:30+grain(n*7)*232,y=right?814+grain(n*17)*64:683+grain(n*23)*32,h=12+grain(n*31)*27;
        return <path key={n} d={`M${x} ${y}q3 -${h*.7} ${h*.2} -${h}m-${h*.2} ${h}q-6 -${h*.7} -${h*.6} -${h*.86}m${h*.6} ${h*.86}q6 -${h*.3} ${h*.7} -${h*.48}`} fill="none" stroke="var(--ink-pine)" strokeWidth=".75" opacity=".49"/>;
      })}
    </g>
    <g className={s.pinePassage}>
      {!gallery&&<use href={`#${id}-pine`} x={grove?1087:37} y={grove?327:362} width={grove?328:241} height={grove?531:392} className={s.nearPine}/>}
      <use href={`#${id}-pine`} x="1304" y="585" width="99" height="160" opacity={gallery?.38:.78}/>
      {panorama&&<><use href={`#${id}-pine`} x="145" y="590" width="97" height="156" opacity=".76"/><use href={`#${id}-pine`} x="1205" y="577" width="117" height="190" opacity=".86"/></>}
      {tier.ridges>10&&<use href={`#${id}-pine`} x="1113" y="606" width="56" height="92" opacity=".44"/>}
    </g>
    {(grove||panorama)&&<use href={`#${id}-pavilion`} x={grove?1047:934} y={grove?654:657} width="168" height="124" className={s.pavilion}/>}
    <use href={`#${id}-boat`} x={water?861:625} y={water?700:776} width={water?98:76} height={water?42:33} className={s.boat}/>
    {tier.birds>0&&<g className={s.cranes} fill="none" stroke="var(--ink-ink)" strokeWidth="1.4" strokeLinecap="round" opacity=".59">{Array.from({length:tier.birds},(_,n)=><path key={n} d={`M${932+n*24} ${water?393+n*9:217+n*10}q8 -${7+n%3*3} 15 1q7 -11 17 -7`} className={s.crane} style={{"--arrival":`${n*.13}s`} as CSSProperties}/>)}</g>}
    <ListeningLandscapeMarks id={id} quality={quality} listening={listening}/>
  </g>;
}

function ScrollMount({ id }: { id:string }) {
  return <g className={s.mount}>
    <path d="M31 31H1409V868H31Z" fill={`url(#${id}-silk)`}/>
    <path d="M31 31H1409V868H31Z" fill={`url(#${id}-brocade)`}/>
    <path d="M80 62H1360V839H80Z" fill="var(--ink-paper)"/>
    <path d="M80 62H1360V839H80Z" fill={`url(#${id}-fibres)`}/>
    <path d="M79 61H1361V840H79Z" fill="none" stroke="var(--ink-trunk)" strokeWidth="1" opacity=".5"/>
    <path d="M69 59V842M1371 59V842" stroke="#e9d7a5" opacity=".44" strokeWidth="2"/>
    <path d="M21 13H52V887H21ZM1388 13H1419V887H1388Z" fill={`url(#${id}-roller)`}/>
    <path d="M20 16H54V36H20ZM1386 16H1421V36H1386ZM20 865H54V884H20ZM1386 865H1421V884H1386Z" fill="#34382e"/>
    <path d="M23 22H51M1389 22H1417M23 878H51M1389 878H1417" stroke="#a99972" strokeWidth="2" opacity=".62"/>
  </g>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, listening, children }: BloomWorldProps) {
  const id=`ink-${useId().replace(/[^a-zA-Z0-9]/g,"")}`;
  const shot=shots[scene],tier=detail[quality],opening=scene==="opening"||view==="cover",still=reducedMotion||quality===1||view!=="story";
  const growth=Math.min(1,Math.max(0,progress)),hour=listening?.peakHour,style={"--ink-dawn":`${hour == null ? growth*.22 : .03 + Math.max(0, stableSin((hour - 6) / 12 * Math.PI)) * .19}`,"--ink-growth":`${.85+growth*.15}`} as CSSProperties;
  return <div className={s.world} data-scene={scene} data-shot={shot} data-quality={quality} data-motion={still?"still":"full"} data-opening={opening} data-view={view} data-theme={theme} style={style}>
    {view!=="poster"&&<svg className={s.definitions} aria-hidden="true"><Definitions id={id} tier={tier}/></svg>}
    <svg className={s.scrollArt} viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
      <ScrollMount id={id}/>
      <g clipPath={`url(#${id}-paper)`}><g className={s.paintedWorld} key={`${shot}-${stage}`}><Landscape id={id} tier={tier} shot={shot} quality={quality} listening={listening}/></g></g>
      <path d="M1261 117h34v46h-34Z" fill="var(--ink-cinnabar)" opacity=".55"/><path d="M1266 122h24v35h-24Z" fill="none" stroke="var(--ink-paper)" strokeWidth="1" opacity=".6"/>
      <path d="M1271 129h14m-14 8h14m-14 9h14" stroke="var(--ink-paper)" strokeWidth="1.5" opacity=".58"/>
    </svg>
    <svg className={s.portraitArt} viewBox="0 0 480 960" preserveAspectRatio="none" aria-hidden="true">{view==="poster"&&<Definitions id={id} tier={tier}/>}<path d="M0 0H480V960H0Z" fill="var(--ink-paper)"/><path d="M0 0H480V960H0Z" fill={`url(#${id}-fibres)`}/><path d="M0 0H19V960H0ZM461 0H480V960H461Z" fill={view==="poster"?"var(--ink-silk)":`url(#${id}-silk)`}/><path d="M0 0H19V960H0ZM461 0H480V960H461Z" fill={`url(#${id}-brocade)`}/><path d="M17 0V960M463 0V960" stroke="var(--ink-trunk)" strokeWidth=".7" opacity=".44"/><g className={s.paintedWorld} key={`portrait-${shot}-${stage}`}><Landscape id={id} tier={tier} shot={shot} portrait quality={quality} listening={listening}/></g></svg>
    <div className={s.dawnLight} aria-hidden="true"/>
    {(opening||view==="poster")&&<div className={s.titleArtwork} aria-hidden="true"><InkTitle/><BloomLettering className={s.subtitle} text="RIVER OF INK" style="brush"/><div className={s.titleRule}/></div>}
    <div className={s.content}>{children}</div>
    {tier.washes>0&&!still&&<div className={s.inkWashes} key={`washes-${scene}-${stage}`} aria-hidden="true">{Array.from({length:tier.washes},(_,n)=><svg key={n} viewBox="0 0 210 95" style={{left:`${n%2?78+grain(n)*14:4+grain(n)*12}%`,top:`${14+grain(n*7)*64}%`,width:`${70+grain(n*3)*94}px`,"--arrival":`${n*.075}s`,"--tilt":`${grain(n*17)*24-12}deg`} as CSSProperties}><path d="M0 66Q17 52 44 35L65 29 79 8 92 17 112 9 149 41 184 47 210 67Q165 77 149 70L106 86 43 78Z" fill="var(--ink-mountain)" opacity=".12"/></svg>)}</div>}
    {tier.mist>0&&<div className={s.mistPassage} key={`mist-${scene}-${stage}`} aria-hidden="true">{Array.from({length:tier.mist},(_,n)=><svg key={n} viewBox="0 0 700 95" style={{left:`${n%2?57:-3}%`,top:`${32+n*8}%`,width:`${39+grain(n)*17}%`,"--arrival":`${n*.11}s`,"--drift":`${n%2?19:-19}px`} as CSSProperties}><path d="M0 73Q112 60 143 48Q212 24 291 39Q384 57 450 31Q514 12 597 38Q651 57 700 64Q597 76 506 61Q427 55 342 79Q219 104 107 80Z" fill="var(--ink-paper)" opacity=".76"/></svg>)}</div>}
    {tier.flecks>0&&<div className={s.paperFlecks} key={`flecks-${scene}-${stage}`} aria-hidden="true">{Array.from({length:tier.flecks},(_,n)=><i key={n} style={{left:`${n%2?81+grain(n*13)*12:7+grain(n*19)*9}%`,top:`${22+grain(n*5)*51}%`,"--arrival":`${.5+n*.09}s`,"--fall":`${11+grain(n*29)*12}px`} as CSSProperties}/>)}</div>}
  </div>;
}
