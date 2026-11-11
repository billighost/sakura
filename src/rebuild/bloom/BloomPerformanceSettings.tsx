"use client";
import {useMusic} from "../app/MusicContext";
import {SelectPopover} from "../app/SelectPopover";
import {BLOOM_QUALITY_LEVELS,type BloomPerformance} from "./performance";
import {useBloomPerformance} from "./useBloomPerformance";
import s from "./cinema.module.css";
export function BloomPerformanceSettings(){
 const p=useMusic();const {quality,automatic}=useBloomPerformance(p.settings.bloomPerformance);
 async function change(value:BloomPerformance){try{await p.updateSettings({bloomPerformance:value});}catch(error){p.reportError(error,"save",()=>void change(value));}}
 return <section className={s.performanceSettings}><span className={s.eyebrow}>SAKURA BLOOM</span><h2>Artwork and motion.</h2><p>Choose the detail in your listening worlds. Lower levels use fewer details and less motion.</p><label className={s.autoChoice}><span><b>Bloom detail</b><small>Automatic chooses a detail level to suit this device.</small></span><SelectPopover<BloomPerformance> label="Bloom detail" value={p.settings.bloomPerformance||"auto"} onChange={value=>void change(value)} options={[{value:"auto",label:"Automatic · "+BLOOM_QUALITY_LEVELS[automatic-1].name},...BLOOM_QUALITY_LEVELS.map(level=>({value:String(level.tier) as BloomPerformance,label:level.tier+" · "+level.name,description:level.description}))]}/></label><div className={s.qualityChoices} role="group" aria-label="Bloom detail levels">{BLOOM_QUALITY_LEVELS.map(level=><button key={level.tier} aria-pressed={p.settings.bloomPerformance===String(level.tier)} onClick={()=>void change(String(level.tier) as BloomPerformance)}><span>{String(level.tier).padStart(2,"0")}</span><b>{level.name}</b><small>{level.description}</small></button>)}</div><p className={s.qualityNote}>Current level: {quality} · {BLOOM_QUALITY_LEVELS[quality-1].name}. A level you choose stays in use. “Keep motion gentle” applies at every level.</p></section>;
}
