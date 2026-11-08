"use client";
import {useEffect,useState} from "react";
import {useMusic} from "./MusicContext";
import {requestJson} from "./errors";
import type {UserSettings} from "./types";
import {initialTasteSignature} from "../recommendations/initialTaste";
import s from "./onboarding-taste.module.css";

interface Preview {genres:string[];matchedArtists:number;selectedArtists:number}
export function OnboardingTastePreview({seedArtists,seedArtistSelections}:{seedArtists:string[];seedArtistSelections:UserSettings["seedArtistSelections"]}){
 const music=useMusic(),accountId=music.account?.id,offline=music.offline;
 const selection=JSON.stringify({seedArtists,seedArtistSelections:seedArtistSelections||[]});
 const key=`${accountId}:${initialTasteSignature({...music.settings,seedArtists,seedArtistSelections})}`;
 const [result,setResult]=useState<{key:string;data?:Preview;failed?:boolean}>();
 useEffect(()=>{
  if(!accountId||!seedArtists.length||offline)return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   void requestJson<Preview>("/api/v2/onboarding/preview",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:selection},{context:"page",accountId}).then(data=>{
    if(!controller.signal.aborted)setResult({key,data});
   }).catch(()=>{if(!controller.signal.aborted)setResult({key,failed:true});});
  },500);
  return()=>{clearTimeout(timer);controller.abort();};
 },[accountId,key,offline,selection,seedArtists.length]);
 if(!seedArtists.length)return null;
 const current=result?.key===key?result:undefined;
 return <aside className={s.preview} aria-label="Your first recommendations"><b>Your starting points</b><p>These artists guide Home, Discover, Search, and your soundtracks. Charts and Bloom use listening saved in Sakura.</p><div aria-live="polite">{current?.data?.genres.length?<><small>Genres from their music</small><ul>{current.data.genres.map(genre=><li key={genre} dir="auto">{genre}</li>)}</ul></>:<small>{offline?"Reconnect to see genres from their music.":current?.failed?"You can still save your artist choices. Genre details are unavailable right now.":current?.data?"No genre details are available for these artists yet.":"Checking the genres in their music…"}</small>}</div></aside>;
}
