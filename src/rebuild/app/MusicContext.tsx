"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { musicTrack, type Account, type DownloadEntry, type MusicTrack, type PlaybackStatus, type PlayerModal, type QueueEntry, type UserSettings } from "./types";
import { requestJson, userIssue, userMessage, UserFacingError, responseIssue, type ErrorContext, type UserIssue } from "./errors";
import type {ResolveRecordingResult} from "../server/contracts";
import {readPreferenceDraft,writePreferenceDraft,settingsFields,fullSettings,cachedPreferences,unacknowledgedPreferences,rebasePreferences,preferenceRevision,preferenceFieldRevisions,type PreferenceDraft} from "./preferences";
import {readFavoriteDraft,writeFavoriteDraft,favoriteOverlay,acknowledgeFavorite,type FavoriteIntent} from "./favorites";
import {DurableDownloadManager} from "./downloadEngine";
import {SharedFlight} from "./sharedFlight";
import {partialPlaybackUrl,revokePartialPlayback,revokePartialPlaybackUrl} from "./partialPlayback";
import {ListeningSync,deviceIdentity} from "./listeningSync";
import {sessionState,type ListeningSession} from "./sessionState";
import {MediaAudioEngine} from "../audio/engine";
import {audioTechnology,type AudioTechnology} from "../audio/presets";
import {readyPlaybackFor} from "./playbackSource";
import {boundedSeekPosition} from "./seekPosition";
import {waitForRecording} from "./recordingJob";
import { clearResources, invalidateResources } from "./resources";
import {FEED_DEFAULTS} from "./feedPreferences";
import {planLocalQueue,type ListeningEvidence,type TasteFeedback} from "../recommendations/personalization";
import {audibleIncrement,listeningOutcome} from "./listeningEvidence";
import {smartContinuation} from "./smartQueue";
import {tasteStamp,tasteTargetKey,retainedFeedback} from "./tasteOrdering";
import { appendManual, clearUpcoming, moveUpcoming, nextUpcoming, reorderUpcoming, upcomingQueue } from "./listeningQueue";
import { clearListeningOutbox, deliverListen, drainListen, lastAccount, localRead, localWrite, rememberAccount, forgetActiveAccount, savedAudio, validOfflineAudio, type ListenChunk, type OfflineAudio } from "./offline";
export type { MusicTrack, DownloadEntry, QueueEntry } from "./types";
export interface SmartQueueOptions {scope?:"all"|"liked"|"downloads"|"collection";tracks?:MusicTrack[];append?:boolean}
export interface ArtistChoiceEditGuard {artistChoiceVersion:string}
export interface PreparedPlaybackAudio {track:MusicTrack;recordingId:string;url:string;fallbackUrl?:string;progressive:boolean;release:()=>void}
interface LocalTasteEvidence {history:ListeningEvidence[];feedback:TasteFeedback[]}
export interface MusicState {
 account:Account|null;booting:boolean;offline:boolean;settings:UserSettings;artistChoiceVersion:string;updateSettings:(patch:Partial<UserSettings>,guard?:ArtistChoiceEditGuard)=>Promise<void>;
 track:MusicTrack|null;status:PlaybackStatus;error:string|null;positionMs:number;durationMs:number;queue:QueueEntry[];currentEntryId:string|null;
 getPlaybackChoiceVersion?:()=>number;
 play:(track:MusicTrack,list?:MusicTrack[],source?:{context:string;contextId?:string})=>void;playQueueEntry:(entryId:string)=>void;togglePlay:()=>void;pause:()=>void;next:()=>void;previous:()=>void;seek:(ms:number)=>void;
 addQueue:(track:MusicTrack)=>void;removeQueue:(entryId:string)=>void;moveQueue:(entryId:string,delta:number)=>void;reorderQueue:(entryId:string,beforeId:string|null)=>void;clearQueue:()=>void;
 smartQueue:(options?:SmartQueueOptions)=>Promise<void>;smartQueueBusy:boolean;
 parkedPicks:QueueEntry[];restoreParkedPicks:()=>void;
 shuffle:boolean;setShuffle:(on:boolean)=>void;repeat:"off"|"one"|"all";setRepeat:(mode:"off"|"one"|"all")=>void;volume:number;setVolume:(volume:number)=>void;
 liked:Set<string>;toggleLike:(track:MusicTrack)=>Promise<void>;downloads:Record<string,DownloadEntry>;requestDownload:(track:MusicTrack)=>void;cancelDownload:(id:string)=>void;pauseDownload:(id:string)=>void;resumeDownload:(id:string)=>void;removeDownload:(id:string)=>Promise<boolean>;effectiveId:(track:MusicTrack)=>string;ensureRecording:(track:MusicTrack)=>Promise<MusicTrack>;
 preparePlaybackAudio:(track:MusicTrack,signal:AbortSignal)=>Promise<PreparedPlaybackAudio>;
 modal:PlayerModal;shareTrack:MusicTrack|null;openModal:(modal:PlayerModal,subject?:MusicTrack)=>void;closeModal:()=>void;notify:(message:string)=>void;toast:string;notice:{issue:UserIssue;retry?:()=>void}|null;reportError:(error:unknown,context?:ErrorContext,retry?:()=>void)=>void;dismissNotice:()=>void;retryConnection:()=>void;logout:()=>Promise<void>;sleepMinutes:number|null;setSleepTimer:(minutes:number|null)=>void;
}
const DEFAULT_SETTINGS:UserSettings={theme:"system",audioQuality:"high",audioTechnology:"none",japaneseReading:false,privateSession:false,...FEED_DEFAULTS,reducedMotion:false,openingAnimation:1,bloomPerformance:"auto",seedArtists:[],seedGenres:[],onboarded:false,timeZone:"Africa/Lagos",explicitContent:true,volume:.8,shuffle:false,repeat:"off",previewVolume:.8,previewLoop:true,sleepTimerMinutes:15};
const Context=createContext<MusicState|null>(null);
export function useMusic(){const value=useContext(Context);if(!value)throw new Error("MusicProvider is required.");return value;}
interface Resolved {track:MusicTrack;url:string;assetId:string;sizeBytes:number;resolvedAt:number;fallbackUrl?:string;sha256?:string;mimeType?:string}
interface PlaybackRecovery {token:number;entryId:string;accountId:string;attempt:number;timer?:ReturnType<typeof setTimeout>;resume:()=>void}
interface ActivePlaybackSource {token:number;fallbackUrl:string|undefined;used:boolean;recoveryAttempt:number;recoveryPositionMs:number;progressive:boolean;transport:number}
const MAX_PLAYBACK_RECOVERIES=3;
const aliasKey=(t:MusicTrack)=>t.reference.provider+":"+(t.reference.scope||"")+":"+t.reference.id;
const isUuid=(id:string)=>/^[a-f0-9-]{36}$/i.test(id);

