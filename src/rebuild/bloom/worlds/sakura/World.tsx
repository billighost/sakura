"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";
import { paintingFraction } from "../illustrations/layout";

import { useId, type CSSProperties } from "react";
import type { BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin } from "../stableTrig";
import s from "./world.module.css";
import {SakuraPrelude} from "./Prelude";

type CanopyPoint = readonly [number, number, number, number, number];

// Each limb was placed around the reading clearing rather than generated as a
// uniform particle field. The final number is its place in the growing canopy.
const canopy: readonly CanopyPoint[] = [
 [105, 748, 1.12, -44, .04], [105, 562, 1.35, -27, .09], [128, 360, 1.5, -15, .12],
 [186, 238, 1.2, 28, .17], [293, 157, 1.15, 17, .2], [405, 127, 1.1, -12, .26],
 [542, 92, .95, 29, .29], [640, 110, .9, -22, .35], [777, 103, .83, 22, .38],
 [891, 108, 1.07, 7, .44], [1029, 149, 1.2, 41, .48], [1181, 208, 1.23, 48, .52],
 [1274, 361, 1.25, 84, .58], [1333, 526, 1.03, 81, .62], [1369, 685, .92, 106, .67],
 [226, 878, .75, -61, .71], [1127, 891, .72, 61, .75], [348, 201, .8, -42, .8],
 [716, 162, .78, 15, .83], [1152, 298, .86, 88, .87], [83, 219, .9, 23, .91],
 [1370, 241, .86, 82, .94], [995, 80, .87, -12, .97], [512, 32, .8, 35, .99],
];

const tierDetails = {
 1: { sprigs: 8, flowers: 5, distant: 7, petals: 7, grasses: 8, fireflies: 0, rays: 2 },
 2: { sprigs: 12, flowers: 8, distant: 12, petals: 16, grasses: 15, fireflies: 8, rays: 3 },
 3: { sprigs: 16, flowers: 12, distant: 18, petals: 28, grasses: 24, fireflies: 16, rays: 5 },
 4: { sprigs: 21, flowers: 17, distant: 26, petals: 48, grasses: 36, fireflies: 26, rays: 7 },
 5: { sprigs: 24, flowers: 24, distant: 38, petals: 76, grasses: 54, fireflies: 44, rays: 10 },
} as const;

function noise(value: number) {
 const x = stableSin(value * 127.1 + 311.7) * 43758.5453123;
 return x - Math.floor(x);
}

