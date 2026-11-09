"use client";

import { ListeningPainting } from "../illustrations/ListeningPainting";

import { useId, type CSSProperties } from "react";
import type { BloomQuality, BloomSceneKind, BloomWorldProps } from "../types";
import type { BloomListeningProfile } from "../../uiTypes";
import { stableSin } from "../stableTrig";
import s from "./world.module.css";

const detail = {
  1: { contours: 7, salt: 26, leaves: 6, plants: 4, shells: 3, fish: 0, swells: 0 },
  2: { contours: 11, salt: 48, leaves: 9, plants: 5, shells: 5, fish: 3, swells: 1 },
  3: { contours: 17, salt: 86, leaves: 13, plants: 7, shells: 8, fish: 8, swells: 2 },
  4: { contours: 24, salt: 135, leaves: 17, plants: 9, shells: 12, fish: 15, swells: 3 },
  5: { contours: 33, salt: 210, leaves: 23, plants: 12, shells: 18, fish: 26, swells: 5 },
} satisfies Record<BloomQuality, Record<string, number>>;

const glyphs: Record<string, string> = {
  T: "M3 8Q25 4 47 7M26 7L24 66M18 67L32 66",
  I: "M10 8L29 6M20 8L18 65M9 67L28 65",
  D: "M7 9L5 65M6 9Q48 2 48 34Q50 65 5 65",
  A: "M2 66Q13 32 25 6Q34 29 48 65M11 44Q27 39 40 43",
  L: "M9 7L6 64Q23 68 44 63",
  R: "M7 66L9 8Q44 2 46 24Q47 44 8 39M25 40Q32 53 48 64",
  E: "M43 7L9 9L7 65L45 63M9 34L34 32",
  M: "M3 66L8 8L29 45L48 6L51 64",
};

function PaintedTitle({ cover = false }: { cover?: boolean }) {
  return (
    <svg className={s.title} viewBox="0 0 590 155" fill="none" aria-hidden="true">
      <g className={s.titleLetters} stroke="currentColor" strokeWidth={cover ? 6.2 : 5.2} strokeLinecap="round" strokeLinejoin="round">
        {"TIDAL".split("").map((letter, i) => <path key={`top-${i}`} d={glyphs[letter]} transform={`translate(${35 + i * 61} 8) rotate(${i % 2 ? 1.5 : -1.1})`} />)}
        {"DREAM".split("").map((letter, i) => <path key={`bottom-${i}`} d={glyphs[letter]} transform={`translate(${205 + i * 66} 78) rotate(${i % 2 ? -1.5 : 1})`} />)}
      </g>
      <g stroke="var(--ocean-sea-light)" strokeWidth=".8" opacity=".45">
        <path d="M61 17L60 62M231 94L230 130M400 89L399 134M100 18L97 64M345 86L342 131" />
      </g>
      <g stroke="currentColor" opacity=".56" strokeWidth="1.2">
        <path d="M22 91Q99 57 157 82Q203 106 267 91M31 99Q105 67 158 91M470 137Q511 117 559 136Q574 142 584 136" />
        <path d="M104 128Q140 117 164 131Q182 141 200 134M510 15Q533 9 546 23Q557 35 577 23" />
      </g>
      <path d="M569 129q12-9 16-2q-1 8-14 7Z" fill="currentColor" opacity=".65" />
    </svg>
  );
}

