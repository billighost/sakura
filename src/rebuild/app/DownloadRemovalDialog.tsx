"use client";
import { useState } from "react";
import { Artwork, PlayerButton, PlayerDialog } from "../player/Primitives";
import { requestDialogClose } from "./dialogLifecycle";
import { ArtistLinks } from "./ArtistLinks";
import { Blossom } from "./Brand";
import type { MusicTrack } from "./types";
import s from "./download-removal-dialog.module.css";

export function DownloadRemovalDialog({track,onClose,onRemove}:{track:MusicTrack;onClose:()=>void;onRemove:()=>Promise<boolean>}){
 const [removing,setRemoving]=useState(false),[failed,setFailed]=useState(false);
 const close=()=>{if(!removing)requestDialogClose(onClose);};
 async function remove(){if(removing)return;setRemoving(true);setFailed(false);try{if(await onRemove())requestDialogClose(onClose);else setFailed(true);}catch{setFailed(true);}finally{setRemoving(false);}}
 return <PlayerDialog appearance="note" closeDisabled={removing} className={s.dialog} subtitle="A NOTE FROM YOUR OFFLINE GARDEN" title="Let this song leave the garden?" onClose={onClose}>
  <div className={s.songCard}>
   <div className={s.art}><Artwork url={track.coverUrl} title={track.albumTitle||track.title}/><span aria-hidden="true"><Blossom/></span></div>
   <div className={s.identity}><span>Saved on this device</span><strong dir="auto">{track.title}</strong><ArtistLinks track={track}/>{track.albumTitle&&<small dir="auto">{track.albumTitle}</small>}</div>
  </div>
  <div className={s.note}><Blossom/><p>The offline copy will be removed from this device. The song stays in your library, likes, playlists and listening history.</p></div>
  {failed&&<p className={s.error} role="alert">This download is still on your device. Please try removing it again.</p>}
  <div className={s.actions}>
   <PlayerButton secondary autoFocus disabled={removing} onClick={close}>Keep this song</PlayerButton>
   <PlayerButton className={s.removeButton} disabled={removing} onClick={()=>void remove()}>{removing?"Removing gently…":"Remove download"}</PlayerButton>
  </div>
 </PlayerDialog>;
}
