"use client";

import { useId, type CSSProperties } from "react";
import { BloomLettering } from "../Lettering";
import type { BloomWorldProps } from "../types";
import s from "./world.module.css";

const density = [0, 24, 38, 58, 84, 116];
const waterDetail = [0, 12, 22, 38, 62, 94];
const pollenCount = [0, 0, 0, 6, 16, 30];
const sample = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const foliage = ["#204840", "#316251", "#4c7d5e", "#699269", "#91aa7b", "#a8b988"];
const riverOutline = "M853 452C774 501 1035 512 1021 561C1005 615 543 578 577 656C619 749 1273 658 1265 785C1256 894 849 960 830 1000H220C212 883 764 789 555 743C313 690 374 602 721 582C910 567 700 523 853 452Z";

function Leaf({ variant = 0, detail = false, colour = "#427e65" }: { variant?: number; detail?: boolean; colour?: string }) {
  if (variant === 1) return <g fill={colour}>
    <path d="M0 7C-45-5-58-64-7-114C33-99 45-38 0 7Z" />
    <path d="M-7-110Q-15-60 0 7" fill="none" stroke="#c6cf9c" strokeOpacity=".46" strokeWidth="1.5" />
    {detail && <g fill="none" stroke="#c6cf9c" strokeOpacity=".25" strokeWidth="1.1">
      <path d="M-9-89-27-82M-11-75-35-69M-11-62-36-54M-8-46-28-35M-5-29-18-17M-9-83 8-93M-11-68 21-77M-10-52 25-58M-7-36 21-38M-3-19 10-20" />
      <path d="M-43-56-26-59M-43-43-28-44M29-60 15-64M27-42 15-45" stroke="#142f2a" strokeOpacity=".5" strokeWidth="3" />
    </g>}
  </g>;
  if (variant === 2) return <g fill={colour}>
    <path d="M0 8C-55-10-71-42-47-66L-35-57C-44-84-19-107-8-91C-12-123 15-124 22-101C48-122 64-90 43-69C78-76 77-42 54-28C40 10 9-7 0 8Z" />
    <path d="M0 8Q17-48 19-105M7-16-38-44M12-38-32-70M15-60-10-88M8-18 49-28M14-42 55-58M17-64 39-86" fill="none" stroke="#ccd7a8" strokeOpacity=".42" strokeWidth="1.5" />
    {detail && <g fill="#133c33" fillOpacity=".55"><ellipse cx="-10" cy="-56" rx="4" ry="12" transform="rotate(-28 -10 -56)" /><ellipse cx="30" cy="-52" rx="3.5" ry="11" transform="rotate(34 30 -52)" /><ellipse cx="1" cy="-77" rx="3" ry="9" transform="rotate(-15 1 -77)" /></g>}
  </g>;
  if (variant === 3) return <g fill={colour}>
    <path d="M0 8Q-8-57 7-129" fill="none" stroke={colour} strokeWidth="3.5" />
    {Array.from({ length: detail ? 9 : 6 }, (_, i) => {
      const y = -9 - i * (detail ? 12 : 17), width = 36 - i * (detail ? 2.7 : 4);
      return <g key={i}><path d={`M0 ${y}Q${-width - 10} ${y - 3} ${-width} ${y - 26}Q-7 ${y - 18} 0 ${y}Z`} /><path d={`M0 ${y}Q${width + 8} ${y - 7} ${width} ${y - 31}Q8 ${y - 21} 0 ${y}Z`} /></g>;
    })}
  </g>;
  return <g fill={colour}>
    <path d="M0 6C-31-18-26-64 1-99C38-66 37-22 0 6Z" />
    <path d="M1-94Q9-43 0 6" fill="none" stroke="#d2d6a5" strokeOpacity=".44" strokeWidth="1.3" />
    {detail && <path d="M3-77-12-68M6-62-17-51M6-44-15-32M5-27-9-17M3-77 20-66M6-60 25-47M6-44 24-29M4-26 14-15" fill="none" stroke="#d2d6a5" strokeOpacity=".23" strokeWidth="1" />}
  </g>;
}