function Definitions({ id, detailed }: { id: string; detailed: boolean }) {
 return <defs>
  <linearGradient id={`${id}-sky`} x1="0" y1="0" x2=".4" y2="1"><stop stopColor="var(--sakura-sky)"/><stop offset=".55" stopColor="var(--sakura-haze)"/><stop offset="1" stopColor="var(--sakura-ground)"/></linearGradient>
  <radialGradient id={`${id}-sun`}><stop stopColor="var(--sakura-sun)" stopOpacity=".65"/><stop offset=".5" stopColor="var(--sakura-sun)" stopOpacity=".19"/><stop offset="1" stopColor="var(--sakura-sun)" stopOpacity="0"/></radialGradient>
  <linearGradient id={`${id}-trunk`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="var(--sakura-bark)"/><stop offset=".48" stopColor="var(--sakura-branch)"/><stop offset="1" stopColor="var(--sakura-bark-light)"/></linearGradient>
  <linearGradient id={`${id}-petal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--sakura-flower-light)"/><stop offset=".45" stopColor="var(--sakura-flower)"/><stop offset="1" stopColor="var(--sakura-flower-deep)"/></linearGradient>
  <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--sakura-leaf-light)"/><stop offset="1" stopColor="var(--sakura-leaf)"/></linearGradient>
  <pattern id={`${id}-paper`} width="71" height="61" patternUnits="userSpaceOnUse"><path d="M3 5h13m22 12h7M5 38h8m40 13h11M20 57h5" stroke="var(--sakura-ink)" strokeWidth=".45" opacity=".17"/><circle cx="24" cy="18" r=".65" fill="var(--sakura-ink)" opacity=".2"/><circle cx="61" cy="33" r=".5" fill="var(--sakura-ink)" opacity=".12"/></pattern>
  <symbol id={`${id}-blossom`} viewBox="-22 -22 44 44">
   <path d="M0 2C-11-1-16-13-9-17L-4-16-2-21C9-22 10-5 0 2Z" fill={`url(#${id}-petal)`}/>
   <path d="M0 2C-5-7 4-19 11-14L12-9 18-8C23 1 8 8 0 2Z" fill={`url(#${id}-petal)`} opacity=".92"/>
   <path d="M0 2C6-5 20-2 18 7L14 9 14 15C5 23-3 11 0 2Z" fill={`url(#${id}-petal)`}/>
   <path d="M0 2C9 8 8 21-1 21L-4 16-10 17C-20 10-9 2 0 2Z" fill={`url(#${id}-petal)`} opacity=".92"/>
   <path d="M0 2C-1 12-16 17-19 8L-17 4-21 0C-21-10-6-8 0 2Z" fill={`url(#${id}-petal)`}/>
   <circle cy="2" r="3" fill="var(--sakura-flower-deep)"/>
   {detailed && <g fill="var(--sakura-pollen)" stroke="var(--sakura-flower-deep)" strokeWidth=".6"><path d="M0 2-4-7M0 2 7-4M0 2 8 8M0 2-1 12M0 2-9 4" fill="none"/><circle cx="-4" cy="-7" r="1.2"/><circle cx="7" cy="-4" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="-1" cy="12" r="1.2"/><circle cx="-9" cy="4" r="1"/></g>}
  </symbol>
  <symbol id={`${id}-half-flower`} viewBox="-22 -22 44 44"><path d="M-12 8C-23-7-16-17-9-9L-7-17C3-25 11-11 3 0L14-8C23-6 22 5 9 10L-12 8Z" fill={`url(#${id}-petal)`}/><path d="M-12 8Q-1 4 9 10L-1 16Z" fill="var(--sakura-leaf)"/><path d="M-3 8-2 21" stroke="var(--sakura-branch)" strokeWidth="2"/></symbol>
  <symbol id={`${id}-bud`} viewBox="-12 -18 24 36"><path d="M0-16C14-12 13 4 0 8C-12 3-13-9 0-16Z" fill="var(--sakura-flower-deep)"/><path d="M0-16C5-10 4 0 0 7C-6-1-5-9 0-16Z" fill="var(--sakura-flower)"/><path d="M-8 3 0 11 8 3 4 13H-4Z" fill="var(--sakura-leaf)"/><path d="M0 10V18" stroke="var(--sakura-branch)"/></symbol>
  <symbol id={`${id}-leaf-shape`} viewBox="-3 -4 40 24"><path d="M0 4C8-8 27-3 36 12C18 20 5 16 0 4Z" fill={`url(#${id}-leaf)`}/>{detailed && <path d="M0 4 32 11M11 7 14 0M20 9 25 4M11 7 10 14M20 9 21 16" stroke="var(--sakura-leaf-light)" strokeWidth=".6" opacity=".75"/>}</symbol>
  <symbol id={`${id}-petal-shape`} viewBox="-8 -16 16 32"><path d="M0-14C-12-7-9 8 1 14C10 4 8-5 0-14Z" fill={`url(#${id}-petal)`}/><path d="M0-12Q-3 0 1 10" stroke="var(--sakura-flower-light)" opacity=".7" fill="none" strokeWidth=".5"/></symbol>
  <symbol id={`${id}-far-tree`} viewBox="-80 -190 160 210"><path d="M-14 20-8-52-32-93-41-161-20-100 2-67 14-126 51-166 26-108 18-49 27 20Z" fill="currentColor"/><path d="M-5-68-64-111-37-99 1-86 15-132 48-147" stroke="currentColor" fill="none" strokeWidth="3"/><path d="M-45-137Q-93-142-64-162Q-65-187-31-172Q-5-205 14-179Q47-188 63-160Q91-143 50-129Q21-116 5-137Q-22-120-45-137Z" fill="var(--sakura-flower)" opacity=".7"/></symbol>
 </defs>;
}

function Sprig({ id, point, index, flowers, growth }: { id: string; point: CanopyPoint; index: number; flowers: number; growth: number }) {
 const [x, y, scale, angle, threshold] = point;
 const branchGrowth = Math.max(.14, Math.min(1, (growth - threshold + .35) * 3));
 return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`} opacity={branchGrowth}>
  <g className={s.sprig} style={{ "--sprig-delay": `${index * .07}s`, "--sway": `${index % 2 ? .8 : -.7}deg` } as CSSProperties}>
   <path d="M-12 45C-5 18 4-18 26-55C45-83 67-106 90-135C67-103 43-90 26-60C12-33 1 13-5 46Z" fill={`url(#${id}-trunk)`}/>
   <g fill="none" stroke="var(--sakura-branch)" strokeLinecap="round"><path d="M13-33Q-20-60-34-91M32-66Q72-62 94-84M54-97Q33-120 41-151M10-18Q42-14 57-35M-2 11Q-35 6-47-17" strokeWidth="2.3"/><path d="M-21-67-18-91M-30-81-50-88M70-67 67-90M81-74 99-70M42-135 25-146M42-134 61-154M35-22 38-43M-30 4-35-16" strokeWidth="1.2"/></g>
   {Array.from({ length: flowers }, (_, n) => {
    const branch = n % 5;
    const sites = [[-29, -79], [79, -77], [43, -141], [42, -29], [-35, -6]];
    const [baseX, baseY] = sites[branch];
    const flowerX = baseX + (noise(index * 31 + n * 11) - .5) * 37;
    const flowerY = baseY + (noise(index * 13 + n * 19) - .5) * 30;
    const size = 17 + noise(n * 23 + index) * 15;
    const open = Math.min(1, Math.max(0, (growth - threshold + .13 - n / flowers * .17) * 7));
    return <g key={n} transform={`translate(${flowerX} ${flowerY}) rotate(${noise(n + index * 4) * 110 - 55})`}>
     <use href={`#${id}-bud`} x="-6" y="-12" width="12" height="24" opacity={1 - open * .85}/>
     <use href={`#${id}-${n % 6 === 0 ? "half-flower" : "blossom"}`} x={-size / 2} y={-size / 2} width={size} height={size} opacity={open}/>
     {n % 3 === 0 && <use href={`#${id}-leaf-shape`} x="5" y="3" width="28" height="17" opacity={open * .9}/>}
    </g>;
   })}
  </g>
 </g>;
}

function BranchLettering({ id }: { id: string }) {
 return <svg className={s.lettering} viewBox="0 0 630 230" aria-hidden="true">
  <g className={s.letterStrokes} fill="none" stroke="var(--sakura-title)" strokeLinecap="round" strokeLinejoin="round">
   <path d="M39 153C49 110 69 52 62 35C57 21 44 34 45 48M42 137C67 79 117 100 101 137C91 161 59 165 46 144" strokeWidth="9"/>
   <path d="M119 149C130 119 157 55 150 41C144 33 136 43 137 57C136 92 121 164 150 143" strokeWidth="8"/>
   <path d="M197 105C160 97 156 154 187 154C213 157 231 108 203 104C180 104 178 128 192 130" strokeWidth="9"/>
   <path d="M267 105C234 99 224 151 254 155C286 159 300 110 275 104C253 101 247 128 263 129" strokeWidth="9"/>
   <path d="M305 150C307 132 318 106 319 102M313 128C340 88 350 102 338 137C330 159 340 151 350 127C373 85 387 106 376 137C369 157 384 151 397 134" strokeWidth="8"/>
  </g>
  <path d="M16 183C90 180 122 205 190 188C236 176 256 160 308 180C342 193 376 186 412 177C457 167 472 152 465 143C459 132 447 147 459 154C490 169 511 157 526 132" stroke="var(--sakura-vine)" strokeWidth="2" fill="none"/>
  <path d="M216 160C232 171 229 177 217 177C204 176 207 165 221 169M453 163Q463 188 481 186M124 187Q119 169 110 163" stroke="var(--sakura-vine)" strokeWidth="1.5" fill="none"/>
  <use href={`#${id}-blossom`} x="22" y="32" width="37" height="37"/>
  <use href={`#${id}-half-flower`} x="452" y="112" width="29" height="29"/>
  <use href={`#${id}-blossom`} x="472" y="170" width="30" height="30"/>
  <use href={`#${id}-leaf-shape`} x="95" y="157" width="28" height="18" transform="rotate(-30 109 166)"/>
  <use href={`#${id}-leaf-shape`} x="475" y="179" width="29" height="19"/>
  <path d="M416 133C426 110 438 120 433 134C428 151 419 148 424 132" stroke="var(--sakura-flower-deep)" strokeWidth="3" fill="none"/>
 </svg>;
}

function ListeningBranches({ id, quality, listening, portrait = false }: { id: string; quality: BloomWorldProps["quality"]; listening?: BloomListeningProfile; portrait?: boolean }) {
 const returns = Math.min(quality + 2, Math.max(0, listening?.returningArtistCount ?? 0));
 const discoveries = Math.min(quality + 2, Math.max(0, listening?.discoveredArtistCount ?? 0));
 if (!returns && !discoveries) return null;
 return <g className={s.listeningBranches} data-listening-motif="returning-blossoms-and-new-buds">
  {Array.from({ length: returns }, (_, n) => {
   const x = portrait ? n % 2 ? 368 : 21 : n % 2 ? 1298 : 148;
   const y = portrait ? 442 + n * 48 : 335 + n * 61;
   return <g key={`return-${n}`} transform={`translate(${x} ${y})`}>
    <path d="M-9 11Q0-12 12-9M0 4Q-18-5-23-18" stroke="var(--sakura-vine)" strokeWidth="1.4" fill="none"/>
    <use href={`#${id}-blossom`} x="-15" y="-14" width="23" height="23"/>
    <use href={`#${id}-blossom`} x="3" y="-23" width="21" height="21"/>
   </g>;
  })}
  {Array.from({ length: discoveries }, (_, n) => <g key={`new-${n}`} transform={`translate(${portrait ? n % 2 ? 363 : 27 : n % 2 ? 1262 : 174} ${portrait ? 477 + n * 46 : 360 + n * 62})`}>
   <path d="M0 19Q5 5 0-7" stroke="var(--sakura-vine)" strokeWidth="1.2" fill="none"/>
   <use href={`#${id}-bud`} x="-8" y="-20" width="16" height="28"/>
  </g>)}
 </g>;
}

function MainTree({ id, quality, growth, listening, seed }: { id: string; quality: BloomWorldProps["quality"]; growth: number; listening?: BloomListeningProfile; seed?: number }) {
 const detail = tierDetails[quality];
 return <g className={s.mainTree}>
  <g className={s.leftLimb}>
   <path d="M-44 1030C55 915 98 788 99 667C100 549 63 451 100 333C117 277 171 240 231 201C314 147 423 150 536 106C589 87 635 70 685 33C598 77 550 77 501 90C402 118 315 112 234 157C157 201 118 214 86 235C50 166 31 131-14 95L-9 139C30 175 36 223 54 276C10 371 24 455 26 542C30 730 12 839-56 938Z" fill={`url(#${id}-trunk)`}/>
   <path d="M87 347C141 321 184 293 220 251L296 198C244 218 214 227 185 250L101 302Z" fill="var(--sakura-branch)"/>
   <path d="M70 551C142 478 159 421 205 392C155 410 133 446 78 481Z" fill="var(--sakura-branch)"/>
   <path d="M229 184C249 126 269 76 320 15L293 21C253 73 232 110 207 166Z" fill="var(--sakura-branch)"/>
   <path d="M402 127C432 147 470 162 523 151C469 151 448 135 440 115Z" fill="var(--sakura-branch)"/>
   <g fill="none" stroke="var(--sakura-bark-light)" strokeLinecap="round" opacity=".48"><path d="M1 931C54 784 69 651 56 501C45 366 62 294 94 251M67 685C77 569 52 468 82 366M101 272C165 222 213 200 264 164M283 150C351 124 415 131 468 111" strokeWidth="2"/><path d="M26 836Q52 699 43 636M90 239Q44 193 29 160M171 215 197 194M227 193 261 91M358 143 398 135M43 484 35 406" strokeWidth=".9"/>{quality >= 3 && <path d="M20 877Q35 746 29 688M75 423Q66 376 94 302M57 738 60 654M124 237 183 208M80 617 77 582M126 298 177 266M306 140 333 135M440 129 474 121" strokeWidth="1.1"/>}</g>
   {quality >= 4 && <g fill="var(--sakura-lichen)" opacity=".35"><path d="m59 498 9-5 5 10-10 7-7-4ZM42 638l11-4 2 9-9 5ZM67 363l12-4-1 10-8 3ZM127 253l10-5 3 3-12 8Z"/><circle cx="64" cy="521" r="4"/><circle cx="83" cy="385" r="3"/></g>}
  </g>
  <g className={s.rightLimb}>
   <path d="M1492 1048C1398 916 1376 812 1385 704C1393 582 1404 448 1342 328C1300 247 1232 198 1153 160C1081 127 993 126 921 96L867 59C944 90 1020 91 1096 112C1222 147 1304 186 1384 278C1405 196 1405 130 1456 62L1481 70C1427 165 1435 265 1435 357C1482 497 1450 599 1451 730C1451 838 1479 925 1525 981Z" fill={`url(#${id}-trunk)`}/>
   <path d="M1343 370C1280 332 1254 311 1203 295C1255 299 1301 316 1323 327Z" fill="var(--sakura-branch)"/>
   <path d="M1245 203C1194 226 1157 240 1101 223C1155 255 1199 241 1274 226Z" fill="var(--sakura-branch)"/>
   <path d="M1191 172C1182 117 1180 71 1146 24L1168 29C1202 77 1210 130 1215 184Z" fill="var(--sakura-branch)"/>
   <g fill="none" stroke="var(--sakura-bark-light)" strokeLinecap="round" opacity=".4"><path d="M1471 958C1400 829 1420 730 1415 596C1411 470 1390 362 1333 284C1280 212 1210 176 1133 149M1388 837Q1377 773 1400 703M1414 435Q1391 361 1357 330M1288 237 1262 220M1203 174 1189 111" strokeWidth="1.9"/></g>
  </g>
  {canopy.slice(0, detail.sprigs).map((point, index) => {
   const placed: CanopyPoint = seed == null ? point : [point[0] + (paintingFraction(seed, index * 3) - .5) * 24, point[1] + (paintingFraction(seed, index * 3 + 1) - .5) * 34, point[2] * (.94 + paintingFraction(seed, index * 3 + 2) * .12), point[3] + (paintingFraction(seed, index + 80) - .5) * 14, point[4]];
   return <Sprig key={index} id={id} point={placed} index={index} flowers={detail.flowers} growth={growth}/>;
  })}
  <ListeningBranches id={id} quality={quality} listening={listening}/>
 </g>;
}

function PortraitBranches({ id, growth, quality, listening, seed }: { id: string; growth: number; quality: BloomWorldProps["quality"]; listening?: BloomListeningProfile; seed?: number }) {
 const flowers = [3, 5, 8, 12, 17][quality - 1];
 return <svg className={s.portraitBranches} viewBox="0 0 390 844" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="var(--sakura-branch)" strokeLinecap="round" opacity=".72">
   <path d="M-8 851C14 776 8 716 13 651C23 573 2 545 14 477C22 432 9 383 4 344" strokeWidth="3"/>
   <path d="M400 850C382 792 393 724 379 662C366 598 389 562 379 515C366 463 385 432 388 384" strokeWidth="2.5"/>
   <path d="M12 701Q28 680 27 657M12 621Q-4 603-3 581M11 533Q29 514 27 496M14 482Q-2 464 1 447M380 721Q363 702 363 683M383 631Q399 612 400 596M379 537Q363 518 364 499M384 456Q400 436 397 418" strokeWidth="1.1"/>
  </g>
  <g className={s.portraitVines} fill="none" stroke="var(--sakura-vine)" strokeWidth=".9">
   <path d="M17 817C40 783-6 759 16 722C43 683-9 661 16 622C30 601 38 603 36 612C33 625 18 611 26 600C43 574 12 547 18 522"/>
   <path d="M374 826C347 801 389 772 374 745C352 711 390 678 369 653C348 631 360 617 369 624C379 634 354 642 354 626C354 604 382 593 376 569"/>
  </g>
  {Array.from({ length: flowers }, (_, n) => {
   const y = 428 + n / Math.max(1, flowers - 1) * 360 + (seed == null ? 0 : (paintingFraction(seed, n + 301) - .5) * 18);
   const open = Math.min(1, Math.max(.08, (growth - n / flowers * .25) * 1.5));
   const right = n % 2 === 1;
   const jitter = seed == null ? 0 : (paintingFraction(seed, n + 321) - .5) * 6;
   const x = (right ? 367 + noise(n * 19) * 16 : -4 + noise(n * 29) * 15) + jitter;
   return <g key={n} opacity={open} transform={`translate(${x} ${y}) rotate(${right ? 22 : -25})`}>
    <use href={`#${id}-${n % 3 === 0 ? "half-flower" : "blossom"}`} x="-9" y="-9" width="18" height="18"/>
    <use href={`#${id}-leaf-shape`} x={right ? -17 : 2} y="7" width="20" height="13" transform={right ? "rotate(160 -7 13)" : undefined}/>
   </g>;
  })}
  <ListeningBranches id={id} quality={quality} listening={listening} portrait/>
 </svg>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, listening, children, experience, openingPhase }: BloomWorldProps) {
 const id = `sakura-${useId().replace(/:/g, "")}`;
 const growth = view === "cover" ? .76 : view === "poster" || scene === "finale" ? 1 : scene === "opening" ? .08 : Math.max(.15, Math.min(1, progress));
 const details = tierDetails[quality];
 const isMusic = ["songs", "song-winner", "artist-songs", "artists"].includes(scene);
 const hour = listening?.peakHour;
 const sunX = (hour == null ? 949 : 645 + hour / 23 * 450) + (experience ? (paintingFraction(experience.seed, 401) - .5) * 180 : 0);
 const sunY = (hour == null ? 378 : 305 + (1 - Math.max(0, stableSin((hour - 6) / 12 * Math.PI))) * 175) + (experience ? (paintingFraction(experience.seed, 402) - .5) * 48 : 0);
 const style = { "--sakura-growth": growth, "--scene-index": stage, "--sakura-afterglow": Math.max(.05, growth), "--sakura-camera-x": `${scene === "artist" ? -2.5 : scene === "returns" ? 2 : 0}%` } as CSSProperties;
 return <section className={s.world} data-opening-phase={openingPhase} data-experience={experience?.composition} data-scene={scene} data-view={view} data-theme={theme} data-quality={quality} data-reduced-motion={reducedMotion} data-music={isMusic} style={style}>
  <svg className={s.landscape} viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
   <Definitions id={id} detailed={quality >= 3}/>
   <rect width="1440" height="1000" fill={`url(#${id}-sky)`}/>
   <g className={s.sunlight} data-listening-hour={hour ?? undefined}><circle cx={sunX} cy={sunY} r="440" fill={`url(#${id}-sun)`}/><circle cx={sunX} cy={sunY} r="63" fill="var(--sakura-sun)" opacity=".35"/><circle cx={sunX} cy={sunY} r="55" fill="var(--sakura-sun)" opacity=".18"/></g>
   <g className={s.hills}><path d="M-20 610C160 506 258 510 417 584C611 482 721 520 884 569C1048 478 1191 518 1470 595V1010H-20Z" fill="var(--sakura-hill-far)"/><path d="M-20 706C130 637 302 687 472 650C665 609 864 634 1039 670C1239 599 1358 632 1470 679V1010H-20Z" fill="var(--sakura-hill-near)"/><path d="M-20 813C255 694 436 763 666 737C934 704 1144 714 1470 806V1010H-20Z" fill="var(--sakura-ground)"/></g>
   <g className={s.distantOrchard}>{Array.from({ length: details.distant }, (_, n) => {
    const x = n / Math.max(1, details.distant - 1) * 1570 - 65;
    const y = 629 + noise(n * 17) * 85;
    const width = 89 + noise(n * 37) * 86;
    return <use key={n} href={`#${id}-far-tree`} x={x - width / 2} y={y - width * 1.32} width={width} height={width * 1.32} opacity={.2 + growth * .2} style={{ color: "var(--sakura-distance-tree)" }}/>;
   })}</g>
   <g className={s.gardenPath}><path d="M747 713C598 758 871 798 772 838C659 891 496 931 418 1020H1104C1115 947 925 906 955 858C1002 783 707 762 784 713Z" fill="var(--sakura-path)" opacity=".35"/><path d="M776 727C677 764 883 796 839 831C784 872 673 910 626 950" stroke="var(--sakura-sun)" strokeWidth="2" opacity=".25" fill="none"/>{quality >= 3 && <path d="M539 922Q493 911 520 898Q560 884 630 892M998 930Q1035 914 989 900M700 813Q644 801 687 791" stroke="var(--sakura-path)" strokeWidth="1.4" opacity=".5" fill="none"/>}</g>
   <g className={s.rays}>{Array.from({ length: details.rays }, (_, n) => <path key={n} d={`M${500 + n * 48} -80 ${600 + n * 66} -80 ${1240 + n * 97} 1040 ${1110 + n * 91} 1040Z`} fill="var(--sakura-sun)" opacity={.012 + growth * .009} style={{ "--ray-delay": `${n * -3}s` } as CSSProperties}/>)}</g>
   <rect width="1440" height="1000" fill={`url(#${id}-paper)`} opacity={quality >= 3 ? .5 : .25}/>
  </svg>
  <svg className={s.orchard} viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
   <MainTree id={id} quality={quality} growth={growth} listening={listening} seed={experience?.seed}/>
   <g className={s.vines} fill="none" stroke="var(--sakura-vine)" strokeLinecap="round">
    <path d="M102 711C165 626 46 532 119 432C170 362 164 303 145 303C119 303 120 338 151 335C195 331 186 273 222 260C255 248 265 224 254 217C241 204 227 225 239 234C269 257 299 219 309 197" strokeWidth="2.5"/>
    <path d="M1358 706C1283 631 1414 542 1350 466C1309 415 1259 406 1288 372C1307 351 1299 335 1287 338C1273 339 1276 356 1294 355C1325 353 1317 306 1268 303C1220 300 1211 281 1223 269C1241 253 1258 276 1242 283C1211 297 1181 265 1168 245" strokeWidth="2"/>
    {quality >= 3 && <><path d="M181 922C169 870 219 854 211 818C207 798 188 800 190 814C192 831 225 824 229 791M1293 925C1237 884 1298 853 1270 824C1254 807 1239 822 1255 832C1282 848 1301 814 1293 783M368 154C392 172 437 164 422 147C409 130 394 145 412 156C440 172 476 142 478 124" strokeWidth="1.3"/><path d="M987 145Q1030 180 1080 156Q1105 133 1085 126Q1060 121 1070 141Q1100 163 1135 172" strokeWidth="1.6"/></>}
   </g>
   <g className={s.foregroundGrass}>{Array.from({ length: details.grasses }, (_, n) => {
    const x = n < details.grasses / 2 ? noise(n * 32 + 1) * 425 : 1100 + noise(n * 32 + 1) * 340;
    const y = 936 + noise(n * 77) * 76;
    const height = 24 + noise(n * 9) * 80;
    return <g key={n} className={s.grassSprig} style={{ "--grass-delay": `${n * -.31}s` } as CSSProperties}><path d={`M${x} ${y}Q${x - 12} ${y - height / 2} ${x + 15} ${y - height}M${x} ${y}Q${x + 23} ${y - height / 2} ${x + 40} ${y - height * .8}`} stroke="var(--sakura-leaf)" strokeWidth="1.5" fill="none"/><use href={`#${id}-leaf-shape`} x={x + 8} y={y - height} width="29" height="18" transform={`rotate(-30 ${x + 20} ${y - height + 8})`}/>{n % 4 === 0 && <use href={`#${id}-half-flower`} x={x - 2} y={y - height * .7} width="25" height="25" opacity={growth}/>}</g>;
   })}</g>
   {growth > .3 && <g className={s.fireflies}>{Array.from({ length: details.fireflies }, (_, n) => <circle key={n} cx={180 + noise(n * 29 + 2) * 1050} cy={535 + noise(n * 21) * 395} r={.9 + noise(n * 5) * 1.6} fill="var(--sakura-pollen)" style={{ "--glint-delay": `${n * -.8}s` } as CSSProperties}/>)}</g>}
  </svg>
  {view === "story" && openingPhase && <SakuraPrelude id={id} quality={quality}/>}
  <PortraitBranches id={id} growth={growth} quality={quality} listening={listening} seed={experience?.seed}/>
  <div className={s.clearing}>
   {(scene === "opening" || scene === "finale" || view === "cover" || view === "poster") && <div className={s.titleArt}><BranchLettering id={id}/><span className={s.titleCaption}>SAKURA AFTERGLOW</span></div>}
   <div className={s.content}><ListeningPainting world="sakura" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
  </div>
  <div key={`${scene}-${stage}`} className={s.breeze} aria-hidden="true">
   {Array.from({ length: details.petals }, (_, n) => <svg key={n} className={s.floatingPetal} viewBox="-8 -16 16 32" style={{ "--petal-x": `${noise(n * 33 + 4) * 100}%`, "--petal-y": `${-8 + noise(n * 97) * 108}%`, "--petal-size": `${7 + noise(n * 51) * 9}px`, "--petal-dx": `${90 + noise(n * 13) * 170}px`, "--petal-dy": `${120 + noise(n * 23) * 200}px`, "--petal-turn": `${90 + noise(n * 43) * 310}deg`, "--petal-delay": `${noise(n * 41) * 5.5}s`, "--petal-duration": `${10 + noise(n * 67) * 8}s` } as CSSProperties} onAnimationEnd={event => { event.currentTarget.style.willChange = "auto"; }}><use href={`#${id}-petal-shape`} x="-8" y="-16" width="16" height="32"/></svg>)}
  </div>
  <div className={s.sceneMark} aria-hidden="true"><span/>{view === "cover" ? "01 / THE LIVING ORCHARD" : scene === "finale" ? "AN ORCHARD OF YOUR OWN" : "EVERY LISTEN LEAVES A TRACE"}<span/></div>
 </section>;
}
