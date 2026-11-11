"use client";
import { useEffect, useRef, useState } from "react";
import { SelectPopover } from "@/rebuild/app/SelectPopover";
import { PlaybackRibbon, VolumeControl, GardenSlider } from "@/rebuild/app/ListeningControls";

const choices = [{value:"light",label:"Light paper"},{value:"warm",label:"Warm paper"},{value:"dark",label:"Dark ink"},{value:"unavailable",label:"Unavailable ink",disabled:true}];
export default function ControlsRoom() {
 const [color,setColor]=useState("light"),[position,setPosition]=useState(10000),[commits,setCommits]=useState(0),[volume,setVolume]=useState(.6),[many,setMany]=useState("0");
 const modal=useRef<HTMLDialogElement>(null);
 const room=useRef<HTMLElement>(null);
 useEffect(()=>{if(room.current)room.current.dataset.hydrated="true";},[]);
 return <main ref={room} style={{maxWidth:650,margin:"40px auto",padding:24}}><h1 style={{fontFamily:"Georgia,serif",fontWeight:400}}>Paper, petals & little threads.</h1>
  <SelectPopover label="Paper color" value={color} onChange={setColor} options={choices}/><output data-color>{color}</output>
  <div style={{marginTop:24}}><SelectPopover label="Many choices" value={many} onChange={setMany} options={Array.from({length:24},(_,i)=>({value:String(i),label:"Hour "+String(i).padStart(2,"0")}))}/></div>
  <div style={{marginTop:32}}><PlaybackRibbon positionMs={position} durationMs={180000} onSeek={value=>{setPosition(value);setCommits(value=>value+1);}}/><output data-commits>{commits}</output><output data-position>{position}</output></div>
  <VolumeControl label="Control volume" value={volume} onChange={setVolume}/><GardenSlider label="Garden intensity" value={volume} onChange={setVolume}/>
  <button type="button" onClick={()=>modal.current?.showModal()}>Open paper dialog</button><button type="button">Outside choices</button>
  <dialog ref={modal} style={{width:290,padding:24,overflow:"hidden",background:"var(--ink-card)",color:"var(--ink-text)"}}><h2>Inside a little note.</h2><SelectPopover label="Dialog ink" value={color} onChange={setColor} options={choices}/><button type="button" onClick={()=>modal.current?.close()}>Close paper dialog</button></dialog>
 </main>;
}
