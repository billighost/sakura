"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";

import { useId, type CSSProperties } from "react";
import { BloomLettering } from "../Lettering";
import type { BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin as sine, stableCos as cosine } from "../stableTrig";
import s from "./world.module.css";

const ornament = "M0 0C-18-25-34-20-25-6C-19 3-9 4 0 0C18-25 34-20 25-6C19 3 9 4 0 0M0 0C-12 20-5 35 0 25C5 35 12 20 0 0";

function Fan({ x, y, size = 1, detail = 8 }: { x: number; y: number; size?: number; detail?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`} fill="none" stroke="currentColor">
    <path d="M-83 0A83 83 0 0 1 83 0M-64 0A64 64 0 0 1 64 0M-42 0A42 42 0 0 1 42 0M-83 0H83M-90 8H90" strokeWidth="1.2" />
    {Array.from({ length: detail + 1 }, (_, i) => {
      const angle = Math.PI + Math.PI * i / detail;
      return <path key={i} d={`M${cosine(angle) * 12} ${sine(angle) * 12}L${cosine(angle) * 82} ${sine(angle) * 82}`} strokeWidth=".65" />;
    })}
    <path d="M-9 0 0-15 9 0 0 8Z" fill="currentColor" fillOpacity=".5" />
  </g>;
}

function Architecture({ id, quality, growth }: { id: string; quality: BloomWorldProps["quality"]; growth: number }) {
  const flutes = 4 + quality * 2;
  return <svg className={s.architecture} viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-room`} x2="0" y2="1"><stop stopColor="#2e1733" /><stop offset=".6" stopColor="#130d21" /><stop offset="1" stopColor="#382239" /></linearGradient>
      <linearGradient id={`${id}-arch`} x2="1" y2="1"><stop stopColor="#8e5e67" /><stop offset=".42" stopColor="#e8c79c" /><stop offset=".7" stopColor="#775063" /><stop offset="1" stopColor="#dbaa89" /></linearGradient>
      <linearGradient id={`${id}-mirror`} x2="1" y2="1"><stop stopColor="#17162d" /><stop offset=".45" stopColor="#314056" /><stop offset=".52" stopColor="#897794" /><stop offset=".57" stopColor="#332139" /><stop offset="1" stopColor="#0e0c1d" /></linearGradient>
      <linearGradient id={`${id}-dawn`} x2="0" y2="1"><stop stopColor="#d48b9d" /><stop offset=".55" stopColor="#f0bc99" /><stop offset="1" stopColor="#f7dcae" /></linearGradient>
      <linearGradient id={`${id}-floor`} x2="0" y2="1"><stop stopColor="#452b48" /><stop offset="1" stopColor="#180f21" /></linearGradient>
      <radialGradient id={`${id}-stage`}><stop stopColor="#6c365c" /><stop offset="1" stopColor="#211225" /></radialGradient>
      <pattern id={`${id}-paper`} width="44" height="44" patternUnits="userSpaceOnUse"><path d="M0 8H44M0 30H44" stroke="#fff4d0" strokeOpacity=".035" /><circle cx="13" cy="14" r=".6" fill="#edd8b9" fillOpacity=".13" /><circle cx="35" cy="39" r=".7" fill="#edd8b9" fillOpacity=".1" /></pattern>
    </defs>
    <path fill={`url(#${id}-room)`} d="M0 0H1440V1000H0Z" />
    <path d="M0 0 720 98 1440 0M0 162 720 98 1440 162M0 295 720 98 1440 295" fill="none" stroke="#a97d85" strokeWidth="1" opacity=".2" />
    <path d="M296 803V384C296 102 1144 102 1144 384V803Z" fill="#24132d" stroke={`url(#${id}-arch)`} strokeWidth="3" />
    <path d="M319 792V390C319 135 1121 135 1121 390V792" fill="none" stroke="#c39586" strokeWidth="1" opacity=".7" />
    <path d="M350 796V406C350 190 1090 190 1090 406V796" fill={`url(#${id}-stage)`} stroke="#97617b" strokeWidth="1.5" />
    <path className={s.dawnWindow} d="M504 744V460C504 246 936 246 936 460V744Z" fill={`url(#${id}-dawn)`} />
    <g className={s.innerDoors} stroke="#7b4b61" fill="#301832"><path d="M516 755V460C516 280 711 294 711 294V755Z" /><path d="M924 755V460C924 280 729 294 729 294V755Z" /><path d="M720 298V754" stroke="#e2b794" strokeWidth="2" /></g>
    <g fill="none" stroke="#c19887" opacity=".7">
      {Array.from({ length: 8 + quality * 3 }, (_, i) => {
        const a = Math.PI + Math.PI * i / (7 + quality * 3);
        return <path key={i} d={`M${720 + cosine(a) * 354} ${390 + sine(a) * 181}L${720 + cosine(a) * 422} ${390 + sine(a) * 249}`} strokeWidth={i % 3 === 0 ? "2" : ".8"} />;
      })}
    </g>
    {[76, 236, 1144, 1304].map((x, i) => <g key={x}>
      <path d={`M${x} 208H${x + 62}V820H${x}Z`} fill={i % 2 ? "#35203a" : "#3f263c"} stroke="#b58a79" strokeWidth="1.2" />
      <path d={`M${x - 10} 208V190H${x + 72}V208M${x - 13} 820V839H${x + 75}V820`} fill="#50304c" stroke="#d1a285" />
      {Array.from({ length: flutes }, (_, j) => <path key={j} d={`M${x + 7 + j * 48 / flutes} 233V798`} stroke={j % 2 ? "#83506a" : "#c19286"} strokeWidth=".7" opacity=".5" />)}
      <Fan x={x + 31} y={188} size={.47} detail={quality * 3 + 4} />
      {quality >= 3 && <g transform={`translate(${x + 31} 370)`} fill="none" stroke="#d5a784" strokeWidth=".8" opacity=".65"><path d="M0 0V213M-12 14 0 0 12 14 0 28ZM-12 192 0 178 12 192 0 206Z" /><path d={ornament} transform="translate(0 94) scale(.65)" /></g>}
    </g>)}
    {[154, 1210].map((x, i) => <g key={x}>
      <path d={`M${x} 736V353Q${x + 39} 282 ${x + 78} 353V736Z`} fill={`url(#${id}-mirror)`} stroke="#c5a18a" strokeWidth="2" />
      <path d={`M${x + 7} 728V360Q${x + 39} 300 ${x + 71} 360V728Z`} fill="none" stroke="#d1a992" opacity=".5" />
      <path d={`M${x + 11} 665  ${x + 65} 490M${x + 9} 620 ${x + 68} 431`} stroke="#e0d2d2" strokeWidth="10" opacity=".08" />
      {quality >= 2 && <Fan x={x + 39} y={459} size={.35} detail={9} />}
      {quality >= 4 && <g transform={`translate(${x + 39} 615) scale(.7)`} fill="none" stroke="#d5b39a" opacity=".4"><path d="M0 74C-10 44-14 5 7-24M-7 45C-44 7-40-17-20-9M1 13C34-16 47-10 26 12M3-9C-25-42-20-58-6-34" /><path d={ornament} transform={`translate(${i ? 8 : -9} -27) scale(.55)`} /></g>}
    </g>)}
    <g stroke="#c89d81" fill="none" opacity=".63"><path d="M0 535H294M1146 535H1440M0 552H294M1146 552H1440" strokeWidth="3" />
      {Array.from({ length: 18 + quality * 3 }, (_, i) => <path key={i} d={`M${i * 24} 535V578M${1440 - i * 24} 535V578`} strokeWidth=".8" />)}
    </g>
    <path d="M0 840 720 730 1440 840V1000H0Z" fill={`url(#${id}-floor)`} />
    <g stroke="#a87578" strokeWidth="1" opacity=".22">
      {Array.from({ length: 16 + quality * 5 }, (_, i) => <path key={i} d={`M720 731 ${-550 + i * 2540 / (15 + quality * 5)} 1000`} />)}
      {[758, 793, 836, 887, 951].map(y => <path key={y} d={`M0 ${y}H1440`} />)}
    </g>
    <ellipse cx="720" cy="787" rx="370" ry="74" fill="#171023" stroke="#e1b894" strokeWidth="2" />
    <ellipse cx="720" cy="773" rx="340" ry="55" fill="#512c48" stroke="#a86c78" />
    <ellipse cx="720" cy="765" rx="306" ry="42" fill="#3d223c" stroke="#d6a489" strokeOpacity=".5" />
    <g opacity={.2 + growth * .6}>
      {Array.from({ length: 14 + quality * 5 }, (_, i) => {
        const angle = Math.PI * i / (13 + quality * 5);
        return <circle key={i} cx={720 + cosine(angle) * 350} cy={790 + sine(angle) * 60} r="2.5" fill="#edcda3" />;
      })}
    </g>
    <g className={s.recordLounge} transform="translate(1150 740)">
      <path d="M-105 20 0-26 115 16 6 66Z" fill="#60364f" stroke="#bd8d83" /><path d="M-105 20V69L6 113V66M6 113 115 63V16" fill="#29152e" stroke="#a97479" />
      <ellipse cx="0" cy="15" rx="73" ry="30" fill="#120e1d" stroke="#986d80" />
      {[19, 27, 35, 43, 51, 59].map(r => <ellipse key={r} cx="0" cy="15" rx={r} ry={r * .4} fill="none" stroke="#766078" strokeWidth=".55" />)}
      <ellipse cx="0" cy="15" rx="18" ry="7" fill="#daaa8f" /><path d="M82-9 49-6 30 23" fill="none" stroke="#e4c4a4" strokeWidth="4" strokeLinecap="round" /><circle cx="82" cy="-9" r="6" fill="#9d6973" />
      {quality >= 3 && <g><path d="M-78 61-61 68V79L-78 72ZM-47 73-30 80V91L-47 84Z" fill="#b7877d" /><path d="M41 76 101 50" stroke="#ac7e7d" strokeWidth="2" /></g>}
    </g>
    <path d="M0 0H1440V1000H0Z" fill={`url(#${id}-paper)`} />
  </svg>;
}

