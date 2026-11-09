"use client";
import {useEffect,useRef,useState} from "react";
import {useMusic} from "../app/MusicContext";
import {musicTrack} from "../app/types";
import {readyPlaybackFor} from "../app/playbackSource";
import {waitForRecording} from "../app/recordingJob";
import {localRead,deliverListen,validOfflineAudio,type OfflineAudio} from "../app/offline";
import {audibleIncrement,listeningOutcome} from "../app/listeningEvidence";
import {requestJson} from "../app/errors";
import type {ResolveRecordingResult} from "../server/contracts";
import {MediaAudioEngine} from "../audio/engine";

interface Receipt {id:string;accountId:string;recordingId:string;sequence:number;ms:number;totalMs:number;last:number;wall:number;durationMs:number;terminal:boolean}

function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function startMs(value:unknown){const number=Number(value);return Number.isFinite(number)&&number>=0?number:null;}
/** Prefer catalog/audio-analysis highlight markers. When none exist, enter far
 * enough past the intro to reach a likely hook while retaining a full passage. */
export function bloomHighlightStart(raw:Record<string,unknown>,rawDurationMs:number):number{
 const metadata=record(raw.metadata),analysis=record(raw.analysis)||record(metadata?.analysis);
 const sources=[raw,metadata,analysis].filter((value):value is Record<string,unknown>=>Boolean(value));
 const durationMs=startMs(rawDurationMs)||startMs(metadata?.durationMs)||0;
 if(durationMs<60000)return 0;
 const maximum=Math.max(0,durationMs-45000);
 for(const source of sources)for(const key of ["highlightStartMs","chorusStartMs","hookStartMs","bestPartStartMs","previewStartMs"]){
  const value=startMs(source[key]);if(value!==null)return Math.min(value,maximum);
 }
 const highlights=sources.flatMap(source=>Array.isArray(source.highlights)?source.highlights:[]).map(record).filter((value):value is Record<string,unknown>=>Boolean(value))
  .map(value=>({start:startMs(value.startMs??value.startTimeMs),score:Number(value.confidence??value.score??0)})).filter(value=>value.start!==null)
  .sort((a,b)=>(Number.isFinite(b.score)?b.score:0)-(Number.isFinite(a.score)?a.score:0));
 if(highlights[0]?.start!==null&&highlights[0]?.start!==undefined)return Math.min(highlights[0].start,maximum);
 return Math.min(Math.max(durationMs*.38,30000),75000,maximum);
}

