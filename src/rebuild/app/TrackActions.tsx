"use client";
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useState } from "react";
import { useMusic } from "./MusicContext";
import { invalidateResources } from "./resources";
import { invalidateRecommendationResources } from "./recommendationResources";
import type { MusicTrack } from "./types";
import { Icon } from "./Icon";
import { ArtistLinks } from "./ArtistLinks";
import { primaryArtistHref } from "./artistNavigation";
import { requestJson, userIssue, type UserIssue } from "./errors";
import { localId } from "./sessionState";
import s from "./touch.module.css";

export interface SongMenuAnchor {left:number;top:number;width:number;height:number}
export function TrackActions({track,onClose,anchor}:{track:MusicTrack;onClose:()=>void;anchor?:SongMenuAnchor}){
  const music=useMusic();
  const titleId=useId();
  const menu=useRef<HTMLDivElement>(null);
  const [playlists,setPlaylists]=useState<Array<{id:string;name:string}>|null>(null);
  const [creatingPlaylist,setCreatingPlaylist]=useState(false);
  const [playlistName,setPlaylistName]=useState("");
  const [playlistDescription,setPlaylistDescription]=useState("");
  const [tasteMenu,setTasteMenu]=useState(false);
  const [busy,setBusy]=useState(false);const busyRef=useRef(false);
  const [failure,setFailure]=useState<{issue:UserIssue;retry:()=>void}|null>(null);
  const close=useRef(onClose);
  const owner=useRef(music.account?.id);const requestVersion=useRef(0);const requestController=useRef<AbortController|null>(null);
  const creation=useRef<{name:string;description:string;id:string}|null>(null);
  const typed=useRef({text:"",at:0});
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useLayoutEffect(()=>{const version=requestVersion.current+1;requestVersion.current=version;if(owner.current!==music.account?.id){owner.current=music.account?.id;close.current();}return()=>{requestVersion.current=version+1;requestController.current?.abort();};},[music.account?.id,track.id]);
  useLayoutEffect(()=>{
    const element=menu.current;if(!element)return;
    const previous=document.activeElement;
    const origin=anchor||(previous instanceof HTMLElement?previous.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0});
    function place(){
      if(!element)return;const gap=8,viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,viewWidth=viewport?.width||innerWidth,viewHeight=viewport?.height||innerHeight;
      element.style.maxHeight=`${Math.max(120,viewHeight-gap*2)}px`;
      const width=element.offsetWidth,height=element.offsetHeight;
      element.style.left=`${Math.max(left+gap,Math.min(left+viewWidth-width-gap,origin.left+origin.width-width))}px`;
      element.style.top=`${Math.max(top+gap,Math.min(top+viewHeight-height-gap,origin.top+origin.height+gap))}px`;
      const rect=element.getBoundingClientRect();
      element.style.transformOrigin=`${Math.max(0,Math.min(width,origin.left+origin.width/2-rect.left))}px ${origin.top>rect.top+height/2?"bottom":"top"}`;
    }
    if(typeof element.showPopover==="function")element.showPopover();else element.style.display="block";
    place();element.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach(item=>{item.tabIndex=-1;});element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);observer.observe(element);
    function scrolled(event:Event){if(event.target instanceof Node&&element?.contains(event.target))return;close.current();}
    function outside(event:Event){if(event.target instanceof Node&&!element?.contains(event.target))close.current();}
    window.addEventListener("resize",place);window.visualViewport?.addEventListener("resize",place);window.visualViewport?.addEventListener("scroll",place);document.addEventListener("wheel",scrolled,{capture:true,passive:true});document.addEventListener("touchmove",scrolled,{capture:true,passive:true});document.addEventListener("pointerdown",outside);
    return()=>{observer.disconnect();window.removeEventListener("resize",place);window.visualViewport?.removeEventListener("resize",place);window.visualViewport?.removeEventListener("scroll",place);document.removeEventListener("wheel",scrolled,true);document.removeEventListener("touchmove",scrolled,true);document.removeEventListener("pointerdown",outside);const restore=element.contains(document.activeElement)||document.activeElement===document.body;if(typeof element.hidePopover==="function")element.hidePopover();if(restore&&previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
  },[anchor]);
  useEffect(()=>{typed.current={text:"",at:0};if(creatingPlaylist)menu.current?.querySelector<HTMLInputElement>("input")?.focus({preventScroll:true});else{menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach(item=>{item.tabIndex=-1;});menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true});}},[playlists,tasteMenu,creatingPlaylist]);
  function keyboard(event:KeyboardEvent){
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(creatingPlaylist){setCreatingPlaylist(false);setFailure(null);}else if(tasteMenu){setTasteMenu(false);}else if(playlists){setPlaylists(null);}else onClose();return;}
    if(event.key==="Tab"){if(creatingPlaylist)return;event.stopPropagation();onClose();return;}
    if(creatingPlaylist&&(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement))return;
    if(event.key.length===1&&/\S/u.test(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      const now=Date.now(),letter=event.key.toLocaleLowerCase(),previous=now-typed.current.at<650?typed.current.text:"",query=previous===letter?letter:previous+letter;
      typed.current={text:query,at:now};
      const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')||[]),index=items.indexOf(document.activeElement as HTMLElement);
      const ordered=[...items.slice(index+1),...items.slice(0,index+1)];
      const match=ordered.find(item=>item.textContent?.trim().toLocaleLowerCase().startsWith(query));
      event.preventDefault();event.stopPropagation();match?.focus({preventScroll:true});return;
    }
    if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')||[]);if(!items.length)return;
    const index=items.indexOf(document.activeElement as HTMLElement);const target=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;items[target].focus();
  }
  async function showPlaylists(){if(busyRef.current||!music.account)return;busyRef.current=true;setBusy(true);setFailure(null);const version=requestVersion.current,controller=new AbortController();requestController.current=controller;try{const data=await requestJson<{playlists?:Array<{id:string;name:string}>}>("/api/v2/playlists",{signal:controller.signal},{context:"page",accountId:music.account.id});if(version===requestVersion.current)setPlaylists(data.playlists||[]);}catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"page"),retry:()=>void showPlaylists()});}finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}}
  async function choose(list:{id:string;name:string}){if(busyRef.current||!music.account)return;busyRef.current=true;setBusy(true);setFailure(null);const accountId=music.account.id,version=requestVersion.current,controller=new AbortController();requestController.current=controller;try{const canonical=await music.ensureRecording(track);if(version!==requestVersion.current||controller.signal.aborted)return;await requestJson("/api/v2/playlists/"+encodeURIComponent(list.id)+"/tracks",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({recordingIds:[canonical.id]})},{context:"save",accountId});if(version!==requestVersion.current||controller.signal.aborted)return;invalidateResources(accountId);music.notify(`Added to “${list.name}”.`);onClose();}catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"save"),retry:()=>void choose(list)});}finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}}
  async function createAndChoose(event?:React.FormEvent){
    event?.preventDefault();const name=playlistName.trim(),description=playlistDescription.trim();if(!name||busyRef.current||!music.account)return;
    busyRef.current=true;setBusy(true);setFailure(null);const accountId=music.account.id,version=requestVersion.current,controller=new AbortController();requestController.current=controller;
    if(creation.current?.name!==name||creation.current.description!==description)creation.current={name,description,id:localId()};
    try{
      const canonical=await music.ensureRecording(track);if(version!==requestVersion.current||controller.signal.aborted)return;
      await requestJson("/api/v2/playlists",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({name,description,requestId:creation.current.id,recordingIds:[canonical.id]})},{context:"save",accountId});
      if(version!==requestVersion.current||controller.signal.aborted)return;creation.current=null;invalidateResources(accountId);music.notify(`Created “${name}” and added this song.`);onClose();
    }catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"save"),retry:()=>void createAndChoose()});}
    finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}
  }
  async function taste(kind:"less"|"snooze"|"block",duration:"day"|"week"|"month"|"forever"="forever") {
   if(busyRef.current||!music.account)return;busyRef.current=true;setBusy(true);setFailure(null);const accountId=music.account.id,version=requestVersion.current,controller=new AbortController();requestController.current=controller;
   try{const canonical=await music.ensureRecording(track);if(version!==requestVersion.current||controller.signal.aborted)return;
    const result=await requestJson<{expiresAt?:string|null;updatedAt?:string}>("/api/v2/taste",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({target:"recording",targetId:canonical.id,kind,duration})},{context:"save",accountId});if(version!==requestVersion.current||controller.signal.aborted)return;
    const days=duration==="day"?1:duration==="week"?7:duration==="month"?30:0;const feedback={target:"recording" as const,targetId:canonical.id,kind,expiresAt:result.expiresAt??(days?new Date(Date.now()+days*86400000).toISOString():null),updatedAt:result.updatedAt};
    window.dispatchEvent(new CustomEvent("sakura-taste-updated",{detail:{accountId,recordingId:canonical.id,feedback}}));invalidateRecommendationResources(accountId);music.notify(kind==="less"?"We’ll recommend this song less often.":days?`This song is excluded from recommendations for ${days} ${days===1?"day":"days"}.` :"This song is excluded from recommendations. Undo this in Settings anytime.");onClose();
   }catch(error){if(version===requestVersion.current&&!controller.signal.aborted)setFailure({issue:userIssue(error,"save"),retry:()=>void taste(kind,duration)});}finally{if(version===requestVersion.current){busyRef.current=false;setBusy(false);}if(requestController.current===controller)requestController.current=null;}
  }
  const id=music.effectiveId(track);
  const download=music.downloads[id];
  const saved=download?.requested!==false&&download?.status==="ready";
  const saving=download?.requested!==false&&["queued","downloading","resolving"].includes(download?.status||"");
  const content=<div ref={menu} popover="auto" role={creatingPlaylist?"dialog":"menu"} aria-modal={creatingPlaylist?false:undefined} aria-label={creatingPlaylist?undefined:`Options for ${track.title}`} aria-labelledby={creatingPlaylist?titleId:undefined} data-motion={music.settings.reducedMotion?"still":undefined} className={s.songPopover} onKeyDown={keyboard} onToggle={event=>{if(event.newState==="closed")onClose();}}>
    <div className={s.popoverHeading}><span id={titleId}>{creatingPlaylist?"new playlist":"song options"}</span><strong>{track.title}</strong><small onClick={onClose}><ArtistLinks track={track}/></small></div>
    {failure&&<><p className={s.popoverNote} role="alert">{failure.issue.message}</p>{failure.issue.kind!=="session"&&<button role={creatingPlaylist?undefined:"menuitem"} disabled={busy} onClick={failure.retry}><Icon name="repeat"/>{failure.issue.action}</button>}{failure.issue.href&&<Link role={creatingPlaylist?undefined:"menuitem"} href={failure.issue.href} onClick={onClose}><Icon name="arrow"/>{failure.issue.linkLabel||"Return to music"}</Link>}</>}
    {creatingPlaylist?<form className={s.playlistComposer} onSubmit={createAndChoose}>
      <p className={s.popoverNote}>Make a new playlist here. This song will be waiting inside it.</p>
      <label>Playlist name<input value={playlistName} onChange={event=>{setPlaylistName(event.target.value);setFailure(null);}} maxLength={120} required placeholder="Songs for a softer day" disabled={busy}/></label>
      <label>A little note <span>optional</span><textarea value={playlistDescription} onChange={event=>{setPlaylistDescription(event.target.value);setFailure(null);}} maxLength={500} rows={2} placeholder="A place for late-evening favorites" disabled={busy}/></label>
      <button type="submit" disabled={busy||!playlistName.trim()}><Icon name="plus"/>{busy?"Making your playlist…":"Create and add song"}</button>
      <button type="button" disabled={busy} onClick={()=>{setCreatingPlaylist(false);setFailure(null);}}><Icon name="back"/>Back to playlists</button>
    </form>:tasteMenu?<>
      <p className={s.popoverNote}>Change how this song shapes recommendations. Excluding it also stops its past listens from influencing suggestions. It stays in your library and can still be played.</p>
      <button role="menuitem" disabled={busy} onClick={()=>void taste("less")}><Icon name="discover"/>{busy?"Updating recommendations…":"Recommend this song less"}</button>
      {(["day","week","month","forever"] as const).map(duration=><button role="menuitem" disabled={busy} key={duration} onClick={()=>void taste(duration==="forever"?"block":"snooze",duration)}><Icon name={duration==="forever"?"close":"moon"}/>{duration==="forever"?"Exclude from recommendations":`Exclude for ${duration==="day"?"1 day":duration==="week"?"7 days":"30 days"}`}</button>)}
      <button role="menuitem" disabled={busy} onClick={()=>setTasteMenu(false)}><Icon name="back"/>Back to song options</button>
    </>:playlists?<>
      {playlists.map(list=><button role="menuitem" key={list.id} disabled={busy} onClick={()=>void choose(list)}><Icon name="library"/>{list.name}</button>)}
      {!playlists.length&&<p className={s.popoverNote}>No playlists yet. Make one here without leaving this song.</p>}
      <button className={s.inlinePlaylistCreate} role="menuitem" disabled={busy} onClick={()=>{setCreatingPlaylist(true);setPlaylistName("");setPlaylistDescription("");setFailure(null);}}><Icon name="plus"/>Create a new playlist here</button>
      <button role="menuitem" onClick={()=>setPlaylists(null)}><Icon name="back"/>Back to song options</button>
    </>:<>
      <button role="menuitem" onClick={()=>{music.play(track);onClose();}}><Icon name="play"/>Play now</button>
      <button role="menuitem" onClick={()=>{music.addQueue(track);onClose();}}><Icon name="queue"/>Add to queue</button>
      <button role="menuitem" onClick={()=>{void music.toggleLike(track);onClose();}}><Icon name="heart"/>{music.liked.has(id)?"Remove from liked songs":"Like this song"}</button>
      <button role="menuitem" disabled={busy} onClick={()=>void showPlaylists()}><Icon name="library"/>{busy?"Finding your playlists…":"Add to playlist"}</button>
      <button role="menuitem" disabled={saved||saving} onClick={()=>{music.requestDownload(track);onClose();}}><Icon name={saved?"check":"download"}/>{saved?"Saved on this device":saving?"Saving on this device…":"Save on this device"}</button>
      <button role="menuitem" onClick={()=>{music.openModal("share",track);onClose();}}><Icon name="share"/>Share this song</button>
      <button role="menuitem" disabled={busy} onClick={()=>setTasteMenu(true)}><Icon name="discover"/>Recommendation controls</button>
      {track.artists[0]&&<Link role="menuitem" href={primaryArtistHref(track)} onClick={onClose}><Icon name="user"/>Visit artist</Link>}
      <Link role="menuitem" href={"/track/"+encodeURIComponent(id)} onClick={onClose}><Icon name="lyrics"/>Song details</Link>
    </>}
  </div>;
  return createPortal(content,document.body);
}