function Curtain({ id, quality, right = false }: { id: string; quality: BloomWorldProps["quality"]; right?: boolean }) {
  const folds = 9 + quality * 3;
  return <div className={`${s.curtain} ${right ? s.curtainRight : s.curtainLeft}`}>
    <svg viewBox="0 0 480 1050" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={`${id}-velvet-${right}`}><stop stopColor="#170e22" /><stop offset=".27" stopColor="#693347" /><stop offset=".58" stopColor="#42203a" /><stop offset="1" stopColor="#171022" /></linearGradient></defs>
      <path d="M0 0H480C435 174 452 398 419 632C390 821 442 940 459 1027C430 1047 410 1047 386 1029C368 1047 338 1054 318 1030C297 1056 274 1046 252 1033C232 1052 207 1050 186 1031C170 1048 140 1047 122 1029C104 1047 82 1048 62 1030C38 1046 14 1040 0 1026Z" fill={`url(#${id}-velvet-${right})`} />
      {Array.from({ length: folds }, (_, i) => {
        const x = 16 + i * 451 / folds;
        return <path key={i} d={`M${x} 0C${x - 38} 256 ${x + 13} 577 ${x - 3} 826Q${x - 8} 940 ${x + 14} 1030`} fill="none" stroke={i % 2 ? "#0d0b1b" : "#d9948b"} strokeWidth={i % 2 ? "19" : "3"} opacity={i % 2 ? ".3" : ".13"} />;
      })}
      <path d="M0 985Q35 1012 64 990Q98 1012 124 991Q156 1013 187 993Q219 1014 252 994Q285 1015 319 993Q350 1013 386 992Q420 1009 449 987" fill="none" stroke="#d5ad86" strokeWidth="3" opacity=".65" />
      {quality >= 3 && Array.from({ length: quality * 8 }, (_, i) => <g key={i} transform={`translate(${34 + i % 5 * 82} ${145 + Math.floor(i / 5) * 95}) scale(.24)`} fill="none" stroke="#d4a987" strokeWidth="2.5" opacity=".2"><path d={ornament} /></g>)}
      {quality >= 4 && Array.from({ length: 28 }, (_, i) => <path key={i} d={`M${8 + i * 16} 991V${1024 + i % 3 * 8}`} stroke="#c7a17e" strokeWidth="1" opacity=".55" />)}
    </svg>
  </div>;
}

