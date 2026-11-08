export type ErrorContext = "page" | "playback" | "download" | "save" | "account" | "lyrics" | "share";
export type FailureKind = "connection" | "offline" | "session" | "version" | "missing" | "busy" | "validation" | "storage" | "unknown";
export interface UserIssue { kind: FailureKind; title: string; message: string; action: string; href?: string; linkLabel?: string }
const issues: Record<FailureKind, UserIssue> = {
 connection: {kind:"connection",title:"We can’t reach Sakura right now.",message:"The connection to Sakura was interrupted. Reconnect and try again, or listen to songs saved on this device.",action:"Reconnect",href:"/library/downloaded",linkLabel:"Open downloads"},
 offline: {kind:"offline",title:"You’re offline for a moment.",message:"Connect to the internet to continue. Your downloaded songs are ready to play on this device.",action:"Check connection",href:"/library/downloaded",linkLabel:"Play downloads"},
 session: {kind:"session",title:"Let’s reconnect your account.",message:"Your session has ended. Sign in again to continue with your library.",action:"Sign in",href:"/login",linkLabel:"Sign in again"},
 version: {kind:"version",title:"Let’s find the version you meant.",message:"We couldn’t verify audio for this exact recording. Open its other versions and choose one to play.",action:"Check again",href:"/search",linkLabel:"Find other versions"},
 missing: {kind:"missing",title:"This isn’t available here yet.",message:"This item could not be found. Search for it again or return to your library.",action:"Check again",href:"/search",linkLabel:"Search music"},
 busy: {kind:"busy",title:"A little pause, then another try.",message:"Sakura is receiving too many requests. Wait a moment, then try again.",action:"Try again shortly",href:"/library/downloaded",linkLabel:"Play downloads"},
 validation: {kind:"validation",title:"A small detail needs your attention.",message:"Check the information you entered, then try again.",action:"Try again"},
 storage: {kind:"storage",title:"Your device needs a little room.",message:"This device couldn’t save the song. Free some storage or allow browser storage, then try again. You can still stream online.",action:"Retry download",href:"/library/downloaded",linkLabel:"Manage downloads"},
 unknown: {kind:"unknown",title:"That didn’t finish this time.",message:"Something interrupted this step. Try again, or return to your music and come back later.",action:"Try again",href:"/home",linkLabel:"Return to music"},
};
const fallbacks: Record<ErrorContext, UserIssue> = {
 page: issues.connection, account: issues.connection,
 playback: {...issues.connection,title:"This song couldn’t start.",action:"Retry song"},
 download: {...issues.connection,title:"The download paused before it finished.",action:"Retry download"},
 save: {...issues.connection,title:"Your change couldn’t be saved.",action:"Save again"},
 lyrics: {...issues.connection,title:"The words couldn’t load this time.",action:"Reload lyrics"},
 share: {...issues.unknown,title:"Your shared moment couldn’t be prepared.",message:"Try preparing it again, or choose an image or link to share instead.",action:"Prepare again"},
};
export class UserFacingError extends Error {
 constructor(readonly issue: UserIssue) { super(issue.message); this.name="UserFacingError"; }
}
const rememberedIssues=new Map<string,UserIssue>();
export function userIssue(error: unknown, context: ErrorContext = "page"): UserIssue {
 if(error instanceof UserFacingError)return error.issue;
 const name=error instanceof Error?error.name:"";
 const message=error instanceof Error?error.message:typeof error==="string"?error:"";
 const remembered=rememberedIssues.get(context+":"+message);if(remembered)return remembered;
 // Only known application copy is reused. Exception text and response bodies never reach the screen.
 const known=[fallbacks[context],...Object.values(issues)].find(issue=>issue.message===message);
 if(known)return known;
 if(name==="QuotaExceededError"||name==="SecurityError"||name==="InvalidStateError")return issues.storage;
 if(/different or uncertain recording|recording.+(match|verify)|identity-conflict|ambiguous-audio|asset-mismatch|catalog-mismatch/.test(message))return issues.version;
 if(/lyrics.+(not available|not found)|no-lyrics|not-found/.test(message)&&context==="lyrics")return {...issues.missing,title:"No lyrics for this recording yet.",message:"The lyrics provider has no verified words for this version yet. Keep listening, or check again later.",action:"Check for lyrics",href:undefined,linkLabel:undefined};
 if(/reading guide.+(match|unavailable)/i.test(message))return {...fallbacks.lyrics,title:"The reading guide needs another try.",message:"The reading guide couldn’t be matched to these lyrics. You can read the original words while we try again."};
 if(/offline|failed to fetch|networkerror|internet disconnected|err_internet_disconnected/i.test(message))return issues.offline;
 if(/connection ended|audio file size|incomplete song|audio.+response|audio source stopped/i.test(message))return fallbacks[context];
 return fallbacks[context];
}
export function userMessage(error: unknown, context: ErrorContext = "page"): string { const issue=userIssue(error,context);rememberedIssues.set(context+":"+issue.message,issue);return issue.message; }
export function responseIssue(status:number, payload:unknown, context:ErrorContext="page"):UserIssue {
 const value=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
 const reason=String(value.reason||"");
 if(status===401)return issues.session;
 if(status===409&&context==="account")return {...issues.validation,title:"That account already has a home here.",message:"That username or email is already in use. Sign in, or choose different account details."};
 if(status===409||value.status==="review")return issues.version;
 if(status===423)return {...issues.missing,title:"This Bloom is still growing.",message:"Your listening story opens on its release date. Keep listening and come back when it’s ready.",href:"/bloom",linkLabel:"View Bloom dates"};
 if(status===410)return {...issues.missing,title:"This Bloom’s season has passed.",message:"The viewing window for this recap has closed. Open Sakura Bloom to see your next listening story.",href:"/bloom",linkLabel:"Open Sakura Bloom"};
 if(status===429)return issues.busy;
 if(status===404||reason==="catalog-not-found"||reason==="recording-not-indexed")return context==="lyrics"?userIssue("no-lyrics",context):issues.missing;
 if([400,413,415,422].includes(status)) {
  const validation:Record<string,string>={"Username is already in use":"That username is already taken. Choose another username.","Email is already in use":"An account already uses that email. Sign in or use another email.","Invalid credentials":"Check your username or email and password, then sign in again."};
  const message=typeof value.error==="string"?validation[value.error]:undefined;
  return {...issues.validation,...(message?{message}:{})};
 }
 if(reason==="no-ready-audio"||reason==="audio-source-unavailable"||reason==="unsupported-provider")return {...issues.missing,title:"Audio is still being found for this song.",message:"We haven’t found a verified full recording yet. Try again shortly, or explore its other versions.",action:"Check again",linkLabel:"Find other versions"};
 return fallbacks[context];
}
export interface JsonOptions {context?:ErrorContext;acceptStatuses?:number[];timeoutMs?:number;accountId?:string}
export async function readJsonResponse<T=Record<string,unknown>>(response:Response,options:JsonOptions={}):Promise<T> {
 let payload:unknown;
 try {const body=await response.text();payload=JSON.parse(body);}catch {throw new UserFacingError(responseIssue(response.ok?502:response.status,null,options.context));}
 if(!response.ok&&!options.acceptStatuses?.includes(response.status))throw new UserFacingError(responseIssue(response.status,payload,options.context));
 if(payload===null||typeof payload!=="object"||Array.isArray(payload))throw new UserFacingError(responseIssue(502,null,options.context));
 return payload as T;
}
export async function requestJson<T=Record<string,unknown>>(url:string,init:RequestInit={},options:JsonOptions={}):Promise<T> {
 // A stalled service must not leave a loading state forever. Caller cancellation stays distinct.
 const controller=new AbortController();const abort=()=>controller.abort(init.signal?.reason);if(init.signal?.aborted)abort();else init.signal?.addEventListener("abort",abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException("Request timed out","TimeoutError")),options.timeoutMs||20000);
 const headers=new Headers(init.headers);if(options.accountId)headers.set("X-Sakura-Account",options.accountId);
 try{return await readJsonResponse<T>(await fetch(url,{credentials:"same-origin",...init,headers,signal:controller.signal}),options);}
 catch(error){if(init.signal?.aborted)throw error;throw error instanceof UserFacingError?error:new UserFacingError(userIssue(error,options.context));}
 finally{clearTimeout(timer);init.signal?.removeEventListener("abort",abort);}
}