function Flower({ x, y, scale = 1, colour = "#e0a680" }: { x: number; y: number; scale?: number; colour?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 24Q5 11 0 0" stroke="#89a887" strokeWidth="2" fill="none" />
    <path d="M0 17Q-19 8-20 19Q-9 27 0 17ZM2 12Q20 1 21 11Q13 21 2 12Z" fill="#587f62" />
    <g fill={colour}><path d="M0 2Q-22-8-17-23Q-2-21 0 2Z" /><path d="M0 2Q-10-25 0-35Q12-22 0 2Z" /><path d="M0 2Q2-23 17-25Q25-8 0 2Z" /><path d="M0 2Q22-9 25 3Q9 14 0 2Z" /><path d="M0 2Q-24-6-24 7Q-9 16 0 2Z" /></g>
    <circle r="4" fill="#edcf8d" /><path d="M-2-5 1-19M3-3 10-12M-5-3-11-13" stroke="#ffe2ac" strokeWidth="1" />
  </g>;
}

function Bank({ count, quality, side }: { count: number; quality: number; side: "left" | "right" }) {
  return <g>
    {Array.from({ length: count }, (_, i) => {
      const n = i + (side === "right" ? 287 : 1);
      const x = side === "left" ? -65 + sample(n) * 405 : 1260 + sample(n) * 420;
      const y = 500 + sample(n + 70) * 510;
      const size = .4 + ((y - 500) / 510) * 1.9 + sample(n + 30) * .5;
      return <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(sample(n + 8) * 66 - 33).toFixed(1)}) scale(${size.toFixed(2)})`}>
        <Leaf variant={i % 4} detail={quality >= 3} colour={foliage[(i + (side === "right" ? 2 : 0)) % foliage.length]} />
      </g>;
    })}
  </g>;
}

function Foreground({ quality, side, id }: { quality: number; side: "left" | "right"; id: string }) {
  const mirror = side === "right";
  return <svg className={`${s.foreground} ${mirror ? s.foregroundRight : s.foregroundLeft}`} viewBox="0 0 450 1000" preserveAspectRatio={mirror ? "xMaxYMid slice" : "xMinYMid slice"} aria-hidden="true">
    <defs><linearGradient id={`${id}-${side}-leaf`} x2="1" y2="1"><stop stopColor="#172f2d" /><stop offset=".65" stopColor="#2f5b45" /><stop offset="1" stopColor="#779164" /></linearGradient></defs>
    <g transform={mirror ? "translate(450 0) scale(-1 1)" : undefined}>
      <path d="M-70-20C145 17 70 220 123 409S142 701 30 1005H-70Z" fill="#142d29" />
      <path d="M-10 4C57 126 21 273 102 421S131 667 24 918" stroke="#739172" strokeOpacity=".23" strokeWidth="5" fill="none" />
      <path d="M43 66Q200 132 262 33M62 202Q205 254 328 153M94 356Q199 303 256 270M100 453Q257 487 353 425M91 693Q246 628 312 602" fill="none" stroke="#17362c" strokeWidth="21" strokeLinecap="round" />
      <path className={s.vine} d="M168-40C228 107 140 112 217 265S177 373 212 456C245 536 148 569 180 662S209 756 161 848" fill="none" stroke="#6b8e5f" strokeWidth="4" strokeLinecap="round" />
      <path d="M255-30C274 125 226 168 273 232S296 396 258 439" fill="none" stroke="#3f654b" strokeWidth="3" />
      {Array.from({ length: quality >= 4 ? 16 : quality === 3 ? 11 : 7 }, (_, i) => {
        const x = 77 + sample(i + 46) * 180, y = -35 + i * (quality >= 4 ? 59 : 111);
        return <g key={i} className={quality >= 4 && i % 3 === 0 ? s.sway : undefined} style={{ "--delay": `${-i * .83}s` } as CSSProperties}>
          <g transform={`translate(${x} ${y}) rotate(${i % 2 ? 65 : -47}) scale(${1.35 + sample(i + 14) * .7})`}><Leaf variant={i % 4} detail={quality >= 3} colour={`url(#${id}-${side}-leaf)`} /></g>
        </g>;
      })}
      {quality >= 3 && <g stroke="#afbe82" strokeOpacity=".2" fill="none" strokeWidth="1.4"><path d="M90 170Q180 209 210 146M130 278Q192 240 230 273M157 520Q191 585 236 584M139 725Q185 692 217 715" /><path d="M200 389Q210 423 185 440Q172 447 181 427Q189 412 203 423" /></g>}
      {quality >= 4 && <><Flower x={150} y={459} scale={.72} /><Flower x={190} y={730} scale={.85} colour="#dfc285" /><Flower x={251} y={238} scale={.54} colour="#dc956e" /></>}
    </g>
  </svg>;
}

