"use client";
import { memo, useMemo } from "react";
import { useMusicActions, useMusicView } from "./musicView";
import { type MusicTrack } from "./types";
import { SectionTitle } from "./Elements";
import { planOfflineMixes } from "../recommendations/situations";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import { DownloadsRoom } from "./DownloadsRoom";
import s from "./ink.module.css";

const OfflineShelves=memo(function OfflineShelves({tracks}:{tracks:MusicTrack[]}){
 const view=useMusicView(),actions=useMusicActions(),seed="offline:"+new Date().toISOString().slice(0,10);
 // The stable action reads mutable aliases; their revision invalidates this projection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const mixes=useMemo(()=>planOfflineMixes(tracks.map(track=>({...track,liked:view.liked.has(actions.effectiveId(track))})),{seed}).filter(mix=>mix.status==="ready").slice(0,6),[tracks,view.liked,actions,view.aliasesRevision,seed]);
 const byId=useMemo(()=>new Map(tracks.map(track=>[track.id,track])),[tracks]);
 if(!mixes.length)return null;return <><SectionTitle title="A few paths through your saved songs" note="Mixes made entirely from songs downloaded on this device."/><div className={s.offlineMixes}>{mixes.map(mix=><button key={mix.id} onClick={()=>{const queue=mix.recordingIds.map(id=>byId.get(id)).filter((t):t is MusicTrack=>Boolean(t));if(queue.length)actions.play(queue[0],queue);}}><Blossom/><span><b>{mix.name}</b><small>{mix.trackCount} songs · ready offline</small></span><Icon name="play" size={18}/></button>)}</div></>;
});

const offlineShelves=(tracks:MusicTrack[])=><OfflineShelves tracks={tracks}/>;
export function Downloads(){return <DownloadsRoom offlineShelves={offlineShelves}/>;}
