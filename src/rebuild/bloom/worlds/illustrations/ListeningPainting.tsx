import type { CSSProperties } from "react";
import type { BloomWorldProps, BloomWorldId } from "../types";
import { listeningPaintingLayout, paintingFraction } from "./layout";
import s from "./painting.module.css";

const pigments: Record<BloomWorldId, readonly string[]> = {
  sakura: ["#cf8d99", "#9daf82", "#dfb782", "#ada9ba"],
  jungle: ["#c0cf9d", "#82b39e", "#dfa990", "#d8c194"],
  disco: ["#dfb48f", "#ac8cbd", "#d89c9a", "#b0c1af"],
  japan: ["#bd6f58", "#899f86", "#b59a6b", "#7a9faa"],
  china: ["#b07363", "#80958a", "#ba9d72", "#8797a4"],
  korea: ["#b07366", "#8b9b80", "#c4a069", "#809da6"],
  india: ["#e0ad9a", "#d9c486", "#99b7a5", "#b6a0b6"],
  ocean: ["#d6bca2", "#9fc4bd", "#c99ea9", "#ccd4ac"],
  cosmos: ["#b88f54", "#839a90", "#bc8982", "#92a4b6"],
  glass: ["#c09a8a", "#9fb593", "#d8bf82", "#83aaa3"],
};

/** Each drawing shares a 48px frame so its silhouette can change with the world. */
function Keepsake({ world, colour }: { world: BloomWorldId; colour: string }) {
  const ink = "currentColor";
  if (world === "sakura" || world === "india") return <g fill={colour} stroke={ink} strokeWidth=".7"><path d="M0 1C-16-6-15-22-5-21L0-14 5-21C16-22 16-6 0 1Z"/><path d="M0 1C7-17 23-14 21-4L14 0 21 5C22 16 7 16 0 1Z"/><path d="M0 1C15 9 12 24 2 22L-2 16-8 21C-19 19-16 5 0 1Z"/><path d="M0 1C-14 13-26 4-20-4L-13-5-15-13C-9-22 3-14 0 1Z"/><circle cy="1" r="4" fill={ink}/><path d="M0 25v16M1 33Q12 20 18 28Q12 37 1 33" fill="none" strokeWidth="1.2"/></g>;
  if (world === "jungle") return <g stroke={ink} strokeWidth="1" fill={colour}><path d="M-23 13Q-18-26 23-16Q23 20-23 13Z"/><path d="M-23 13 23-16M-10 7-10-7M0 0 0-15M10-7 9-20M-10 7 4 12M1-1 15 4" fill="none"/><path d="M-23 13q-6 8 0 13" fill="none"/></g>;
  if (world === "disco") return <g><circle r="23" fill={colour} stroke={ink}/>{[17, 12].map(radius => <circle key={radius} r={radius} fill="none" stroke={ink} strokeWidth=".7" opacity=".55"/>)}<circle r="7" fill={ink}/><circle r="2" fill={colour}/><path d="M-16-11q5-9 17-7M15 12q-3 6-11 7" fill="none" stroke={ink} strokeWidth="1.4"/></g>;
  if (world === "japan") return <g stroke={ink} strokeWidth=".9"><path d="M-11-22H11L19-8V16L11 24H-11L-19 16V-8Z" fill={colour}/><path d="M-11-21 0-12 11-21M-19-8H19M-19 4H19M-19 16H19M0-12V24M-11-21-9 24M11-21 9 24" fill="none"/><path d="M-8-26H8M-8 27H8M0 27V36M-4 31V39M4 31V39" fill="none"/></g>;
  if (world === "china") return <g stroke={ink} strokeWidth="1"><path d="M-25 11H25L14 24H-16Z" fill={colour}/><path d="M-1 10V-24L21 4H2" fill={colour}/><path d="M-26 31q13-6 27 0t26 0M-20 38q14-4 32 0" fill="none" opacity=".65"/></g>;
  if (world === "korea") return <g stroke={ink} strokeWidth="1"><path d="M-20-23H15L22-16V25H-20Z" fill={colour}/><path d="M-13-23V25M-18 18H22M-6-12H12M-6-6H8M-6 2H13" fill="none"/><path d="M6-22H12V9L9 5 6 9Z" fill={ink} opacity=".5"/></g>;
  if (world === "ocean") return <g stroke={ink} strokeWidth=".85"><path d="M0 24Q-32 3-21-16Q-11-28 0-19Q11-28 21-16Q32 3 0 24Z" fill={colour}/><path d="M0 24V-19M0 24-11-22M0 24 11-22M0 24-22-12M0 24 22-12M0 24-26 1M0 24 26 1" fill="none"/><path d="M-10 23H10L6 29H-6Z" fill={colour}/></g>;
  if (world === "cosmos") return <g fill={colour} stroke={ink} strokeWidth=".8"><path d="m0-24 7 16 17 8-17 8-7 16-7-16-17-8 17-8Z"/><path d="M0-24V24M-24 0H24" opacity=".45"/><circle r="29" fill="none" strokeDasharray="1 5" opacity=".5"/></g>;
  return <g stroke={ink} strokeWidth="1.4"><path d="M0-27 23-13V14L0 27-23 14V-13Z" fill={colour}/><path d="M0-27V27M-23-13 23 14M23-13-23 14" fill="none"/><path d="M0-13 11-6V7L0 14-11 7V-6Z" fill="none" strokeWidth=".8"/></g>;
}