function MirrorBall({ id, quality, listening }: { id: string; quality: BloomWorldProps["quality"]; listening?: BloomListeningProfile }) {
  const rows = 6 + quality * 2;
  const columns = 6 + quality * 3;
  const genres = listening?.genres?.filter(genre => genre.share > 0) ?? [];
  const palette = ["#edc697", "#dfa4b2", "#a7bad0", "#9ebfaf", "#c7b0d7", "#d7be87"];
  return <div className={s.mirrorBall}><svg viewBox="0 0 220 290" aria-hidden="true">
    <defs><clipPath id={`${id}-sphere`}><circle cx="110" cy="157" r="82" /></clipPath><radialGradient id={`${id}-sphere-light`} cx=".3" cy=".28"><stop stopColor="#fff1c4" /><stop offset=".46" stopColor="#ceafb1" /><stop offset=".85" stopColor="#776983" /><stop offset="1" stopColor="#28273e" /></radialGradient></defs>
    <path d="M110 0V74" stroke="#c9a19e" strokeWidth="1" /><path d="M101 71H119V79H101Z" fill="#e1b499" />
    <circle cx="110" cy="157" r="83" fill={`url(#${id}-sphere-light)`} stroke="#d6c1bb" strokeWidth=".8" />
    <g clipPath={`url(#${id}-sphere)`} data-listening-motif={genres.length ? "genre-mirror" : undefined}>{Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
      const y = 76 + row * 162 / rows;
      const x = 27 + column * 166 / columns + row % 2 * 4;
      const bright = (row * 13 + column * 7) % 11;
      const fraction = (row * columns + column) / (rows * columns);
      let share = 0;
      const genreIndex = genres.findIndex(genre => { share += genre.share; return fraction < share; });
      return <rect key={`${row}-${column}`} x={x} y={y} width={166 / columns - 1.2} height={162 / rows - 1.2} rx=".4" fill={genres.length ? genreIndex < 0 ? "#4e4a6b" : palette[genreIndex % palette.length] : bright < 3 ? "#fff2cb" : bright < 6 ? "#e1bfc2" : "#4e4a6b"} opacity={.15 + bright / 18} />;
    }))}</g>
    <path d="M61 130 72 116 65 98 83 110 96 102 91 121 108 130 88 132 81 150 77 134Z" fill="#fff5d5" opacity=".8" />
    {quality >= 3 && <g fill="none" stroke="#f5e2c1" strokeWidth=".6" opacity=".6"><path d="M24 100H44M34 90V110M161 192H182M172 181V202M117 241H128M122 236V249" /></g>}
  </svg></div>;
}

