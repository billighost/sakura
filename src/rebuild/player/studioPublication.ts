import type { MusicTrack } from "../app/types";
import { createLyricPublishPreparation, type LyricPublishPreparation, type LyricPublishProgress } from "./lyricPublish";

/** A pending catalog lookup must not hold the studio open after cancellation. */
export function waitForStudioRecording<T>(work:Promise<T>,signal:AbortSignal,timeoutMs=20000):Promise<T>{
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);};
    const abort=()=>{cleanup();reject(signal.reason);};
    const timer=setTimeout(()=>{cleanup();reject(new Error("Checking this song took too long. Your draft is kept; try publishing again."));},timeoutMs);
    signal.addEventListener("abort",abort,{once:true});
    work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted)abort();
  });
}

export interface StudioPublicationPreparation {
  ready:Promise<{recording:MusicTrack;preparation:LyricPublishPreparation}>;
  cancel:()=>void;
}

/** Resolve the recording and start proof immediately when the studio opens. */
export function createStudioPublicationPreparation(track:MusicTrack,options:{accountId:string;ensureRecording:(track:MusicTrack)=>Promise<MusicTrack>;onProgress?:(progress:LyricPublishProgress)=>void}):StudioPublicationPreparation{
  const controller=new AbortController();let preparation:LyricPublishPreparation|undefined;
  const ready=(async()=>{
    const recording=await waitForStudioRecording(options.ensureRecording(track),controller.signal);
    controller.signal.throwIfAborted();
    preparation=createLyricPublishPreparation(recording.id,{accountId:options.accountId,onProgress:options.onProgress});
    return {recording,preparation};
  })();
  void ready.catch(()=>{});
  return {ready,cancel:()=>{controller.abort();preparation?.cancel();}};
}
