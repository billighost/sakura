import {requestJson,UserFacingError,responseIssue} from "./errors";
import type {ResolveRecordingResult,RecordingJobStatus} from "../server/contracts";

/** Match the persistent worker lease, rather than abandoning healthy work after a fixed poll count. */
export async function waitForRecording(initial:ResolveRecordingResult,options:{signal:AbortSignal;accountId:string;origin:string;timeoutMs?:number;background?:boolean}):Promise<ResolveRecordingResult>{
 let result=initial;const deadline=performance.now()+(options.timeoutMs??125000);
 while(result.status==="pending"){
  options.signal.throwIfAborted();const remaining=deadline-performance.now();
  if(remaining<=0)throw new UserFacingError({...responseIssue(503,null,"playback"),title:"This song needs a little more time.",message:"The audio is still being prepared. Try the song again shortly, or listen to your downloaded music.",action:"Retry song"});
  // Foreground playback retains the existing one-second result pickup. Only
  // explicitly background preparation may accept a wider server retry hint.
  const hint=Number.isFinite(result.retryAfterMs)&&result.retryAfterMs>0?result.retryAfterMs:1000;
  const delay=Math.min(options.background?5000:1000,hint,remaining);
  await new Promise<void>((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(options.signal.reason);};
   const timer=setTimeout(()=>{options.signal.removeEventListener("abort",abort);resolve();},delay);
   options.signal.addEventListener("abort",abort,{once:true});if(options.signal.aborted)abort();
  });
  options.signal.throwIfAborted();const left=deadline-performance.now();if(left<=0)continue;
  const poll=new URL(result.pollUrl,options.origin);
  if(poll.origin!==options.origin||poll.username||poll.password||poll.hash||poll.pathname!=="/api/v2/recordings/jobs/"+encodeURIComponent(result.jobId))throw new UserFacingError(responseIssue(502,null,"playback"));
  poll.searchParams.set("compact","1");if(options.background)poll.searchParams.set("background","1");
  const next=await requestJson<RecordingJobStatus>(poll.href,{signal:options.signal},{context:"playback",accountId:options.accountId,timeoutMs:Math.min(20000,left)});
  if(next.status==="pending"&&"schemaVersion" in next){
   if(next.schemaVersion!==1||next.jobId!==result.jobId||typeof result.recording?.recordingId!=="string"||next.recordingId!==result.recording.recordingId)throw new UserFacingError(responseIssue(502,null,"playback"));
   result={...result,pollUrl:next.pollUrl,retryAfterMs:next.retryAfterMs,...(next.stage?{stage:next.stage}:{})};
  }else result=next;
 }
 return result;
}

