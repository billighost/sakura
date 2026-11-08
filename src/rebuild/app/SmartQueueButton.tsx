"use client";
import {useMusic,type SmartQueueOptions} from "./MusicContext";
import {Icon} from "./Icon";
import type {MusicTrack} from "./types";
import s from "./smart-queue.module.css";

export function SmartQueueButton({scope="all",tracks,append=false,label="Find my soundtrack",className="",secondary=true,iconOnly=false,disabled=false}:{scope?:SmartQueueOptions["scope"];tracks?:MusicTrack[];append?:boolean;label?:string;className?:string;secondary?:boolean;iconOnly?:boolean;disabled?:boolean}) {
 const music=useMusic(),busy=music.smartQueueBusy;
 const title=busy?"Finding your next songs…":label;
 return <button type="button" className={`${s.button} ${secondary?s.secondary:""} ${iconOnly?s.iconOnly:""} ${className}`} disabled={disabled||busy||!music.account} aria-label={title} aria-busy={busy} title={title} onClick={()=>{void music.smartQueue({scope,tracks,append}).catch(error=>music.reportError(error,"playback",()=>void music.smartQueue({scope,tracks,append}).catch(nextError=>music.reportError(nextError,"playback"))));}}><span className={s.mark} aria-hidden="true"><Icon name="queue" size={19}/></span>{!iconOnly&&<span>{title}</span>}</button>;
}