/** Recap sound accompanies a chapter without replacing the listener's queue. */
export function useBloomAudio(){
 const music=useMusic(),latest=useRef(music);
 const media=useRef<HTMLAudioElement|null>(null),controller=useRef<AbortController|null>(null),objectUrl=useRef<string|null>(null);
 const engine=useRef<MediaAudioEngine|null>(null),nativeSound=useRef({muted:false,volume:1}),paused=useRef(false);
 const returning=useRef<{accountId:string;entryId:string|null;trackId:string;resume:boolean;choiceVersion?:number}|null>(null);
 const receipt=useRef<Receipt|null>(null);
 const [message,setMessage]=useState("");
 function renewReceipt(){const r=receipt.current,a=media.current;if(r&&a)receipt.current={...r,id:crypto.randomUUID(),sequence:0,ms:0,totalMs:0,last:a.currentTime,wall:performance.now(),terminal:false};}
 function collect(boundary?:{paused?:boolean;muted?:boolean}){
  const audio=media.current,r=receipt.current;if(!audio||!r)return;
  const now=audio.currentTime,wall=performance.now(),p=latest.current;
  const increment=audibleIncrement({mediaDeltaMs:(now-r.last)*1000,wallDeltaMs:wall-r.wall,playing:p.account?.id===r.accountId&&!r.terminal,paused:boundary?.paused??audio.paused,seeking:audio.seeking,privateSession:p.settings.privateSession,learnFromListening:p.settings.learnFromListening,muted:boundary?.muted??(audio.muted||audio.volume===0),volume:p.volume});
  r.ms+=increment;r.totalMs+=increment;r.last=now;r.wall=wall;
 }
 function flush(finished=false,naturalEnd=false){
  collect();const r=receipt.current,p=latest.current;
  if(!r||r.terminal||p.account?.id!==r.accountId||p.settings.privateSession||p.settings.learnFromListening===false)return;
  let remaining=Math.floor(r.ms);if(!remaining&&(!finished||r.sequence===0))return;
  const duration=media.current?.duration,outcome=listeningOutcome({naturalEnd,explicitSkip:false,audibleMs:r.totalMs,durationMs:Number.isFinite(duration)?duration!*1000:r.durationMs});
  do{const msPlayed=Math.min(120000,remaining);remaining-=msPlayed;r.ms-=msPlayed;
   void deliverListen(r.accountId,{eventId:r.id,recordingId:r.recordingId,sequence:r.sequence++,msPlayed,positionMs:Math.max(0,Math.floor((media.current?.currentTime||0)*1000)),completed:naturalEnd&&outcome.completed&&remaining===0,finished:finished&&remaining===0,context:"bloom",occurredAt:new Date(Date.now()-remaining).toISOString()}).catch(()=>{});
  }while(remaining>0);
  if(finished)r.terminal=true;
 }
 function dispose(){
  controller.current?.abort();controller.current=null;flush(true);media.current?.pause();
  if(media.current){media.current.removeAttribute("src");media.current.load();media.current=null;}
  engine.current?.dispose();engine.current=null;
  receipt.current=null;if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;}
 }
 function stop(paint=true){dispose();if(paint)setMessage("");}
 function pause(){paused.current=true;flush();media.current?.pause();}
 function resume(){paused.current=false;const audio=media.current;if(audio&&!audio.ended&&audio.paused){if(receipt.current?.terminal)renewReceipt();void engine.current?.resume().catch(()=>{});void audio.play().catch(()=>{if(media.current===audio)setMessage("Tap Sound to resume this chapter's soundtrack.");});}}
 function close(paint=true){
  stop(paint);const original=returning.current;returning.current=null;const p=latest.current;
  if(original?.resume&&p.account?.id===original.accountId&&p.currentEntryId===original.entryId&&p.track?.id===original.trackId&&p.status==="paused"&&(original.choiceVersion===undefined||original.choiceVersion===p.getPlaybackChoiceVersion?.()))p.togglePlay();
 }
 function play(raw:Record<string,unknown>,resumePlayback=false){
  if(resumePlayback)paused.current=false;stop();const p=latest.current,accountId=p.account?.id;if(!accountId)return;
  if(!returning.current&&p.track)returning.current={accountId,entryId:p.currentEntryId,trackId:p.track.id,resume:p.status==="playing",choiceVersion:p.getPlaybackChoiceVersion?.()};
  const original=returning.current;if(original?.choiceVersion!==undefined&&original.choiceVersion!==p.getPlaybackChoiceVersion?.())original.resume=false;
  p.pause();if(original)original.choiceVersion=p.getPlaybackChoiceVersion?.();
  const request=new AbortController();controller.current=request;
  // Unlock iOS audio during the Sound gesture, before storage/network awaits.
  const audio=new Audio();audio.preload="auto";media.current=audio;
  const sound=new MediaAudioEngine(audio);engine.current=sound;sound.setVolume(p.volume);nativeSound.current={muted:audio.muted,volume:audio.volume};
  const unlocked=sound.setMode("none");void unlocked.catch(()=>{});
  const current=()=>controller.current===request&&!request.signal.aborted&&latest.current.account?.id===accountId;
  setMessage("Loading this chapter's song...");
  void(async()=>{try{
   await unlocked;if(!current())return;
   const track=musicTrack(raw);let recordingId=track.id,url:string,fallback:string|undefined;
   const local=await localRead<OfflineAudio>(accountId,"audio:"+track.id).catch(()=>undefined);if(!current())return;
   const ready=readyPlaybackFor(track);
   if(validOfflineAudio(local)&&local.track.id===track.id){url=URL.createObjectURL(local.blob);objectUrl.current=url;}
   else if(navigator.onLine===false)throw new Error("This chapter's song is not saved on this device. Continue your story, or reconnect to play it.");
   else if(ready){url=ready.url;fallback=ready.fallbackUrl;}
   else{
    let result=await requestJson<ResolveRecordingResult>("/api/v2/recordings/resolve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:track.reference,expected:{title:track.title,artists:track.artists,artistsComplete:track.artistsComplete,version:track.version,durationMs:track.durationMs||undefined}}),signal:request.signal},{context:"playback",accountId});
    result=await waitForRecording(result,{signal:request.signal,accountId,origin:location.origin});
    if(result.status!=="resolved")throw new Error("Sound unavailable");recordingId=result.recording.recordingId;url=result.playback.url;fallback=result.playback.fallbackUrl;
   }
   if(!current())return;
   if((sound.initialized||sound.requiresVolumeGraph)&&!url.startsWith("blob:")&&new URL(url,location.href).origin!==location.origin){
    if(!fallback||new URL(fallback,location.href).origin!==location.origin)throw new Error("Sound unavailable");url=fallback;
   }
   sound.setVolume(latest.current.volume);audio.src=url;
   let highlightApplied=false;
   const enterHighlight=(metadataReady=false)=>{if(highlightApplied||!current()||media.current!==audio)return;const actualDuration=metadataReady&&Number.isFinite(audio.duration)&&audio.duration>0?audio.duration*1000:track.durationMs;if(actualDuration<=0)return;const start=bloomHighlightStart(raw,actualDuration);if(start<=0){highlightApplied=true;return;}try{audio.currentTime=start/1000;highlightApplied=true;}catch{/* Metadata will provide a seekable duration shortly. */}};
   audio.addEventListener("loadedmetadata",()=>enterHighlight(true));enterHighlight();
   receipt.current={id:crypto.randomUUID(),accountId,recordingId,sequence:0,ms:0,totalMs:0,last:0,wall:performance.now(),durationMs:track.durationMs,terminal:false};
   audio.addEventListener("playing",()=>{if(!current()||media.current!==audio)return;if(receipt.current?.terminal)renewReceipt();const r=receipt.current;if(r){r.last=audio.currentTime;r.wall=performance.now();}});
   audio.addEventListener("timeupdate",()=>{if(current()&&media.current===audio)collect();});
   audio.addEventListener("volumechange",()=>{if(!current()||media.current!==audio)return;collect({muted:nativeSound.current.muted||nativeSound.current.volume===0});nativeSound.current={muted:audio.muted,volume:audio.volume};});
   audio.addEventListener("pause",()=>{if(current()&&media.current===audio){collect({paused:false});flush();}});
   audio.addEventListener("ended",()=>{if(!current()||media.current!==audio)return;collect({paused:false});flush(true,true);setMessage("The chapter's song has ended.");});
   audio.addEventListener("error",()=>{if(!current()||media.current!==audio)return;flush(true);setMessage("This chapter's song isn't available right now. Continue your story, or tap Sound to try again.");});
   if(!paused.current)await audio.play();if(current())setMessage("");
  }catch(error){if(current())setMessage(navigator.onLine===false&&error instanceof Error?error.message:"This chapter's song isn't available right now. Continue your story, or tap Sound to try again.");}})();
 }
 useEffect(()=>{
  const previous=latest.current;
  if(previous.account?.id===music.account?.id&&(previous.settings.privateSession!==music.settings.privateSession||previous.settings.learnFromListening!==music.settings.learnFromListening)){flush(true);renewReceipt();}
  if(previous.volume!==music.volume)collect();latest.current=music;engine.current?.setVolume(music.volume);
 });
 useEffect(()=>{dispose();returning.current=null;paused.current=false;
 // Account changes cancel chapter audio before requests or receipts can reach another account.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[music.account?.id]);
 useEffect(()=>{if(music.status==="playing"&&media.current){stop(false);returning.current=null;}
 // Main-player gestures take precedence over companion audio.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[music.status,music.currentEntryId,music.track?.id]);
 useEffect(()=>{
  const erased=(event:Event)=>{const detail=(event as CustomEvent<{accountId?:string;scope?:string}>).detail;if(detail?.accountId!==latest.current.account?.id||detail.scope==="feedback")return;renewReceipt();};
  const timer=setInterval(()=>flush(),15000),hidden=()=>flush(true);window.addEventListener("pagehide",hidden);window.addEventListener("sakura-personalization-cleared",erased);window.addEventListener("sakura-listening-erased",erased);
  return()=>{clearInterval(timer);window.removeEventListener("pagehide",hidden);window.removeEventListener("sakura-personalization-cleared",erased);window.removeEventListener("sakura-listening-erased",erased);close(false);};
 // The lifetime timer reads current audio, account and settings through refs.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return {play,stop,close,pause,resume,message};
}
