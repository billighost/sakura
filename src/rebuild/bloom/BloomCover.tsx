"use client";
import {memo} from "react";
import type {BloomDesign,BloomListeningProfile} from "./uiTypes";
import {BloomCoverMarks} from "./BloomCoverMarks";
import {bloomWorld} from "./worlds/registry";
import {bloomCoverImage} from "./coverAssets";
import type {BloomExperience} from "./experience";
import {stableCos,stableSin} from "./worlds/stableTrig";
import s from "./cinema.module.css";

/** A persistent bitmap of the authored world; scroll never mounts a cinematic scene. */
export const BloomCover=memo(function BloomCover({design,theme,listening,experience,sizes="(max-width:750px) calc(100vw - 48px), 50vw"}:{design:BloomDesign;theme:"light"|"dark";listening?:BloomListeningProfile;experience?:BloomExperience;sizes?:string}){
 const world=bloomWorld(design),image=bloomCoverImage(design,theme);
 return <div className={s.cardArt} data-bloom-cover={world.id} data-theme={theme} data-experience={experience?.seed} data-composition={experience?.composition} style={{background:world.colours[0]}}>
  {/* These pre-rendered WebPs are already bounded and supplied in two sizes. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img {...image} alt={`${world.name} illustrated cover`} sizes={sizes} loading="lazy" decoding="async" fetchPriority="low" style={experience?{filter:`hue-rotate(${[0,12,-12,22][experience.palette]}deg) saturate(${[1,1.08,.88,1.12][experience.palette]})`}:undefined}/>
  {experience&&<svg className={s.coverEdition} viewBox="0 0 400 300" aria-hidden="true"><rect x={12+experience.composition*3} y={12+experience.composition*3} width={376-experience.composition*6} height={276-experience.composition*6} rx={experience.composition*10}/>{Array.from({length:5},(_,index)=><circle key={index} cx={Number((334+stableCos(index*Math.PI*2/5+experience.seed%6)*14).toFixed(3))} cy={Number((252+stableSin(index*Math.PI*2/5+experience.seed%6)*14).toFixed(3))} r={5+(experience.seed>>(index*3)&3)}/>)}</svg>}
  <BloomCoverMarks world={world.id} listening={listening}/>
 </div>;
});
