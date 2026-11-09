"use client";
/* eslint-disable @next/next/no-img-element -- Original covers use the authenticated image proxy, intrinsic sizes and an illustrated error fallback. */
import {useState} from "react";
import {ArtistLinks} from "../app/ArtistLinks";
import {Icon} from "../app/Icon";
import {musicTrack} from "../app/types";
import {chapterScene} from "./story";
import {listeningDuration} from "./comparisons";
import type {BloomArtistInsight,BloomChapter,BloomRankedRecording} from "./uiTypes";
import s from "./cinema.module.css";

export function BloomArtwork({url,title,className}:{url:unknown;title:string;className?:string}){const [failed,setFailed]=useState(false);return typeof url==="string"&&url&&!failed?<img className={className} src={`/api/v2/image?url=${encodeURIComponent(url)}`} width="400" height="400" decoding="async" alt={`${title} artwork`} onError={()=>setFailed(true)}/>:<div className={`${s.artFallback} ${className||""}`} role="img" aria-label={`Artwork unavailable for ${title}`}><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="57"/><circle cx="80" cy="80" r="35"/><path d="M80 22Q29 46 80 80Q131 46 80 22ZM22 80Q46 131 80 80Q46 29 22 80ZM80 138Q131 114 80 80Q29 114 80 138ZM138 80Q114 29 80 80Q114 131 138 80Z"/><circle cx="80" cy="80" r="8"/></svg></div>;}

function Recording({entry,onPlay,measured=true}:{entry:BloomRankedRecording;onPlay?:(recording:Record<string,unknown>)=>void;measured?:boolean}){
 const metadata=(entry.recording.metadata||entry.recording) as Record<string,unknown>;const title=String(entry.recording.title||metadata.title||"Song");let track=null;try{track=musicTrack(entry.recording);}catch{}
 return <article className={s.recording} data-rank={measured?entry.rank:undefined}><div className={s.recordingImage}><BloomArtwork url={entry.recording.coverUrl||metadata.coverUrl} title={title}/>{measured&&<span className={s.rank}>{String(entry.rank).padStart(2,"0")}</span>}{onPlay&&<button className={s.playArtwork} aria-label={`Play ${title}`} onClick={()=>onPlay(entry.recording)}><Icon name="play" size={17}/></button>}</div><h3>{title}</h3><p className={s.credits}>{track?<ArtistLinks track={track}/>:Array.isArray(metadata.artists)?metadata.artists.join(" · "):""}</p>{measured&&<small>{listeningDuration(entry.audibleMs)} listened · {entry.plays} {entry.plays===1?"play":"plays"}</small>}</article>;
}
function Artist({artist}:{artist:BloomArtistInsight}){return <article className={`${s.artist} bloom-artist`}><BloomArtwork url={artist.imageUrl} title={artist.name} className={s.artistPortrait}/><div><span className={s.eyebrow}>A VOICE IN YOUR STORY</span><h3>{artist.name}</h3><p>{listeningDuration(artist.audibleMs)} of listening</p></div></article>;}

export function BloomChapterContent({chapter,onPlay,compact=false}:{chapter:BloomChapter;onPlay?:(recording:Record<string,unknown>)=>void;compact?:boolean}){
 const [sources,setSources]=useState(false);const kind=chapterScene(chapter);const entries=chapter.recordings?.length?chapter.recordings:chapter.relatedRecording?[{rank:1,audibleMs:0,plays:0,recording:chapter.relatedRecording}]:[];
 const music=kind==="songs"||kind==="song-winner"||kind==="artist-songs"||kind==="discoveries"||kind==="returns";
 return <section className={`bloom-content ${s.chapterContent}`} data-kind={kind} aria-live={compact?undefined:"polite"}><span className={s.eyebrow}>{kind==="song-winner"?"YOUR NUMBER ONE":"YOUR LISTENING STORY"}</span><h2 className={`bloom-heading ${s.chapterHeading}`}>{chapter.title}</h2>{chapter.revealed&&chapter.stat?<>
  {(!music||!entries.length)&&kind!=="artist"&&kind!=="artists"&&<div className={`bloom-stat ${s.stat}`}><strong>{chapter.stat.value}</strong>{chapter.stat.unit&&<span>{chapter.stat.unit}</span>}<p>{chapter.stat.label}</p></div>}
  {chapter.stat.label&&((music&&entries.length>0&&kind!=="song-winner")||kind==="artists")&&<div className={`bloom-stat ${s.supportingStat}`}><strong>{chapter.stat.value}{chapter.stat.unit?` ${chapter.stat.unit}`:""}</strong><span>{chapter.stat.label}</span></div>}
  {chapter.comparison&&<div className={s.comparison}><h3>{chapter.comparison.title}</h3><p>{chapter.comparison.detail}</p><button onClick={()=>setSources(value=>!value)} aria-expanded={sources}>How this was calculated</button>{sources&&<small>{chapter.comparison.reference}{chapter.comparison.referenceUrl&&<> <a href={chapter.comparison.referenceUrl} target="_blank" rel="noreferrer">Reference <Icon name="external" size={12}/></a></>}</small>}</div>}
  {chapter.artists?.length&&kind!=="artist-songs"?<div className={`${s.artists} bloom-artists`}>{chapter.artists.map(artist=><Artist key={artist.key} artist={artist}/>)}</div>:null}
  {kind==="artist-songs"&&chapter.artists?.[0]&&<p className={s.detail}>By {chapter.artists[0].name} · your most-listened songs</p>}
  {music&&entries.length>0?<div className={`${s.artworks} bloom-artworks`} data-count={entries.length}>{entries.map(entry=><Recording key={String(entry.recording.id||entry.recording.recordingId)} entry={entry} onPlay={onPlay} measured={Boolean(chapter.recordings?.length)}/>)}</div>:null}
  {kind==="artist"&&!chapter.artists?.length&&<div className={s.stat}><strong>{chapter.stat.label}</strong><p>{chapter.stat.value}{chapter.stat.unit?` ${chapter.stat.unit}`:""}</p></div>}
  {kind==="artist"&&!chapter.artists?.length&&entries[0]&&<div className={`${s.artworks} bloom-artworks`}><Recording entry={entries[0]} onPlay={onPlay} measured={Boolean(chapter.recordings?.length)}/></div>}
  {chapter.detail&&!chapter.comparison&&<p className={s.detail}>{chapter.detail}</p>}
 </>:<p className={s.detail}>This part of your story is opening…</p>}</section>;
}
