import {requestJson,UserFacingError,responseIssue} from "./errors";
import type {ResolveRecordingResult} from "../server/contracts";

/** Match the persistent worker lease, rather than abandoning healthy work after a fixed poll count. */
export async function waitForRecording(initial:ResolveRecordingResult,options:{signal:AbortSignal;accountId:string;origin:string;timeoutMs?:number}):Promise<ResolveRecordingResult>{
 let result=initial;const deadline=performance.now()+(options.timeoutMs??125000);
 while(result.status==="pending"){
  options.signal.throwIfAborted();const remaining=deadline-performance.now();
  if(remaining<=0)throw new UserFacingError({...responseIssue(503,null,"playback"),title:"This song needs a little more time.",message:"The audio is still being prepared. Try the song again shortly, or listen to your downloaded music.",action:"Retry song"});
  const delay=Math.min(2000,result.retryAfterMs||1000,remaining);
  await new Promise<void>((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(options.signal.reason);};
   const timer=setTimeout(()=>{options.signal.removeEventListener("abort",abort);resolve();},delay);
   options.signal.addEventListener("abort",abort,{once:true});if(options.signal.aborted)abort();
  });
  options.signal.throwIfAborted();const left=deadline-performance.now();if(left<=0)continue;
  const poll=new URL(result.pollUrl,options.origin);
  if(poll.origin!==options.origin||!poll.pathname.startsWith("/api/v2/recordings/jobs/"))throw new UserFacingError(responseIssue(502,null,"playback"));
  result=await requestJson<ResolveRecordingResult>(poll.href,{signal:options.signal},{context:"playback",accountId:options.accountId,timeoutMs:Math.min(20000,left)});
 }
 return result;
}

