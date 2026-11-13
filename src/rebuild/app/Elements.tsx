"use client";
import { memo, useMemo, useState, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";
import { TrackActions, type SongMenuAnchor } from "./TrackActions";
import { SongGesture } from "./SongGesture";
import { AlbumLink } from "./AlbumLink";
import { ArtistLinks } from "./ArtistLinks";
import { RecoveryNotice } from "./RecoveryNotice";
import { PlaybackRibbon, VolumeControl } from "./ListeningControls";
import { Blossom } from "./Brand";
import { usePlaybackProgress } from "./MusicContext";
import type { MusicTrack, DownloadEntry } from "./types";
import { useLyrics } from "../player/useLyrics";
import { useJapaneseReading } from "../player/useJapaneseReading";
import { useSongSwipe } from "./useSongSwipe";
import { useMiniLyricCue } from "../player/useLyricProgress";
import { responsiveArtworkSources } from "../player/imageUrl";
import { DownloadRemovalModal } from "./DownloadRemovalModal";
import { useDownloadEntry, useMusicActions, useMusicView, type MusicActions } from "./musicView";
import s from "./ink.module.css";
import t from "./track-presentation.module.css";
export function IconButton({icon,label,onClick,active,disabled=false,shortcut}:{icon:IconName;label:string;onClick:()=>void;active?:boolean;disabled?:boolean;shortcut?:string}){return <button className={s.iconButton+" "+(active?s.active:"")} type="button" aria-label={label} aria-pressed={active} title={shortcut?label+" ("+shortcut+")":label} onClick={onClick} disabled={disabled}><Icon name={icon}/>{shortcut&&<span className={s.shortcutHint} aria-hidden="true">{shortcut}</span>}</button>;}
export function Button({children,onClick,icon,secondary=false,disabled=false}:{children:ReactNode;onClick?:()=>void;icon?:IconName;secondary?:boolean;disabled?:boolean}){return <button className={secondary?s.secondaryButton:s.primaryButton} type="button" onClick={onClick} disabled={disabled}>{icon&&<Icon name={icon} size={18}/>} {children}</button>;}
export function SearchField({value,onChange,label,placeholder,autoFocus=false,icon="search"}:{value:string;onChange:(value:string)=>void;label:string;placeholder:string;autoFocus?:boolean;icon?:IconName}){const field=useRef<HTMLInputElement>(null);return <div className={s.searchBox} data-search-field><span className={s.searchMark} data-search-mark aria-hidden="true"><Icon name={icon} size={20}/><Blossom/></span><input ref={field} type={icon==="link"?"url":"search"} value={value} onChange={e=>onChange(e.target.value)} autoFocus={autoFocus} aria-label={label} placeholder={placeholder} onKeyDown={e=>{if(e.key==="Escape"&&value){e.preventDefault();onChange("");}}}/>{value&&<IconButton icon="close" label={"Clear "+label.toLowerCase()} onClick={()=>{onChange("");field.current?.focus();}}/>}<svg className={s.searchStem} data-search-stem viewBox="0 0 500 18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12Q65 4 115 11T220 10T330 9T420 11T500 7"/><path d="M18 10q-7 -12 -14 -8q3 10 14 8m466 -2q9 -10 15 -6q-4 7 -15 6"/></svg></div>;}
export function Artwork({url,title,className="",onError,sizes,priority=false}:{url?:string|null;title:string;className?:string;onError?:()=>void;sizes?:string;priority?:boolean}){const [failedUrl,setFailedUrl]=useState<string|null>(null);const failed=failedUrl===url;const {src,srcSet}=responsiveArtworkSources(url);return <div className={s.artwork+" "+className}>{src&&!failed?<img src={src} srcSet={srcSet} sizes={sizes||(priority?"(max-width: 700px) 80vw, 440px":"auto, 160px")} width={320} height={320} alt={title} loading={priority?"eager":"lazy"} fetchPriority={priority?"high":"auto"} decoding="async" onError={()=>{setFailedUrl(url||null);onError?.();}}/>:<div className={s.artFallback} aria-label={title}><Blossom/><span>{title.slice(0,1)}</span></div>}</div>;}
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
type TrackRowProps = {
 song:MusicTrack; id:string; index:number; tracks:MusicTrack[]; current:boolean; playing:boolean; engaged:boolean; liked:boolean;
 menuOpen:boolean; downloaded:boolean; dateLabel?:string; showVersion:boolean; trackDetail?:(song:MusicTrack)=>ReactNode;
 actions:MusicActions; onMenu:(menu:{track:MusicTrack;anchor:SongMenuAnchor})=>void; onRemove:(song:MusicTrack)=>void;
};
const TrackRow=memo(function TrackRow({song,id,index,tracks,current,playing,engaged,liked,menuOpen,downloaded,dateLabel,showVersion,trackDetail,actions,onMenu,onRemove}:TrackRowProps){
 const entry=useDownloadEntry(id),saved=entry?.requested===false?undefined:entry;
 const busy=saved?.status==="queued"||saved?.status==="resolving"||saved?.status==="downloading",progress=transferProgress(saved);
 const addedDate=useMemo(()=>dateLabel?trackDate(song.addedAt):null,[dateLabel,song.addedAt]);
 const addedLabel=useMemo(()=>addedDate?{iso:addedDate.toISOString(),title:dateLabel+" "+addedDate.toLocaleString(),text:dateLabel+" "+addedDate.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"})}:null,[addedDate,dateLabel]);
 return <SongGesture id={id} className={`${s.trackRow} ${t.row} ${current?t.current:""} ${playing?s.playingRow:""}`} onOptions={anchor=>onMenu({track:song,anchor})}>
  <button className={`${s.trackCover} ${t.cover}`} aria-label={(engaged?"Pause ":"Play ")+song.title} onClick={()=>current&&engaged?actions.togglePlay():actions.play(song,tracks)}><span aria-hidden="true">{playing?<span className={s.equalizer}><i/><i/><i/></span>:String(index+1).padStart(2,"0")}</span><Artwork url={song.coverUrl} title={song.albumTitle||song.title} className={t.art}/><span className={`${s.coverPlay} ${t.play}`}><Icon name={engaged?"pause":"play"} size={15}/></span></button>
  <div className={`${s.trackInfo} ${t.info}`}><Link href={"/track/"+encodeURIComponent(id)} dir="auto">{song.title}</Link><div className={t.credits} data-track-credits><ArtistLinks track={song} className={t.artists}/>{song.albumTitle&&<span className={t.inlineAlbum}><span aria-hidden="true" className={t.creditDot}>·</span><AlbumLink track={song}/></span>}</div><span className={`${t.details} ${trackDetail?t.withDetail:""}`}>{trackDetail?.(song)}{addedLabel&&<time dateTime={addedLabel.iso} title={addedLabel.title}>{addedLabel.text}</time>}{showVersion&&song.versionLabel!=="Original recording"&&<span className={t.version} title={song.versionLabel}>{song.versionLabel}</span>}{saved?.status==="ready"?<span className={t.saved}><Icon name="check"/>Offline</span>:saved&&<span className={t.transferText}>{transferLabel(saved)}</span>}</span></div>
  <AlbumLink track={song} className={`${s.albumColumn} ${t.album}`}/><span className={`${s.duration} ${t.length}`}>{time(song.durationMs)}</span><div className={t.actions}>
   <button className={`${s.iconButton} ${t.like} ${liked?s.active:""}`} type="button" aria-label={(liked?"Unlike ":"Like ")+song.title} aria-pressed={liked} title={(liked?"Unlike ":"Like ")+song.title} onClick={()=>void actions.toggleLike(song)}><Icon name="heart"/></button>
   {downloaded?<IconButton icon="trash" label={"Remove "+song.title+" from this device"} onClick={()=>onRemove(song)}/>:<TrackDownload track={song} entry={saved} onDownload={()=>actions.requestDownload(song)}/>}
   <button className={s.iconButton} type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={"More options for "+song.title} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();onMenu({track:song,anchor:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}});}}><Icon name="more"/></button>
  </div>
  {busy&&<span className={t.vine} role="progressbar" aria-label={"Download progress for "+song.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress===null?undefined:Math.round(progress*100)} aria-valuetext={transferLabel(saved)}><svg viewBox="0 0 500 8" preserveAspectRatio="none" aria-hidden="true"><path className={t.vineTrack} d="M0 5Q70 1 130 4T250 4T370 3T500 4"/><path className={t.vineFill} d="M0 5Q70 1 130 4T250 4T370 3T500 4" pathLength="1" strokeDasharray="1" strokeDashoffset={progress===null ? .9 : 1-progress}/></svg></span>}
 </SongGesture>;
});
type TrackRowsProps = {
 tracks:MusicTrack[]; currentId:string|null; status:string; liked:Set<string>; menuTrack?:MusicTrack;
 downloaded:boolean; dateLabel?:string; showVersion:boolean; trackDetail?:(song:MusicTrack)=>ReactNode;
 actions:MusicActions; onMenu:(menu:{track:MusicTrack;anchor:SongMenuAnchor})=>void; onRemove:(song:MusicTrack)=>void;
};
const TrackRows=memo(function TrackRows({tracks,currentId,status,liked,menuTrack,downloaded,dateLabel,showVersion,trackDetail,actions,onMenu,onRemove}:TrackRowsProps){
 return <>{tracks.map((song,index)=>{const id=actions.effectiveId(song),current=id===currentId,playing=current&&status==="playing",engaged=current&&(playing||status==="buffering"||status==="resolving");return <TrackRow key={id} song={song} id={id} index={index} tracks={tracks} current={current} playing={playing} engaged={engaged} liked={liked.has(id)} menuOpen={menuTrack===song} downloaded={downloaded} dateLabel={dateLabel} showVersion={showVersion} trackDetail={trackDetail} actions={actions} onMenu={onMenu} onRemove={onRemove}/>;})}</>;
});
export function TrackList({tracks,showVersion=true,downloaded=false,layout="list",dateLabel,trackDetail}:{tracks:MusicTrack[];showVersion?:boolean;downloaded?:boolean;layout?:TrackLayout;dateLabel?:string;trackDetail?:(song:MusicTrack)=>ReactNode}){
 const view=useMusicView(),actions=useMusicActions();
 const [menu,setMenu]=useState<{track:MusicTrack;anchor:SongMenuAnchor}|null>(null),[removing,setRemoving]=useState<MusicTrack|null>(null);
 // The stable action reads mutable aliases; their revision invalidates this projection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const unique=useMemo(()=>[...new Map(tracks.map(song=>[actions.effectiveId(song),song])).values()],[tracks,actions,view.aliasesRevision]);
 const currentId=view.track?actions.effectiveId(view.track):null;
 return <div className={`${s.trackList} ${t[layout]}`} data-track-layout={layout}><TrackRows tracks={unique} currentId={currentId} status={view.status} liked={view.liked} menuTrack={menu?.track} downloaded={downloaded} dateLabel={dateLabel} showVersion={showVersion} trackDetail={trackDetail} actions={actions} onMenu={setMenu} onRemove={setRemoving}/>{!unique.length&&<Empty/>}{menu&&<TrackMenu track={menu.track} anchor={menu.anchor} onClose={()=>setMenu(null)}/>} {removing&&<DownloadRemovalModal track={removing} onClose={()=>setRemoving(null)} onRemove={()=>actions.removeDownload(actions.effectiveId(removing))}/>}</div>;
}
export function TrackMenu({track,onClose,anchor}:{track:MusicTrack;onClose:()=>void;anchor?:SongMenuAnchor}){return <TrackActions key={track.id} track={track} onClose={onClose} anchor={anchor}/>;}
const MiniPlaybackTimeline=memo(function MiniPlaybackTimeline({durationMs}:{durationMs:number}){
 const progress=usePlaybackProgress();
 return <span className={t.miniTimeline} aria-hidden="true"><i style={{width:Math.min(100,Math.max(0,progress.positionMs/Math.max(1,progress.durationMs||durationMs)*100))+"%"}}/></span>;
});
const MiniPlaybackRibbon=memo(function MiniPlaybackRibbon({onSeek,disabled}:{onSeek:(ms:number)=>void;disabled:boolean}){
 const progress=usePlaybackProgress();
 return <PlaybackRibbon compact positionMs={progress.positionMs} durationMs={progress.durationMs} onSeek={onSeek} disabled={disabled}/>;
});
export function PlayerBar(){
 const view=useMusicView(),actions=useMusicActions(),p={...view,...actions};const lyrics=useLyrics(p.track);const reading=useJapaneseReading(lyrics);const swipe=useSongSwipe({onNext:p.next,onPrevious:p.previous,disabled:!p.track,reducedMotion:p.settings.reducedMotion});
 const cue=useMiniLyricCue(lyrics.data?.lines,lyrics.data?.timing==="synced"&&p.status!=="resolving"&&p.status!=="error");
 if(!p.track)return null;const active=p.status==="playing"||p.status==="buffering"||p.status==="resolving";
 // Artwork and caption are siblings: sharing a key retains old covers during
 // reconciliation. An occurrence identity also survives catalog resolution.
 const identity=p.currentEntryId||p.effectiveId(p.track);
 return <footer className={s.playerBar}>
  <MiniPlaybackTimeline durationMs={p.track.durationMs}/>
  <div className={s.playerIdentityGroup} {...swipe.bind} style={swipe.style} data-song-swipe="mini" data-swipe-direction={swipe.direction||undefined} data-swiping={swipe.swiping||undefined}><button className={s.playerIdentity} onClick={()=>p.openModal("player")} aria-label="Open now playing" title="Open now playing (F). Swipe or drag to change songs"><Artwork key={`artwork:${identity}`} url={p.track.coverUrl} title={p.track.albumTitle||p.track.title} className={s.miniSleeve}/><span key={`caption:${identity}`} className={s.miniCaption}><b dir="auto">{p.track.title}</b>{p.preparingTrack?<small role="status">Getting {p.preparingTrack.title} ready…</small>:cue?<small className={t.miniWords} title={cue.text} data-mini-lyric><Icon name="lyrics"/><span key={identity+":"+cue.start} dir="auto">{cue.text}{reading.enabled&&cue.romanized&&<i className={s.miniReading} lang={reading.language ? reading.language+"-Latn" : undefined}>{cue.romanized}</i>}</span></small>:<small>{p.status==="resolving"?"Finding the exact recording…":p.status==="buffering"?"Getting the sound ready…":"Open your listening room"}</small>}</span></button><ArtistLinks track={p.track} className={s.playerCredits}/></div>
  <div className={s.playerCenter}><div className={s.transport}><IconButton icon="shuffle" label={p.shuffle?"Turn shuffle off":"Turn shuffle on"} active={p.shuffle} onClick={()=>p.setShuffle(!p.shuffle)}/><IconButton icon="previous" label="Previous song" shortcut="Shift + Left" onClick={p.previous}/><button className={s.roundPlay} title={active?"Pause (Space)":"Play (Space)"} aria-label={active?"Pause":"Play"} onClick={p.togglePlay}><Icon name={active?"pause":"play"}/></button><IconButton icon="next" label="Next song" shortcut="Shift + Right" onClick={p.next}/><span className={s.repeatControl}><IconButton icon="repeat" label={p.repeat==="off"?"Repeat now playing and songs added by you":p.repeat==="all"?"Your added queue is repeating. Repeat this song instead":"Repeat this song is on. Turn repeat off"} active={p.repeat!=="off"} onClick={()=>p.setRepeat(p.repeat==="off"?"all":p.repeat==="all"?"one":"off")}/>{p.repeat==="one"&&<b aria-hidden="true">1</b>}</span></div><MiniPlaybackRibbon onSeek={p.seek} disabled={p.status==="resolving"}/></div>
  <div className={s.playerTools}><IconButton icon="lyrics" label="Open lyrics" shortcut="L" onClick={()=>p.openModal("lyrics")}/><IconButton icon="queue" label="Open queue" shortcut="Q" onClick={()=>p.openModal("queue")}/><VolumeControl compact value={p.volume} onChange={p.setVolume} nativePlayback={p.settings.audioTechnology==="none"}/></div><div className={s.mobileTransport}><IconButton icon="queue" label="Open queue" shortcut="Q" onClick={()=>p.openModal("queue")}/><IconButton icon={active?"pause":"play"} label={active?"Pause":"Play"} onClick={p.togglePlay}/></div>
  {p.error&&<div className={s.playerError}><RecoveryNotice compact error={p.error} context="playback" retry={p.togglePlay} href={p.error.includes("exact recording")?"/search?q="+encodeURIComponent(p.track.title+" "+p.track.artists[0]):undefined}/></div>}
 </footer>;
}