/** Saved experiences carry the seed; no wall clock or browser randomness enters the artwork. */
export function ListeningPainting({ world, experience, scene, stage, listening, quality, reducedMotion, view }: Pick<BloomWorldProps, "experience" | "scene" | "stage" | "listening" | "quality" | "reducedMotion" | "view"> & { world: BloomWorldId }) {
  if (!experience || view !== "story" || (scene !== "time" && scene !== "pattern")) return null;
  // The time chapter stays ornamental on replay, even after all later hours
  // have been disclosed; only the hours scene paints those measurements.
  const model = listeningPaintingLayout(experience.seed, experience.composition, stage, scene === "pattern" ? listening : undefined);
  const colours = pigments[world];
  const still = reducedMotion || quality === 1;
  return <div className={s.painting} data-world-painting={world} data-painting-layout={model.layout} data-measured-hours={model.measured} data-motion={still ? "still" : "full"} aria-hidden="true" style={{ "--painting-ink": colours[(experience.palette + 1) % 4] } as CSSProperties}>
    <svg viewBox="0 0 480 216" focusable="false">
      {model.layout === "orbit" && <g fill="none" stroke="currentColor" strokeWidth=".8" opacity=".55"><ellipse cx="240" cy="108" rx="158" ry="65"/><ellipse cx="240" cy="108" rx="126" ry="44" strokeDasharray="2 7"/><path d="M48 108H432M240 23V193" strokeDasharray="1 9"/></g>}
      {model.layout === "ribbon" && <g fill="none" stroke="currentColor" opacity=".6">{[0, 1, 2].map(n => <path key={n} d={`M14 ${145+n*7}C109 ${80+n*5} 147 ${175-n*9} 243 ${122+n*3}S376 ${43+n*12} 467 ${96+n*10}`} strokeWidth={n === 0 ? 1.6 : .65}/>)}</g>}
      {model.layout === "fan" && <g fill="none" stroke="currentColor" opacity=".65"><path d="M38 161Q240-73 442 161L240 189Z" strokeWidth="1"/><path d="M58 159Q240-44 422 159M79 157Q240-12 401 157" strokeWidth=".65"/>{model.bands.map((band, index) => <path key={band.id} d={`M240 189 ${band.x} 53`} stroke={colours[(index+experience.palette)%4]} strokeWidth={band.share === undefined ? 2 : 1 + band.share * 8}/>)}</g>}
      {model.layout === "gallery" && <g fill="none" stroke="currentColor" strokeWidth=".7" opacity=".7"><path d="M16 29Q240 66 464 29M16 34Q240 71 464 34"/>{model.bands.map(band => <path key={band.id} d={`M${band.x} 47V${band.y-29}`}/>)}</g>}
      {model.bands.map((band, index) => <g key={band.id} data-hour-band={model.measured ? band.id : undefined} data-hour-share={band.share} className={s.keepsake} style={{ "--keepsake-delay": `${index * .1}s` } as CSSProperties}>
        <g transform={`translate(${band.x.toFixed(3)} ${band.y.toFixed(3)}) rotate(${band.turn.toFixed(3)}) scale(${band.scale.toFixed(3)})`}><Keepsake world={world} colour={colours[(index + experience.palette) % 4]}/></g>
        {model.layout === "gallery" && <path d={`M${band.x-28} 168H${band.x+28}M${band.x-16} 174H${band.x+16}`} fill="none" stroke="currentColor" strokeWidth=".7" opacity=".5"/>}
      </g>)}
      {quality >= 3 && Array.from({ length: 8 }, (_, index) => <g key={index} fill="none" stroke="currentColor" strokeWidth=".65" opacity=".45" transform={`translate(${(24+paintingFraction(experience.seed, 100+index)*432).toFixed(3)} ${(22+paintingFraction(experience.seed, 120+index)*174).toFixed(3)})`}><path d="M-3 0H3M0-3V3"/><circle r="5" strokeDasharray="1 7"/></g>)}
      <path d="M144 202H214M266 202H336M231 202l9-4 9 4-9 4Z" fill="none" stroke="currentColor" strokeWidth=".7" opacity=".65"/>
    </svg>
  </div>;
}
