"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Artwork, PlayerButton, PlayerDialog } from "../player/CommonPrimitives";
import { Blossom, Branch } from "./Brand";
import { Icon } from "./Icon";
import { useMusic } from "./MusicContext";
import { RecoveryNotice } from "./RecoveryNotice";
import { invalidateResources } from "./resources";
import { useScreenActions } from "./screenActions";
import { localId } from "./sessionState";
import type { MusicTrack } from "./types";
import { requestJson } from "./errors";
import s from "./playlist-workflows.module.css";

type CreatedPlaylist={id:string;name:string;trackCount:number};

export function MixPlaylistDialog({mixId,mixName,tracks,onClose}:{mixId:string;mixName:string;tracks:MusicTrack[];onClose:()=>void}){
 const music=useMusic(),actions=useScreenActions(music.account?.id,"mix-playlist:"+mixId);
 const choices=useMemo(()=>tracks.slice(0,2000).map((track,index)=>({key:music.effectiveId(track)+":"+index,track})),[tracks,music]);
 const [selected,setSelected]=useState(()=>new Set(choices.map(choice=>choice.key)));
 const [name,setName]=useState(mixName),[description,setDescription]=useState(`A playlist gathered from “${mixName}”.`);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[created,setCreated]=useState<CreatedPlaylist|null>(null);
 const request=useRef<{signature:string;id:string}|null>(null);
 const picked=choices.filter(choice=>selected.has(choice.key)),allSelected=picked.length===choices.length;
 function toggle(key:string){if(busy)return;setError(null);setSelected(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});}
 function toggleAll(){if(busy)return;setError(null);setSelected(allSelected?new Set():new Set(choices.map(choice=>choice.key)));}
 async function canonicalize(controller:AbortController){
  const canonical=new Array<MusicTrack>(picked.length);let next=0,stopped=false;
  async function worker(){
   while(!stopped&&actions.current("create",controller)){
    const index=next++;if(index>=picked.length)return;
    try{canonical[index]=await music.ensureRecording(picked[index].track);}catch(error){stopped=true;throw error;}
   }
  }
  await Promise.all(Array.from({length:Math.min(4,picked.length)},()=>worker()));
  return actions.current("create",controller)?canonical:null;
 }
 async function create(){
  const playlistName=name.trim(),playlistDescription=description.trim();if(!music.account||!playlistName||!picked.length)return;
  const controller=actions.begin("create");if(!controller)return;setBusy(true);setError(null);
  const signature=JSON.stringify([playlistName,playlistDescription,picked.map(choice=>choice.key)]);
  if(request.current?.signature!==signature)request.current={signature,id:localId()};
  try{
   const canonical=await canonicalize(controller);if(!canonical)return;
   const recordingIds=[...new Set(canonical.map(track=>track.id))];
   if(!recordingIds.length)throw new Error("Choose at least one song for this playlist.");
   const result=await requestJson<CreatedPlaylist>("/api/v2/playlists",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({name:playlistName,description:playlistDescription,requestId:request.current.id,recordingIds})},{context:"save",accountId:music.account.id});
   if(!actions.current("create",controller))return;request.current=null;setCreated({...result,name:result.name||playlistName,trackCount:Number(result.trackCount)||recordingIds.length});invalidateResources(music.account.id);music.notify(`“${playlistName}” is ready in your playlists.`);
  }catch(nextError){if(actions.current("create",controller))setError(nextError);}
  finally{if(actions.finish("create",controller))setBusy(false);}
 }
 const footer=created?<><button className={s.quietButton} type="button" onClick={onClose}>Keep listening</button><Link className={s.primaryLink} href={`/playlist/${encodeURIComponent(created.id)}`}>Open playlist <Icon name="arrow"/></Link></>:<><span className={s.footerCount}>{picked.length} of {choices.length} songs selected</span><PlayerButton secondary disabled={busy} onClick={onClose}>Not now</PlayerButton><PlayerButton icon="check" disabled={busy||!picked.length||!name.trim()} onClick={()=>void create()}>{busy?"Gathering the songs…":"Create playlist"}</PlayerButton></>;
 return <PlayerDialog title={created?"Your playlist is ready.":"Make this mix yours."} subtitle="SAKURA SELECTS / TO PLAYLIST" onClose={onClose} closeDisabled={busy} wide appearance="note" className={s.dialog} footer={footer}>
  {created?<div className={s.success}><div className={s.successMark}><Blossom/></div><span>new playlist</span><h3>{created.name}</h3><p>{created.trackCount} {created.trackCount===1?"song":"songs"}, kept together without interrupting your mix.</p><Branch/></div>:<div className={s.layout}>
   <section className={s.details}><div className={s.paperMark}><Branch/><span>from a mix,<br/>made your own.</span></div><label><span>Playlist name</span><input data-dialog-autofocus value={name} disabled={busy} maxLength={120} onChange={event=>{setName(event.target.value);setError(null);}}/></label><label><span>A little note <i>optional</i></span><textarea value={description} disabled={busy} maxLength={2000} rows={4} onChange={event=>{setDescription(event.target.value);setError(null);}}/></label><p>All songs begin selected. Leave out anything that does not belong in this version.</p></section>
   <section className={s.selection} aria-label="Songs in the new playlist"><header><div><span>the songs</span><strong>{picked.length} selected</strong></div><button type="button" disabled={busy} onClick={toggleAll}>{allSelected?"Clear all":"Select all"}</button></header><div className={s.songList}>{choices.map(({key,track},index)=><label className={s.song} key={key} data-selected={selected.has(key)||undefined}><input type="checkbox" checked={selected.has(key)} disabled={busy} onChange={()=>toggle(key)}/><Artwork url={track.coverUrl} title={track.title}/><span><b>{track.title}</b><small>{track.artists.join(", ")||"A Sakura recording"}</small></span><em>{String(index+1).padStart(2,"0")}</em></label>)}</div></section>
  </div>}
  {error!==null&&<RecoveryNotice error={error} context="save" retry={()=>void create()} onDismiss={()=>setError(null)}/>} 
 </PlayerDialog>;
}
