"use client";
import {useEffect,useRef,useState} from "react";
import {useMusic} from "../app/MusicContext";
import {musicTrack,type MusicTrack} from "../app/types";
import {readyPlaybackFor} from "../app/playbackSource";
import {waitForRecording} from "../app/recordingJob";
import {localRead,deliverListen,validOfflineAudio,type OfflineAudio} from "../app/offline";
import {audibleIncrement,listeningOutcome} from "../app/listeningEvidence";
import {requestJson} from "../app/errors";
import type {ResolveRecordingResult} from "../server/contracts";
import {MediaAudioEngine} from "../audio/engine";

interface Receipt {id:string;accountId:string;recordingId:string;sequence:number;ms:number;totalMs:number;last:number;wall:number;durationMs:number;terminal:boolean}
interface PreparedBloomAudio {track:ReturnType<typeof musicTrack>;recordingId:string;url:string;fallbackUrl?:string;progressive?:boolean;release:()=>void}
interface BloomVoice {
 key:string;accountId:string;audio:HTMLAudioElement;engine:MediaAudioEngine;controller:AbortController;receipt:Receipt|null;
 release:()=>void;level:number;disposed:boolean;ready:boolean;nativeSound:{muted:boolean;volume:number};
 fadeTimer?:ReturnType<typeof setTimeout>;fallbackUrl?:string;currentUrl?:string;resetHighlight?:()=>void;
}