function Atmosphere({ id, quality, listening }: { id: string; quality: BloomWorldProps["quality"]; listening?: BloomListeningProfile }) {
  const beams = quality === 1 ? 2 : quality + 3;
  const hourBands = listening?.hourBands;
  return <div className={s.atmosphere} aria-hidden="true"><svg viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id={`${id}-beam`} x2="0" y2="1"><stop stopColor="#edc6a3" stopOpacity=".16" /><stop offset="1" stopColor="#ea98ba" stopOpacity="0" /></linearGradient><linearGradient id={`${id}-rose-beam`} x2="0" y2="1"><stop stopColor="#da86b8" stopOpacity=".19" /><stop offset="1" stopColor="#8d81d2" stopOpacity="0" /></linearGradient></defs>
    {Array.from({ length: beams }, (_, i) => <g key={i} className={s.beam} data-listening-motif={hourBands?.length ? "listening-hour-lights" : undefined} opacity={hourBands?.length ? .25 + hourBands[i % hourBands.length].share * 1.5 : 1} style={{ "--beam-angle": `${(i - beams / 2) * 13}deg`, "--beam-delay": `${i * -2.7}s` } as CSSProperties}><path d={`M${1070 - i * 62} 211 ${160 + i * 143} 999 ${452 + i * 133} 999Z`} fill={`url(#${id}-${hourBands?.length ? ["beam", "beam", "rose-beam", "rose-beam"][i % hourBands.length] : i % 2 ? "rose-beam" : "beam"})`} /></g>)}
    <g className={s.sunriseRays}><path d="M604 298 127 1000H1112L835 298Z" fill="#f3c9a9" fillOpacity=".12" /><path d="M692 298 495 1000H771L754 298Z" fill="#ffe4b8" fillOpacity=".12" />{quality >= 4 && <path d="M803 298 1268 1000H1384L851 298Z" fill="#e8adba" fillOpacity=".08" />}</g>
    {quality >= 3 && <g className={s.floorGlints}>{Array.from({ length: quality * 12 }, (_, i) => <path key={i} d={`M${(i * 193) % 1440} ${835 + i % 8 * 21}l${7 + i % 5 * 3} -3 7 3-${7 + i % 5 * 3} 3Z`} fill={i % 3 ? "#dca9b5" : "#d0c2ee"} opacity={.06 + i % 5 * .025} />)}</g>}
    {quality >= 4 && <g className={s.dust}>{Array.from({ length: quality * 11 }, (_, i) => <circle key={i} cx={47 + i * 137 % 1367} cy={143 + i * 83 % 712} r={i % 3 === 0 ? "1.8" : ".85"} fill="#efcbb5" opacity={.13 + i % 4 * .07} />)}</g>}
  </svg></div>;
}

