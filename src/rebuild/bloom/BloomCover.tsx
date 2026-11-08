"use client";
import {memo} from "react";
import type {BloomDesign,BloomListeningProfile} from "./uiTypes";
import {BloomCoverMarks} from "./BloomCoverMarks";
import {bloomWorld} from "./worlds/registry";
import {bloomCoverImage} from "./coverAssets";
import s from "./cinema.module.css";

/** A persistent bitmap of the authored world; scroll never mounts a cinematic scene. */
export const BloomCover=memo(function BloomCover({design,theme,listening,sizes="(max-width:750px) calc(100vw - 48px), 50vw"}:{design:BloomDesign;theme:"light"|"dark";listening?:BloomListeningProfile;sizes?:string}){
 const world=bloomWorld(design),image=bloomCoverImage(design,theme);
 return <div className={s.cardArt} data-bloom-cover={world.id} data-theme={theme} style={{background:world.colours[0]}}>
  {/* These pre-rendered WebPs are already bounded and supplied in two sizes. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img {...image} alt={`${world.name} illustrated cover`} sizes={sizes} loading="lazy" decoding="async" fetchPriority="low"/>
  <BloomCoverMarks world={world.id} listening={listening}/>
 </div>;
});
