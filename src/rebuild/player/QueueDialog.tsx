"use client";
import { useRef, useState, type PointerEvent } from "react";
import { useMusic } from "../app/MusicContext";
import { upcomingQueue } from "../app/listeningQueue";
import type { QueueEntry } from "../app/types";
import { ArtistLinks } from "../app/ArtistLinks";
import { Artwork, formatPlaybackTime, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { requestDialogClose } from "../app/dialogLifecycle";
import {SmartQueueButton} from "../app/SmartQueueButton";
import s from "./player.module.css";

export function QueueDialog({ onClose }: { onClose: () => void }) {
  const music = useMusic();
  const close = () => requestDialogClose(onClose);
  const upcoming = upcomingQueue(music.queue, music.currentEntryId);
  const manual = upcoming.filter(entry => entry.priority === "manual");
  const automatic = upcoming.filter(entry => entry.priority !== "manual");
  const drag = useRef<{entryId:string;pointerId:number;startY:number;beforeId:string|null;changed:boolean}|null>(null);
  const [dragging,setDragging] = useState<string|null>(null);
  const [dropBefore,setDropBefore] = useState<string|null>(null);
  function begin(event:PointerEvent<HTMLButtonElement>,entry:QueueEntry){
    if(event.button!==0)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={entryId:entry.entryId,pointerId:event.pointerId,startY:event.clientY,beforeId:entry.entryId,changed:false};
  }
  function move(event:PointerEvent<HTMLButtonElement>,entries:QueueEntry[]){
    const state=drag.current;if(!state||state.pointerId!==event.pointerId)return;
    if(Math.abs(event.clientY-state.startY)<5&&!state.changed)return;
    state.changed=true;setDragging(state.entryId);
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>("[data-queue-entry]");if(!row)return;
    const index=entries.findIndex(entry=>entry.entryId===row.dataset.queueEntry);if(index<0){state.beforeId=state.entryId;setDropBefore(null);return;}
    const rect=row.getBoundingClientRect();state.beforeId=event.clientY>rect.top+rect.height/2?(entries[index+1]?.entryId??null):entries[index].entryId;setDropBefore(state.beforeId);
    const scroll=row.closest<HTMLElement>("[data-player-scroll]");if(scroll){const area=scroll.getBoundingClientRect();if(event.clientY<area.top+48)scroll.scrollTop-=14;else if(event.clientY>area.bottom-48)scroll.scrollTop+=14;}
  }
  function finish(event:PointerEvent<HTMLButtonElement>,cancel=false){
    event.stopPropagation();const state=drag.current;if(state?.changed&&!cancel)music.reorderQueue(state.entryId,state.beforeId);
    drag.current=null;setDragging(null);setDropBefore(null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function group(entries:QueueEntry[],title:string){
    return entries.length>0&&<section className={s.queueSection} aria-label={title}>
      <div className={s.queueSectionHeading}><h3>{title}</h3><span>{entries.length}</span></div>
      <ol className={s.queueList}>{entries.map((entry,index)=><li key={entry.entryId} data-queue-entry={entry.entryId} className={`${s.queueItem} ${dragging===entry.entryId?s.draggingQueue:""} ${dragging&&dropBefore===entry.entryId?s.queueDropBefore:""}`}>
        <button className={s.queueGrip} type="button" aria-label={`Drag to reorder ${entry.track.title}`} title="Drag to reorder, or use the arrow buttons" onPointerDown={event=>begin(event,entry)} onPointerMove={event=>move(event,entries)} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onKeyDown={event=>{if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();event.stopPropagation();music.moveQueue(entry.entryId,event.key==="ArrowUp"?-1:1);}}}><svg width="16" height="22" viewBox="0 0 16 22" fill="currentColor" aria-hidden="true">{[6,11,16].map(y=><g key={y}><circle cx="5" cy={y} r="1.2"/><circle cx="11" cy={y} r="1.2"/></g>)}</svg></button>
        <div className={s.queueSong}><button className={s.queueCoverButton} type="button" aria-label={`Play ${entry.track.title}`} onClick={event=>{event.stopPropagation();music.playQueueEntry(entry.entryId);}}><Artwork url={entry.track.coverUrl} title={entry.track.title}/></button><span><button className={s.queueTitleButton} type="button" onClick={event=>{event.stopPropagation();music.playQueueEntry(entry.entryId);}}><strong>{entry.track.title}</strong></button><small onClick={close}><ArtistLinks track={entry.track}/></small><small>{entry.track.versionLabel}</small></span></div>
        <div className={s.queueActions}><IconButton icon="up" label={`Move ${entry.track.title} earlier`} disabled={index===0} onClick={event=>{event.stopPropagation();music.moveQueue(entry.entryId,-1);}}/><IconButton icon="down" label={`Move ${entry.track.title} later`} disabled={index===entries.length-1} onClick={event=>{event.stopPropagation();music.moveQueue(entry.entryId,1);}}/><IconButton icon="close" label={`Remove ${entry.track.title} from queue`} onClick={event=>{event.stopPropagation();music.removeQueue(entry.entryId);}}/></div>
      </li>)}</ol>
    </section>;
  }
  return <PlayerDialog title="Your next songs." subtitle="YOUR QUEUE" onClose={onClose} className={s.queueDialog} appearance="queue" footer={<PlayerButton secondary onClick={close}>Back to listening</PlayerButton>}>
    {music.track&&<div className={`${s.queueNow} ${s.currentQueue}`} aria-current="true"><Artwork url={music.track.coverUrl} title={music.track.title}/><div><p className={s.eyebrow}>NOW PLAYING</p><strong>{music.track.title}</strong><p onClick={close}><ArtistLinks track={music.track}/></p><small>{music.track.versionLabel}</small></div><IconButton icon={music.status==="playing"?"pause":"play"} label={music.status==="playing"?"Pause":"Play"} onClick={music.togglePlay}/></div>}
    <div className={s.queueHeading}><div><h3>Up next</h3><p>{upcoming.length} songs · {formatPlaybackTime(upcoming.reduce((sum,entry)=>sum+entry.track.durationMs,0))}</p></div><SmartQueueButton scope={music.offline?"downloads":"all"} append iconOnly label="Find songs for my queue"/>{upcoming.length>0&&<PlayerButton secondary onClick={music.clearQueue}>Clear queue</PlayerButton>}</div>
    {!upcoming.length&&<div className={s.empty}><p>No songs queued.</p><PlayerButton secondary onClick={close}>Browse music</PlayerButton></div>}
    {group(manual,"Added by you")}
    {group(automatic,"Continuing your listening")}
    {music.parkedPicks.length>0&&<section className={s.queueSection} aria-label="Your picks, kept for later"><div className={s.queueSectionHeading}><h3>Your picks, kept for later</h3><span>{music.parkedPicks.length}</span></div><p>These picks are waiting while your offline soundtrack plays.</p><ol className={s.queueList}>{music.parkedPicks.slice(0,3).map(entry=><li className={s.queueItem} key={entry.entryId}><div className={s.queueSong}><Artwork url={entry.track.coverUrl} title={entry.track.title}/><span><strong>{entry.track.title}</strong><small><ArtistLinks track={entry.track}/></small></span></div></li>)}</ol>{music.parkedPicks.length>3&&<p>And {music.parkedPicks.length-3} more of your picks.</p>}<PlayerButton secondary disabled={music.offline} onClick={music.restoreParkedPicks}>Bring back my picks</PlayerButton>{music.offline&&<p>Reconnect to bring your picks back into the queue.</p>}</section>}
  </PlayerDialog>;
}