const CROSSFADE_STEPS=13,CROSSFADE_STEP_MS=50;

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
export function useBloomAudio(preparedPlayback?:(recording:Record<string,unknown>)=>PreparedBloomAudio|undefined){
 const music=useMusic(),latest=useRef(music);
 const preparedSource=useRef(preparedPlayback);useEffect(()=>{preparedSource.current=preparedPlayback;},[preparedPlayback]);
 const active=useRef<BloomVoice|null>(null),pending=useRef<BloomVoice|null>(null),outgoing=useRef<BloomVoice|null>(null),paused=useRef(false);
 const returning=useRef<{accountId:string;entryId:string|null;trackId:string;resume:boolean;choiceVersion?:number}|null>(null);
 const [message,setMessage]=useState("");
 function voices(){return [...new Set([active.current,pending.current,outgoing.current].filter((voice):voice is BloomVoice=>Boolean(voice)))];}
 function renewVoiceReceipt(voice:BloomVoice|null){const r=voice?.receipt;if(r&&voice)voice.receipt={...r,id:crypto.randomUUID(),sequence:0,ms:0,totalMs:0,last:voice.audio.currentTime,wall:performance.now(),terminal:false};}
 function renewReceipt(){renewVoiceReceipt(active.current);}
 function collectVoice(voice:BloomVoice|null,boundary?:{paused?:boolean;muted?:boolean}){
  const audio=voice?.audio,r=voice?.receipt;if(!voice||!audio||!r||voice.disposed)return;
  const now=audio.currentTime,wall=performance.now(),p=latest.current;
  const increment=audibleIncrement({mediaDeltaMs:(now-r.last)*1000,wallDeltaMs:wall-r.wall,playing:p.account?.id===r.accountId&&!r.terminal,paused:boundary?.paused??audio.paused,seeking:audio.seeking,privateSession:p.settings.privateSession,learnFromListening:p.settings.learnFromListening,muted:boundary?.muted??(audio.muted||voice.level<=0),volume:p.volume*voice.level});
  r.ms+=increment;r.totalMs+=increment;r.last=now;r.wall=wall;
 }
 function flushVoice(voice:BloomVoice|null,finished=false,naturalEnd=false){
  collectVoice(voice);const r=voice?.receipt,p=latest.current;
  if(!r||r.terminal||p.account?.id!==r.accountId||p.settings.privateSession||p.settings.learnFromListening===false)return;
  let remaining=Math.floor(r.ms);if(!remaining&&(!finished||r.sequence===0))return;
  const duration=voice?.audio.duration,outcome=listeningOutcome({naturalEnd,explicitSkip:false,audibleMs:r.totalMs,durationMs:Number.isFinite(duration)?duration!*1000:r.durationMs});
  do{const msPlayed=Math.min(120000,remaining);remaining-=msPlayed;r.ms-=msPlayed;
   void deliverListen(r.accountId,{eventId:r.id,recordingId:r.recordingId,sequence:r.sequence++,msPlayed,positionMs:Math.max(0,Math.floor((voice?.audio.currentTime||0)*1000)),completed:naturalEnd&&outcome.completed&&remaining===0,finished:finished&&remaining===0,context:"bloom",occurredAt:new Date(Date.now()-remaining).toISOString()}).catch(()=>{});
  }while(remaining>0);
  if(finished)r.terminal=true;
 }
 function flush(finished=false,naturalEnd=false){flushVoice(active.current,finished,naturalEnd);}
 function setLevel(voice:BloomVoice,level:number){if(voice.disposed)return;collectVoice(voice);voice.level=Math.max(0,Math.min(1,level));voice.engine.setVolume(latest.current.volume*voice.level);}
 function cancelFade(voice:BloomVoice|null){if(voice?.fadeTimer)clearTimeout(voice.fadeTimer);if(voice)voice.fadeTimer=undefined;}
 function fadeTo(voice:BloomVoice,target:number,done?:()=>void){
  cancelFade(voice);const from=voice.level;if(Math.abs(from-target)<.001){setLevel(voice,target);done?.();return;}let step=0;
  const advance=()=>{if(voice.disposed)return;step++;setLevel(voice,from+(target-from)*step/CROSSFADE_STEPS);if(step<CROSSFADE_STEPS)voice.fadeTimer=setTimeout(advance,CROSSFADE_STEP_MS);else{voice.fadeTimer=undefined;done?.();}};
  voice.fadeTimer=setTimeout(advance,CROSSFADE_STEP_MS);
 }
 function unlink(voice:BloomVoice){if(active.current===voice)active.current=null;if(pending.current===voice)pending.current=null;if(outgoing.current===voice)outgoing.current=null;}
 function disposeVoice(voice:BloomVoice|null,finish=true){
  if(!voice||voice.disposed)return;cancelFade(voice);unlink(voice);voice.controller.abort();if(finish)flushVoice(voice,true);voice.receipt=null;voice.disposed=true;voice.audio.pause();voice.audio.removeAttribute("src");voice.audio.load();voice.engine.dispose();voice.release();
 }
 function dispose(){for(const voice of voices())disposeVoice(voice);active.current=null;pending.current=null;outgoing.current=null;}
 function stop(paint=true){dispose();if(paint)setMessage("");}
 function pause(){paused.current=true;if(outgoing.current)disposeVoice(outgoing.current);for(const voice of voices()){cancelFade(voice);setLevel(voice,1);flushVoice(voice);voice.audio.pause();}}
 async function beginVoice(voice:BloomVoice){
  if(voice.disposed||!voice.ready||paused.current)return;
  try{await voice.engine.resume().catch(()=>{});try{await voice.audio.play();}catch(firstError){if(!voice.fallbackUrl||voice.currentUrl===voice.fallbackUrl)throw firstError;voice.currentUrl=voice.fallbackUrl;voice.audio.src=voice.fallbackUrl;voice.resetHighlight?.();voice.audio.load();await voice.audio.play();}
   if(voice.disposed||paused.current){voice.audio.pause();return;}const previous=active.current;pending.current=null;active.current=voice;
   if(previous&&previous!==voice&&previous.key!==voice.key&&!previous.audio.paused){flushVoice(previous,true);previous.receipt=null;outgoing.current=previous;fadeTo(previous,0,()=>disposeVoice(previous,false));fadeTo(voice,1);}
   else{if(previous&&previous!==voice)disposeVoice(previous);setLevel(voice,1);}setMessage("");
  }catch(error){if(voice.disposed)return;disposeVoice(voice,false);if(active.current)setMessage("This chapter's next song isn't available right now. The current soundtrack will keep playing.");else setMessage("Tap Sound to resume this chapter's soundtrack.");throw error;}
 }
 function resume(){paused.current=false;const voice=pending.current||active.current;if(!voice||voice.audio.ended)return;if(voice.receipt?.terminal)renewVoiceReceipt(voice);if(pending.current===voice)void beginVoice(voice).catch(()=>{});else{setLevel(voice,1);void voice.engine.resume().catch(()=>{});void voice.audio.play().catch(()=>{if(active.current===voice)setMessage("Tap Sound to resume this chapter's soundtrack.");});}}
 function close(paint=true){
  stop(paint);const original=returning.current;returning.current=null;const p=latest.current;
  if(original?.resume&&p.account?.id===original.accountId&&p.currentEntryId===original.entryId&&p.track?.id===original.trackId&&p.status==="paused"&&(original.choiceVersion===undefined||original.choiceVersion===p.getPlaybackChoiceVersion?.()))p.togglePlay();
 }
 function play(raw:Record<string,unknown>,resumePlayback=false){
  if(resumePlayback)paused.current=false;const p=latest.current,accountId=p.account?.id;if(!accountId)return;
  if(!returning.current&&p.track)returning.current={accountId,entryId:p.currentEntryId,trackId:p.track.id,resume:p.status==="playing",choiceVersion:p.getPlaybackChoiceVersion?.()};
  const original=returning.current;if(original?.choiceVersion!==undefined&&original.choiceVersion!==p.getPlaybackChoiceVersion?.())original.resume=false;
  p.pause();if(original)original.choiceVersion=p.getPlaybackChoiceVersion?.();
  disposeVoice(pending.current,false);disposeVoice(outgoing.current,false);if(active.current){cancelFade(active.current);setLevel(active.current,1);}const request=new AbortController();
  // Unlock iOS audio during the Sound gesture, before storage/network awaits.
  const audio=new Audio();audio.preload="auto";
  const sound=new MediaAudioEngine(audio),voice:BloomVoice={key:String(raw.recordingId||raw.id||"recording"),accountId,audio,engine:sound,controller:request,receipt:null,release:()=>{},level:active.current?0:1,disposed:false,ready:false,nativeSound:{muted:audio.muted,volume:audio.volume}};pending.current=voice;sound.setVolume(p.volume*voice.level);
  const unlocked=sound.setMode("none");void unlocked.catch(()=>{});
  const current=()=>!voice.disposed&&!request.signal.aborted&&latest.current.account?.id===accountId&&(pending.current===voice||active.current===voice||outgoing.current===voice);
  setMessage("Loading this chapter's song...");
  void(async()=>{try{
   await unlocked;if(!current())return;
   const track=musicTrack(raw),cached=preparedSource.current?.(raw),prepare=(p as typeof p&{preparePlaybackAudio?:(track:MusicTrack,signal:AbortSignal)=>Promise<PreparedBloomAudio>}).preparePlaybackAudio;let prepared:PreparedBloomAudio;
   if(cached)prepared=cached;
   else if(prepare)prepared=await prepare(track,request.signal);
   else{let recordingId=track.id,url:string,fallbackUrl:string|undefined,release=()=>{};const local=await localRead<OfflineAudio>(accountId,"audio:"+track.id).catch(()=>undefined);if(!current())return;const ready=readyPlaybackFor(track);
    if(validOfflineAudio(local)&&local.track.id===track.id){url=URL.createObjectURL(local.blob);let released=false;release=()=>{if(released)return;released=true;URL.revokeObjectURL(url);};}
    else if(navigator.onLine===false)throw new Error("This chapter's song is not saved on this device. Continue your story, or reconnect to play it.");
    else if(ready){url=ready.url;fallbackUrl=ready.fallbackUrl;}
    else{let result=await requestJson<ResolveRecordingResult>("/api/v2/recordings/resolve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:track.reference,expected:{title:track.title,artists:track.artists,artistsComplete:track.artistsComplete,version:track.version,durationMs:track.durationMs||undefined}}),signal:request.signal},{context:"playback",accountId});result=await waitForRecording(result,{signal:request.signal,accountId,origin:location.origin});if(result.status!=="resolved")throw new Error("Sound unavailable");recordingId=result.recording.recordingId;url=result.playback.url;fallbackUrl=result.playback.fallbackUrl;}
    prepared={track,recordingId,url,fallbackUrl,release};
   }
   if(!current()){prepared.release();return;}voice.release=prepared.release;voice.key=prepared.recordingId;let url=prepared.url;const fallback=prepared.fallbackUrl;
   if((sound.initialized||sound.requiresVolumeGraph)&&!url.startsWith("blob:")&&new URL(url,location.href).origin!==location.origin){
    if(!fallback||new URL(fallback,location.href).origin!==location.origin)throw new Error("Sound unavailable");url=fallback;
   }
   sound.setVolume(latest.current.volume*voice.level);voice.currentUrl=url;voice.fallbackUrl=fallback;audio.src=url;
   let highlightApplied=false;
   const enterHighlight=(metadataReady=false)=>{if(highlightApplied||!current())return;const actualDuration=metadataReady&&Number.isFinite(audio.duration)&&audio.duration>0?audio.duration*1000:prepared.track.durationMs;if(actualDuration<=0)return;const start=bloomHighlightStart(raw,actualDuration);if(start<=0){highlightApplied=true;return;}try{audio.currentTime=start/1000;highlightApplied=true;}catch{/* Metadata will provide a seekable duration shortly. */}};
   voice.resetHighlight=()=>{highlightApplied=false;enterHighlight();};
   audio.addEventListener("loadedmetadata",()=>enterHighlight(true));enterHighlight();
   voice.receipt={id:crypto.randomUUID(),accountId,recordingId:prepared.recordingId,sequence:0,ms:0,totalMs:0,last:0,wall:performance.now(),durationMs:prepared.track.durationMs,terminal:false};voice.ready=true;
   audio.addEventListener("playing",()=>{if(!current())return;if(voice.receipt?.terminal)renewVoiceReceipt(voice);const r=voice.receipt;if(r){r.last=audio.currentTime;r.wall=performance.now();}});
   audio.addEventListener("timeupdate",()=>{if(current())collectVoice(voice);});
   audio.addEventListener("volumechange",()=>{if(!current())return;collectVoice(voice,{muted:voice.nativeSound.muted||voice.nativeSound.volume===0||voice.level<=0});voice.nativeSound={muted:audio.muted,volume:audio.volume};});
   audio.addEventListener("pause",()=>{if(current()){collectVoice(voice,{paused:false});flushVoice(voice);}});
   audio.addEventListener("ended",()=>{if(!current())return;collectVoice(voice,{paused:false});flushVoice(voice,true,true);if(active.current===voice)setMessage("The chapter's song has ended.");});
   audio.addEventListener("error",()=>{if(!current())return;flushVoice(voice,true);if(active.current===voice)setMessage("This chapter's song isn't available right now. Continue your story, or tap Sound to try again.");});
   if(!paused.current)await beginVoice(voice);
  }catch(error){if(!voice.disposed&&current()){disposeVoice(voice,false);setMessage(active.current?"This chapter's next song isn't available right now. The current soundtrack will keep playing.":navigator.onLine===false&&error instanceof Error?error.message:"This chapter's song isn't available right now. Continue your story, or tap Sound to try again.");}}})();
 }
 useEffect(()=>{
  const previous=latest.current;
  if(previous.account?.id===music.account?.id&&(previous.settings.privateSession!==music.settings.privateSession||previous.settings.learnFromListening!==music.settings.learnFromListening)){for(const voice of voices()){flushVoice(voice,true);renewVoiceReceipt(voice);}}
  if(previous.volume!==music.volume)for(const voice of voices())collectVoice(voice);latest.current=music;for(const voice of voices())voice.engine.setVolume(music.volume*voice.level);
 });
 useEffect(()=>{dispose();returning.current=null;paused.current=false;
 // Account changes cancel chapter audio before requests or receipts can reach another account.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[music.account?.id]);
 useEffect(()=>{if(music.status==="playing"&&voices().length){dispose();returning.current=null;}
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