function Shell({ x, y, size, turn, variant }: { x: number; y: number; size: number; turn: number; variant: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn}) scale(${size})`}>
      {variant % 3 === 0 ? <>
        <path d="M-20 11Q-28-5-17-18Q-9-25-2-18Q5-27 13-20Q24-16 23-1Q28 7 17 15L0 19Z" fill="var(--ocean-shell)" />
        <path d="M0 17L-17-16M0 17L-6-18M0 17L7-20M0 17L20-7M-19 6Q0-5 19 7" fill="none" stroke="var(--ocean-shell-ink)" strokeWidth="1" />
      </> : variant % 3 === 1 ? <>
        <path d="M-24 8Q-15-13 1-12Q21-10 23 5Q18 21-1 21Q-10 17-8 8Q-4-2 5 2Q10 5 5 10" fill="var(--ocean-shell)" stroke="var(--ocean-shell-ink)" strokeWidth="1.2" />
        <path d="M-19 8Q-4-5 12-1M-17 12Q-4 2 12 6M-12 16Q-2 10 9 12" fill="none" stroke="var(--ocean-shell-ink)" strokeWidth=".8" />
      </> : <>
        <path d="M0-22L7-5L23-4L10 7L14 23L0 13L-15 21L-10 5L-23-7L-7-8Z" fill="var(--ocean-shell)" />
        <path d="M0-17L0 11M-17-5L8 6M17-3L-7 6M10 18L-4-3M-10 16L4-3" stroke="var(--ocean-shell-ink)" strokeWidth=".8" />
      </>}
    </g>
  );
}

function Kelp({ index, quality, side }: { index: number; quality: BloomQuality; side: "left" | "right" }) {
  const count = detail[quality].leaves;
  const length = 145 + (index * 59) % 240;
  const bent = index % 2 === 0 ? 36 : -27;
  return (
    <g transform={`translate(${side === "left" ? -35 + index * 24 : 1235 - index * 24} ${870 + index % 3 * 11}) scale(${side === "left" ? 1 : -1} 1)`}>
      <path d={`M0 0C${bent} ${-length * .3} ${-bent * .55} ${-length * .7} ${bent * .72} ${-length}`} fill="none" stroke="var(--ocean-kelp)" strokeWidth={4 + index % 3} strokeLinecap="round" />
      {Array.from({ length: count }, (_, i) => {
        const y = -(i + 1) / (count + 1) * length;
        const x = stableSin(i / count * 4.2) * bent * .5;
        const dir = i % 2 ? 1 : -1;
        const width = 20 + (i * 11 + index * 7) % 29;
        const leafLength = 36 + (i * 17 + index * 13) % 33;
        return <g key={i} transform={`translate(${x} ${y}) rotate(${dir * (31 + i % 3 * 8)}) scale(${dir} 1)`}>
          <path d={`M0 0Q${-width * .8} ${-leafLength * .35} -3 ${-leafLength}Q${width} ${-leafLength * .4} 0 0Z`} fill={i % 4 === 0 ? "var(--ocean-kelp-light)" : "var(--ocean-kelp)"} opacity={.42 + (i % 3) * .16} />
          {quality >= 3 && <path d={`M0-2Q${width * .1} ${-leafLength * .5} -3 ${-leafLength + 6}`} stroke="var(--ocean-vein)" strokeWidth=".85" fill="none" opacity=".65" />}
          {quality >= 5 && <path d={`M0 ${-leafLength * .2}l${-width * .3} ${-leafLength * .19}M-1 ${-leafLength * .45}l${width * .22} ${-leafLength * .18}`} fill="none" stroke="var(--ocean-vein)" strokeWidth=".65" opacity=".45" />}
        </g>;
      })}
    </g>
  );
}

function Contours({ quality, shore }: { quality: BloomQuality; shore: boolean }) {
  return <g fill="none" strokeLinecap="round">
    {Array.from({ length: detail[quality].contours }, (_, i) => {
      const y = 280 + i * (shore ? 15 : 17);
      const full = i % 4 === 0;
      const x = i % 2 ? 850 + i % 7 * 31 : -60 + i % 6 * 29;
      const curve = full ? `M-90 ${y}C130 ${y - 78 - i % 3 * 14} 293 ${y + 103} 475 ${y + 37}S845 ${y - 83} 1270 ${y + 23}` : `M${x} ${y}q${90 + i % 4 * 16} ${-31 - i % 3 * 8} ${183 + i % 5 * 19} ${i % 3 * 11 - 9}`;
      return <path key={i} d={curve} stroke={full ? "var(--ocean-foam)" : "var(--ocean-line)"} strokeWidth={full ? 1.7 : .7} opacity={shore ? .23 : .15} />;
    })}
  </g>;
}

function SeaPainting({ id, quality, shore, deep, poster, listening }: { id: string; quality: BloomQuality; shore: boolean; deep: boolean; poster: boolean; listening?: BloomListeningProfile }) {
  const count = detail[quality];
  const shells = listening?.discoveredRecordingCount == null ? count.shells : Math.min(quality + 3,Math.max(0,listening.discoveredRecordingCount));
  const daylight = listening?.peakHour != null && listening.peakHour >= 6 && listening.peakHour < 18;
  return <svg className={s.painting} viewBox="0 0 1200 900" preserveAspectRatio={poster ? "none" : "xMidYMid slice"} fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--ocean-sky)" /><stop offset="1" stopColor="var(--ocean-horizon)" /></linearGradient>
      <linearGradient id={`${id}-sea`} x1=".1" y1="0" x2=".8" y2="1"><stop stopColor="var(--ocean-sea-light)" /><stop offset=".53" stopColor="var(--ocean-sea)" /><stop offset="1" stopColor="var(--ocean-bottom)" /></linearGradient>
    </defs>
    <rect width="1200" height="900" fill={`url(#${id}-${deep ? "sea" : "sky"})`} />
    <g className={s.skyMarks} opacity={deep ? .11 : .6}>
      <path d="M-35 173Q53 145 122 166Q218 188 275 156Q322 131 394 154M727 121Q785 88 857 115Q914 142 985 109Q1064 81 1251 117" stroke="var(--ocean-cloud)" strokeWidth="2" />
      <path d="M27 184Q117 164 160 176M828 133Q877 137 927 123M39 119Q100 100 169 122" stroke="var(--ocean-cloud)" strokeWidth=".8" />
      <path d="M-5 238Q132 225 275 242Q387 254 489 235M756 234Q916 211 1207 237" stroke="var(--ocean-pearl)" opacity=".31" />
    </g>
    {!deep && !poster && <g className={s.moon} transform={`translate(${shore ? 992 : 996} ${shore ? 206 : 144})`}>
      <circle r={shore ? 69 : 54} fill="var(--ocean-moon)" opacity=".1" />
      <circle r={shore ? 49 : 39} fill="var(--ocean-moon)" opacity=".15" />
      {daylight ? <circle r="27" fill="var(--ocean-moon)"/> : <path d="M-24-18Q-34 8-14 24Q7 37 26 17Q37-3 23-20Q5-34-14-25Q-20-23-24-18Z" fill="var(--ocean-moon)" />}
      <path d="M-15-18q13-11 25-2M-20 2q5-9 12-10M7 17q9-1 13-8M-5 2q4-5 8-1" stroke="var(--ocean-moon-ink)" strokeWidth="1.4" opacity=".36" />
    </g>}
    <path d="M-40 270Q97 245 231 268Q345 295 463 269Q702 229 873 270Q1041 300 1240 258L1230 920H-30Z" fill={`url(#${id}-sea)`} />
    {!deep && <g opacity=".32">
      {Array.from({length:quality * 9 + 10}, (_, i) => {
        const y = 276 + i * 7.9;
        const width = 25 + i * 2.9 + i % 4 * 12;
        const x = 996 - width / 2 + stableSin(i * 2.5) * 12;
        return <path key={i} d={`M${x} ${y}q${width * .27} ${i % 2 ? -3 : 2} ${width * .45} 0t${width * .55} 1`} stroke="var(--ocean-pearl)" strokeWidth={i % 4 === 0 ? 4 : 1.5} strokeLinecap="round" opacity={.6 - i / (quality * 9 + 10) * .5} />;
      })}
    </g>}
    {!deep && quality >= 3 && <g stroke="var(--ocean-pearl)" strokeWidth="1.2" opacity=".47"><path d="M719 161q8-10 17 0q7-10 15-1M682 180q5-7 11 0q5-7 10-1M789 174q4-6 9-1q5-6 10-1" /></g>}
    <path d="M-42 381Q113 314 287 373Q479 429 688 343Q877 279 1219 362L1239 564Q1027 490 810 524Q521 575 319 485Q113 422-35 466Z" fill="var(--ocean-wash)" opacity=".32" />
    <path d="M-21 596Q211 505 390 592Q655 720 854 565Q1013 443 1239 541L1261 910H-24Z" fill="var(--ocean-deep-wash)" opacity=".43" />
    <path d="M-33 747Q151 640 338 719Q488 799 684 723Q936 638 1235 719L1240 900H-26Z" fill="var(--ocean-bottom)" opacity=".41" />
    <Contours quality={quality} shore={shore} />
    <g opacity=".46">
      {Array.from({ length: count.salt }, (_, i) => {
        const x = (i * 173 + 49) % 1240 - 20;
        const y = 277 + (i * 89) % 525;
        return <path key={i} d={`M${x} ${y}q${2 + i % 7} ${i % 2 ? -1.4 : 1.1} ${4 + i % 11} 0`} stroke={i % 4 ? "var(--ocean-line)" : "var(--ocean-foam)"} strokeWidth={i % 3 ? .7 : 1.5} opacity={.3 + i % 3 * .13} />;
      })}
    </g>
    {shore && <g>
      <path d="M-20 628Q197 572 364 699Q531 841 784 784Q971 719 1235 821V923H-20Z" fill="var(--ocean-sand)" />
      <path d="M-25 625Q194 569 368 696Q539 841 786 784Q967 718 1235 818" stroke="var(--ocean-foam)" strokeWidth="9" opacity=".7" />
      <path d="M-27 619Q194 562 377 688Q542 824 788 775Q969 708 1238 810" stroke="var(--ocean-foam)" strokeWidth="1.8" opacity=".8" />
      <path d="M-11 687Q195 632 350 757Q516 887 802 838Q982 788 1222 864" stroke="var(--ocean-sand-ink)" opacity=".27" />
      {Array.from({ length: shells }, (_, i) => <Shell key={i} x={80 + (i * 167) % 1070} y={789 + i * 37 % 104} size={.32 + i % 4 * .12} turn={i * 31 % 140 - 70} variant={i} />)}
    </g>}
    {!shore && listening?.discoveredRecordingCount != null && <g className={s.foundShells} data-listening-motif="first-listen-shells" opacity=".75">{Array.from({length:shells},(_,i)=><Shell key={i} x={i % 2 ? 1106 - i * 9 : 82 + i * 12} y={716 + i * 21} size={.55 + i % 3 * .13} turn={i * 29 - 40} variant={i}/>)}</g>}
    <g opacity={shore ? .46 : .8}>
      {Array.from({ length: count.plants }, (_, i) => <Kelp key={i} index={Math.floor(i / 2)} quality={quality} side={i % 2 ? "right" : "left"} />)}
    </g>
    {quality >= 3 && <g fill="none" stroke="var(--ocean-coral)" strokeLinecap="round" opacity=".45">
      {[40, 87, 1130, 1176].map((x, i) => <g key={x} transform={`translate(${x} 910) scale(${i % 2 ? -.8 : .8} .8)`}>
        <path d="M0 0Q-2-47 3-126M2-49Q-32-55-38-93M2-70Q30-83 32-126M-1-21Q-47-30-55-64M0-97Q-22-115-20-143" strokeWidth="5" />
        <path d="M-35-84l-20-12M-47-43l-21-9M25-108l18-23M1-115l17-32M-17-133l-14-23" strokeWidth="2" />
      </g>)}
    </g>}
    <g className={s.shoal} fill="var(--ocean-pearl)" opacity=".22">
      {Array.from({ length: count.fish }, (_, i) => {
        const x = 844 + i * 17 % 263, y = 365 + i * 31 % 155;
        return <path key={i} d={`M${x} ${y}q13-6 24 0q-10 5-24 0l-5 4v-8Z`} transform={`rotate(${-7 + i % 4 * 4} ${x} ${y})`} />;
      })}
    </g>
  </svg>;
}