function Landscape({ id, quality, dawn }: { id: string; quality: number; dawn: number }) {
  const paint = (name: string) => `url(#${id}-${name})`;
  return <svg className={s.landscape} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-sky`} x2="0" y2="1"><stop stopColor="#183e43" /><stop offset=".5" stopColor="#557a71" /><stop offset="1" stopColor="#abb58c" /></linearGradient>
      <linearGradient id={`${id}-day`} x2="0" y2="1"><stop stopColor="#aab9a0" /><stop offset=".45" stopColor="#e4c399" /><stop offset="1" stopColor="#f2d6a9" /></linearGradient>
      <linearGradient id={`${id}-river`} x2="0" y2="1"><stop stopColor="#87ac9c" /><stop offset=".36" stopColor="#366f69" /><stop offset=".68" stopColor="#5f9687" /><stop offset="1" stopColor="#9dbaa0" /></linearGradient>
      <linearGradient id={`${id}-bank`} x2="0" y2="1"><stop stopColor="#315f4a" /><stop offset="1" stopColor="#183c31" /></linearGradient>
      <linearGradient id={`${id}-beam`}><stop stopColor="#e7d09a" stopOpacity=".3" /><stop offset="1" stopColor="#e7d09a" stopOpacity="0" /></linearGradient>
      <radialGradient id={`${id}-sun`}><stop stopColor="#faf0cb" stopOpacity=".8" /><stop offset=".25" stopColor="#e9d5ad" stopOpacity=".3" /><stop offset="1" stopColor="#e2caa8" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-mist`} x2="0" y2="1"><stop stopColor="#d5dbc1" stopOpacity="0" /><stop offset=".55" stopColor="#d5dbc1" stopOpacity=".23" /><stop offset="1" stopColor="#d5dbc1" stopOpacity="0" /></linearGradient>
      <pattern id={`${id}-grain`} width="43" height="37" patternUnits="userSpaceOnUse"><path d="M3 8h5M19 3h3M28 19h7M5 27h2M16 32h8M34 34h2" stroke="#eee3bb" strokeOpacity=".11" strokeWidth=".8" /><path d="M6 13h7M28 6h4M8 34h5M23 26h3" stroke="#133c34" strokeOpacity=".17" strokeWidth="1" /></pattern>
      <clipPath id={`${id}-river-clip`}><path d={riverOutline} /></clipPath>
    </defs>
    <rect width="1600" height="1000" fill={paint("sky")} />
    <rect width="1600" height="740" fill={paint("day")} opacity={dawn * .82} />
    <ellipse cx="1050" cy="330" rx="470" ry="330" fill={paint("sun")} opacity={.2 + dawn * .7} />
    <circle cx="1085" cy="271" r="42" fill="#f3ddb2" opacity={.14 + dawn * .62} />
    <g fill="#759488" opacity=".66"><path d="M0 375Q159 254 298 375Q392 258 530 352Q650 200 802 339Q931 225 1093 356Q1240 245 1411 374Q1533 271 1600 352V596H0Z" /><path d="M0 406Q271 386 415 434T800 414T1171 413T1600 408V577H0Z" /></g>
    {quality >= 2 && <g fill="#547d6e" opacity=".7">{Array.from({ length: quality * 6 }, (_, i) => <path key={i} d={`M${i * 1600 / (quality * 6)} 510v${-80 - sample(i + 90) * 120}l-25 50 12-6-35 51h16l-29 37Z`} />)}</g>}
    <path d="M0 465C224 401 407 442 565 478S818 414 925 458S1302 393 1600 469V700H0Z" fill="#305e52" />
    <path d="M0 534C276 450 443 521 626 504S981 505 1125 483S1408 487 1600 527V1000H0Z" fill={paint("bank")} />
    <path d={riverOutline} fill={paint("river")} />
    <path d="M850 453C816 491 999 512 1001 551M604 643C616 718 1233 684 1231 782M1248 791C1240 868 864 938 820 971" fill="none" stroke="#c5cfad" strokeOpacity=".43" strokeWidth="3" />
    <path d="M598 576C433 603 366 631 445 688M421 739C444 806 253 855 252 953" fill="none" stroke="#122f2a" strokeOpacity=".4" strokeWidth="11" />
    <g clipPath={paint("river-clip")}><g className={s.waterLines} fill="none" strokeLinecap="round">{Array.from({ length: waterDetail[quality] }, (_, i) => {
      const y = 602 + sample(i + 7) * 390;
      const x = 490 + sample(i + 91) * 440;
      const length = 26 + sample(i + 38) * 180;
      return <path key={i} d={`M${x.toFixed(1)} ${y.toFixed(1)}q${(length / 2).toFixed(1)} ${sample(i + 62) * 8 - 4} ${length.toFixed(1)} 0`} stroke={i % 4 === 0 ? "#1e5a54" : "#dae1bd"} strokeWidth={i % 5 === 0 ? 2.5 : 1} opacity={.1 + sample(i + 33) * .25} />;
    })}</g>
    {quality >= 2 && <g className={s.waterDrift} fill="none" stroke="#e0e5c3" strokeOpacity=".16" strokeWidth="2"><path d="M468 849Q595 807 726 827T1125 838M452 885Q570 852 739 876T1045 881" /><path d="M691 691Q847 701 1032 737M598 923Q799 918 920 942" /></g>}
    {quality >= 3 && <g className={s.waterDriftSlow} fill="none" stroke="#285b50" strokeOpacity=".24" strokeWidth="6"><path d="M514 866Q644 850 777 870T1065 877M689 749Q843 778 1118 772M758 584Q872 590 957 567" /></g>}</g>
    {quality >= 4 && <g className={s.mist} fill={paint("mist")}><ellipse cx="925" cy="485" rx="490" ry="100" /><ellipse cx="643" cy="551" rx="470" ry="58" /></g>}
    <g fill="#53746a"><path d="M21 780Q76 736 129 772L151 809 34 825Z" /><path d="M1342 767Q1414 716 1478 756L1503 804 1332 814Z" /><path d="M1294 911Q1360 870 1433 910L1450 944 1274 951Z" /></g>
    <g fill="#9ba589" opacity=".67"><path d="M31 777 78 753 129 772 78 775Z" /><path d="M1356 763 1415 735 1478 756 1431 763Z" /><path d="M1310 909 1367 889 1429 911 1370 911Z" /></g>
    <Bank count={Math.floor(density[quality] / 2)} quality={quality} side="left" />
    <Bank count={Math.floor(density[quality] / 2)} quality={quality} side="right" />
    <g className={s.lilies} clipPath={paint("river-clip")}>{Array.from({ length: quality * 3 + 3 }, (_, i) => {
      const x = 595 + sample(i + 502) * 500, y = 770 + sample(i + 511) * 225;
      return <g key={i} transform={`translate(${x} ${y})`}><path d="M-28 1C-25-10 12-12 28-2C41 9 3 15-19 8L-2 0Z" fill={i % 2 ? "#47785d" : "#709777"} /><path d="M-22 3Q-1-3 22 1" stroke="#a5bb8c" strokeWidth="1" fill="none" opacity=".6" />{quality >= 3 && i % 3 === 0 && <Flower x={0} y={0} scale={.4 + sample(i + 512) * .28} colour={i % 2 ? "#e5c38f" : "#cb9684"} />}</g>;
    })}</g>
    {quality >= 5 && <g className={s.riverBird} transform="translate(1240 675)">
      <path d="M-4 29-7 78M7 30 9 77M-8 78-17 81M9 77 18 81" stroke="#adac84" strokeWidth="2" fill="none" />
      <path d="M-7 35Q-26 16-13 1Q-5-6 2-3Q12-16 5-31Q-6-45 6-54Q17-61 20-52Q28-42 15-32Q26-2 17 14Q33 17 22 27Q9 38-7 35Z" fill="#dfddbf" />
      <path d="M-10 9Q1 1 10 11L1 26Q-6 29-14 22Z" fill="#a4bca7" /><path d="M-4 3Q1 14-4 24M0 1Q8 12 3 26M9 11 15 22" fill="none" stroke="#72958b" strokeWidth="1.4" />
      <path d="M20-51 48-47 22-44Z" fill="#d1b67b" /><circle cx="15" cy="-51" r="1.7" fill="#213e34" />
    </g>}
    {quality >= 3 && <g className={s.sunbeams} fill={paint("beam")} opacity={.15 + dawn * .65}><path d="M1070 15 290 930 560 1000 1140 15Z" /><path d="M1180 5 935 1000 1060 1000 1210 5Z" />{quality >= 5 && <path d="M1290-10 1320 1000 1475 1000 1320-10Z" />}</g>}
    {quality >= 4 && <rect width="1600" height="1000" fill={paint("grain")} opacity={quality === 5 ? .8 : .43} />}
    {quality >= 5 && <g fill="#cad4a4" opacity=".13">{Array.from({ length: 180 }, (_, i) => <ellipse key={i} cx={sample(i + 904) * 1600} cy={sample(i + 117) * 1000} rx={.6 + sample(i + 18) * 2.5} ry={.4 + sample(i + 24)} transform={`rotate(${sample(i + 26) * 180} ${sample(i + 904) * 1600} ${sample(i + 117) * 1000})`} />)}</g>}
  </svg>;
}