export function MusicProvider({children}:{children:ReactNode}){
 const [account,setAccount]=useState<Account|null>(null);const [booting,setBooting]=useState(true);const [offline,setOffline]=useState(false);const [settings,setSettings]=useState<UserSettings>(DEFAULT_SETTINGS);
 const [track,setTrack]=useState<MusicTrack|null>(null);const [status,setStatus]=useState<PlaybackStatus>("idle");const [error,setError]=useState<string|null>(null);const [positionMs,setPosition]=useState(0);const [durationMs,setDuration]=useState(0);
 const [queue,setQueue]=useState<QueueEntry[]>([]);const [currentEntryId,setCurrentEntryId]=useState<string|null>(null);const [shuffle,setShuffleState]=useState(false);const [repeat,setRepeatState]=useState<"off"|"one"|"all">("off");const [volume,setVolumeState]=useState(.8);
 const [liked,setLiked]=useState<Set<string>>(new Set());const [downloads,setDownloads]=useState<Record<string,DownloadEntry>>({});const [modal,setModal]=useState<PlayerModal>(null);const [shareTrack,setShareTrack]=useState<MusicTrack|null>(null);const [toast,setToast]=useState("");const [sleepMinutes,setSleepMinutes]=useState<number|null>(null);
 const [notice,setNotice]=useState<{issue:UserIssue;retry?:()=>void}|null>(null);const [connectionVersion,setConnectionVersion]=useState(0);
 const [artistChoiceVersion,setArtistChoiceVersion]=useState("");
 const [smartQueueBusy,setSmartQueueBusy]=useState(false);const smartQueueRequest=useRef(0);const smartQueuePending=useRef(false);
 const [parkedPicks,setParkedPicks]=useState<QueueEntry[]>([]);const parked=useRef<QueueEntry[]>([]);const parkedWrites=useRef(Promise.resolve());
 const lastFeedbackClearAt=useRef<string|null>(null);const removedFeedback=useRef(new Map<string,string>());
 const lastTasteClearAt=useRef<string|null>(null);const tasteVersion=useRef(0);const tasteSync=useRef<Promise<void>|null>(null);
 const tasteEvidence=useRef<LocalTasteEvidence>({history:[],feedback:[]});const tasteWrite=useRef(Promise.resolve());
 const preferenceBaseRevisions=useRef<Record<string,number>>({}),serverPreferenceFieldRevisions=useRef<Record<string,number>>({});
 const preferenceBase=useRef<Partial<UserSettings>>({}),serverPreferences=useRef<Partial<UserSettings>>({}),serverPreferenceRevision=useRef<number|undefined>(undefined);
 const pendingPreferences=useRef<Partial<UserSettings>>({});const settingsQueue=useRef<Promise<void>>(Promise.resolve());const settingsVersion=useRef(0);
 const pendingFavorites=useRef<Record<string,FavoriteIntent>>({});const favoritesQueue=useRef<Promise<void>>(Promise.resolve());
 const activeAccountId=useRef<string|null>(null);const accountGeneration=useRef(0);const accountRequests=useRef(new Set<AbortController>());
 const audio=useRef<HTMLAudioElement|null>(null);const generation=useRef(0);const resolveController=useRef<AbortController|null>(null);const blobUrl=useRef<string|null>(null);const aliases=useRef<Record<string,string>>({});const readySources=useRef(new Map<string,Resolved>());const likeJobs=useRef(new Set<string>());const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const sleepTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const audioEngine=useRef<MediaAudioEngine|null>(null);
 const pendingMediaRestore=useRef<{token:number;address:string;positionMs:number}|null>(null);
 const listeningSync=useRef<ListeningSync|null>(null);const restoredPosition=useRef(0);const sleepUntil=useRef<number|null>(null);const lastSnapshot=useRef(0);const logoutJob=useRef<Promise<void>|null>(null);const removeJobs=useRef(new Map<string,Promise<boolean>>());const likedRef=useRef(new Set<string>());const favoriteVersion=useRef(0);const downloadSnapshot=useRef<Record<string,DownloadEntry>>({});const requestedDownloads=useRef(new Map<string,Promise<void>>());const downloadManager=useRef<{accountId:string;manager:DurableDownloadManager;hydrated:Promise<void>}|null>(null);const sourceFlights=useRef(new SharedFlight<Resolved>());const indexFlights=useRef(new SharedFlight<MusicTrack>());
 const playbackChoiceVersion=useRef(0);const nativeSound=useRef({muted:false,volume:.8});
 const runtime=useRef({account,track,status,queue,currentEntryId,shuffle,repeat,settings,volume});const audible=useRef({eventId:"",sequence:0,ms:0,totalMs:0,terminal:false,last:0,media:0,context:"direct",contextId:null as string|null});const nextRef=useRef<()=>void>(()=>{});const activeSource=useRef<ActivePlaybackSource|null>(null);const playbackWatchdog=useRef<{arm:()=>void;clear:()=>void}>({arm:()=>{},clear:()=>{}});const playbackRecovery=useRef<PlaybackRecovery|null>(null);const playbackFallback=useRef<()=>boolean>(()=>false);
 useEffect(()=>{runtime.current={account,track,status,queue,currentEntryId,shuffle,repeat,settings,volume};},[account,track,status,queue,currentEntryId,shuffle,repeat,settings,volume]);
 useEffect(()=>{
  function cleared(event:Event){const detail=(event as CustomEvent<{accountId?:string;scope?:string;period?:"week"|"month"|"all";cutoff?:string;tasteFeedback?:TasteFeedback[];feedbackAuthoritative?:boolean}>).detail,owner=activeAccountId.current;if(!owner||detail?.accountId!==owner)return;const scope=detail.scope||"history";
   if(scope==="history"||scope==="all"){
    const cutoff=detail.cutoff||new Date().toISOString(),stamp=tasteStamp(cutoff),known=tasteStamp(lastTasteClearAt.current);
    // Receipts may arrive twice or out of order. Their erasure still applies to
    // queued events, but only a new receipt may restart current measurement.
    if(stamp&&(!known||stamp>known)){audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:audio.current?.currentTime||0,context:audible.current.context,contextId:audible.current.contextId};tasteEvidence.current.history=[];lastTasteClearAt.current=cutoff;void localWrite(owner,"personalization-clear-marker",cutoff).catch(()=>{});}
    void clearListeningOutbox(owner,detail.period||"all",detail.cutoff?Date.parse(detail.cutoff):Date.now()).catch(error=>reportError(error,"save"));
   }
   if(scope==="feedback"||scope==="all"){
    const cutoff=tasteStamp(detail.cutoff);
    if(cutoff&&lastFeedbackClearAt.current&&cutoff<lastFeedbackClearAt.current){/* A newer clear has already supplied this account's remaining choices. */}
    else if(detail.feedbackAuthoritative&&Array.isArray(detail.tasteFeedback)){
     const remaining=detail.tasteFeedback.map(item=>({target:item.target,targetId:item.targetId,kind:item.kind,expiresAt:item.expiresAt??null,updatedAt:item.updatedAt}));
     tasteEvidence.current.feedback=cutoff?retainedFeedback(tasteEvidence.current.feedback,remaining,cutoff,removedFeedback.current):remaining;
    }else if((detail.period||"all")==="all")tasteEvidence.current.feedback=[];
    if(cutoff&&(!lastFeedbackClearAt.current||cutoff>lastFeedbackClearAt.current))lastFeedbackClearAt.current=cutoff;
    // Older responses cannot identify which choices a partial clear removed.
    // Keep known exclusions until an authoritative reply supplies the remainder.
   }tasteVersion.current++;saveTasteEvidence(owner);smartQueueRequest.current++;smartQueuePending.current=false;setSmartQueueBusy(false);if(scope==="history"||scope==="all")invalidateResources(owner,"/api/v2/",true);else invalidateRecommendationResources(owner);
  }
  function tasteChanged(event:Event){
   const detail=(event as CustomEvent<{accountId?:string;feedback?:TasteFeedback;recordingId?:string;removedTargetId?:string;target?:"recording"|"artist";authoritative?:boolean;mutationAt?:string}>).detail,owner=activeAccountId.current;if(!owner||detail?.accountId!==owner)return;
   if(!detail.authoritative&&(detail.feedback||detail.removedTargetId)){
    const target:Pick<TasteFeedback,"target"|"targetId">=detail.feedback||{target:detail.target||"recording",targetId:detail.removedTargetId!},key=tasteTargetKey(target),stamp=tasteStamp(detail.feedback?.updatedAt||detail.mutationAt),prior=tasteEvidence.current.feedback.find(item=>tasteTargetKey(item)===key),known=[tasteStamp(prior?.updatedAt),removedFeedback.current.get(key)].filter((value):value is string=>!!value).sort().at(-1);
    if(stamp&&(stamp<=(lastFeedbackClearAt.current||"")||stamp<(known||""))||!stamp&&lastFeedbackClearAt.current)return;
    if(detail.removedTargetId&&stamp)removedFeedback.current.set(key,stamp);
   }
   smartQueueRequest.current++;smartQueuePending.current=false;setSmartQueueBusy(false);if(detail.authoritative)return;tasteVersion.current++;
   if(detail.removedTargetId){tasteEvidence.current.feedback=tasteEvidence.current.feedback.filter(item=>item.targetId!==detail.removedTargetId||item.target!==(detail.target||"recording"));saveTasteEvidence(owner);}
   else if(detail.feedback){const feedback=detail.feedback;tasteEvidence.current.feedback=[feedback,...tasteEvidence.current.feedback.filter(item=>item.target!==feedback.target||item.targetId!==feedback.targetId)];saveTasteEvidence(owner);}
   else{const version=tasteVersion.current;void localRead<{data?:{feedback?:TasteFeedback[]}}>(owner,"resource:/api/v2/taste").then(saved=>{if(activeAccountId.current===owner&&version===tasteVersion.current&&saved?.data?.feedback){tasteEvidence.current.feedback=saved.data.feedback;saveTasteEvidence(owner);}}).catch(()=>{});}
  }
  window.addEventListener("sakura-personalization-cleared",cleared);window.addEventListener("sakura-taste-updated",tasteChanged);return()=>{window.removeEventListener("sakura-personalization-cleared",cleared);window.removeEventListener("sakura-taste-updated",tasteChanged);};
 // Active-account checks protect asynchronous events and browser writes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 function notify(message:string){if(account&&activeAccountId.current!==account.id)return;if(toastTimer.current)clearTimeout(toastTimer.current);setToast(message);toastTimer.current=setTimeout(()=>setToast(""),4000);}
 function cancelPlaybackRecovery(){const pending=playbackRecovery.current;if(pending?.timer)clearTimeout(pending.timer);playbackRecovery.current=null;}
 /** Error events can replace media before its original Play promise rejects. Only the current transport owns that outcome. */
 async function playAttachedAudio(source:ActivePlaybackSource){
  const a=audio.current;if(!a)return;
  const address=a.src,transport=++source.transport;
  // Sakura has no variable-speed playback. Keep the recording's original pitch
  // through source recovery and browser media-session interruptions.
  a.defaultPlaybackRate=1;a.playbackRate=1;a.preservesPitch=true;
  void audioEngine.current?.resume().catch(()=>{});
  try{await a.play();}catch(error){
   if(activeSource.current!==source||source.token!==generation.current||source.transport!==transport||a.src!==address)return;
   throw error;
  }
 }
 /** A media request can expire while its durable download is still retrying. Reopen it without stopping that job. */
 function recoverPlayback(attempt:number){
  const r=runtime.current,a=audio.current,entry=r.queue.find(item=>item.entryId===r.currentEntryId);
  if(playbackRecovery.current)return true;
  if(attempt>=MAX_PLAYBACK_RECOVERIES||!r.account||!r.track||!a||!a.src&&r.status!=="resolving"&&r.status!=="buffering"&&attempt===0||!entry||!["resolving","buffering","playing"].includes(r.status))return false;
  const position=playbackPosition();collectAudible();restoredPosition.current=position;setPosition(position);readySources.current.delete(effectiveId(r.track));
  const token=++generation.current;resolveController.current?.abort();playbackWatchdog.current.clear();activeSource.current=null;
  const pending:PlaybackRecovery={token,entryId:entry.entryId,accountId:r.account.id,attempt:attempt+1,resume:()=>{}};playbackRecovery.current=pending;
  runtime.current.status="buffering";setStatus("buffering");setError(null);a.pause();a.removeAttribute("src");a.load();revokePartialPlayback();
  pending.resume=()=>{
   if(playbackRecovery.current!==pending||pending.timer||navigator.onLine===false)return;
   pending.timer=setTimeout(()=>{
    pending.timer=undefined;
    if(playbackRecovery.current!==pending||token!==generation.current||activeAccountId.current!==pending.accountId||runtime.current.currentEntryId!==pending.entryId||runtime.current.status!=="buffering")return;
    if(navigator.onLine===false)return;
    const current=runtime.current.queue.find(item=>item.entryId===pending.entryId);if(!current){cancelPlaybackRecovery();return;}
    void startEntry(current,restoredPosition.current,pending.attempt);
   },750*2**attempt);
  };
  pending.resume();return true;
 }
 function applyAudioTechnology(mode:AudioTechnology):Promise<void>{
  const a=audio.current,engine=audioEngine.current;if(!a||!engine)return Promise.resolve();
  const address=a.src;
  if(address&&(mode!=="none"||engine.initialized||engine.requiresVolumeGraph)&&!address.startsWith("blob:")&&new URL(address,location.href).origin!==location.origin){
   const source=activeSource.current,fallback=source?.fallbackUrl;
   if(!fallback||new URL(fallback,location.href).origin!==location.origin)return Promise.reject(new Error("This song needs a compatible audio source to use this sound. Try another song."));
   collectAudible();const position=playbackPosition()/1000,wasPlaying=!a.paused,token=generation.current;restoredPosition.current=position*1000;
   a.pause();attachPlaybackSource(a,fallback,token);if(source)source.used=true;
   if(runtime.current.track){runtime.current.track={...runtime.current.track,audioUrl:fallback};setTrack(runtime.current.track);}
   const applied=engine.setMode(mode);if(wasPlaying)void a.play().catch(()=>notify("Tap play to continue with this sound."));return applied;
  }
  return engine.setMode(mode);
 }
 useEffect(()=>{if(audioEngine.current?.initialized)void applyAudioTechnology(audioTechnology(settings.audioTechnology)).catch(error=>notify(error instanceof Error?error.message:"This sound could not be enabled."));
 // The controller is initialized only by an explicit listening gesture.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[settings.audioTechnology]);
 function reportError(error:unknown,context:ErrorContext="page",retry?:()=>void){if(account&&activeAccountId.current!==account.id)return;setToast("");setNotice({issue:userIssue(error,context),retry});}
 function switchAccount(user:Account|null){if(activeAccountId.current===(user?.id||null))return;cancelPlaybackRecovery();saveListening(false);flushListen(false,true);listeningSync.current?.stop();listeningSync.current=null;if(sleepTimer.current)clearTimeout(sleepTimer.current);sleepUntil.current=null;setSleepMinutes(null);restoredPosition.current=0;const initial={...DEFAULT_SETTINGS,...(user?cachedPreferences(user.id):{})};const old=activeAccountId.current;activeAccountId.current=user?.id||null;accountGeneration.current++;generation.current++;settingsVersion.current++;smartQueueRequest.current++;smartQueuePending.current=false;setSmartQueueBusy(false);tasteEvidence.current={history:[],feedback:[]};tasteVersion.current++;tasteSync.current=null;lastTasteClearAt.current=null;lastFeedbackClearAt.current=null;removedFeedback.current.clear();parked.current=[];setParkedPicks([]);resolveController.current?.abort();for(const controller of accountRequests.current)controller.abort();accountRequests.current.clear();downloadManager.current?.manager.dispose();downloadManager.current=null;downloadSnapshot.current={};requestedDownloads.current.clear();sourceFlights.current.clear();indexFlights.current.clear();revokePartialPlayback();likeJobs.current.clear();pendingFavorites.current={};favoritesQueue.current=Promise.resolve();pendingPreferences.current={};preferenceBase.current={};serverPreferences.current={};serverPreferenceRevision.current=undefined;preferenceBaseRevisions.current={};serverPreferenceFieldRevisions.current={};settingsQueue.current=Promise.resolve();if(old)clearResources(old);readySources.current.clear();aliases.current={};activeSource.current=null;playbackWatchdog.current.clear();audio.current?.pause();if(audio.current)audio.current.src="";if(blobUrl.current){URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;}runtime.current={...runtime.current,account:user,track:null,status:"idle",queue:[],currentEntryId:null,settings:initial,volume:initial.volume??.8,shuffle:initial.shuffle??false,repeat:initial.repeat??"off"};audible.current={eventId:"",sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:0,context:"direct",contextId:null as string|null};setTrack(null);setQueue([]);setCurrentEntryId(null);setPosition(0);setDuration(0);setStatus("idle");setDownloads({});likedRef.current=new Set();favoriteVersion.current++;setLiked(new Set());setSettings(initial);setVolumeState(initial.volume??.8);setShuffleState(initial.shuffle??false);setRepeatState(initial.repeat??"off");if(audioEngine.current)audioEngine.current.setVolume(initial.volume??.8);else if(audio.current)audio.current.volume=initial.volume??.8;setModal(null);setNotice(null);setToast("");setArtistChoiceVersion(artistChoiceKey(initial));}
 async function accountJson<T=Record<string,unknown>>(path:string,init:RequestInit={},context:ErrorContext="save",expectedAccount=activeAccountId.current){if(!expectedAccount)throw new UserFacingError(responseIssue(401,null));if(expectedAccount!==activeAccountId.current)throw new DOMException("Account changed","AbortError");const epoch=accountGeneration.current;const controller=new AbortController();const cancel=()=>controller.abort(init.signal?.reason);if(init.signal?.aborted)cancel();else init.signal?.addEventListener("abort",cancel,{once:true});accountRequests.current.add(controller);try{const value=await requestJson<T>(path,{...init,signal:controller.signal},{context,accountId:expectedAccount});if(epoch!==accountGeneration.current||expectedAccount!==activeAccountId.current)throw new DOMException("Account changed","AbortError");return value;}finally{init.signal?.removeEventListener("abort",cancel);accountRequests.current.delete(controller);}}
 function preferenceSyncMetadata(){return {serverRevision:serverPreferenceRevision.current,serverSettings:serverPreferences.current,baseSettings:preferenceBase.current,serverFieldRevisions:serverPreferenceFieldRevisions.current,baseFieldRevisions:preferenceBaseRevisions.current};}
 function artistChoiceKey(value=runtime.current.settings){return JSON.stringify([accountGeneration.current,serverPreferenceFieldRevisions.current.seedArtists||0,serverPreferenceFieldRevisions.current.seedArtistSelections||0,value.seedArtists,value.seedArtistSelections||[]]);}
 function restorePreferenceMetadata(draft:PreferenceDraft|undefined){
  if(!draft)return;
  if(serverPreferenceRevision.current===undefined&&draft.serverRevision!==undefined){serverPreferenceRevision.current=draft.serverRevision;serverPreferences.current=settingsFields(draft.serverSettings);serverPreferenceFieldRevisions.current=preferenceFieldRevisions({fieldRevisions:draft.serverFieldRevisions});}
  preferenceBase.current={...settingsFields(draft.baseSettings),...preferenceBase.current};
  preferenceBaseRevisions.current={...Object.fromEntries(Object.keys(settingsFields(draft.baseSettings)).map(key=>[key,draft.serverRevision||0])),...preferenceFieldRevisions({fieldRevisions:draft.baseFieldRevisions}),...preferenceBaseRevisions.current};
 }
 async function persistPreferences(accountId:string){await writePreferenceDraft(accountId,runtime.current.settings,Object.keys(pendingPreferences.current).length>0,pendingPreferences.current,preferenceSyncMetadata()).catch(()=>{});}
 function refreshPreferenceBase(response:Record<string,unknown>){
  const remote={...DEFAULT_SETTINGS,...fullSettings(response.settings||response)},fieldRevisions=preferenceFieldRevisions(response),rebased=rebasePreferences(pendingPreferences.current,preferenceBase.current,remote,{base:preferenceBaseRevisions.current,remote:fieldRevisions});
  pendingPreferences.current=rebased.pending;
  preferenceBase.current=Object.fromEntries(Object.keys(rebased.pending).map(key=>[key,remote[key as keyof UserSettings]])) as Partial<UserSettings>;
  preferenceBaseRevisions.current=Object.fromEntries(Object.keys(pendingPreferences.current).map(key=>[key,fieldRevisions[key]||0]));
  serverPreferenceFieldRevisions.current=fieldRevisions;serverPreferences.current=remote;serverPreferenceRevision.current=preferenceRevision(response);
  applySettings({...remote,...pendingPreferences.current});
  if(rebased.conflicts.length)notify("Your newer choices from another device are now in use.");
 }
 async function sendPreferenceChanges(accountId:string,initial?:Record<string,unknown>,signal?:AbortSignal){
  const epoch=accountGeneration.current,current=()=>epoch===accountGeneration.current&&activeAccountId.current===accountId&&!signal?.aborted;
  if(initial){refreshPreferenceBase(initial);await persistPreferences(accountId);}
  else if(serverPreferenceRevision.current===undefined){const remote=await accountJson<Record<string,unknown>>("/api/v2/settings",{signal},"save",accountId);if(!current())return;refreshPreferenceBase(remote);await persistPreferences(accountId);}
  for(let attempt=0;attempt<3&&current();attempt++){
   const dirty={...pendingPreferences.current};if(!Object.keys(dirty).length)return;
   try{
    const response=await accountJson<Record<string,unknown>>("/api/v2/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...dirty,...(serverPreferenceRevision.current!==undefined?{expectedRevision:serverPreferenceRevision.current}:{})}),signal},"save",accountId);
    if(!current())return;
    const remote={...DEFAULT_SETTINGS,...fullSettings(response.settings||response)};
    pendingPreferences.current=unacknowledgedPreferences(pendingPreferences.current,dirty);
    // An edit made while this save was in flight is based on the accepted
    // local choice, not the older value against which that save was sent.
    preferenceBase.current=Object.fromEntries(Object.keys(pendingPreferences.current).map(key=>[key,remote[key as keyof UserSettings]])) as Partial<UserSettings>;
    const fieldRevisions=preferenceFieldRevisions(response);preferenceBaseRevisions.current=Object.fromEntries(Object.keys(pendingPreferences.current).map(key=>[key,fieldRevisions[key]||0]));
    serverPreferenceFieldRevisions.current=fieldRevisions;serverPreferences.current=remote;serverPreferenceRevision.current=preferenceRevision(response);
    applySettings({...remote,...pendingPreferences.current});await persistPreferences(accountId);
    if(current()){setNotice(null);if(["seedArtists","seedGenres","seedArtistSelections","discovery","artistVariety","repeatTolerance","newReleaseBias","deepCutBias","timeAware","learnFromListening","explicitContent","onboarded","timeZone"].some(key=>key in dirty))invalidateResources(accountId);}
    return;
   }catch(error){
    if(!current())return;
    if(!(error instanceof UserFacingError)||error.status!==409)throw error;
    const remote=await accountJson<Record<string,unknown>>("/api/v2/settings",{signal},"save",accountId);if(!current())return;refreshPreferenceBase(remote);await persistPreferences(accountId);
    if(attempt===2&&Object.keys(pendingPreferences.current).length)throw new UserFacingError({kind:"busy",title:"Settings are changing on another device.",message:"Your latest account choices are shown here. Try saving your remaining changes again.",action:"Save again"},409);
   }
  }
 }
 async function syncSettings(accountId:string,signal?:AbortSignal){
  const epoch=accountGeneration.current;const operation=settingsQueue.current.catch(()=>{}).then(async()=>{
   if(epoch!==accountGeneration.current||activeAccountId.current!==accountId)return;
   const response=await accountJson<Record<string,unknown>>("/api/v2/settings",{signal},"save",accountId),draft=await readPreferenceDraft(accountId);
   if(signal?.aborted||epoch!==accountGeneration.current||activeAccountId.current!==accountId)return;
   restorePreferenceMetadata(draft);
   pendingPreferences.current={...(draft?.pending?settingsFields(draft.pendingPatch||draft.settings):{}),...pendingPreferences.current};
   await sendPreferenceChanges(accountId,response,signal);
  });settingsQueue.current=operation.catch(()=>{});return operation;
 }
 function applySettings(value:UserSettings){
  value={...DEFAULT_SETTINGS,...fullSettings(value)};setArtistChoiceVersion(artistChoiceKey(value));
  const previous=runtime.current.settings;
  if(JSON.stringify(previous)===JSON.stringify(value))return;
  settingsVersion.current++;if(runtime.current.volume!==(value.volume??.8))collectAudible();
  if(previous.privateSession!==value.privateSession||previous.learnFromListening!==value.learnFromListening){flushListen(false,true);audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:audio.current?.currentTime||0,context:audible.current.context,contextId:audible.current.contextId};}
  runtime.current.settings=value;setSettings(value);
  const level=value.volume??.8;runtime.current.volume=level;setVolumeState(level);if(audioEngine.current)audioEngine.current.setVolume(level);else if(audio.current)audio.current.volume=level;
  runtime.current.shuffle=value.shuffle??false;setShuffleState(value.shuffle??false);runtime.current.repeat=value.repeat??"off";setRepeatState(value.repeat??"off");
  const owner=activeAccountId.current;
  if(owner&&previous.timeZone!==value.timeZone){
   // New calendar windows/charts follow the current zone. Persisted stories
   // remain anchored to their own saved timezone on the server.
   for(const prefix of ["/api/v2/bloom","/api/v2/profile","/api/v2/history"])invalidateResources(owner,prefix);
   invalidateRecommendationResources(owner);
  }
 }
 function playbackPosition(){const a=audio.current,pending=pendingMediaRestore.current;if(a?.src&&pending?.token===generation.current&&pending.address===a.src)return pending.positionMs;return a?.src&&Number.isFinite(a.currentTime)&&(a.currentTime>0||Number.isFinite(a.duration))?Math.max(0,a.currentTime*1000):restoredPosition.current;}
 function attachPlaybackSource(a:HTMLAudioElement,address:string,token:number){a.src=address;pendingMediaRestore.current={token,address:a.src,positionMs:restoredPosition.current};a.load();}
 function restorePlaybackPosition(a:HTMLAudioElement){
  const pending=pendingMediaRestore.current;
  if(!pending||pending.token!==generation.current||pending.address!==a.src)return;
  // A stream can start before a finite duration is known. Starting at zero
  // needs no seek: once it advances, later metadata must retain that progress.
  if(pending.positionMs===0){if(!Number.isFinite(a.duration)&&!(a.currentTime>0))return;}
  else{
   if(!Number.isFinite(a.duration)&&a.duration!==Infinity)return;
   const target=Number.isFinite(a.duration)?Math.min(pending.positionMs/1000,Math.max(0,a.duration-.1)):pending.positionMs/1000;
   try{if(Math.abs(a.currentTime-target)>.025)a.currentTime=target;}catch{return;}
  }
  pendingMediaRestore.current=null;restoredPosition.current=a.currentTime*1000;setPosition(restoredPosition.current);audible.current.media=a.currentTime;audible.current.last=performance.now();
 }
 function saveListening(explicit=true){const r=runtime.current;if(!r.account)return;lastSnapshot.current=Date.now();listeningSync.current?.change(sessionState(r.queue,r.currentEntryId,playbackPosition(),sleepUntil.current),explicit);}
 function restoreListening(state:ListeningSession){playbackChoiceVersion.current++;cancelPlaybackRecovery();if(runtime.current.track)prepareAutomatic(effectiveId(runtime.current.track));revokePartialPlayback();flushListen(false,true);generation.current++;resolveController.current?.abort();playbackWatchdog.current.clear();audio.current?.pause();if(audio.current){audio.current.removeAttribute("src");audio.current.load();}const entry=state.queue.find(item=>item.entryId===state.currentEntryId);runtime.current.queue=state.queue;runtime.current.currentEntryId=entry?.entryId||null;runtime.current.track=entry?.track||null;runtime.current.status=entry?"paused":"idle";setQueue(state.queue);setCurrentEntryId(entry?.entryId||null);setTrack(entry?.track||null);restoredPosition.current=state.positionMs;setPosition(state.positionMs);setDuration(entry?.track.durationMs||0);setStatus(entry?"paused":"idle");setError(null);armSleep(state.sleepUntil);}
 async function syncFavorites(accountId:string,signal?:AbortSignal){
  const epoch=accountGeneration.current;
  const operation=favoritesQueue.current.catch(()=>{}).then(async()=>{
   if(epoch!==accountGeneration.current||likeJobs.current.size||signal?.aborted)return;
   const version=favoriteVersion.current,draft=await readFavoriteDraft(accountId);
   if(epoch!==accountGeneration.current||version!==favoriteVersion.current||signal?.aborted)return;
   pendingFavorites.current={...draft?.pending,...pendingFavorites.current};
   const favorites=new Set<string>();let cursor:string|null=null;
   do{const page:{recordings?:Array<{recordingId?:string;id?:string}>;nextCursor?:string}=await accountJson<{recordings?:Array<{recordingId?:string;id?:string}>;nextCursor?:string}>("/api/v2/library?kind=liked"+(cursor?"&cursor="+encodeURIComponent(cursor):""),{signal},"page",accountId);for(const item of page.recordings||[]){const id=item.recordingId||item.id;if(id)favorites.add(id);}cursor=page.nextCursor||null;}while(cursor&&!signal?.aborted);
   if(epoch!==accountGeneration.current||version!==favoriteVersion.current||likeJobs.current.size||signal?.aborted)return;
   likedRef.current=favoriteOverlay(favorites,pendingFavorites.current,effectiveId);setLiked(likedRef.current);
   await writeFavoriteDraft(accountId,likedRef.current,pendingFavorites.current).catch(()=>{});
   for(const [key,intent] of Object.entries(pendingFavorites.current)){if(epoch!==accountGeneration.current||signal?.aborted)return;await sendFavoriteIntent(accountId,key,intent);}
  });favoritesQueue.current=operation.catch(()=>{});return operation;
 }
 function effectiveId(t:MusicTrack){return aliases.current[aliasKey(t)]||t.id;}
 function collectAudible(boundary?:{paused?:boolean;muted?:boolean}){const a=audio.current,state=audible.current,now=performance.now();if(a){const increment=audibleIncrement({mediaDeltaMs:(a.currentTime-state.media)*1000,wallDeltaMs:Math.max(0,now-state.last),playing:runtime.current.status==="playing"&&!state.terminal,paused:boundary?.paused??a.paused,seeking:a.seeking,privateSession:runtime.current.settings.privateSession,learnFromListening:runtime.current.settings.learnFromListening,muted:boundary?.muted??(a.muted||a.volume===0),volume:runtime.current.volume});state.ms+=increment;state.totalMs+=increment;state.media=a.currentTime;}state.last=now;}
 function invalidateRecommendationResources(owner:string){for(const prefix of ["/api/v2/taste","/api/v2/feed","/api/v2/home","/api/v2/mixes","/api/v2/smart-queue","/api/v2/search/suggestions"])invalidateResources(owner,prefix);}
 function feedbackKey(items:readonly TasteFeedback[]){const stamp=(value:string|number|null|undefined)=>value==null?null:typeof value==="number"?value:Date.parse(value);return JSON.stringify(items.map(item=>[item.target,item.targetId,item.kind,stamp(item.expiresAt),tasteStamp(item.updatedAt)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
 function listeningKey(items:readonly ListeningEvidence[]){return JSON.stringify(items.map(item=>[item.recordingId,Number(item.audibleMs),Number(item.playCount),Number(item.completedCount),Number(item.skippedCount),item.lastPlayedAt==null?null:typeof item.lastPlayedAt==="number"?item.lastPlayedAt:Date.parse(item.lastPlayedAt),[...(item.hours||[])].sort((a,b)=>a-b),[...(item.hourWeights||[])].map(weight=>[weight.hour,Number(weight.audibleMs)]).sort((a,b)=>a[0]-b[0])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
 function saveTasteEvidence(accountId:string){const snapshot={history:[...tasteEvidence.current.history],feedback:[...tasteEvidence.current.feedback]};tasteWrite.current=tasteWrite.current.catch(()=>{}).then(()=>localWrite(accountId,"personalization-evidence",snapshot));void tasteWrite.current.catch(()=>{});}
 async function syncTasteEvidence(owner:string){if(tasteSync.current)return tasteSync.current;const operation=refreshTasteEvidence(owner);tasteSync.current=operation;try{await operation;}finally{if(tasteSync.current===operation)tasteSync.current=null;}}
 async function refreshTasteEvidence(owner:string){
  const epoch=accountGeneration.current,before=tasteVersion.current;
  const data=await accountJson<{feedback:TasteFeedback[];tasteEvidence:ListeningEvidence[];historyClearedAt?:string|null;historyDeletion?:{periodStart:string|null;clearedAt:string}|null;historyDeletions?:Array<{periodStart:string|null;clearedAt:string}>}>("/api/v2/taste",{},"page",owner);
  if(epoch!==accountGeneration.current||activeAccountId.current!==owner||!Array.isArray(data.feedback)||!Array.isArray(data.tasteEvidence))return;
  let feedbackChangedWhileLoading=before!==tasteVersion.current;
  let reconciledHistory:ListeningEvidence[]|null=null;
  const clearStamp=tasteStamp(data.historyClearedAt),knownClearStamp=tasteStamp(lastTasteClearAt.current),advanced=!!clearStamp&&(!knownClearStamp||clearStamp>knownClearStamp);
  if(advanced){
   const after=knownClearStamp||"";
   const deletions=(Array.isArray(data.historyDeletions)?data.historyDeletions:[data.historyDeletion||{periodStart:null,clearedAt:data.historyClearedAt!}]).filter(deletion=>(tasteStamp(deletion.clearedAt)||"")>after).sort((a,b)=>(tasteStamp(a.clearedAt)||"").localeCompare(tasteStamp(b.clearedAt)||""));
   audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:audio.current?.currentTime||0,context:audible.current.context,contextId:audible.current.contextId};
   // Start from the server's retained history before asynchronous local erasure.
   // Listening recorded during that work then adds to this trusted snapshot.
   tasteEvidence.current.history=data.tasteEvidence.slice(0,500);reconciledHistory=tasteEvidence.current.history;saveTasteEvidence(owner);
   for(const deletion of deletions){const cutoff=Date.parse(deletion.clearedAt),start=deletion.periodStart?Date.parse(deletion.periodStart):NaN,days=(cutoff-start)/86400000,period=Math.abs(days-7)<.001?"week":Math.abs(days-30)<.001?"month":"all";await clearListeningOutbox(owner,period,cutoff);if(epoch!==accountGeneration.current||activeAccountId.current!==owner||(tasteStamp(lastTasteClearAt.current)||"")>=(clearStamp||""))return;if((tasteStamp(deletion.clearedAt)||"")>(tasteStamp(lastTasteClearAt.current)||""))lastTasteClearAt.current=deletion.clearedAt;await localWrite(owner,"personalization-clear-marker",lastTasteClearAt.current).catch(()=>{});}
   feedbackChangedWhileLoading ||= before!==tasteVersion.current;
   if((tasteStamp(lastTasteClearAt.current)||"")>(clearStamp||""))return;
   tasteVersion.current++;window.dispatchEvent(new CustomEvent("sakura-listening-erased",{detail:{accountId:owner}}));
  }else if(before!==tasteVersion.current)return;
  const feedback=feedbackChangedWhileLoading? tasteEvidence.current.feedback:data.feedback.map(item=>({target:item.target,targetId:item.targetId,kind:item.kind,expiresAt:item.expiresAt??null,updatedAt:item.updatedAt})),history=reconciledHistory&&tasteEvidence.current.history!==reconciledHistory?tasteEvidence.current.history:data.tasteEvidence.slice(0,500);
  const feedbackChanged=feedbackKey(tasteEvidence.current.feedback)!==feedbackKey(feedback),historyChanged=listeningKey(tasteEvidence.current.history)!==listeningKey(history);
  if(!advanced&&!feedbackChanged&&!historyChanged)return;
  tasteVersion.current++;tasteEvidence.current={history,feedback};saveTasteEvidence(owner);
  if(advanced)invalidateResources(owner,"/api/v2/",true);
  else{invalidateRecommendationResources(owner);if(historyChanged){invalidateResources(owner,"/api/v2/profile");invalidateResources(owner,"/api/v2/history");invalidateResources(owner,"/api/v2/bloom/shelf");}}
  // New measurements update the journal without rearranging a feed or cancelling
  // a queue the listener has already requested. Changed choices and erasure do.
  if(advanced||feedbackChanged)window.dispatchEvent(new CustomEvent("sakura-taste-updated",{detail:{accountId:owner,authoritative:true}}));
 }
 function flushListen(completed=false,finished=false,skipped=false){collectAudible();const r=runtime.current,state=audible.current;let remaining=Math.floor(state.ms);if(!r.account||!r.track||!isUuid(r.track.id)||r.settings.privateSession||r.settings.learnFromListening===false||state.terminal||(!remaining&&!completed&&!finished)||(!remaining&&state.sequence===0&&!completed))return;
  const owner=r.account.id,recordingId=r.track.id,first=state.sequence===0,total=remaining,stamp=new Date().toISOString();
  const existing=tasteEvidence.current.history.find(item=>item.recordingId===recordingId),evidence:ListeningEvidence={recordingId,audibleMs:Number(existing?.audibleMs||0)+total,playCount:Number(existing?.playCount||0)+(first?1:0),completedCount:Number(existing?.completedCount||0)+(completed?1:0),skippedCount:Number(existing?.skippedCount||0)+(skipped?1:0),lastPlayedAt:stamp};
  tasteVersion.current++;tasteEvidence.current.history=[evidence,...tasteEvidence.current.history.filter(item=>item.recordingId!==recordingId)].slice(0,500);saveTasteEvidence(owner);
  do{const msPlayed=Math.min(120000,remaining);remaining-=msPlayed;const chunk:ListenChunk={eventId:state.eventId,recordingId,sequence:state.sequence++,msPlayed,positionMs:Math.max(0,Math.floor(playbackPosition())),completed:completed&&remaining===0,skipped:skipped&&remaining===0,context:state.context,...(state.contextId?{contextId:state.contextId}:{}),finished:finished&&remaining===0,occurredAt:new Date(Date.now()-remaining).toISOString()};state.ms-=msPlayed;void deliverListen(owner,chunk).catch(()=>reportError(new UserFacingError({kind:"storage",title:"This listening activity could not be saved.",message:"Allow browser storage to save listening activity while offline. Playback is still available.",action:"Check again"})));}while(remaining>0);
  if(finished)state.terminal=true;
 }
 useEffect(()=>{let live=true;const controller=new AbortController();if(!activeAccountId.current)applySettings({...DEFAULT_SETTINGS,...cachedPreferences()});
  async function restoreDevice(user:Account){
   const epoch=accountGeneration.current,current=()=>live&&!controller.signal.aborted&&epoch===accountGeneration.current&&activeAccountId.current===user.id;
   const [savedAliases,savedTaste]=await Promise.all([localRead<Record<string,string>>(user.id,"aliases"),localRead<LocalTasteEvidence>(user.id,"personalization-evidence")]).catch(()=>[undefined,undefined] as const);if(!current())return;aliases.current={...savedAliases,...aliases.current};if(savedTaste&&Array.isArray(savedTaste.history)&&Array.isArray(savedTaste.feedback))tasteEvidence.current={history:savedTaste.history.slice(0,500),feedback:savedTaste.feedback};
   const [savedPicks,clearMarker]=await Promise.all([localRead<QueueEntry[]>(user.id,"smart-parked-picks"),localRead<string>(user.id,"personalization-clear-marker")]).catch(()=>[undefined,undefined] as const);if(!current())return;if(Array.isArray(savedPicks)){parked.current=savedPicks.filter(entry=>typeof entry?.entryId==="string"&&typeof entry.track?.id==="string"&&typeof entry.track?.title==="string"&&Array.isArray(entry.track?.artists)&&typeof entry.track?.reference?.id==="string").slice(0,2000);setParkedPicks(parked.current);}if(typeof clearMarker==="string"&&Number.isFinite(Date.parse(clearMarker)))lastTasteClearAt.current=clearMarker;
   await managerFor(user.id).hydrated.catch(error=>{if(current())reportError(error,"download");});if(!current())return;
   const version=favoriteVersion.current,[favoriteDraft,favorites]=await Promise.all([readFavoriteDraft(user.id),localRead<string[]>(user.id,"liked")]).catch(()=>[undefined,undefined] as const);
   if(current()&&version===favoriteVersion.current&&!likeJobs.current.size){pendingFavorites.current={...favoriteDraft?.pending,...pendingFavorites.current};likedRef.current=favoriteOverlay(favoriteDraft?.likedIds||favorites||[],pendingFavorites.current,effectiveId);setLiked(likedRef.current);}
  }
  void(async()=>{try{
   const data=await requestJson<{profile:Account}>("/api/v2/profile",{signal:controller.signal},{context:"account"});const user=data.profile;if(!user?.id)throw new UserFacingError(responseIssue(502,null,"account"));if(!live)return;switchAccount(user);setAccount(user);setOffline(false);setError(null);await rememberAccount(user).catch(()=>{});await restoreDevice(user);await syncTasteEvidence(user.id).catch(()=>{});
   const draft=await readPreferenceDraft(user.id);const cached=await localRead<UserSettings>(user.id,"settings").catch(()=>undefined);if(live&&!controller.signal.aborted&&activeAccountId.current===user.id&&(draft||cached)){restorePreferenceMetadata(draft);const value={...DEFAULT_SETTINGS,...fullSettings(draft?.settings||cached),...pendingPreferences.current};applySettings(value);if(draft?.pending)pendingPreferences.current={...settingsFields(draft.pendingPatch||draft.settings),...pendingPreferences.current};}
   if(live&&!controller.signal.aborted)setBooting(false);
   try{await syncSettings(user.id,controller.signal);}catch(e){if(!controller.signal.aborted&&live)reportError(e,"save",()=>setConnectionVersion(v=>v+1));}
   try{await syncFavorites(user.id,controller.signal);}catch(e){if(live&&!controller.signal.aborted)reportError(e,"page",()=>setConnectionVersion(v=>v+1));}void drainListen(user.id).catch(()=>{});
  }catch(e){if(controller.signal.aborted)return;if(userIssue(e).kind==="session"){if(live){await forgetActiveAccount().catch(()=>{});switchAccount(null);setAccount(null);setError(null);}return;}const saved=await lastAccount().catch(()=>undefined);if(saved&&live){switchAccount(saved);setAccount(saved);setOffline(true);const draft=await readPreferenceDraft(saved.id);if(live&&activeAccountId.current===saved.id)restorePreferenceMetadata(draft);if(live&&activeAccountId.current===saved.id&&draft?.pending)pendingPreferences.current={...settingsFields(draft.pendingPatch||draft.settings),...pendingPreferences.current};const prefs=draft?.settings||await localRead<UserSettings>(saved.id,"settings").catch(()=>undefined);if(prefs&&live&&activeAccountId.current===saved.id)applySettings({...DEFAULT_SETTINGS,...prefs});await restoreDevice(saved);reportError(e,"account",()=>setConnectionVersion(v=>v+1));}else if(live)setError(userMessage(e,"account"));}finally{if(live)setBooting(false);}})();
  const online=()=>{setConnectionVersion(v=>v+1);if(runtime.current.account)void drainListen(runtime.current.account.id).catch(()=>{});};const offlineEvent=()=>setOffline(true);window.addEventListener("online",online);window.addEventListener("offline",offlineEvent);
  return()=>{live=false;controller.abort();window.removeEventListener("online",online);window.removeEventListener("offline",offlineEvent);};
 },[connectionVersion]);
 useEffect(()=>{const a=new Audio();a.preload="metadata";a.defaultPlaybackRate=1;a.playbackRate=1;a.preservesPitch=true;a.volume=.8;audio.current=a;audioEngine.current=new MediaAudioEngine(a);audioEngine.current.setVolume(runtime.current.volume);let watchdog:ReturnType<typeof setTimeout>|null=null;let watchdogAnchor:{source:unknown;token:number;url:string;position:number}|null=null;
  const clearWatchdog=()=>{if(watchdog)clearTimeout(watchdog);watchdog=null;watchdogAnchor=null;};
  const failPlayback=(error?:unknown)=>{const source=activeSource.current,code=a.error?.code;const transient=(error instanceof Error||error instanceof DOMException)&&["NetworkError","TimeoutError"].includes(error.name);if(source&&(code===2||code===4&&source.progressive||transient)&&recoverPlayback(source.recoveryAttempt))return;if(runtime.current.track)readySources.current.delete(runtime.current.track.id);stopPlaybackTransport();runtime.current.status="error";setStatus("error");setError("This audio source stopped responding. Try the song again.");};
  const switchToFallback=()=>{const source=activeSource.current;if(!a.src||!source?.fallbackUrl||source.used||source.token!==generation.current||!["resolving","buffering","playing"].includes(runtime.current.status))return false;clearWatchdog();source.used=true;collectAudible();restoredPosition.current=playbackPosition();runtime.current.status="buffering";setStatus("buffering");setError(null);attachPlaybackSource(a,source.fallbackUrl,source.token);if(runtime.current.track){runtime.current.track={...runtime.current.track,audioUrl:source.fallbackUrl};setTrack(runtime.current.track);}void playAttachedAudio(source).catch(error=>{if(activeSource.current===source&&source.token===generation.current)failPlayback(error);});return true;};
  const armWatchdog=()=>{
   const source=activeSource.current;if(!source||!a.src||a.src.startsWith("blob:")||source.token!==generation.current){clearWatchdog();return;}
   const position=a.currentTime,token=source.token,url=a.src;
   // Repeated waiting/stalled/timeupdate events are not progress and must not postpone recovery.
   if(watchdog&&watchdogAnchor?.source===source&&watchdogAnchor.token===token&&watchdogAnchor.url===url&&Math.abs(position-watchdogAnchor.position)<.05)return;
   clearWatchdog();watchdogAnchor={source,token,url,position};watchdog=setTimeout(()=>{
    watchdog=null;watchdogAnchor=null;const current=activeSource.current;
    if(current===source&&current.token===token&&token===generation.current&&a.src===url&&!["paused","idle","error"].includes(runtime.current.status)){
     if(Math.abs(a.currentTime-position)>=.05){armWatchdog();return;}
     if(!switchToFallback()&&!recoverPlayback(current.recoveryAttempt))failPlayback();
    }
   },12000);
  };
  playbackWatchdog.current={arm:armWatchdog,clear:clearWatchdog};playbackFallback.current=switchToFallback;
  const time=()=>{if(!a.src)return;restorePlaybackPosition(a);collectAudible();const source=activeSource.current;if(source&&a.currentTime*1000-source.recoveryPositionMs>=5000)source.recoveryAttempt=0;if(runtime.current.status==="playing"&&Date.now()-lastSnapshot.current>5000)saveListening(false);setPosition(playbackPosition());if(Number.isFinite(a.duration))setDuration(a.duration*1000);armWatchdog();};
  const playing=()=>{if(!a.src||a.paused)return;restorePlaybackPosition(a);void audioEngine.current?.resume().catch(()=>{});runtime.current.status="playing";setStatus("playing");audible.current.last=performance.now();audible.current.media=a.currentTime;armWatchdog();};
  const paused=()=>{if(!a.paused||playbackRecovery.current||runtime.current.status==="buffering"&&pendingMediaRestore.current?.token===generation.current)return;clearWatchdog();collectAudible({paused:false});flushListen();if(!["resolving","error","idle"].includes(runtime.current.status)){runtime.current.status="paused";setStatus("paused");}};
  const waiting=()=>{if(!a.src||!["resolving","buffering","playing"].includes(runtime.current.status))return;collectAudible();runtime.current.status="buffering";setStatus("buffering");armWatchdog();};
  // A rejected Play promise can load the fallback before WebKit delivers the
  // original error event. load() clears MediaError; that queued event no longer
  // belongs to the attached source and must not stop its replacement.
  const failure=()=>{if(!a.src||!a.error||!["buffering","playing"].includes(runtime.current.status))return;clearWatchdog();if(!switchToFallback())failPlayback();};
  const ended=()=>{if(!a.src)return;clearWatchdog();collectAudible({paused:false});const outcome=listeningOutcome({naturalEnd:true,explicitSkip:false,audibleMs:audible.current.totalMs,durationMs:runtime.current.track?.durationMs||a.duration*1000});flushListen(outcome.completed,true,false);if(runtime.current.repeat==="one"){audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:0,context:audible.current.context,contextId:audible.current.contextId};a.currentTime=0;const token=generation.current;void a.play().catch(()=>{if(token===generation.current)pause(false);});}else nextRef.current();};
  const metadata=()=>restorePlaybackPosition(a);
  const naturalSpeed=()=>{if(a.defaultPlaybackRate!==1)a.defaultPlaybackRate=1;if(a.playbackRate!==1)a.playbackRate=1;a.preservesPitch=true;};
  const volumeChanged=()=>{collectAudible({muted:nativeSound.current.muted||nativeSound.current.volume===0});nativeSound.current={muted:a.muted,volume:a.volume};};
  a.addEventListener("loadedmetadata",metadata);a.addEventListener("durationchange",metadata);a.addEventListener("ratechange",naturalSpeed);a.addEventListener("volumechange",volumeChanged);a.addEventListener("loadstart",armWatchdog);a.addEventListener("stalled",armWatchdog);a.addEventListener("timeupdate",time);a.addEventListener("playing",playing);a.addEventListener("pause",paused);a.addEventListener("waiting",waiting);a.addEventListener("error",failure);a.addEventListener("ended",ended);
  const clock=setInterval(collectAudible,250),sync=setInterval(()=>flushListen(),15000),hide=()=>flushListen(),online=()=>playbackRecovery.current?.resume();window.addEventListener("pagehide",hide);window.addEventListener("online",online);
  return()=>{cancelPlaybackRecovery();clearWatchdog();playbackWatchdog.current={arm:()=>{},clear:()=>{}};playbackFallback.current=()=>false;generation.current++;resolveController.current?.abort();downloadManager.current?.manager.dispose();downloadManager.current=null;downloadSnapshot.current={};requestedDownloads.current.clear();sourceFlights.current.clear();indexFlights.current.clear();revokePartialPlayback();clearInterval(clock);clearInterval(sync);window.removeEventListener("pagehide",hide);window.removeEventListener("online",online);a.removeEventListener("loadedmetadata",metadata);a.removeEventListener("durationchange",metadata);a.removeEventListener("ratechange",naturalSpeed);a.removeEventListener("volumechange",volumeChanged);a.removeEventListener("loadstart",armWatchdog);a.removeEventListener("stalled",armWatchdog);a.removeEventListener("timeupdate",time);a.removeEventListener("playing",playing);a.removeEventListener("pause",paused);a.removeEventListener("waiting",waiting);a.removeEventListener("error",failure);a.removeEventListener("ended",ended);a.pause();a.src="";audioEngine.current?.dispose();audioEngine.current=null;audio.current=null;if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);if(toastTimer.current)clearTimeout(toastTimer.current);if(sleepTimer.current)clearTimeout(sleepTimer.current);};
 },[]);
 async function resolve(t:MusicTrack,signal:AbortSignal,options:{refresh?:boolean}={}):Promise<Resolved>{
  const key=JSON.stringify([activeAccountId.current,aliasKey(t),t.title,t.artists,t.artistsComplete,t.version,t.durationMs,!!options.refresh]);
  return sourceFlights.current.run(key,signal,sharedSignal=>resolveSource(t,sharedSignal,!!options.refresh));
 }
 async function resolveSource(t:MusicTrack,signal:AbortSignal,refresh=false):Promise<Resolved>{
  signal.throwIfAborted();const savedSource=!refresh&&downloadManager.current?.manager.playbackSourceFor(effectiveId(t));if(savedSource)return {...savedSource,resolvedAt:Date.now()};
  const epoch=accountGeneration.current;const owner=activeAccountId.current;if(!owner)throw new UserFacingError(responseIssue(401,null));const ready=!refresh&&readyPlaybackFor(t);if(ready){const value:Resolved={track:t,url:ready.url,assetId:ready.assetId,sizeBytes:ready.sizeBytes,resolvedAt:Date.now(),fallbackUrl:ready.fallbackUrl,sha256:ready.sha256,mimeType:ready.mimeType};readySources.current.set(t.id,value);return value;}const cached=!refresh&&readySources.current.get(effectiveId(t));if(cached&&Date.now()-cached.resolvedAt<4*60000)return cached;
 let result=await requestJson<ResolveRecordingResult>("/api/v2/recordings/resolve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:t.reference,expected:{title:t.title,artists:t.artists,artistsComplete:t.artistsComplete,version:t.version,durationMs:t.durationMs||undefined}}),signal},{context:"playback",accountId:owner});
 result=await waitForRecording(result,{signal,accountId:owner,origin:location.origin});
 if(signal.aborted||epoch!==accountGeneration.current||owner!==activeAccountId.current)throw new DOMException("Account changed","AbortError");if(result.status!=="resolved")throw new UserFacingError(responseIssue(result.status==="review"?409:503,result,"playback"));
 if(!result.playback?.url||!result.recording?.metadata)throw new UserFacingError(responseIssue(502,null,"playback"));
 const recording=result.recording;const resolved:MusicTrack={...t,...musicTrack(recording as unknown as Record<string,unknown>)};
  aliases.current[aliasKey(t)]=resolved.id;for(const ref of resolved.references)aliases.current[ref.provider+":"+(ref.scope||"")+":"+ref.id]=resolved.id;
 if(runtime.current.account)void localWrite(runtime.current.account.id,"aliases",aliases.current).catch(()=>{});
  const value={track:resolved,url:result.playback.url,assetId:result.playback.assetId,sizeBytes:result.playback.sizeBytes,resolvedAt:Date.now(),fallbackUrl:result.playback.fallbackUrl,sha256:result.playback.sha256,mimeType:result.playback.mimeType};if(value.sha256)readySources.current.set(resolved.id,value);return value;
 }
 async function preparePlaybackAudio(t:MusicTrack,signal:AbortSignal):Promise<PreparedPlaybackAudio>{
  signal.throwIfAborted();const owner=activeAccountId.current;if(!owner)throw new UserFacingError(responseIssue(401,null));const localId=effectiveId(t),local=await localRead<OfflineAudio>(owner,"audio:"+localId).catch(()=>undefined);signal.throwIfAborted();if(owner!==activeAccountId.current)throw new DOMException("Account changed","AbortError");
  if(validOfflineAudio(local)&&local.track.id===localId){const url=URL.createObjectURL(local.blob);let released=false;return {track:local.track,recordingId:local.track.id,url,progressive:false,release:()=>{if(released)return;released=true;URL.revokeObjectURL(url);}};}
  const managed=managerFor(owner);await managed.hydrated;signal.throwIfAborted();let result:Resolved;
  if(navigator.onLine===false){const partial=await managed.manager.getPartial(localId);if(!partial)throw new Error("This song is not saved on this device.");const fallback="/api/v2/recordings/"+localId+"/audio?assetId="+encodeURIComponent(partial.fingerprint.assetId);result={track:{...t,id:localId},url:fallback,fallbackUrl:fallback,assetId:partial.fingerprint.assetId,sizeBytes:partial.fingerprint.sizeBytes,sha256:partial.fingerprint.sha256,resolvedAt:Date.now()};}
  else result=await resolve(t,signal);
  signal.throwIfAborted();if(owner!==activeAccountId.current)throw new DOMException("Account changed","AbortError");const canonical=result.track,fallbackUrl=result.fallbackUrl;if(fallbackUrl&&new URL(fallbackUrl,location.origin).origin!==location.origin)throw new Error("The fallback audio address is invalid.");
  managed.manager.setPriorities(upcomingQueue(runtime.current.queue,runtime.current.currentEntryId).map(item=>effectiveId(item.track)),canonical.id);
  const playback=await partialPlaybackUrl(owner,result,(offset,chunkSignal)=>{if(signal.aborted||owner!==activeAccountId.current)return Promise.reject(signal.reason??new DOMException("Playback stopped","AbortError"));return managed.manager.ensureChunk(canonical.id,offset,chunkSignal);});
  if(signal.aborted||owner!==activeAccountId.current){if(playback)revokePartialPlaybackUrl(playback);signal.throwIfAborted();throw new DOMException("Account changed","AbortError");}
  if(playback){void managed.manager.enqueue(canonical,{mode:"playback",requested:false}).catch(()=>{});try{await managed.manager.ensureChunk(canonical.id,0,signal);signal.throwIfAborted();if(owner!==activeAccountId.current)throw new DOMException("Account changed","AbortError");}catch(error){revokePartialPlaybackUrl(playback);throw error;}let released=false;return {track:canonical,recordingId:canonical.id,url:playback,fallbackUrl,progressive:true,release:()=>{if(released)return;released=true;revokePartialPlaybackUrl(playback);}};}
  return {track:canonical,recordingId:canonical.id,url:result.url,fallbackUrl,progressive:false,release:()=>{}};
 }
 async function startEntry(entry:QueueEntry,resumeMs=0,recoveryAttempt=0,sourceContext?:{context:string;contextId?:string}){
  const r=runtime.current;if(!r.account){notify("Sign in to open your library.");return;}cancelPlaybackRecovery();const refreshSource=recoveryAttempt>0||r.status==="error"&&!!r.track&&effectiveId(r.track)===effectiveId(entry.track);if(r.track&&recoveryAttempt===0)prepareAutomatic(effectiveId(r.track));revokePartialPlayback();const resumeEvent=!!r.track&&effectiveId(r.track)===effectiveId(entry.track)&&!audible.current.terminal&&(resumeMs>0||recoveryAttempt>0||r.status==="paused"||r.status==="error");flushListen(false,!resumeEvent,!!r.track&&!resumeEvent&&r.status!=="error");if(resumeEvent){audible.current.last=performance.now();audible.current.media=0;}else audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:0,context:sourceContext?.context||entry.context||location.pathname.split("/")[1]||"direct",contextId:sourceContext?.contextId||entry.contextId||null};const token=++generation.current;resolveController.current?.abort();const controller=new AbortController();resolveController.current=controller;const a=audio.current;if(!a)return;playbackWatchdog.current.clear();runtime.current.status="resolving";a.pause();a.removeAttribute("src");a.load();if(blobUrl.current){URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;}const audioReady=applyAudioTechnology(audioTechnology(r.settings.audioTechnology));void audioReady.catch(()=>{});activeSource.current=null;runtime.current.track=entry.track;runtime.current.currentEntryId=entry.entryId;setTrack(entry.track);setCurrentEntryId(entry.entryId);restoredPosition.current=resumeMs;setPosition(resumeMs);setDuration(entry.track.durationMs);setStatus("resolving");setError(null);saveListening();let sourceLookupPending=false,chunkLookupPending=false;
  try{await audioReady;if(token!==generation.current||controller.signal.aborted)return;const localId=effectiveId(entry.track),local=await localRead<OfflineAudio>(r.account.id,"audio:"+localId).catch(()=>undefined);if(token!==generation.current||controller.signal.aborted)return;let source:string;let fallbackUrl:string|undefined;let canonical=entry.track;
   if(entry.localOnly&&!(validOfflineAudio(local)&&local.track.id===localId&&local.requested!==false))throw new Error("This song is no longer saved on this device. Choose another downloaded song.");if(validOfflineAudio(local)&&local.track.id===localId){if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);source=URL.createObjectURL(local.blob);blobUrl.current=source;canonical=local.track;}else{const managed=managerFor(r.account.id);await managed.hydrated;if(token!==generation.current||controller.signal.aborted)return;let result:Resolved;
    if(navigator.onLine===false){const partial=await managed.manager.getPartial(effectiveId(entry.track));if(!partial)throw new Error("This song is not saved on this device. Choose a downloaded song.");const fallback="/api/v2/recordings/"+effectiveId(entry.track)+"/audio?assetId="+encodeURIComponent(partial.fingerprint.assetId);result={track:{...entry.track,id:effectiveId(entry.track)},url:fallback,fallbackUrl:fallback,assetId:partial.fingerprint.assetId,sizeBytes:partial.fingerprint.sizeBytes,sha256:partial.fingerprint.sha256,resolvedAt:Date.now()};}
    else{sourceLookupPending=true;result=await resolve(entry.track,controller.signal,{refresh:refreshSource});sourceLookupPending=false;}
    if(token!==generation.current||controller.signal.aborted)return;source=result.url;canonical=result.track;fallbackUrl=result.fallbackUrl;if(fallbackUrl&&new URL(fallbackUrl,location.origin).origin!==location.origin)throw new Error("The fallback audio address is invalid.");
    managed.manager.setPriorities(upcomingQueue(runtime.current.queue,runtime.current.currentEntryId).map(item=>effectiveId(item.track)),canonical.id);
    const playback=await partialPlaybackUrl(r.account.id,result,(offset,signal)=>{if(token!==generation.current||effectiveId(runtime.current.track||canonical)!==canonical.id||runtime.current.status==="paused")return Promise.reject(new DOMException("Playback paused","AbortError"));return managed.manager.ensureChunk(canonical.id,offset,signal);});if(token!==generation.current||controller.signal.aborted)return;
    if(playback){source=playback;void managed.manager.enqueue(canonical,{mode:"playback",requested:false}).catch(()=>{});runtime.current.status="buffering";setStatus("buffering");chunkLookupPending=true;await managed.manager.ensureChunk(canonical.id,0,controller.signal);chunkLookupPending=false;}
   }
   if(token!==generation.current||controller.signal.aborted)return;if((audioEngine.current?.initialized||audioEngine.current?.requiresVolumeGraph||audioTechnology(r.settings.audioTechnology)!=="none")&&!source.startsWith("blob:")&&new URL(source,location.href).origin!==location.origin){if(!fallbackUrl)throw new Error("This recording needs a compatible audio source for your selected sound.");source=fallbackUrl;fallbackUrl=undefined;}canonical={...canonical,audioUrl:source};runtime.current.track=canonical;setTrack(canonical);updateQueue(runtime.current.queue.map(item=>item.entryId===entry.entryId?{...item,track:canonical}:item),false);setDuration(canonical.durationMs);activeSource.current={token,fallbackUrl,used:false,recoveryAttempt,recoveryPositionMs:resumeMs,progressive:new URL(source,location.href).pathname.startsWith("/_sakura/audio/"),transport:0};runtime.current.status="buffering";attachPlaybackSource(a,source,token);setStatus("buffering");playbackWatchdog.current.arm();try{await playAttachedAudio(activeSource.current);}catch(firstError){if(token!==generation.current||controller.signal.aborted)return;if(!playbackFallback.current())throw firstError;}
 }catch(e){if(token!==generation.current||controller.signal.aborted)return;if((recoveryAttempt>0||sourceLookupPending||chunkLookupPending||!!activeSource.current)&&!((e instanceof Error||e instanceof DOMException)&&["NotAllowedError","AbortError","DownloadIntegrityError"].includes(e.name))&&["connection","offline","busy"].includes(userIssue(e,"playback").kind)&&recoverPlayback(recoveryAttempt))return;stopPlaybackTransport();runtime.current.status="error";setStatus("error");setError(userMessage(e,"playback"));}
 }
 useEffect(()=>{const managed=downloadManager.current;if(!managed||!account)return;const upcoming=upcomingQueue(queue,currentEntryId);managed.manager.setPriorities(upcoming.map(entry=>effectiveId(entry.track)),track?effectiveId(track):undefined);
  if(status!=="playing"||offline||settings.audioQuality==="data-saver")return;const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;if(connection?.saveData||settings.audioQuality==="balanced"&&connection?.effectiveType&&connection.effectiveType!=="4g")return;
  const count=settings.audioQuality==="high"?3:1;for(const [index,entry]of upcoming.slice(0,count).entries())void managed.hydrated.then(()=>managed.manager.enqueue({...entry.track,id:effectiveId(entry.track)},{mode:"prefix",requested:false,priority:50-index})).catch(()=>{});
 // Jobs retain their chunks when playback or the queue changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[account?.id,currentEntryId,status,queue,track?.id,offline,settings.audioQuality]);
 function updateQueue(entries:QueueEntry[],persist=true){runtime.current.queue=entries;setQueue(entries);downloadManager.current?.manager.setPriorities(upcomingQueue(entries,runtime.current.currentEntryId).map(entry=>effectiveId(entry.track)),runtime.current.track?effectiveId(runtime.current.track):undefined);if(persist)saveListening();}
 function saveParkedPicks(owner:string,picks:QueueEntry[]){parked.current=picks;setParkedPicks(picks);parkedWrites.current=parkedWrites.current.catch(()=>{}).then(()=>localWrite(owner,"smart-parked-picks",picks));void parkedWrites.current.catch(error=>{if(activeAccountId.current===owner)reportError(error,"save");});}
 function restoreParkedPicks(){const owner=activeAccountId.current;if(!owner||!parked.current.length)return;let next=runtime.current.queue;const existing=new Set(next.map(entry=>effectiveId(entry.track))),waiting:QueueEntry[]=[];let added=0;for(const entry of parked.current){if(existing.has(effectiveId(entry.track)))continue;if(next.length>=80){waiting.push(entry);continue;}next=appendManual(next,runtime.current.currentEntryId,{...entry,localOnly:false});existing.add(effectiveId(entry.track));added++;}updateQueue(next);saveParkedPicks(owner,waiting);notify(added?`${added} of your picks are back in the queue.`:"Your queue is full. Remove a song to add your picks.");}
 async function smartQueue(options:SmartQueueOptions={}) {
  const r=runtime.current,owner=r.account?.id;if(!owner||activeAccountId.current!==owner)return;if(smartQueuePending.current)return;
  const operation=++smartQueueRequest.current,epoch=accountGeneration.current,playback=generation.current,queueBefore=r.queue,preferencesBefore=settingsVersion.current,tasteBefore=tasteVersion.current;
  smartQueuePending.current=true;setSmartQueueBusy(true);
  const current=()=>operation===smartQueueRequest.current&&epoch===accountGeneration.current&&activeAccountId.current===owner&&preferencesBefore===settingsVersion.current;
  const scope=options.scope||"all";
  try{
   let candidates:MusicTrack[]=[],reason="",readyLocalIds=new Set<string>();const localOnly=navigator.onLine===false||scope==="downloads";
   if(localOnly){const local=await savedAudio(owner);if(!current())return;const selected=options.tracks?new Set(options.tracks.map(effectiveId)):null;candidates=local.filter(item=>item.requested!==false&&(!selected||selected.has(item.track.id))&&(scope!=="liked"||likedRef.current.has(item.track.id))).map(item=>item.track);}
   else if(scope==="collection"){const supplied=(options.tracks||[]).slice(0,2000),selected:MusicTrack[]=[];let next=0;await Promise.all(Array.from({length:Math.min(3,supplied.length)},async()=>{while(next<supplied.length&&current()){const song=supplied[next++];selected.push(await ensureRecording(song));}}));if(!current())return;candidates=[...new Map(selected.map(track=>[track.id,track])).values()];}
   if((scope==="downloads"||scope==="collection"||localOnly)&&!candidates.length){notify(localOnly?"Download songs on this device to make an offline soundtrack.":"Add a few songs to this collection to make a queue.");return;}
   const selectedIds=scope==="collection"?new Set(candidates.map(effectiveId)):null;
   if(navigator.onLine!==false){
    try{const data=await accountJson<{tracks:Record<string,unknown>[];reason?:string;taste?:LocalTasteEvidence}>("/api/v2/smart-queue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope,limit:24,...(scope==="downloads"||scope==="collection"?{recordingIds:candidates.slice(0,2000).map(track=>track.id)}:{})})},"playback",owner);
     if(!current())return;candidates=(data.tracks||[]).map(musicTrack).filter(track=>!selectedIds||selectedIds.has(effectiveId(track)));reason=data.reason||"Your next songs, chosen from your listening.";
     if(tasteBefore===tasteVersion.current&&data.taste&&Array.isArray(data.taste.history)&&Array.isArray(data.taste.feedback)){tasteEvidence.current={history:data.taste.history.slice(0,500),feedback:data.taste.feedback};saveTasteEvidence(owner);}
    }catch(error){if(!current())return;if(scope!=="downloads"||!["connection","offline","busy"].includes(userIssue(error,"playback").kind))throw error;candidates=planLocalQueue(candidates,{likedIds:[...likedRef.current],settings:r.settings,history:tasteEvidence.current.history,feedback:tasteEvidence.current.feedback,limit:24});}
   }else candidates=planLocalQueue(candidates,{likedIds:[...likedRef.current],settings:r.settings,history:tasteEvidence.current.history,feedback:tasteEvidence.current.feedback,limit:24,seed:owner+":"+new Date().toISOString().slice(0,10)});
   if(!current())return;
   // A download can be removed while the suggestion request is in flight.
   if(localOnly){const local=await savedAudio(owner);if(!current())return;const ready=new Map(local.filter(item=>item.requested!==false).map(item=>[item.track.id,item.track]));readyLocalIds=new Set(ready.keys());candidates=candidates.filter(track=>ready.has(effectiveId(track))).map(track=>ready.get(effectiveId(track))!);reason="A soundtrack from the songs saved on this device.";}
   if(!candidates.length){notify("No songs match these recommendations yet. Adjust your preferences or add more music.");return;}
   // New playback or manual queue edits take precedence over a delayed request.
   if(playback!==generation.current||queueBefore!==runtime.current.queue){notify("Your listening changed. Select the soundtrack action again to use your current queue.");return;}
   if(options.append){const next=smartContinuation(runtime.current.queue,candidates,effectiveId,cryptoId,80,localOnly).map((entry,index)=>index<runtime.current.queue.length?entry:{...entry,context:"smart-"+scope});const added=next.length-runtime.current.queue.length;if(!added){notify(runtime.current.queue.length>=80?"Your queue is full. Remove a song before adding more.":"These suggestions are already in your queue.");return;}updateQueue(next);notify(`${added} songs added to your queue. ${reason}`);}
   else{
    const allManual=upcomingQueue(runtime.current.queue,runtime.current.currentEntryId).filter(entry=>entry.priority==="manual"),waiting=localOnly?allManual.filter(entry=>!readyLocalIds.has(effectiveId(entry.track))):[],manual=localOnly?allManual.filter(entry=>readyLocalIds.has(effectiveId(entry.track))).map(entry=>({...entry,localOnly:true})):allManual,manualIds=new Set(manual.map(entry=>effectiveId(entry.track)));
    const combinedWaiting=[...new Map([...parked.current,...waiting].map(entry=>[entry.entryId,entry])).values()];if(combinedWaiting.length>2000){notify("Bring back some of your kept picks before starting another offline soundtrack.");return;}const ordered=candidates.filter(track=>!manualIds.has(effectiveId(track)));if(!ordered.length){notify("Your picks are already waiting in the queue.");return;}if(manual.length>=80){notify("Your queue is full. Remove a song before starting a soundtrack.");return;}
    const entries:QueueEntry[]=ordered.slice(0,80-manual.length).map(track=>({entryId:cryptoId(),track,priority:"automatic" as const,context:"smart-"+scope,...(localOnly?{localOnly:true}:{})}));entries.splice(1,0,...manual);if(waiting.length){saveParkedPicks(owner,combinedWaiting);reason+=` ${waiting.length} of your picks are kept for later in the queue.`;}updateQueue(entries,false);void startEntry(entries[0],0,0,{context:"smart-"+scope});notify(reason);
   }
  }finally{if(operation===smartQueueRequest.current&&epoch===accountGeneration.current&&activeAccountId.current===owner){smartQueuePending.current=false;setSmartQueueBusy(false);}}
 }
 function play(t:MusicTrack,list?:MusicTrack[],source?:{context:string;contextId?:string}){playbackChoiceVersion.current++;const r=runtime.current;if(r.track&&effectiveId(r.track)===effectiveId(t)){
  if(list){const index=r.queue.findIndex(e=>e.entryId===r.currentEntryId),past=r.queue.slice(0,index+1),manual=upcomingQueue(r.queue,r.currentEntryId).filter(e=>e.priority==="manual"),at=list.findIndex(song=>effectiveId(song)===effectiveId(t));const context=[...new Map(list.slice(at+1).map(song=>[effectiveId(song),song])).values()].filter(song=>!manual.some(e=>effectiveId(e.track)===effectiveId(song))).map(song=>({entryId:cryptoId(),track:song,priority:"automatic" as const,...source}));updateQueue([...past,...manual,...context]);}
  if(["resolving","buffering","playing"].includes(r.status))return;togglePlay();return;
 }let entries:QueueEntry[];let entry:QueueEntry;
  const oldIndex=r.queue.findIndex(item=>item.entryId===r.currentEntryId);const past=r.queue.slice(0,Math.max(0,oldIndex+1));
  if(list){entries=[...new Map(list.map(track=>[effectiveId(track),track])).values()].map(track=>({entryId:cryptoId(),track,priority:"automatic",...source}));entry=entries.find(e=>effectiveId(e.track)===effectiveId(t))||{entryId:cryptoId(),track:t,priority:"automatic",...source};if(!entries.includes(entry))entries.unshift(entry);const manual=upcomingQueue(r.queue,r.currentEntryId).filter(item=>item.priority==="manual");entries.splice(entries.indexOf(entry)+1,0,...manual);entries=[...past,...entries];}
  else{entry=upcomingQueue(r.queue,r.currentEntryId).find(e=>effectiveId(e.track)===effectiveId(t))||{entryId:cryptoId(),track:t,priority:"automatic",...source};const upcoming=upcomingQueue(r.queue,r.currentEntryId).filter(e=>e.entryId!==entry.entryId);entries=[...past,entry,...upcoming];}
  updateQueue(entries,false);void startEntry(entry,0,0,source);
 }
 function playQueueEntry(entryId:string){playbackChoiceVersion.current++;const entry=runtime.current.queue.find(e=>e.entryId===entryId);if(entry)void startEntry(entry);}
 function prepareAutomatic(id:string){const managed=downloadManager.current;if(managed&&downloadSnapshot.current[id]?.requested===false)void managed.manager.prepare(id).catch(()=>{});}
 function stopPlaybackTransport(){cancelPlaybackRecovery();const a=audio.current,position=playbackPosition()||0;flushListen();restoredPosition.current=position;setPosition(position);if(runtime.current.track)prepareAutomatic(effectiveId(runtime.current.track));revokePartialPlayback();playbackWatchdog.current.clear();activeSource.current=null;a?.pause();if(a){a.removeAttribute("src");a.load();}}
 function pause(explicit=true){if(explicit)playbackChoiceVersion.current++;collectAudible();cancelPlaybackRecovery();generation.current++;resolveController.current?.abort();playbackWatchdog.current.clear();const a=audio.current,position=playbackPosition()||0;const restart=!!a?.src&&(!Number.isFinite(a.duration)||new URL(a.src,location.href).pathname.startsWith("/_sakura/audio/"));a?.pause();flushListen();runtime.current.status="paused";if(runtime.current.track)prepareAutomatic(effectiveId(runtime.current.track));revokePartialPlayback();if(restart){restoredPosition.current=position;a!.removeAttribute("src");a!.load();setPosition(position);}if(activeSource.current)activeSource.current.token=generation.current;setStatus("paused");saveListening(explicit);}
 function clearPlaybackSelection(){cancelPlaybackRecovery();generation.current++;resolveController.current?.abort();playbackWatchdog.current.clear();const a=audio.current;flushListen(false,true,runtime.current.status!=="error");if(runtime.current.track)prepareAutomatic(effectiveId(runtime.current.track));revokePartialPlayback();activeSource.current=null;a?.pause();if(a){a.removeAttribute("src");a.load();}if(blobUrl.current){URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;}restoredPosition.current=0;runtime.current.status="idle";runtime.current.currentEntryId=null;runtime.current.track=null;audible.current={eventId:"",sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:0,context:"direct",contextId:null as string|null};setStatus("idle");setError(null);setCurrentEntryId(null);setTrack(null);setPosition(0);setDuration(0);}

 function togglePlay(){playbackChoiceVersion.current++;const a=audio.current;if(!a)return;if(runtime.current.status==="playing"||runtime.current.status==="buffering"||runtime.current.status==="resolving")pause();else if(a.src&&runtime.current.status!=="error"){void applyAudioTechnology(audioTechnology(runtime.current.settings.audioTechnology)).catch(error=>notify(error instanceof Error?error.message:"This sound could not be enabled."));saveListening();void a.play().catch(()=>notify("Tap play again to resume."));}else if(runtime.current.track){const entry=runtime.current.queue.find(e=>e.entryId===runtime.current.currentEntryId);if(entry)void startEntry(entry,restoredPosition.current);else play(runtime.current.track);}}
 function next(){playbackChoiceVersion.current++;const r=runtime.current;if(!r.queue.length)return;flushListen(false,true,r.status!=="error");const upcoming=upcomingQueue(r.queue,r.currentEntryId);const target=nextUpcoming(r.queue,r.currentEntryId,r.shuffle)||(r.repeat==="all"?r.queue[0]:undefined);if(target){if(r.shuffle&&target.priority!=="manual"&&upcoming.length&&target.entryId!==upcoming[0].entryId&&upcoming.some(entry=>entry.entryId===target.entryId))updateQueue(reorderUpcoming(r.queue,r.currentEntryId,target.entryId,upcoming[0].entryId));void startEntry(target);}else pause();}
 nextRef.current=next;
 function previous(){playbackChoiceVersion.current++;const a=audio.current;const r=runtime.current;const i=r.queue.findIndex(e=>e.entryId===r.currentEntryId);if(i>0)void startEntry(r.queue[i-1]);else if(a)seek(0);}
 function seek(ms:number){playbackChoiceVersion.current++;const a=audio.current;const bounded=boundedSeekPosition(ms,runtime.current.track?.durationMs||0,a?.src?a.duration*1000:0);restoredPosition.current=bounded;if(pendingMediaRestore.current?.token===generation.current)pendingMediaRestore.current.positionMs=bounded;setPosition(bounded);if(a?.src&&Number.isFinite(a.duration)){collectAudible();a.currentTime=Math.min(bounded/1000,a.duration);audible.current.last=performance.now();audible.current.media=a.currentTime;}saveListening();}
 function setVolume(v:number){if(!Number.isFinite(v))return;collectAudible();const bounded=Math.max(0,Math.min(1,v));runtime.current.volume=bounded;setVolumeState(bounded);if(audioEngine.current){audioEngine.current.setVolume(bounded);if(audioEngine.current.requiresVolumeGraph)void applyAudioTechnology(audioTechnology(runtime.current.settings.audioTechnology)).catch(error=>notify(error instanceof Error?error.message:"Volume could not be changed. Tap play to try again."));}else if(audio.current)audio.current.volume=bounded;void updateSettings({volume:bounded}).catch(e=>reportError(e,"save"));}
 function setShuffle(value:boolean){runtime.current.shuffle=value;setShuffleState(value);void updateSettings({shuffle:value}).catch(e=>reportError(e,"save"));}
 function setRepeat(value:"off"|"one"|"all"){runtime.current.repeat=value;setRepeatState(value);void updateSettings({repeat:value}).catch(e=>reportError(e,"save"));}
 async function ensureRecording(t:MusicTrack):Promise<MusicTrack>{const signal=new AbortController().signal;return indexFlights.current.run(JSON.stringify([activeAccountId.current,aliasKey(t),t.title,t.artists,t.version,t.durationMs]),signal,()=>indexRecording(t));}
 async function indexRecording(t:MusicTrack):Promise<MusicTrack>{const id=effectiveId(t);const ready=readySources.current.get(id);if(ready)return ready.track;if(isUuid(id))return {...t,id};const owner=activeAccountId.current,epoch=accountGeneration.current;const result=await accountJson<{recording:Record<string,unknown>}>("/api/v2/recordings/index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference:t.reference,expected:{title:t.title,artists:t.artists,artistsComplete:t.artistsComplete,version:t.version,durationMs:t.durationMs||undefined}})},"save",owner);if(!result.recording)throw new UserFacingError(responseIssue(502,null,"save"));const canonical={...t,...musicTrack(result.recording)};aliases.current[aliasKey(t)]=canonical.id;if(owner)await localWrite(owner,"aliases",aliases.current).catch(()=>{});if(epoch!==accountGeneration.current)throw new DOMException("Account changed","AbortError");return canonical;}
 async function sendFavoriteIntent(accountId:string,initial:string,intent:FavoriteIntent):Promise<boolean>{
  const epoch=accountGeneration.current,operation=accountId+":"+initial;if(activeAccountId.current!==accountId||likeJobs.current.has(operation))return false;
  likeJobs.current.add(operation);let canonicalKey:string|undefined;
  try{
   const canonical=await ensureRecording(intent.track);if(epoch!==accountGeneration.current||pendingFavorites.current[initial]?.operationId!==intent.operationId)return false;
   const id=canonical.id,key=accountId+":"+id;if(key!==operation){if(likeJobs.current.has(key))return false;likeJobs.current.add(key);canonicalKey=key;}
   if(initial!==id){const next={...pendingFavorites.current};delete next[initial];next[id]={...intent,track:canonical};pendingFavorites.current=next;const liked=new Set(likedRef.current);liked.delete(initial);likedRef.current=favoriteOverlay(liked,pendingFavorites.current,effectiveId);setLiked(likedRef.current);}
   await writeFavoriteDraft(accountId,likedRef.current,pendingFavorites.current);
   await accountJson("/api/v2/library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recordingId:id,liked:intent.liked})},"save",accountId);
   if(epoch!==accountGeneration.current)return false;
   pendingFavorites.current=acknowledgeFavorite(pendingFavorites.current,id,intent.operationId);
   await writeFavoriteDraft(accountId,likedRef.current,pendingFavorites.current);
   if(epoch!==accountGeneration.current)return false;invalidateResources(accountId);setNotice(null);return true;
  }finally{if(epoch===accountGeneration.current){likeJobs.current.delete(operation);if(canonicalKey)likeJobs.current.delete(canonicalKey);}}
 }
 async function toggleLike(t:MusicTrack){
  const owner=runtime.current.account;if(!owner){reportError(new UserFacingError(responseIssue(401,null)));return;}
  const epoch=accountGeneration.current,id=effectiveId(t);if(likeJobs.current.has(owner.id+":"+id))return;
  favoriteVersion.current++;const intent:FavoriteIntent={track:t,liked:!likedRef.current.has(id),operationId:cryptoId()};pendingFavorites.current={...pendingFavorites.current,[id]:intent};
  likedRef.current=favoriteOverlay(likedRef.current,pendingFavorites.current,effectiveId);setLiked(likedRef.current);
  const saved=writeFavoriteDraft(owner.id,likedRef.current,pendingFavorites.current),sent=sendFavoriteIntent(owner.id,id,intent);
  try{const [,accepted]=await Promise.all([saved,sent]);if(epoch===accountGeneration.current&&accepted)notify(intent.liked?"Added to liked songs.":"Removed from liked songs.");}
  catch(error){if(epoch!==accountGeneration.current)return;const issue=userIssue(error,"save");reportError(["connection","offline"].includes(issue.kind)?new UserFacingError({kind:"connection",title:"Your library change is saved on this device.",message:"Reconnect to sync this change with your account. Your choice will still be here when you return.",action:"Save to account"}):error,"save",()=>void syncFavorites(owner.id));}
 }

 async function updateSettings(patch:Partial<UserSettings>,guard?:ArtistChoiceEditGuard){
  if(!account)return;const accountId=account.id,epoch=accountGeneration.current;if(activeAccountId.current!==accountId)return;
  if(guard&&guard.artistChoiceVersion!==artistChoiceKey())throw new UserFacingError({kind:"validation",title:"Your artist choices changed.",message:"The current choices are shown. Check them before saving.",action:"Save current choices"},409);
  const clean=settingsFields(patch);if(!Object.keys(clean).length)return;if(clean.privateSession!==undefined||clean.learnFromListening!==undefined){flushListen(false,true);audible.current={eventId:cryptoId(),sequence:0,ms:0,totalMs:0,terminal:false,last:performance.now(),media:audio.current?.currentTime||0,context:audible.current.context,contextId:audible.current.contextId};}
  for(const key of Object.keys(clean)){if(!(key in pendingPreferences.current)&&key in serverPreferences.current){preferenceBase.current={...preferenceBase.current,[key]:serverPreferences.current[key as keyof UserSettings]};preferenceBaseRevisions.current={...preferenceBaseRevisions.current,[key]:serverPreferenceFieldRevisions.current[key]||0};}}
  pendingPreferences.current={...pendingPreferences.current,...clean};settingsVersion.current++;
  const updated={...runtime.current.settings,...clean};applySettings(updated);
  if(clean.audioTechnology!==undefined)void applyAudioTechnology(audioTechnology(clean.audioTechnology)).catch(error=>notify(error instanceof Error?error.message:"This sound could not be enabled."));
  let locallySaved=false;const saved=writePreferenceDraft(accountId,updated,true,pendingPreferences.current,preferenceSyncMetadata()).then(()=>{locallySaved=true;}).catch(()=>{});
  await new Promise<void>(resolve=>setTimeout(resolve,180));
  const operation=settingsQueue.current.catch(()=>{}).then(async()=>{
   await saved;if(epoch!==accountGeneration.current||runtime.current.account?.id!==accountId)return;
   await sendPreferenceChanges(accountId);
  });settingsQueue.current=operation.catch(()=>{});
  try{await operation;}catch(error){if(epoch!==accountGeneration.current)return;if(locallySaved&&["connection","offline","storage"].includes(userIssue(error).kind))throw new UserFacingError({kind:"connection",title:"Preferences saved on this device.",message:"Your preferences are saved here. Reconnect to sync them with your account; we’ll keep your choices for your next visit.",action:"Save to account",href:"/library/downloaded",linkLabel:"Open downloads"});throw error;}
 }
 function managerFor(accountId:string){
  const previous=downloadManager.current;if(previous?.accountId===accountId)return previous;
  previous?.manager.dispose();const epoch=accountGeneration.current;
  const manager=new DurableDownloadManager({accountId,resolve:(t,signal,options)=>resolve(t,signal,options),onChange:entries=>{if(epoch===accountGeneration.current&&activeAccountId.current===accountId){downloadSnapshot.current=entries;setDownloads(entries);}},onError:(error)=>{if(epoch===accountGeneration.current&&activeAccountId.current===accountId)reportError(error,"download");}});
  const hydrated=manager.hydrate();void hydrated.catch(()=>{});const value={accountId,manager,hydrated};downloadManager.current=value;
  manager.setPriorities(upcomingQueue(runtime.current.queue,runtime.current.currentEntryId).map(entry=>effectiveId(entry.track)),runtime.current.track?effectiveId(runtime.current.track):undefined);
  return value;
 }
 function requestDownload(t:MusicTrack){const owner=activeAccountId.current;if(!owner)return;const id=effectiveId(t),key=owner+":"+id;if(removeJobs.current.has(key)||requestedDownloads.current.has(key))return;const current=downloadSnapshot.current[id];if(current?.status==="ready"&&current.requested!==false){notify("This recording is already saved on your device.");return;}if(current?.requested!==false&&current&&["queued","resolving","downloading"].includes(current.status))return;const managed=managerFor(owner),epoch=accountGeneration.current;
  const task=managed.hydrated.then(()=>{if(epoch!==accountGeneration.current)return;return managed.manager.enqueue({...t,id},{mode:"full",requested:true,priority:100});}).then(()=>{if(epoch===accountGeneration.current&&downloadSnapshot.current[effectiveId(t)]?.status==="ready")notify("Saved on this device. Ready for the offline hours.");}).catch(error=>{if(epoch===accountGeneration.current&&error?.name!=="AbortError")reportError(error,"download",()=>requestDownload(t));}).finally(()=>{if(requestedDownloads.current.get(key)===task)requestedDownloads.current.delete(key);});requestedDownloads.current.set(key,task);
 }
 function pauseDownload(id:string){const managed=downloadManager.current;if(managed)void managed.manager.pause(id).catch(error=>reportError(error,"download"));}
 function resumeDownload(id:string){const managed=downloadManager.current;if(managed)void managed.manager.resume(id).catch(error=>{if(error?.name!=="AbortError")reportError(error,"download",()=>resumeDownload(id));});}
 function cancelDownload(id:string){const managed=downloadManager.current;if(managed)void managed.manager.cancel(id).catch(error=>reportError(error,"download"));}
 async function removeDownload(id:string){const owner=activeAccountId.current;if(!owner)return false;const epoch=accountGeneration.current,key=owner+":"+id;const pending=removeJobs.current.get(key);if(pending)return pending;const operation=(async()=>{const managed=managerFor(owner);await managed.hydrated;await managed.manager.remove(id);if(epoch===accountGeneration.current)notify("Download removed from this device.");return true;})();removeJobs.current.set(key,operation);try{return await operation;}catch(error){if(epoch===accountGeneration.current)reportError(error,"download",()=>void removeDownload(id));return false;}finally{removeJobs.current.delete(key);}}
 function addQueue(t:MusicTrack){if(upcomingQueue(runtime.current.queue,runtime.current.currentEntryId).some(e=>e.priority==="manual"&&effectiveId(e.track)===effectiveId(t))){notify("This song is already in your picks.");return;}updateQueue(appendManual(runtime.current.queue,runtime.current.currentEntryId,{entryId:cryptoId(),track:t,priority:"manual",context:"manual-queue"}));notify("Added to your picks, ahead of the automatic queue.");}
 function removeQueue(id:string){const r=runtime.current;const index=r.queue.findIndex(entry=>entry.entryId===id);if(index<0)return;const next=r.queue.filter(entry=>entry.entryId!==id);updateQueue(next);if(id===r.currentEntryId){if(next[index])void startEntry(next[index]);else{clearPlaybackSelection();saveListening();}}notify("Removed from your queue.");}
 function moveQueue(id:string,delta:number){const next=moveUpcoming(runtime.current.queue,runtime.current.currentEntryId,id,delta);if(next!==runtime.current.queue){updateQueue(next);notify("Your listening order has changed.");}}
 function reorderQueue(id:string,beforeId:string|null){const next=reorderUpcoming(runtime.current.queue,runtime.current.currentEntryId,id,beforeId);if(next!==runtime.current.queue){updateQueue(next);notify("Your listening order has changed.");}}
 function clearQueue(){updateQueue(clearUpcoming(runtime.current.queue,runtime.current.currentEntryId));notify("Upcoming songs cleared. Your current song keeps playing.");}
 function armSleep(until:number|null){if(sleepTimer.current)clearTimeout(sleepTimer.current);sleepUntil.current=until;setSleepMinutes(until?Math.max(0,Math.ceil((until-Date.now())/60000)):null);if(until)sleepTimer.current=setTimeout(()=>{pause(false);sleepUntil.current=null;setSleepMinutes(null);saveListening(false);notify("A quiet end to your listening.");},Math.max(0,until-Date.now()));}
 function setSleepTimer(minutes:number|null){if(minutes!==null&&(!Number.isFinite(minutes)||minutes<1||minutes>180))return;armSleep(minutes===null?null:Date.now()+minutes*60000);saveListening();if(minutes!==null)void updateSettings({sleepTimerMinutes:Math.round(minutes)}).catch(error=>reportError(error,"save"));}
 async function logout(){if(logoutJob.current)return logoutJob.current;if(!account)return;const operation=(async()=>{
  pause(false);let timeout:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([Promise.allSettled([listeningSync.current?.flush(true),drainListen(account.id,{timeoutMs:5000,maxDurationMs:5000,maxChunks:20})]),new Promise<void>(resolve=>{timeout=setTimeout(resolve,5000);})]);}finally{if(timeout)clearTimeout(timeout);}
  await signOut({redirect:false});const session=await requestJson<{user?:unknown}>("/api/auth/session",{}, {context:"account"});if(session.user)throw new UserFacingError(responseIssue(503,null,"account"));await forgetActiveAccount().catch(()=>{});clearResources(account.id);switchAccount(null);setAccount(null);runtime.current.account=null;location.href="/login";
 })();logoutJob.current=operation;try{await operation;}finally{logoutJob.current=null;}}
 useEffect(()=>{if(!account)return;const id=account.id,epoch=accountGeneration.current;const sync=new ListeningSync(id,deviceIdentity(),state=>{if(epoch===accountGeneration.current)restoreListening(state);});listeningSync.current=sync;void sync.start();
  let refreshing=false;async function refresh(){if(refreshing||document.visibilityState==="hidden"||epoch!==accountGeneration.current)return;refreshing=true;try{await sync.refresh();await syncSettings(id);await syncFavorites(id);await syncTasteEvidence(id);void drainListen(id).catch(()=>{});}catch{}finally{refreshing=false;}}
  const interval=setInterval(()=>void refresh(),15000);const focus=()=>void refresh();const hidden=()=>{if(document.visibilityState==="hidden"){flushListen();if(runtime.current.status==="playing")saveListening(false);void sync.flush(true).catch(()=>{});}else void refresh();};const hide=()=>{flushListen();if(runtime.current.status==="playing")saveListening(false);void sync.flush(true).catch(()=>{});};window.addEventListener("focus",focus);window.addEventListener("pagehide",hide);document.addEventListener("visibilitychange",hidden);window.addEventListener("online",focus);
  return()=>{clearInterval(interval);window.removeEventListener("focus",focus);window.removeEventListener("pagehide",hide);document.removeEventListener("visibilitychange",hidden);window.removeEventListener("online",focus);sync.stop();if(listeningSync.current===sync)listeningSync.current=null;};
 // Account generation guards isolate restored state and callbacks.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[account?.id]);
 useEffect(()=>()=>{if(sleepTimer.current)clearTimeout(sleepTimer.current);if(toastTimer.current)clearTimeout(toastTimer.current);},[]);

 useEffect(()=>{if(!("mediaSession" in navigator))return;if(track)navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:track.artists.join(", "),album:track.albumTitle||"",artwork:track.coverUrl?[{src:track.coverUrl,sizes:"512x512",type:"image/jpeg"}]:[]});navigator.mediaSession.playbackState=status==="playing"?"playing":status==="paused"?"paused":"none";try{navigator.mediaSession.setActionHandler("play",()=>{if(!["playing","buffering","resolving"].includes(runtime.current.status))togglePlay();});navigator.mediaSession.setActionHandler("pause",()=>pause());navigator.mediaSession.setActionHandler("nexttrack",next);navigator.mediaSession.setActionHandler("previoustrack",previous);navigator.mediaSession.setActionHandler("seekto",details=>seek((details.seekTime||0)*1000));}catch{/* Older browsers expose only some Media Session actions. */}},[track,status]);
 const value:MusicState={account,booting,offline,settings,artistChoiceVersion,updateSettings,track,status,error,positionMs,durationMs,queue,currentEntryId,getPlaybackChoiceVersion:()=>playbackChoiceVersion.current,play,playQueueEntry,togglePlay,pause:()=>pause(),next,previous,seek,addQueue,removeQueue,moveQueue,reorderQueue,clearQueue,smartQueue,smartQueueBusy,parkedPicks,restoreParkedPicks,shuffle,setShuffle,repeat,setRepeat,volume,setVolume,liked,toggleLike,downloads,requestDownload,cancelDownload,pauseDownload,resumeDownload,removeDownload,effectiveId,ensureRecording,preparePlaybackAudio,modal,shareTrack,openModal:(modal,subject)=>{setShareTrack(subject||null);setModal(modal);},closeModal:()=>setModal(null),notify,toast,notice,reportError,dismissNotice:()=>setNotice(null),retryConnection:()=>setConnectionVersion(v=>v+1),logout,sleepMinutes,setSleepTimer};
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
function cryptoId(){return typeof crypto!=="undefined"&&typeof crypto.randomUUID==="function"?crypto.randomUUID():"00000000-0000-4000-8000-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);}
