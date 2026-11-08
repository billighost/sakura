"use client";
import {memo} from "react";
import type {BloomDesign} from "./uiTypes";
import {bloomWorld} from "./worlds/registry";
import {bloomCoverImage} from "./coverAssets";
import s from "./cinema.module.css";

/** A persistent bitmap of the authored world; scroll never mounts a cinematic scene. */
export const BloomCover=memo(function BloomCover({design,theme}:{design:BloomDesign;theme:"light"|"dark"}){
 const world=bloomWorld(design),image=bloomCoverImage(design,theme);
 return <div className={s.cardArt} data-bloom-cover={world.id} data-theme={theme} style={{background:world.colours[0]}}>
  {/* These pre-rendered WebPs are already bounded and supplied in two sizes. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img {...image} alt={`${world.name} illustrated cover`} sizes="(max-width:750px) calc(100vw - 48px), 50vw" loading="eager" decoding="async" fetchPriority="low"/>
 </div>;
});
