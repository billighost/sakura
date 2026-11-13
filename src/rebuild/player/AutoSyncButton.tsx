"use client";
import { useEffect, useRef, useState } from "react";
import { useMusic } from "../app/MusicContext";
import { requestJson } from "../app/errors";
import type { TimedLyric } from "../lyrics/parse";
import type { MusicTrack } from "../app/types";
import type { PlayerLyrics } from "./useLyrics";
import { canAutoSync, type AutoSyncEvidence } from "../lyrics/autoSync";
import { pollSyncWhenVisible, syncPollDelay, waitForSyncPoll, type SyncPollHint } from "./autoSyncPolling";

type SyncReply=SyncPollHint&{status:"pending"|"complete";jobToken?:string;lines?:TimedLyric[];evidence?:AutoSyncEvidence};

/** The phone sends only metadata. The separate worker reads existing verified
 * media; it never downloads a model onto the phone or uploads the phone's file.
 */
type AutoSyncButtonProps={track:MusicTrack;lyrics:PlayerLyrics;onSynced:(lines:TimedLyric[],evidence:AutoSyncEvidence)=>Promise<void>};
export function AutoSyncButton(props:AutoSyncButtonProps) {
  const music=useMusic();
  const identity=JSON.stringify([music.account?.id,music.currentEntryId||music.effectiveId(props.track),props.lyrics.lines.map(line=>line.text)]);
  return <AutoSyncContent key={identity} {...props}/>;
}
function AutoSyncContent({track,lyrics,onSynced}:AutoSyncButtonProps) {
  const music=useMusic(),controller=useRef<AbortController|null>(null);
  const [state,setState]=useState<{busy:boolean;error?:string}>({busy:false});
  useEffect(()=>()=>{controller.current?.abort();controller.current=null;},[]);
  if(lyrics.timing!=="plain"||lyrics.instrumental||!canAutoSync(lyrics.lines,track.language))return null;
  async function sync(){
    if(controller.current||!music.account)return;
    const operation=new AbortController();controller.current=operation;
    const owner=music.account.id,valid=()=>!operation.signal.aborted&&controller.current===operation;
    setState({busy:true});
    try{
      const canonical=await music.ensureRecording(track);
      if(!valid())return;
      let reply=await requestJson<SyncReply>("/api/v2/lyrics/sync",{method:"POST",signal:operation.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({recordingId:canonical.id,lines:lyrics.lines.map(line=>({text:line.text,start:line.start,...(line.end===undefined?{}:{end:line.end})}))})},{context:"lyrics",accountId:owner,timeoutMs:65000});
      const deadline=Date.now()+10*60*1000;let pendingReplies=0;
      while(reply.status==="pending"){
        if(!reply.jobToken)throw new Error("The sync worker did not return a job identity.");
        if(Date.now()>deadline)throw new Error("The free sync worker is still busy. Try again when its queue is shorter.");
        await waitForSyncPoll(syncPollDelay(reply,pendingReplies),operation.signal);
        if(!valid())return;
        if(Date.now()>deadline)throw new Error("The free sync worker is still busy. Try again when its queue is shorter.");
        const jobToken=reply.jobToken;
        const polled=await pollSyncWhenVisible(signal=>requestJson<SyncReply>("/api/v2/lyrics/sync",{method:"POST",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({jobToken})},{context:"lyrics",accountId:owner,timeoutMs:65000}),operation.signal);
        if(!polled)continue;
        pendingReplies++;
        reply={...polled,jobToken:polled.jobToken||jobToken};
      }
      if(!valid())return;
      if(reply.status!=="complete"||!reply.lines||!reply.evidence)throw new Error("The sync worker returned an incomplete result.");
      await onSynced(reply.lines,reply.evidence);
      if(valid())setState({busy:false});
    }catch(error){if(valid())setState({busy:false,error:error instanceof Error?error.message:"Auto sync could not finish. Your original lyrics have been kept."});}
    finally{if(controller.current===operation)controller.current=null;}
  }
  return <span data-auto-sync>
    <button type="button" aria-busy={state.busy} title="Sync English lyrics using the free audio worker" onClick={()=>{if(state.busy){controller.current?.abort();controller.current=null;setState({busy:false});}else void sync();}}>{state.busy?"Cancel auto sync":"Auto sync"}</button>
    {state.busy&&<small role="status">Matching the words to the vocals…</small>}
    {state.error&&<small role="status">{state.error}</small>}
  </span>;
}