function ReturningCurrents({ amount, portrait = false }: { amount: number; portrait?: boolean }) {
  return <g className={s.returningCurrents} data-listening-motif={amount > 0 ? "returning-currents" : undefined} fill="none" stroke="var(--ocean-ribbon)" strokeLinecap="round">
    {Array.from({length:amount},(_,n)=><path key={n} d={portrait ? `M-24 ${360 + n * 55}Q${78 + n * 2} ${297 + n * 55} 43 ${409 + n * 45}Q-1 ${456 + n * 39} 91 ${467 + n * 38}M416 ${481 + n * 48}Q320 ${409 + n * 48} 346 ${508 + n * 46}Q391 ${559 + n * 43} 301 ${581 + n * 40}` : `M-30 ${365 + n * 49}Q${251 + n * 9} ${288 + n * 47} 139 ${443 + n * 34}Q28 ${513 + n * 32} 283 ${531 + n * 28}M1240 ${452 + n * 43}Q${948 - n * 5} ${346 + n * 43} 1079 ${510 + n * 32}Q1207 ${591 + n * 32} 920 ${611 + n * 25}`} strokeWidth={n % 2 ? 1 : 2.3} opacity={.25 + n % 3 * .1}/>)}
  </g>;
}

const sceneShots: Partial<Record<BloomSceneKind, string>> = {
  opening: "surface", time: "deep", comparison: "terrace", days: "terrace", breadth: "surface",
  songs: "gallery", "song-winner": "portrait", artist: "portrait", "artist-songs": "gallery",
  artists: "reef", discoveries: "gallery", returns: "reef", genres: "reef", pattern: "deep", finale: "shore",
};