function ListeningRecords({ quality, listening }: { quality: BloomWorldProps["quality"]; listening?: BloomListeningProfile }) {
  const returning = Math.min(quality + 1, Math.max(0, listening?.returningArtistCount ?? 0));
  const discovered = Math.min(quality + 1, Math.max(0, listening?.discoveredArtistCount ?? 0));
  if (!returning && !discovered) return null;
  return <div className={s.listeningRecords} aria-hidden="true" data-listening-motif="encore-and-debut-sleeves" data-motif-count={returning + discovered}>
    <svg viewBox="0 0 240 170">
      <path d="M8 151H232L223 164H17Z" fill="#613b52" stroke="#d4ad8a" strokeWidth="1"/>
      {Array.from({ length: returning + discovered }, (_, n) => {
        const encore = n < returning, x = 17 + n * 172 / Math.max(1, returning + discovered - 1);
        return <g key={n} transform={`translate(${x} ${encore ? 13 : 31}) rotate(${encore ? -5 : 5})`}>
          <path d="M0 0H40V122H0Z" fill={encore ? "#3c2945" : "#a06772"} stroke="#dcbb94" strokeWidth=".8"/>
          <path d="M5 5H35V117H5Z" fill="none" stroke="#ddb990" strokeWidth=".5" opacity=".5"/>
          <circle cx="20" cy="41" r="13" fill="#211628" stroke="#c39d9b" strokeWidth=".7"/>
          <circle cx="20" cy="41" r="3" fill="#e8c195"/>
          {encore && <circle cx="20" cy="41" r="9" fill="none" stroke="#d5b4a4" strokeWidth=".6"/>}
          <path d="M11 78H29M14 84H26M11 102H29" stroke="#e9c9a6" strokeWidth="1" opacity=".6"/>
        </g>;
      })}
    </svg>
  </div>;
}

