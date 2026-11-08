"use client";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useState } from "react";
import { useMusic } from "./MusicContext";
import { invalidateResources } from "./resources";
import type { MusicTrack } from "./types";
import { Icon } from "./Icon";
import { ArtistLinks } from "./ArtistLinks";
import { requestJson, userIssue, type UserIssue } from "./errors";
import s from "./touch.module.css";

export interface SongMenuAnchor {left:number;top:number;width:number;height:number}
export function TrackActions({track,onClose,anchor}:{track:MusicTrack;onClose:()=>void;anchor?:SongMenuAnchor}){
  const music=useMusic();
  const menu=useRef<HTMLDivElement>(null);
  const [playlists,setPlaylists]=useState<Array<{id:string;name:string}>|null>(null);
  const [busy,setBusy]=useState(false);const busyRef=useRef(false);
  const [failure,setFailure]=useState<{issue:UserIssue;retry:()=>void}|null>(null);
  const close=useRef(onClose);
  const owner=useRef(music.account?.id);const requestVersion=useRef(0);const requestController=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useLayoutEffect(()=>{const version=requestVersion.current+1;requestVersion.current=version;if(owner.current!==music.account?.id){owner.current=music.account?.id;close.current();}return()=>{requestVersion.current=version+1;requestController.current?.abort();};},[music.account?.id,track.id]);
  useLayoutEffect(()=>{
    const element=menu.current;if(!element)return;
    const previous=document.activeElement;
    const origin=anchor||(previous instanceof HTMLElement?previous.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0});
    function place(){
      if(!element)return;const gap=8;const width=element.offsetWidth;const height=element.offsetHeight;
      element.style.left=`${Math.max(gap,Math.min(innerWidth-width-gap,origin.left+origin.width-width))}px`;
      element.style.top=`${Math.max(gap,Math.min(innerHeight-height-gap,origin.top+origin.height+gap))}px`;
    }
    if(typeof element.showPopover==="function")element.showPopover();else element.style.display="block";
    place();element.querySelector<HTMLElement>('[role="menuitem"]')?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);observer.observe(element);
    function scrolled(event:Event){if(event.target instanceof Node&&element?.contains(event.target))return;close.current();}
    function outside(event:Event){if(event.target instanceof Node&&!element?.contains(event.target))close.current();}
    window.addEventListener("resize",place);document.addEventListener("wheel",scrolled,{capture:true,passive:true});document.addEventListener("touchmove",scrolled,{capture:true,passive:true});document.addEventListener("pointerdown",outside);
    return()=>{observer.disconnect();window.removeEventListener("resize",place);document.removeEventListener("wheel",scrolled,true);document.removeEventListener("touchmove",scrolled,true);document.removeEventListener("pointerdown",outside);const restore=element.contains(document.activeElement)||document.activeElement===document.body;if(typeof element.hidePopover==="function")element.hidePopover();if(restore&&previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
  },[anchor]);
  useEffect(()=>{menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({preventScroll:true});},[playlists]);
  function keyboard(event:KeyboardEvent){
    if(event.key==="Escape"||event.key==="Tab"){if(event.key==="Escape")event.preventDefault();event.stopPropagation();onClose();return;}
    if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')||[]);if(!items.length)return;
    const index=items.indexOf(document.activeElement as HTMLElement);const target=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;items[target].focus();
  }
  async function showPlaylists(){if(busyRef.current||!music.account)return;busyRef.current=true;setBusy(true);setFailure(null);const version=requestVersion.current,controller=new AbortController();requestController.current=controller;try{const data=await requestJson<{playlists?:Array<{id:string;name:string}>}>("/api/v2/playlists",{signal:controller.signal},{context:"page",accountId:music.account.id});if(version===requestVersion.current)setPlaylists(data.playlists||[]);}catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"page"),retry:()=>void showPlaylists()});}finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}}
  async function choose(list:{id:string;name:string}){if(busyRef.current||!music.account)return;busyRef.current=true;setBusy(true);setFailure(null);const accountId=music.account.id,version=requestVersion.current,controller=new AbortController();requestController.current=controller;try{const canonical=await music.ensureRecording(track);if(version!==requestVersion.current||controller.signal.aborted)return;await requestJson("/api/v2/playlists/"+encodeURIComponent(list.id)+"/tracks",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({recordingIds:[canonical.id]})},{context:"save",accountId});if(version!==requestVersion.current||controller.signal.aborted)return;invalidateResources(accountId);music.notify(`Added to “${list.name}”.`);onClose();}catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"save"),retry:()=>void choose(list)});}finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}}
  const id=music.effectiveId(track);
  const download=music.downloads[id];
  const saved=download?.requested!==false&&download?.status==="ready";
  const saving=download?.requested!==false&&["queued","downloading","resolving"].includes(download?.status||"");
  const content=<div ref={menu} popover="auto" role="menu" aria-label={`Options for ${track.title}`} className={s.songPopover} onKeyDown={keyboard} onToggle={event=>{if(event.newState==="closed")onClose();}}>
    <div className={s.popoverHeading}><span>a little more music</span><strong>{track.title}</strong><small onClick={onClose}><ArtistLinks track={track}/></small></div>
    {failure&&<><p className={s.popoverNote} role="alert">{failure.issue.message}</p>{failure.issue.kind!=="session"&&<button role="menuitem" disabled={busy} onClick={failure.retry}><Icon name="repeat"/>{failure.issue.action}</button>}{failure.issue.href&&<Link role="menuitem" href={failure.issue.href} onClick={onClose}><Icon name="arrow"/>{failure.issue.linkLabel||"Return to music"}</Link>}</>}
    {playlists?<>{playlists.map(list=><button role="menuitem" key={list.id} disabled={busy} onClick={()=>void choose(list)}><Icon name="library"/>{list.name}</button>)}{!playlists.length&&<p className={s.popoverNote}>Your first collection can begin with this song.</p>}<Link role="menuitem" href="/library" onClick={onClose}><Icon name="plus"/>Create a playlist</Link><button role="menuitem" onClick={()=>setPlaylists(null)}><Icon name="back"/>Back to song options</button></>:<>
      <button role="menuitem" onClick={()=>{music.play(track);onClose();}}><Icon name="play"/>Play now</button>
      <button role="menuitem" onClick={()=>{music.addQueue(track);onClose();}}><Icon name="queue"/>Add to queue</button>
      <button role="menuitem" onClick={()=>{void music.toggleLike(track);onClose();}}><Icon name="heart"/>{music.liked.has(id)?"Remove from liked songs":"Like this song"}</button>
      <button role="menuitem" disabled={busy} onClick={()=>void showPlaylists()}><Icon name="library"/>{busy?"Finding your playlists…":"Add to playlist"}</button>
      <button role="menuitem" disabled={saved||saving} onClick={()=>{music.requestDownload(track);onClose();}}><Icon name={saved?"check":"download"}/>{saved?"Saved on this device":saving?"Saving on this device…":"Save on this device"}</button>
      <button role="menuitem" onClick={()=>{music.openModal("share",track);onClose();}}><Icon name="share"/>Share this song</button>
      {track.artists[0]&&<Link role="menuitem" href={track.artistId?"/artist/"+encodeURIComponent(track.artistId):"/search?"+new URLSearchParams({q:track.artists[0],tab:"Artists"})} onClick={onClose}><Icon name="user"/>Visit artist</Link>}
      <Link role="menuitem" href={"/track/"+encodeURIComponent(id)} onClick={onClose}><Icon name="lyrics"/>Song details</Link>
    </>}
  </div>;
  return createPortal(content,document.body);
}
