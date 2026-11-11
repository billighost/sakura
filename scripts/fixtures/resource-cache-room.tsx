"use client";
import {useEffect,useState} from "react";
import {useLyrics,type PlayerLyrics} from "@/rebuild/player/useLyrics";
import {loadResource,resourceSnapshot,clearResources} from "@/rebuild/app/resources";
import type {MusicTrack} from "@/rebuild/app/types";
import type {ReadingLanguage} from "@/rebuild/lyrics/language";
import type {TimedLyric} from "@/rebuild/lyrics/parse";
import type {AutoSyncEvidence} from "@/rebuild/lyrics/autoSync";

const track:MusicTrack={id:"95090000-0000-4000-8000-000000000401",title:"君の声 cache fixture",artists:["Cache fixture"],artistId:null,albumId:null,albumTitle:"Offline cache fixture",durationMs:40000,coverUrl:null,versionLabel:"Original recording",reference:{provider:"deezer",id:"cache401"},references:[]};
type Probe={data:PlayerLyrics|null;secondary:PlayerLyrics|null;loading:boolean;error:string|null;read:(language:ReadingLanguage)=>Promise<void>;choose:(language:ReadingLanguage)=>Promise<void>;sync:(lines:TimedLyric[],evidence:AutoSyncEvidence)=>Promise<void>;retry:()=>void;load:typeof loadResource;snapshot:typeof resourceSnapshot;clear:typeof clearResources;change:()=>void};
declare global{interface Window{cacheProbe?:Probe}}
export default function ResourceCacheRoom(){
 const [current,setCurrent]=useState(track),first=useLyrics(current),second=useLyrics(current);
 useEffect(()=>{window.cacheProbe={data:first.data,secondary:second.data,loading:first.loading,error:first.error,read:first.getJapaneseReadings,choose:first.setReadingLanguage,sync:first.applyAutoSync,retry:first.retry,load:loadResource,snapshot:resourceSnapshot,clear:clearResources,change:()=>setCurrent(current=>current.id===track.id?{...track,id:track.id+"-other",title:"Second cache fixture"}:track)};});
 return <main><h1>Resource cache verification</h1><output data-cache-state>{first.loading?"loading":first.error||first.data?.timing||"waiting"}</output><output data-cache-readings>{first.data?.lines.map(line=>line.romanized||"_").join(" / ")}</output><p>Isolated synthetic lyrics and browser storage. No music or account mutations.</p></main>;
}
