"use client";
import { useMusic } from "./MusicContext";
import { type MusicTrack } from "./types";
import { SectionTitle } from "./Elements";
import { planOfflineMixes } from "../recommendations/situations";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import { DownloadsRoom } from "./DownloadsRoom";
import s from "./ink.module.css";

function OfflineShelves({tracks}:{tracks:MusicTrack[]}){
 const p=useMusic();const mixes=planOfflineMixes(tracks.map(t=>({...t,liked:p.liked.has(p.effectiveId(t))})),{seed:"offline:"+new Date().toISOString().slice(0,10)}).filter(m=>m.status==="ready").slice(0,6);
 if(!mixes.length)return null;return <><SectionTitle title="A few paths through your saved songs" note="Mixes made entirely from songs downloaded on this device."/><div className={s.offlineMixes}>{mixes.map(mix=><button key={mix.id} onClick={()=>{const byId=new Map(tracks.map(t=>[t.id,t]));const queue=mix.recordingIds.map(id=>byId.get(id)).filter((t):t is MusicTrack=>Boolean(t));if(queue.length)p.play(queue[0],queue);}}><Blossom/><span><b>{mix.name}</b><small>{mix.trackCount} songs · ready offline</small></span><Icon name="play" size={18}/></button>)}</div></>;
}

export function Downloads(){return <DownloadsRoom offlineShelves={tracks=><OfflineShelves tracks={tracks}/>}/>;}