function Title({ cover }: { cover: boolean }) {
  return <div className={cover ? s.coverTitle : s.signature}>
    <BloomLettering text="Rainforest" className={s.titleFirst} style="brush" />
    <BloomLettering text="Reverie" className={s.titleSecond} style="brush" />
    {cover && <svg className={s.titleVine} viewBox="0 0 620 100" aria-hidden="true"><path d="M14 59C103 100 175 27 253 57S393 92 482 48C538 19 589 28 603 52Q619 82 589 70Q572 60 589 50" fill="none" stroke="currentColor" strokeWidth="2" /><g fill="currentColor"><path d="M111 70Q104 43 130 38Q146 58 111 70ZM269 62Q290 32 308 46Q308 68 269 62ZM413 68Q416 93 439 89Q450 65 413 68ZM534 32Q529 5 553 9Q562 29 534 32Z" /></g><path d="M22 64Q24 34 39 30M577 46Q568 24 574 16" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>}
  </div>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, children }: BloomWorldProps) {
  const id = `jungle-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const isCover = view === "cover";
  const dawn = scene === "finale" || view === "poster" ? 1 : scene === "opening" ? 0 : Math.min(.88, Math.max(stage / 18, progress * .78));
  const shot = ["time", "comparison", "days", "breadth"].includes(scene) ? "river" : ["song-winner", "artist", "artist-songs"].includes(scene) ? "clearing" : ["songs", "artists", "discoveries", "returns", "genres"].includes(scene) ? "pool" : scene === "finale" ? "lagoon" : "canopy";
  const vars = { "--dawn": dawn, "--travel": Math.max(0, Math.min(1, progress)), "--shade": theme === "dark" ? .27 - dawn * .13 : .16 - dawn * .12 } as CSSProperties;
  return <div className={s.world} data-world="jungle" data-scene={scene} data-shot={shot} data-view={view} data-quality={quality} data-reduced-motion={reducedMotion || view === "poster"} data-theme={theme} style={vars}>
    <div className={s.paintedWorld}><Landscape id={id} quality={quality} dawn={dawn} /></div>
    <div className={s.shade} aria-hidden="true" />
    <Foreground quality={quality} side="left" id={id} />
    <Foreground quality={quality} side="right" id={id} />
    <div className={s.shotLight} key={scene} aria-hidden="true" />
    {(scene === "opening" || isCover) && <svg className={s.rain} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g className={s.rainFall} stroke="#cdd7bc" strokeWidth="1" strokeOpacity=".3">{Array.from({ length: quality * quality * 2 + 4 }, (_, i) => { const x = sample(i + 33) * 1600, y = sample(i + 97) * 1200 - 200; return <path key={i} d={`M${x} ${y}l-9 ${27 + sample(i + 98) * 28}`} />; })}</g></svg>}
    {quality >= 3 && <div className={s.pollen} aria-hidden="true">{Array.from({ length: pollenCount[quality] }, (_, i) => <i key={i} style={{ "--x": `${8 + sample(i + 84) * 84}%`, "--y": `${15 + sample(i + 53) * 70}%`, "--delay": `${-sample(i + 2) * 12}s`, "--duration": `${9 + sample(i + 12) * 12}s`, "--size": `${2 + sample(i + 35) * 3}px` } as CSSProperties} />)}</div>}
    <svg className={s.travellingLeaf} viewBox="0 0 100 50" aria-hidden="true"><path d="M3 33C14 2 67-5 91 13C82 33 48 46 3 33Z" fill="#d2b576" /><path d="M3 33Q38 20 91 13M25 28 35 10M47 22 59 5M26 28 43 37M53 22 69 28" fill="none" stroke="#806b41" strokeWidth="1.2" /><path d="M1 34Q-4 42 5 44" fill="none" stroke="#a18d54" strokeWidth="2" /><path d="M16 45Q47 48 84 37" fill="none" stroke="#d9e1b7" strokeOpacity=".55" /></svg>
    <div className={s.clearing} key={`${scene}:${view}`}>
      {isCover ? <Title cover /> : null}
      <div className={s.content}>{children}</div>
    </div>
    {!isCover && <Title cover={false} />}
    <svg className={s.waterFrame} viewBox="0 0 1600 100" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 60Q180 32 367 64T799 59T1203 69T1620 53M-10 89Q203 60 367 88T804 86T1203 88T1620 79" fill="none" stroke="#ccdbad" strokeWidth="1" strokeOpacity=".25" /></svg>
  </div>;
}