function Chandelier({ id, quality, growth }: { id: string; quality: BloomWorldProps["quality"]; growth: number }) {
  const count = 5 + quality * 2;
  return <div className={s.chandelier}><svg viewBox="0 0 420 270" aria-hidden="true">
    <defs><linearGradient id={`${id}-crystal`} x2="1" y2="1"><stop stopColor="#fff0c5" /><stop offset=".4" stopColor="#dea8b2" /><stop offset=".75" stopColor="#7970a3" /><stop offset="1" stopColor="#efc2a2" /></linearGradient></defs>
    <path d="M210 0V69M145 69Q210 47 275 69M93 111Q210 64 327 111M65 158Q210 105 355 158" fill="none" stroke="#ddb294" strokeWidth="1.5" />
    <path d="M210 57 231 80 210 101 189 80Z" fill="#ce9c91" stroke="#e9c5a2" strokeWidth="1" />
    {Array.from({ length: count }, (_, i) => {
      const x = 69 + i * 282 / (count - 1);
      const y = 151 - sine(i * Math.PI / (count - 1)) * 34;
      return <g key={i} opacity={.45 + (i / count < growth ? .48 : .08)}><path d={`M${x} ${y}V${y + 18 + i % 3 * 9}`} stroke="#ccaca0" strokeWidth=".8" /><path d={`M${x} ${y + 14 + i % 3 * 9}q-18 17 0 48q18-31 0-48Z`} fill={`url(#${id}-crystal)`} stroke="#edcfae" strokeWidth=".65" /><path d={`M${x} ${y + 16 + i % 3 * 9}V${y + 60 + i % 3 * 9}`} stroke="#fff0c3" strokeOpacity=".7" strokeWidth=".7" /></g>;
    })}
    {quality >= 4 && Array.from({ length: 9 }, (_, i) => <g key={i} transform={`translate(${128 + i * 20.5} ${77 - sine(i * Math.PI / 8) * 10})`} fill="#dec2ad"><path d="M0 0V29M0 29Q-10 40 0 49Q10 40 0 29" stroke="#bb9c9f" strokeWidth=".6" /></g>)}
    <path d="M198 162 210 182 222 162M210 182V224" fill="none" stroke="#ddbb99" /><path d="M210 208Q186 230 210 250Q234 230 210 208Z" fill={`url(#${id}-crystal)`} />
  </svg></div>;
}

