"use client";
import dynamic from "next/dynamic";
import type {BloomWorldProps} from "./types";
import {bloomWorld} from "./registry";
import type {BloomDesign} from "../uiTypes";
import s from "./world-stage.module.css";
const components={
 sakura:dynamic(()=>import("./sakura/World")),jungle:dynamic(()=>import("./jungle/World")),disco:dynamic(()=>import("./disco/World")),
 japan:dynamic(()=>import("./japan/World")),china:dynamic(()=>import("./china/World")),korea:dynamic(()=>import("./korea/World")),
 india:dynamic(()=>import("./india/World")),ocean:dynamic(()=>import("./ocean/World")),cosmos:dynamic(()=>import("./cosmos/World")),glass:dynamic(()=>import("./glass/World")),
};
export function WorldStage({design,...props}:BloomWorldProps&{design:BloomDesign}){const world=bloomWorld(design),Component=components[world.id];return <div className={s.stage} data-bloom-world={world.id} data-bloom-seed={props.experience?.seed} data-bloom-composition={props.experience?.composition} data-bloom-palette={props.experience?.palette} style={{width:"100%",height:"100%",minHeight:"inherit"}}><Component {...props}/></div>;}