function PearlOpening({id,quality}:{id:string;quality:BloomWorldProps["quality"]}) {
  return <div className={s.pearlOpening} aria-hidden="true">
    <div className={s.openingDeep}/>
    <svg className={s.pearlTheatre} viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
      <defs><radialGradient id={`${id}-pearl-light`} cx=".35" cy=".27"><stop stopColor="#fff9dd"/><stop offset=".33" stopColor="#f7e4b9"/><stop offset=".72" stopColor="#b9c6bf"/><stop offset="1" stopColor="#547a84"/></radialGradient><radialGradient id={`${id}-pearl-aura`}><stop stopColor="#c9e1cc" stopOpacity=".46"/><stop offset=".33" stopColor="#8caebe" stopOpacity=".13"/><stop offset="1" stopColor="#72959d" stopOpacity="0"/></radialGradient></defs>
      <g className={s.pearlReflection}><path d="M600 460 525 725 675 725Z" fill={`url(#${id}-pearl-aura)`}/>{Array.from({length:8+quality*2},(_,n)=><path key={n} d={`M${582-n*3} ${477+n*14}q${15+n*2} -${3+n%3} ${36+n*6} 0`} stroke="#d9e4c8" strokeWidth={n%2?1:2} fill="none" opacity={.33-n*.013}/>)}</g>
      <g className={s.tidalRings} fill="none" stroke="#badbd2">{Array.from({length:4+quality},(_,n)=><ellipse className={s.tidalRing} key={n} cx="600" cy="469" rx={72+n*48} ry={11+n*9} opacity={.36-n*.025} style={{"--ring-delay":`${n*.16}s`} as CSSProperties}/>)}</g>
      <g className={s.tidalPearl}><circle cx="600" cy="394" r="220" fill={`url(#${id}-pearl-aura)`}/><circle cx="600" cy="394" r="48" fill={`url(#${id}-pearl-light)`}/><path d="M570 376q15-22 38-15M566 400q7-12 14-14M608 423q16-4 24-23" stroke="#fff2cf" strokeWidth="1.7" opacity=".5" fill="none"/><circle cx="584" cy="374" r="4" fill="#fff9e5" opacity=".75"/></g>
      <g className={s.pearlStars} fill="#cde0ce">{Array.from({length:8+quality*4},(_,n)=><circle key={n} cx={176+n*71%850} cy={248+n*57%337} r={n%3===0?1.8:.8} style={{"--mote-delay":`${n*.065}s`} as CSSProperties}/>)}</g>
      <g className={s.openingTide} fill="none" stroke="#c9ddc7"><path d="M-60 562Q157 474 365 567T775 562T1260 547" strokeWidth="2.4" opacity=".6"/><path d="M-20 579Q199 496 412 584T829 568T1240 568" strokeWidth=".8" opacity=".4"/></g>
    </svg>
  </div>;
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, children, listening, experience, openingPhase }: BloomWorldProps) {
  const id = `ocean-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const shot = sceneShots[scene] || "deep";
  const cover = view === "cover";
  const shore = shot === "shore" || view === "poster";
  const still = reducedMotion || quality === 1 || view === "poster";
  const dawn = listening?.peakHour == null ? shore ? 1 : Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) : Math.max(.08, stableSin((listening.peakHour - 6) / 24 * Math.PI * 2));
  const currents = Math.min(quality + 1,Math.max(0,listening?.returningRecordingCount || 0));
  const shells = listening?.discoveredRecordingCount == null ? undefined : Math.min(quality + 3,Math.max(0,listening.discoveredRecordingCount));
  const style = { "--ocean-dawn": dawn, "--ocean-stage": stage } as CSSProperties;
  return <section className={s.world} data-opening-phase={openingPhase} data-experience={experience?.composition} style={style} data-scene={scene} data-shot={shot} data-view={view} data-theme={theme} data-quality={quality} data-motion={still ? "still" : "full"} data-listening={Boolean(listening)} data-return-currents={listening?.returningRecordingCount == null ? undefined : currents} data-discovery-shells={shells} data-hour-light={listening?.peakHour == null ? undefined : dawn.toFixed(3)}>
    <div className={s.environment}><SeaPainting id={id} quality={quality} shore={shore} deep={shot === "deep" || shot === "portrait" || shot === "gallery"} poster={view === "poster"} listening={listening}/><svg className={s.currentPainting} viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><ReturningCurrents amount={currents}/></svg></div>
    <div className={s.portraitGarden} aria-hidden="true"><svg viewBox="0 0 390 900" preserveAspectRatio="none" fill="none">
      <g opacity={shore ? .3 : .56}>
        {Array.from({length:Math.min(quality,4)},(_,i)=><Kelp key={`left-${i}`} index={i} quality={quality} side="left" />)}
        <g transform="translate(-850 0)">{Array.from({length:Math.min(quality,4)},(_,i)=><Kelp key={`right-${i}`} index={i} quality={quality} side="right" />)}</g>
      </g>
      {quality >= 4 && <g opacity=".32" stroke="var(--ocean-coral)" strokeLinecap="round"><path d="M12 897Q22 844 15 793M17 850Q44 834 41 810M18 873Q-4 857-5 832M371 900Q351 848 363 790M358 850Q341 831 345 811M361 873Q383 850 383 825" strokeWidth="3" /></g>}
      <ReturningCurrents amount={currents} portrait/>
      {shells != null && <g opacity=".65">{Array.from({length:Math.min(4,shells)},(_,n)=><Shell key={n} x={38 + n * 103} y={841 + n % 2 * 19} size={.5} turn={n * 17 - 25} variant={n}/>)}</g>}
    </svg></div>
    {(cover || shot === "surface" || shot === "shore") && <div className={s.portraitMoon} aria-hidden="true"><svg viewBox="0 0 85 85" fill="none"><path d="M17 20Q7 45 25 64Q48 79 67 59Q81 36 62 18Q38 4 17 20Z" fill="var(--ocean-moon)" /><path d="M21 27q10-12 22-7M17 45q6-8 12-9M46 62q11-2 15-13" stroke="var(--ocean-moon-ink)" strokeWidth="1.3" opacity=".4" /></svg></div>}
    <div className={s.dawn} aria-hidden="true" />
    <div className={s.swells} aria-hidden="true">
      {Array.from({ length: detail[quality].swells }, (_, i) => <div className={s.swell} key={i} style={{ "--swell-delay": `${i * .43}s`, "--swell-top": `${48 + i * 9}%`, "--swell-size": `${80 + i * 14}%` } as CSSProperties}>
        <svg viewBox="0 0 1200 160" preserveAspectRatio="none" fill="none"><path d="M-100 98Q150-19 353 97Q551 194 795 92Q1000 7 1300 91" stroke="var(--ocean-foam)" strokeWidth={i % 2 ? 1 : 2.7} opacity={i % 2 ? .11 : .17} /><path d="M-100 107Q150-10 353 106Q551 203 795 101Q1000 16 1300 100" stroke="var(--ocean-line)" strokeWidth=".8" opacity=".2" /></svg>
      </div>)}
    </div>
    <div className={s.ribbon} aria-hidden="true"><svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" fill="none"><path d={shore ? "M-30 625Q194 569 368 696Q539 841 786 784Q967 718 1235 818" : shot === "portrait" ? "M-30 664Q46 563 158 519Q295 477 412 650Q511 782 725 743Q859 728 958 626Q1077 510 1240 594" : shot === "gallery" ? "M-30 665Q138 608 293 705Q523 852 766 739Q997 625 1255 705" : "M-60 542Q158 473 331 570Q490 653 686 565Q927 444 1240 522"} stroke="var(--ocean-ribbon)" strokeWidth="3" opacity=".35" /><path d="M-23 810Q175 749 269 805M948 812Q1088 775 1216 829" stroke="var(--ocean-ribbon)" opacity=".23" /></svg></div>
    {scene === "song-winner" && <div className={s.recognition} aria-hidden="true"><svg viewBox="0 0 600 460" fill="none"><path d="M92 344Q-22 175 150 72Q365-46 533 142Q654 320 442 398Q209 475 92 344Z" stroke="var(--ocean-ribbon)" strokeWidth="1.2" opacity=".5" /><path d="M112 354Q-3 171 170 92Q379 8 508 162Q603 310 421 383Q219 450 112 354Z" stroke="var(--ocean-foam)" opacity=".3" /><path d="M129 60Q178 25 233 28M487 364Q533 327 541 282" stroke="var(--ocean-pearl)" strokeWidth="3" strokeLinecap="round" /></svg></div>}
    {(cover || scene === "opening" || view === "poster") && <div className={s.titleArt}><PaintedTitle cover={cover} /><div className={s.titleRule} aria-hidden="true" /></div>}
    <div className={s.content}><ListeningPainting world="ocean" experience={experience} scene={scene} stage={stage} listening={listening} quality={quality} reducedMotion={reducedMotion} view={view}/>{children}</div>
    <div className={s.edgeMark} aria-hidden="true"><svg viewBox="0 0 100 36" fill="none"><path d="M3 19Q18 3 31 18Q47 34 60 18Q76 2 93 18M7 26Q22 10 35 25Q48 36 63 25" stroke="currentColor" strokeWidth=".9" /><circle cx="94" cy="18" r="1.5" fill="currentColor" /></svg></div>
    {openingPhase && <PearlOpening id={id} quality={quality}/>}
  </section>;
}