function ForegroundFurniture({ quality, id }: { quality: BloomWorldProps["quality"]; id: string }) {
  return <div className={s.furniture} aria-hidden="true"><svg viewBox="0 0 1440 360" preserveAspectRatio="xMidYMax slice">
    <defs><linearGradient id={`${id}-sofa`} x2="0" y2="1"><stop stopColor="#713a53" /><stop offset=".4" stopColor="#4b2744" /><stop offset="1" stopColor="#25162d" /></linearGradient><linearGradient id={`${id}-table`} x2="0" y2="1"><stop stopColor="#c5978c" /><stop offset="1" stopColor="#55384e" /></linearGradient></defs>
    {[false, true].map(right => <g key={String(right)} transform={right ? "translate(1440 0) scale(-1 1)" : undefined}>
      <path d="M-25 354V207Q-8 130 65 143L171 161Q208 168 218 202L258 335Z" fill={`url(#${id}-sofa)`} stroke="#a06e7a" strokeWidth="1.3" />
      <path d="M11 337 32 179Q45 157 65 158L152 174Q180 176 188 201L209 337Z" fill="#66324c" stroke="#a36777" strokeWidth="1" />
      <path d="M30 319Q109 277 208 320L228 341H18Z" fill="#9a5365" stroke="#c28c8a" strokeWidth=".8" />
      <path d="M48 339 44 358M204 339 213 358" stroke="#c49b84" strokeWidth="5" />
      {Array.from({ length: quality * 2 + 3 }, (_, i) => <path key={i} d={`M${44 + i * 143 / (quality * 2 + 3)} ${175 + i % 3 * 4}Q${43 + i * 148 / (quality * 2 + 3)} 236 ${36 + i * 166 / (quality * 2 + 3)} 299`} fill="none" stroke="#cf8f8e" strokeWidth=".8" opacity=".3" />)}
      <ellipse cx="266" cy="284" rx="80" ry="22" fill={`url(#${id}-table)`} stroke="#ddb49a" strokeWidth="1" />
      <path d="M266 287V348M241 354Q266 342 291 354" stroke="#d3ad92" fill="none" strokeWidth="3" />
      <path d="M248 261Q246 238 254 228H276Q284 238 282 261Z" fill="#d8a195" stroke="#edc6a5" strokeWidth=".8" /><ellipse cx="265" cy="261" rx="17" ry="4" fill="#9d7380" />
      <path d="M265 235Q253 182 270 140M262 206Q237 184 231 166M265 188Q295 167 309 153M266 163Q247 145 244 127" fill="none" stroke="#d3a287" strokeWidth="1.8" />
      {[{x:270,y:139},{x:231,y:166},{x:309,y:153},{x:244,y:127}].map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y}) scale(.3)`} fill="#dfad9e" fillOpacity=".85" stroke="#f2ccb3" strokeWidth=".6"><path d={ornament} /><circle r="3" fill="#f5d9b9" /></g>)}
      {quality >= 5 && <g transform="translate(67 137)" stroke="#d0a087" fill="none" strokeWidth=".7" opacity=".5"><path d="M0 0Q-9-18-3-31M-3-20Q-19-31-20-44M-1-8Q15-20 19-35" /><path d={ornament} transform="translate(-20 -44) scale(.17)" /><path d={ornament} transform="translate(19 -35) scale(.17)" /></g>}
    </g>)}
  </svg></div>;
}

function Valance({ quality }: { quality: BloomWorldProps["quality"] }) {
  return <svg className={s.valance} viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 0H1440V39Q1260 231 1040 78Q720 236 400 78Q180 231 0 39Z" fill="#321831" />
    <path d="M0 32Q180 217 400 65Q720 220 1040 65Q1260 217 1440 32" fill="none" stroke="#d0a183" strokeWidth="2" />
    <path d="M0 41Q180 231 400 76Q720 234 1040 76Q1260 231 1440 41" fill="none" stroke="#80535f" strokeWidth="6" />
    {quality >= 2 && Array.from({ length: 18 + quality * 6 }, (_, i) => <path key={i} d={`M${i * 1440 / (18 + quality * 6)} 0Q${i * 1440 / (18 + quality * 6) + 35} 50 ${i * 1440 / (18 + quality * 6) + 10} ${60 + sine(i / 5) * 20}`} fill="none" stroke="#7b3e52" strokeWidth="2" opacity=".5" />)}
    {[400, 1040].map(x => <g key={x} transform={`translate(${x} 77)`} fill="#d9b08a"><circle r="7" /><path d="M-4 4H4L8 45 0 59-8 45Z" /><path d="M-7 43H7V53H-7Z" fill="#826069" /></g>)}
  </svg>;
}

function OpeningLight({id,quality}:{id:string;quality:BloomWorldProps["quality"]}) {
  return <div className={s.openingLight} aria-hidden="true">
    <div className={s.openingDark}/>
    <svg className={s.champagneLight} viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
      <defs><radialGradient id={`${id}-opening-glow`}><stop stopColor="#ffe0b4" stopOpacity=".7"/><stop offset=".26" stopColor="#e6a7a5" stopOpacity=".17"/><stop offset="1" stopColor="#d898a4" stopOpacity="0"/></radialGradient></defs>
      <circle className={s.openingHalo} cx="600" cy="330" r="400" fill={`url(#${id}-opening-glow)`}/>
      <g className={s.openingRays} fill="#eec49e">{Array.from({length:6+quality*2},(_,n)=><path key={n} d={`M600 330 ${-100+n*120} 950 ${-45+n*120} 950Z`} opacity={n%2?.032:.07}/>)}</g>
      <g className={s.openingScintillas} fill="#f8deb6">{Array.from({length:8+quality*5},(_,n)=><g key={n} style={{"--spark-delay":`${n*.045}s`} as CSSProperties} transform={`translate(${160+n*97%890} ${133+n*71%610})`}><path d="M-4 0H4M0-4V4" stroke="#edd2ac" strokeWidth=".8"/><circle r="1.1"/></g>)}</g>
      <g className={s.openingMarquee} fill="none" stroke="#e2b78f" strokeWidth=".8"><path d="M420 366Q600 473 780 366M462 399Q600 469 738 399"/><path d="M600 456v23m-7-12 7-6 7 6-7 6Z"/><circle cx="600" cy="330" r="93" strokeDasharray="1 13" opacity=".65"/></g>
    </svg>
  </div>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, listening, children, experience, openingPhase }: BloomWorldProps) {
  const id = `disco-${useId().replace(/:/g, "")}`;
  const shot = scene === "opening" ? "entrance" : scene === "finale" ? "dawn" : ["songs", "discoveries", "returns", "breadth"].includes(scene) ? "lounge" : ["artist", "artist-songs", "artists", "song-winner"].includes(scene) ? "stage" : "chandelier";
  const growth = Math.min(1, Math.max(0, stage / 14));
  return <div className={s.world} data-opening-phase={openingPhase} data-experience={experience?.composition} data-world="disco" data-scene={scene} data-shot={shot} data-quality={quality} data-reduced-motion={reducedMotion} data-view={view} data-theme={theme} style={{ "--disco-progress": Math.min(1, Math.max(0, progress)), "--disco-growth": growth } as CSSProperties}>
    <div className={s.backdrop}><Architecture id={id} quality={quality} growth={growth} /></div>
    <div className={s.roseWash} aria-hidden="true" />
    <div className={s.afterhours} aria-hidden="true" />
    <Atmosphere id={id} quality={quality} listening={listening}/>
    {quality >= 2 && <Chandelier id={id} quality={quality} growth={growth} />}
    <MirrorBall id={id} quality={quality} listening={listening}/>
    <Curtain id={id} quality={quality} /><Curtain id={id} quality={quality} right />
    <Valance quality={quality} />
    {quality >= 3 && <ForegroundFurniture quality={quality} id={id} />}
    <ListeningRecords quality={quality} listening={listening}/>
    {quality >= 4 && <div className={s.floorAura} aria-hidden="true" />}
    <div className={s.foreground}>
      {(view !== "story" || scene === "opening" || scene === "finale") && <div className={s.title}>
        <svg className={s.titleFrame} viewBox="0 0 680 250" preserveAspectRatio="none" aria-hidden="true"><path d="M37 7H643V22H663V43H677V207H663V228H643V243H37V228H17V207H3V43H17V22H37Z" fill="#1d1020" fillOpacity=".74" stroke="#c4a181" strokeWidth="1" /><path d="M43 16H637V31H654V50H668V200H654V219H637V234H43V219H26V200H12V50H26V31H43Z" fill="none" stroke="#d8b58d" strokeOpacity=".34" /><path d="M230 20H450M230 230H450" stroke="#d5a888" />{quality >= 3 && [false,true].map(right => <g key={String(right)} transform={right ? "translate(680 0) scale(-1 1)" : undefined} fill="none" stroke="#d3af8e" strokeWidth=".6"><path d="M31 70H59V42H101M31 180H59V208H101M31 85H73V43M31 165H73V207" /><path d={ornament} transform="translate(58 122) scale(.5)" /></g>)}</svg>
        <span className={s.titleNote}>your music takes the stage</span>
        <BloomLettering text="VELVET" style="deco" className={s.titleFirst} />
        <BloomLettering text="DISCO" style="deco" className={s.titleSecond} />
        <span className={s.titleEdition}>SAKURA BLOOM · VELVET EDITION</span>
      </div>}
      <div className={s.content}><ListeningPainting world="disco" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
    </div>
    <svg className={s.signature} viewBox="0 0 200 68" aria-hidden="true"><path d="M8 43H62M138 43H192" stroke="#cead8d" strokeWidth=".7" /><Fan x={100} y={45} size={.38} detail={11} /><path d={ornament} transform="translate(100 40) scale(.27)" fill="none" stroke="#e4c6a2" strokeWidth="1.7" /></svg>
    <div className={s.vignette} aria-hidden="true" />
    {openingPhase && <OpeningLight id={id} quality={quality}/>}
  </div>;
}
