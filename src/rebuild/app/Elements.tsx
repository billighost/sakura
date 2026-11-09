"use client";
import { useState, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";
import { TrackActions, type SongMenuAnchor } from "./TrackActions";
import { SongGesture } from "./SongGesture";
import { ArtistLinks } from "./ArtistLinks";
import { RecoveryNotice } from "./RecoveryNotice";
import { PlaybackRibbon, VolumeControl } from "./ListeningControls";
import { Blossom } from "./Brand";
import { useMusic } from "./MusicContext";
import type { MusicTrack, DownloadEntry } from "./types";
import { useLyrics } from "../player/useLyrics";
import { miniLyricCue } from "../player/miniLyric";
import { DownloadRemovalDialog } from "./DownloadRemovalDialog";
import s from "./ink.module.css";
import t from "./track-presentation.module.css";
export function IconButton({icon,label,onClick,active,disabled=false}:{icon:IconName;label:string;onClick:()=>void;active?:boolean;disabled?:boolean}){return <button className={s.iconButton+" "+(active?s.active:"")} type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} disabled={disabled}><Icon name={icon}/></button>;}
export function Button({children,onClick,icon,secondary=false,disabled=false}:{children:ReactNode;onClick?:()=>void;icon?:IconName;secondary?:boolean;disabled?:boolean}){return <button className={secondary?s.secondaryButton:s.primaryButton} type="button" onClick={onClick} disabled={disabled}>{icon&&<Icon name={icon} size={18}/>} {children}</button>;}
export function SearchField({value,onChange,label,placeholder,autoFocus=false,icon="search"}:{value:string;onChange:(value:string)=>void;label:string;placeholder:string;autoFocus?:boolean;icon?:IconName}){const field=useRef<HTMLInputElement>(null);return <div className={s.searchBox}><span className={s.searchMark} aria-hidden="true"><Icon name={icon} size={20}/><Blossom/></span><input ref={field} type={icon==="link"?"url":"search"} value={value} onChange={e=>onChange(e.target.value)} autoFocus={autoFocus} aria-label={label} placeholder={placeholder} onKeyDown={e=>{if(e.key==="Escape"&&value){e.preventDefault();onChange("");}}}/>{value&&<IconButton icon="close" label={"Clear "+label.toLowerCase()} onClick={()=>{onChange("");field.current?.focus();}}/>}<svg className={s.searchStem} viewBox="0 0 500 18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12Q65 4 115 11T220 10T330 9T420 11T500 7"/><path d="M18 10q-7 -12 -14 -8q3 10 14 8m466 -2q9 -10 15 -6q-4 7 -15 6"/></svg></div>;}
export function Artwork({url,title,className=""}:{url?:string|null;title:string;className?:string}){const [failedUrl,setFailedUrl]=useState<string|null>(null);const failed=failedUrl===url;return <div className={s.artwork+" "+className}>{url&&!failed?<img src={url} alt={title} loading="lazy" decoding="async" onError={()=>setFailedUrl(url||null)}/>:<div className={s.artFallback} aria-label={title}><Blossom/><span>{title.slice(0,1)}</span></div>}</div>;}
export function PageTitle({eyebrow,title,description,children}:{eyebrow:string;title:string;description?:string;children?:ReactNode}){return <div className={s.pageTitle}><div><span className={s.eyebrow}>{eyebrow}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{children}</div>;}
export function SectionTitle({title,note,href,action}:{title:string;note?:string;href?:string;action?:string}){return <div className={s.sectionTitle}><div><h2>{title}</h2>{note&&<p>{note}</p>}</div>{href&&<Link href={href}>{action||"Explore"}<Icon name="arrow" size={15}/></Link>}</div>;}
export function LoadingRows(){return <div className={s.skeletonRows} role="status" aria-label="Loading music">{[0,1,2,3].map(i=><div key={i}><i/><span/><b/></div>)}</div>;}
export function Empty({title="A little room for something good.",description="Your songs will find their home here.",href="/discover",action="Find your next favorite"}:{title?:string;description?:string;href?:string;action?:string}){return <div className={s.empty}><Blossom/><h2>{title}</h2><p>{description}</p><Link className={s.secondaryButton} href={href}>{action}<Icon name="arrow" size={16}/></Link></div>;}
export function LoadError({message,retry}:{message:unknown;retry:()=>void}){return <RecoveryNotice error={message} retry={retry}/>;}
export function time(ms:number){const n=Math.max(0,Math.floor(ms/1000));return Math.floor(n/60)+":"+String(n%60).padStart(2,"0");}
export type TrackLayout = "list" | "cards" | "compact";
function transferProgress(entry?:DownloadEntry){return entry?.totalBytes?Math.min(1,Math.max(0,entry.downloadedBytes/entry.totalBytes)):null;}
function transferLabel(entry?:DownloadEntry){
 if(!entry)return "";
 if(entry.status==="ready")return "Ready offline";
 if(entry.status==="queued")return "In line";
 if(entry.status==="resolving")return "Finding your recording";
 if(entry.status==="paused")return "Paused";
 if(entry.status==="prepared")return "Ready to continue";
 if(entry.status==="failed")return "Try again";
 const progress=transferProgress(entry);return progress===null?"Saving your song":progress===1?"Finishing your song":Math.round(progress*100)+"% saved";
}
function TrackDownload({track,entry,onDownload}:{track:MusicTrack;entry?:DownloadEntry;onDownload:()=>void}){
 const busy=entry?.status==="queued"||entry?.status==="resolving"||entry?.status==="downloading";
 const ready=entry?.status==="ready",progress=transferProgress(entry);
 const label=ready?track.title+" is ready offline":busy?"Saving "+track.title+": "+transferLabel(entry):entry?.status==="failed"?"Retry download of "+track.title:entry?.status==="paused"||entry?.status==="prepared"?"Continue downloading "+track.title:"Download "+track.title;
 return <button type="button" className={`${t.download} ${busy?t.busy:""} ${ready?t.ready:""} ${busy&&progress===null?t.indeterminate:""}`} aria-label={label} title={label} disabled={busy||ready} onClick={onDownload}>
  {busy&&<svg className={t.ring} viewBox="0 0 40 40" aria-hidden="true"><circle className={t.ringTrack} cx="20" cy="20" r="15"/><circle className={t.ringFill} cx="20" cy="20" r="15" pathLength="1" strokeDasharray="1" strokeDashoffset={progress===null?0:1-progress}/></svg>}
  <Icon name={ready?"check":entry?.status==="paused"||entry?.status==="prepared"?"play":"download"} size={17}/>
 </button>;
}
function trackDate(value:MusicTrack["addedAt"]){
 if(value===undefined)return null;
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date:null;
}
export function TrackList({tracks,showVersion=true,downloaded=false,layout="list",dateLabel}:{tracks:MusicTrack[];showVersion?:boolean;downloaded?:boolean;layout?:TrackLayout;dateLabel?:string}){
 const p=useMusic();const [menu,setMenu]=useState<{track:MusicTrack;anchor:SongMenuAnchor}|null>(null),[removing,setRemoving]=useState<MusicTrack|null>(null);const unique=[...new Map(tracks.map(t=>[p.effectiveId(t),t])).values()];
 return <div className={`${s.trackList} ${t[layout]}`} data-track-layout={layout}>{unique.map((song,i)=>{const id=p.effectiveId(song),addedDate=dateLabel?trackDate(song.addedAt):null;const current=!!p.track&&p.effectiveId(p.track)===id,playing=current&&p.status==="playing",engaged=current&&(playing||p.status==="buffering"||p.status==="resolving");const saved=p.downloads[id]?.requested===false?undefined:p.downloads[id],busy=saved?.status==="queued"||saved?.status==="resolving"||saved?.status==="downloading",progress=transferProgress(saved);return <SongGesture key={id} id={id} className={`${s.trackRow} ${t.row} ${current?t.current:""} ${playing?s.playingRow:""}`} onOptions={anchor=>setMenu({track:song,anchor})}>
   <button className={`${s.trackCover} ${t.cover}`} aria-label={(engaged?"Pause ":"Play ")+song.title} onClick={()=>current&&engaged?p.togglePlay():p.play(song,unique)}><span aria-hidden="true">{playing?<span className={s.equalizer}><i/><i/><i/></span>:String(i+1).padStart(2,"0")}</span><Artwork url={song.coverUrl} title={song.albumTitle||song.title} className={t.art}/><span className={`${s.coverPlay} ${t.play}`}><Icon name={engaged?"pause":"play"} size={15}/></span></button>
   <div className={`${s.trackInfo} ${t.info}`}><Link href={"/track/"+encodeURIComponent(id)} dir="auto">{song.title}</Link><ArtistLinks track={song} className={t.artists}/><span className={t.details}>{dateLabel&&addedDate&&<time dateTime={addedDate.toISOString()} title={dateLabel+" "+addedDate.toLocaleString()}>{dateLabel} {addedDate.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"})}</time>}{showVersion&&<span className={t.version} title={song.versionLabel}>{song.versionLabel}</span>}{saved?.status==="ready"?<span className={t.saved}><Icon name="check"/>Offline</span>:saved&&<span className={t.transferText}>{transferLabel(saved)}</span>}</span></div>
   <span className={`${s.albumColumn} ${t.album}`} title={song.albumTitle||undefined}>{song.albumTitle}</span><span className={`${s.duration} ${t.length}`}>{time(song.durationMs)}</span><div className={t.actions}>
   <button className={`${s.iconButton} ${t.like} ${p.liked.has(id)?s.active:""}`} type="button" aria-label={(p.liked.has(id)?"Unlike ":"Like ")+song.title} aria-pressed={p.liked.has(id)} title={(p.liked.has(id)?"Unlike ":"Like ")+song.title} onClick={()=>void p.toggleLike(song)}><Icon name="heart"/></button>
   {downloaded?<IconButton icon="trash" label={"Remove "+song.title+" from this device"} onClick={()=>setRemoving(song)}/>:<TrackDownload track={song} entry={saved} onDownload={()=>p.requestDownload(song)}/>}
   <button className={s.iconButton} type="button" aria-haspopup="menu" aria-expanded={menu?.track===song} aria-label={"More options for "+song.title} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setMenu({track:song,anchor:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}});}}><Icon name="more"/></button></div>
   {busy&&<span className={t.vine} role="progressbar" aria-label={"Download progress for "+song.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress===null?undefined:Math.round(progress*100)} aria-valuetext={transferLabel(saved)}><svg viewBox="0 0 500 8" preserveAspectRatio="none" aria-hidden="true"><path className={t.vineTrack} d="M0 5Q70 1 130 4T250 4T370 3T500 4"/><path className={t.vineFill} d="M0 5Q70 1 130 4T250 4T370 3T500 4" pathLength="1" strokeDasharray="1" strokeDashoffset={progress===null ? .9 : 1-progress}/></svg></span>}
 </SongGesture>;})}{!unique.length&&<Empty/>}{menu&&<TrackMenu track={menu.track} anchor={menu.anchor} onClose={()=>setMenu(null)}/>} {removing&&<DownloadRemovalDialog track={removing} onClose={()=>setRemoving(null)} onRemove={()=>p.removeDownload(p.effectiveId(removing))}/>}</div>;
}
export function TrackMenu({track,onClose,anchor}:{track:MusicTrack;onClose:()=>void;anchor?:SongMenuAnchor}){return <TrackActions key={track.id} track={track} onClose={onClose} anchor={anchor}/>;}
export function PlayerBar(){
 const p=useMusic();const lyrics=useLyrics(p.track);if(!p.track)return null;const active=p.status==="playing"||p.status==="buffering"||p.status==="resolving";
 const cue=lyrics.data?.timing==="synced"&&p.status!=="resolving"&&p.status!=="error"?miniLyricCue(lyrics.data.lines,p.positionMs):null;
 return <footer className={s.playerBar}>
  <span className={t.miniTimeline} aria-hidden="true"><i style={{width:Math.min(100,Math.max(0,p.positionMs/Math.max(1,p.durationMs||p.track.durationMs)*100))+"%"}}/></span>
  <div className={s.playerIdentityGroup}><button className={s.playerIdentity} onClick={()=>p.openModal("player")} aria-label="Open now playing"><Artwork url={p.track.coverUrl} title={p.track.albumTitle||p.track.title}/><span><b dir="auto">{p.track.title}</b>{cue?<small className={t.miniWords} title={cue.text} data-mini-lyric><Icon name="lyrics"/><span key={p.track.id+":"+cue.start} dir="auto">{cue.text}</span></small>:<small>{p.status==="resolving"?"Finding the exact recording…":p.status==="buffering"?"Getting the sound ready…":"Open your listening room"}</small>}</span></button><ArtistLinks track={p.track} className={s.playerCredits}/></div>
  <div className={s.playerCenter}><div className={s.transport}><IconButton icon="shuffle" label={p.shuffle?"Turn shuffle off":"Turn shuffle on"} active={p.shuffle} onClick={()=>p.setShuffle(!p.shuffle)}/><IconButton icon="previous" label="Previous song" onClick={p.previous}/><button className={s.roundPlay} aria-label={active?"Pause":"Play"} onClick={p.togglePlay}><Icon name={active?"pause":"play"}/></button><IconButton icon="next" label="Next song" onClick={p.next}/><span className={s.repeatControl}><IconButton icon="repeat" label={p.repeat==="off"?"Turn repeat on":p.repeat==="all"?"Repeat all is on. Repeat this song instead":"Repeat this song is on. Turn repeat off"} active={p.repeat!=="off"} onClick={()=>p.setRepeat(p.repeat==="off"?"all":p.repeat==="all"?"one":"off")}/>{p.repeat==="one"&&<b aria-hidden="true">1</b>}</span></div><PlaybackRibbon compact positionMs={p.positionMs} durationMs={p.durationMs} onSeek={p.seek} disabled={p.status==="resolving"}/></div>
  <div className={s.playerTools}><IconButton icon="lyrics" label="Open lyrics" onClick={()=>p.openModal("lyrics")}/><IconButton icon="queue" label="Open queue" onClick={()=>p.openModal("queue")}/><VolumeControl compact value={p.volume} onChange={p.setVolume}/></div><div className={s.mobileTransport}><IconButton icon="queue" label="Open queue" onClick={()=>p.openModal("queue")}/><IconButton icon={active?"pause":"play"} label={active?"Pause":"Play"} onClick={p.togglePlay}/></div>
  {p.error&&<div className={s.playerError}><RecoveryNotice compact error={p.error} context="playback" retry={p.togglePlay} href={p.error.includes("exact recording")?"/search?q="+encodeURIComponent(p.track.title+" "+p.track.artists[0]):undefined}/></div>}
 </footer>;
}
