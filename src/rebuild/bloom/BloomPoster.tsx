"use client";
import {BloomArtwork} from "./BloomContent";
import {WorldStage} from "./worlds/WorldStage";
import {bloomWorld} from "./worlds/registry";
import {bloomDate,type BloomDesign,type BloomRecap} from "./uiTypes";
import {listeningDuration} from "./comparisons";
import type {BloomQuality} from "./worlds/types";
import s from "./cinema.module.css";

export function BloomPoster({recap,design,theme,demo,quality}:{recap:BloomRecap;design:BloomDesign;theme:"light"|"dark";demo:boolean;quality:BloomQuality}){
 const winner=recap.chapters.find(chapter=>chapter.id==="top-song"&&chapter.revealed);
 const recording=winner?.recordings?.[0]?.recording||winner?.relatedRecording;
 const metadata=(recording?.metadata||recording||{}) as Record<string,unknown>;
 const title=String(recording?.title||metadata.title||"");
 const credits=Array.isArray(recording?.artists)?recording.artists:Array.isArray(metadata.artists)?metadata.artists:[];
 const artist=recap.chapters.find(chapter=>chapter.id==="top-artist"&&chapter.revealed);
 return <div className={s.poster} data-bloom-poster>
  <WorldStage design={design} scene="finale" stage={recap.chapters.length} progress={1} quality={quality} reducedMotion view="poster" theme={theme}>
   <section className={`bloom-content ${s.posterContent}`}>
    <p className={s.posterPeriod}>{recap.period.toUpperCase()} · {bloomDate(recap.periodStart,recap.timeZone)} — {bloomDate(new Date(new Date(recap.periodEnd).getTime()-1).toISOString(),recap.timeZone)}</p>
    <h1 className={`bloom-heading ${s.posterHeading}`}>This season<br/>sounds like you.</h1>
    {recording&&<article className={s.posterWinner}><BloomArtwork url={recording.coverUrl||metadata.coverUrl} title={title}/><h2>{title}</h2><p>{credits.map(String).join(" · ")}</p><small>Your most-listened song</small></article>}
    <div className={s.posterStats}><div><strong>{listeningDuration(recap.summary.audibleMs)}</strong><span>of actual listening</span></div><div><strong>{recap.summary.recordingCount}</strong><span>different recordings</span></div></div>
    {artist?.stat&&<p className={s.posterArtist}><span>Your most-listened artist</span><strong>{artist.artists?.[0]?.name||artist.stat.label}</strong></p>}
    <p className={s.posterSignature}>sakura bloom · {bloomWorld(design).name}<br/>Every little listen leaves a trace.</p>
    {demo&&<small>Design preview · sample listening history</small>}
   </section>
  </WorldStage>
 </div>;
}
