"use client";
import {useMusic} from "../app/MusicContext";
import {BLOOM_QUALITY_LEVELS,type BloomPerformance} from "./performance";
import {useBloomPerformance} from "./useBloomPerformance";
import s from "./cinema.module.css";
export function BloomPerformanceSettings(){
 const p=useMusic();const {quality,automatic}=useBloomPerformance(p.settings.bloomPerformance);
 async function change(value:BloomPerformance){try{await p.updateSettings({bloomPerformance:value});}catch(error){p.reportError(error,"save",()=>void change(value));}}
 return <section className={s.performanceSettings}><span className={s.eyebrow}>SAKURA BLOOM</span><h2>How much wonder?</h2><p>Choose how richly your listening worlds come to life.</p><label className={s.autoChoice}><span><b>Bloom performance</b><small>Automatic chooses a starting level from this device and its frame timing.</small></span><select aria-label="Bloom performance" value={p.settings.bloomPerformance||"auto"} onChange={e=>void change(e.target.value as BloomPerformance)}><option value="auto">Automatic · {BLOOM_QUALITY_LEVELS[automatic-1].name}</option>{BLOOM_QUALITY_LEVELS.map(level=><option key={level.tier} value={String(level.tier)}>{level.tier} · {level.name}</option>)}</select></label><div className={s.qualityChoices} role="group" aria-label="Bloom quality levels">{BLOOM_QUALITY_LEVELS.map(level=><button key={level.tier} aria-pressed={p.settings.bloomPerformance===String(level.tier)} onClick={()=>void change(String(level.tier) as BloomPerformance)}><span>{String(level.tier).padStart(2,"0")}</span><b>{level.name}</b><small>{level.description}</small></button>)}</div><p className={s.qualityNote}>Current level: {quality} · {BLOOM_QUALITY_LEVELS[quality-1].name}. Your choice always overrides automatic selection. Keep motion gentle still applies at every level.</p></section>;
}
