"use client";
import {useEffect,useRef,useState} from "react";
import {useMusic} from "../app/MusicContext";
import {musicTrack} from "../app/types";
import {readyPlaybackFor} from "../app/playbackSource";
import {waitForRecording} from "../app/recordingJob";
import {localRead,deliverListen,type OfflineAudio} from "../app/offline";
import {requestJson} from "../app/errors";
import type {ResolveRecordingResult} from "../server/contracts";

/** Recap sound accompanies a chapter without replacing the listener's queue. */
export function useBloomAudio(){
 const music=useMusic();const latest=useRef(music);useEffect(()=>{latest.current=music;},[music]);
 const media=useRef<HTMLAudioElement|null>(null),controller=useRef<AbortController|null>(null),objectUrl=useRef<string|null>(null);
 const returning=useRef<{accountId:string;entryId:string|null;trackId:string;resume:boolean}|null>(null);
 const receipt=useRef<{id:string;accountId:string;recordingId:string;sequence:number;ms:number;last:number;wall:number}|null>(null);
 const [message,setMessage]=useState("");
 function collect(){
  const audio=media.current,r=receipt.current;if(!audio||!r)return;
  const now=audio.currentTime,wall=performance.now(),delta=(now-r.last)*1000,elapsed=wall-r.wall;
  if(latest.current.account?.id===r.accountId&&!latest.current.settings.privateSession&&delta>0&&delta<=elapsed*1.15+300)r.ms+=delta;
  r.last=now;r.wall=wall;
 }
 function flush(finished=false){
  collect();const r=receipt.current;if(!r||latest.current.account?.id!==r.accountId||r.ms<1)return;
  let remaining=Math.floor(r.ms);
  while(remaining>0){const msPlayed=Math.min(120000,remaining);remaining-=msPlayed;r.ms-=msPlayed;
   void deliverListen(r.accountId,{eventId:r.id,recordingId:r.recordingId,sequence:r.sequence++,msPlayed,positionMs:Math.floor((media.current?.currentTime||0)*1000),completed:false,finished:finished&&remaining===0,context:"bloom",occurredAt:new Date(Date.now()-remaining).toISOString()}).catch(()=>{});
  }
 }
 function dispose(){
  controller.current?.abort();controller.current=null;flush(true);media.current?.pause();
  if(media.current){media.current.removeAttribute("src");media.current.load();media.current=null;}
  receipt.current=null;if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;}
 }
 function stop(paint=true){dispose();if(paint)setMessage("");}
 function close(paint=true){
  stop(paint);const original=returning.current;returning.current=null;const p=latest.current;
  if(original?.resume&&p.account?.id===original.accountId&&p.currentEntryId===original.entryId&&p.track?.id===original.trackId&&p.status==="paused")p.togglePlay();
 }
 function play(raw:Record<string,unknown>){
  stop();const p=latest.current,accountId=p.account?.id;if(!accountId)return;
  if(!returning.current&&p.track)returning.current={accountId,entryId:p.currentEntryId,trackId:p.track.id,resume:p.status==="playing"};
  p.pause();const request=new AbortController();controller.current=request;
  const current=()=>controller.current===request&&!request.signal.aborted&&latest.current.account?.id===accountId;
  setMessage("Finding this chapter’s soundtrack…");
  void(async()=>{try{
   const track=musicTrack(raw);let recordingId=track.id,url:string;
   const local=await localRead<OfflineAudio>(accountId,"audio:"+track.id).catch(()=>undefined);if(!current())return;
   const ready=readyPlaybackFor(track);
   if(local&&local.track.id===track.id&&local.blob.size===local.sizeBytes){url=URL.createObjectURL(local.blob);objectUrl.current=url;}
   else if(ready){url=ready.url;}
   else{
    let result=await requestJson<ResolveRecordingResult>("/api/v2/recordings/resolve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:track.reference,expected:{title:track.title,artists:track.artists,artistsComplete:track.artistsComplete,version:track.version,durationMs:track.durationMs||undefined}}),signal:request.signal},{context:"playback",accountId});
    result=await waitForRecording(result,{signal:request.signal,accountId,origin:location.origin});
    if(result.status!=="resolved")throw new Error("Sound unavailable");recordingId=result.recording.recordingId;url=result.playback.url;
   }
   if(!current())return;const audio=new Audio(url);audio.volume=latest.current.volume;audio.preload="auto";media.current=audio;
   receipt.current={id:crypto.randomUUID(),accountId,recordingId,sequence:0,ms:0,last:0,wall:performance.now()};
   audio.addEventListener("timeupdate",()=>{if(current()&&media.current===audio)collect();});
   audio.addEventListener("pause",()=>{if(current()&&media.current===audio)flush();});
   audio.addEventListener("ended",()=>{if(!current()||media.current!==audio)return;flush(true);setMessage("The chapter’s song has ended. Your Bloom is still here.");});
   audio.addEventListener("error",()=>{if(!current()||media.current!==audio)return;setMessage("This chapter’s song isn’t available right now. Continue your story, or tap Sound to try again.");});
   await audio.play();if(current())setMessage("");
  }catch{if(current())setMessage("This chapter’s song isn’t available right now. Continue your story, or tap Sound to try again.");}})();
 }
 useEffect(()=>{if(media.current)media.current.volume=music.volume;},[music.volume]);
 useEffect(()=>{dispose();returning.current=null;
 // Account changes cancel chapter audio before requests or receipts can reach another account.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[music.account?.id]);
 useEffect(()=>{const timer=setInterval(()=>flush(),15000),hidden=()=>flush(true);window.addEventListener("pagehide",hidden);return()=>{clearInterval(timer);window.removeEventListener("pagehide",hidden);close(false);};
 // The lifetime timer reads current audio, account and settings through refs.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return {play,stop,close,message};
}

