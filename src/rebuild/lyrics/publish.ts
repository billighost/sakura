import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { waitForLyrics } from "./transport";
import { LyricRequestError } from "./request";
import { parseTimedLyrics } from "./parse";
import { lyricEdition } from "./identity";
import { selectLyricsCandidate, type LyricIdentity, type LrcLibTrack } from "./provider";

export class LyricPublishError extends LyricRequestError {
  constructor(message:string,status:number,readonly reason:string,readonly retryAfterMs?:number){super(message,status);}
}
const publishHeaders={"Content-Type":"application/json","User-Agent":"Sakura/2.0 (https://github.com/billighost/sakura)"};
export interface PublishChallenge {prefix:string;target:string;expiresAt:number}
export function validPublishChallenge(value:unknown):value is {prefix:string;target:string}{
  const item=value as Partial<PublishChallenge>|null;
  return !!item&&typeof item.prefix==="string"&&/^[a-zA-Z0-9_-]{1,256}$/.test(item.prefix)&&typeof item.target==="string"&&/^[a-fA-F0-9]{64}$/.test(item.target);
}
async function upstreamPublishError(response:Response):Promise<LyricPublishError>{
  let payload:{name?:string}|undefined;try{payload=await response.json();}catch{}
  const after=response.headers.get("Retry-After"),seconds=after?Number(after):NaN;
  const retryAfterMs=Number.isFinite(seconds)?Math.max(1000,seconds*1000):after?Math.max(1000,Date.parse(after)-Date.now())||undefined:undefined;
  if(response.status===429)return new LyricPublishError("LRCLIB is receiving too many requests. Your draft is kept; try again after a short wait.",429,"lyrics-publish-rate-limit",retryAfterMs||60000);
  if(response.status===400&&payload?.name==="IncorrectPublishTokenError")return new LyricPublishError("The publish token expired. Your draft is kept; start publishing again.",400,"lyrics-publish-token");
  if(response.status===400)return new LyricPublishError("LRCLIB did not accept these lyrics. Check the song details and timestamps, then try again.",400,"lyrics-publish-rejected");
  return new LyricPublishError("LRCLIB publishing is temporarily unavailable. Your draft is kept.",503,"lyrics-publish-unavailable",retryAfterMs);
}
export async function requestPublishChallenge(options:{fetch?:typeof fetch;signal?:AbortSignal}={}):Promise<PublishChallenge>{
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  const response=await(options.fetch||fetch)("https://lrclib.net/api/request-challenge",{method:"POST",headers:publishHeaders,signal,cache:"no-store"});
  if(!response.ok)throw await upstreamPublishError(response);
  let proof:unknown;try{proof=await response.json();}catch{throw new LyricPublishError("LRCLIB returned an incomplete publish challenge. Please try again.",503,"lyrics-publish-invalid-challenge");}
  if(!validPublishChallenge(proof))throw new LyricPublishError("LRCLIB returned an incomplete publish challenge. Please try again.",503,"lyrics-publish-invalid-challenge");
  return {prefix:proof.prefix,target:proof.target,expiresAt:Date.now()+4*60*1000};
}

export function parseLyricSubmission(value: unknown, identity: LyricIdentity) {
  const input = value && typeof value === "object" ? value as Record<string,unknown> : {};
  if (typeof input.text !== "string" || !input.text.trim()) throw new LyricRequestError("Add the lyrics first");
  if (input.text.length > 20_000 || input.text.split(/\r?\n/).length > 400) throw new LyricRequestError("Lyrics exceed 400 lines or 20,000 characters",413);
  if (!identity.title.trim()||!identity.artist.trim()||!identity.album?.trim()||identity.durationSeconds===undefined||!Number.isFinite(identity.durationSeconds)||identity.durationSeconds<1||identity.durationSeconds>3600) throw new LyricPublishError("This song needs a verified album and duration before it can be published. Your draft is kept.",400,"lyrics-publish-metadata");
  if (lyricEdition(identity.title,identity.versionLabel).includes("instrumental")) throw new LyricRequestError("Vocal lyrics cannot be published for an instrumental recording");
  const text = input.text.replace(/\r\n?/g,"\n").trim();
  if (input.format !== "plain" && input.format !== "lrc") throw new LyricRequestError("Choose plain text or synced LRC");
  if (input.format === "lrc") {
    for(const line of text.split("\n")){
      if(!line.trim())continue;
      if(/^\s*\[(?:ar|al|ti|by|re|ve|length|offset):[^\]]*\]\s*$/i.test(line))continue;
      const tags=line.match(/^\s*((?:\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\])+)/);
      if(!tags)throw new LyricRequestError("Each LRC lyric line needs a valid timestamp (seconds 00–59)");
      if(/^\s*\[\d/.test(line.slice(tags[0].length)))throw new LyricRequestError("Every LRC timestamp must be complete with seconds 00–59");
      for(const mark of line.matchAll(/<\d[^>\n]*(?:>|$)/g))if(!/^<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>$/.test(mark[0]))throw new LyricRequestError("Every word timestamp needs complete minutes and seconds 00–59");
    }
    const lines = parseTimedLyrics(text);
    if (!lines.some(line=>line.text.trim()) || lines.some(line=>line.start > identity.durationSeconds! + 2)) throw new LyricRequestError("LRC timestamps must fit this recording");
    if(lines.some(line=>line.words?.some((word,index,words)=>word.start<line.start||word.start>identity.durationSeconds!+2||line.end!==undefined&&word.start>line.end||index>0&&word.start<words[index-1].start)))throw new LyricRequestError("Word timestamps must follow their lyric line in order and fit this recording");
    // Reject partial parsing instead of silently dropping unstamped lyric text.
    if (text.split("\n").some(line=>line.trim() && !/^\s*\[(?:\d+:\d|[a-z]+:)/i.test(line))) throw new LyricRequestError("Each LRC lyric line needs a timestamp");
    return {trackName:identity.title, artistName:identity.artist, albumName:identity.album, duration:Math.round(identity.durationSeconds), syncedLyrics:text, plainLyrics:lines.map(line=>line.text).join("\n")};
  }
  // Keep stanza spacing, leading/trailing blank lines and the contributor's
  // exact plain text. Trimming above is only for validation/LRC parsing.
  return {trackName:identity.title, artistName:identity.artist, albumName:identity.album, duration:Math.round(identity.durationSeconds), plainLyrics:input.text};
}

/** Official LRCGET algorithm: SHA256(prefix + decimal nonce) <= target. */
export async function solvePublishChallenge(prefix: string, target: string, signal: AbortSignal, maximumMs=25_000) {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(prefix) || !/^[a-fA-F0-9]{64}$/.test(target)) throw new Error("LRCLIB returned an invalid challenge");
  const threshold=Buffer.from(target,"hex"), start=Date.now();
  for(let nonce=0;nonce<Number.MAX_SAFE_INTEGER;nonce++) {
    if(nonce%4096===0){signal.throwIfAborted();if(Date.now()-start>maximumMs)throw new LyricRequestError("Publishing took too long. Please try again.",503);await setImmediate();}
    if(Buffer.compare(createHash("sha256").update(prefix+nonce).digest(),threshold)<=0)return `${prefix}:${nonce}`;
  }
  throw new Error("Challenge could not be solved");
}

export async function publishLyrics(identity: LyricIdentity, value: unknown, options:{fetch?:typeof fetch;signal?:AbortSignal;readback?:boolean}={}) {
  const payload=parseLyricSubmission(value,identity), fetcher=options.fetch||fetch;
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(50_000)]):AbortSignal.timeout(50_000);
  const headers=publishHeaders,input=value&&typeof value==="object"?value as Record<string,unknown>:{};
  let token:string;
  if(input.publishToken!==undefined){
    if(typeof input.publishToken!=="string"||!/^[a-zA-Z0-9_-]{1,256}:\d{1,16}$/.test(input.publishToken))throw new LyricPublishError("The publish token is incomplete. Start publishing again.",400,"lyrics-publish-token");
    token=input.publishToken;
  }else{
    // Compatibility path for older clients. New clients solve in a Worker so
    // a ~2^24-hash challenge is not cut off by the server's request lifetime.
    const proof=await requestPublishChallenge({fetch:fetcher,signal});
    token=await solvePublishChallenge(proof.prefix,proof.target,signal);
  }
  const response=await fetcher("https://lrclib.net/api/publish",{method:"POST",headers:{...headers,"X-Publish-Token":token},body:JSON.stringify(payload),signal,cache:"no-store"});
  if(response.status!==201)throw await upstreamPublishError(response);
  // The accepted upload is final. API clients can refresh the read endpoint
  // separately, without holding the successful response open for indexing.
  if(options.readback===false)return {published:true as const,track:undefined as LrcLibTrack|undefined};
  // Publishing already succeeded. A delayed read must never suggest resubmitting.
  let track:LrcLibTrack|undefined;
  try {
    const query=new URLSearchParams({track_name:identity.title,artist_name:identity.artist,album_name:identity.album!,duration:String(Math.round(identity.durationSeconds!))});
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)await waitForLyrics(250*2**(attempt-1),signal);
      const lookup=attempt%2===0?`https://lrclib.net/api/get?${query}`:`https://lrclib.net/api/search?${new URLSearchParams({q:identity.title})}`;
      const result=await fetcher(lookup,{headers,signal:AbortSignal.any([signal,AbortSignal.timeout(4000)]),cache:"no-store"});
      // Publication is confirmed already. Leave lookup pending rather than
      // ignoring LRCLIB's cooldown or extending the upload request lifetime.
      if(result.status===429||result.status===503)break;
      if(result.ok){
        const data=await result.json() as LrcLibTrack|LrcLibTrack[];
        const normalize=(text:string|undefined|null)=>(text||"").replace(/\r\n?/g,"\n").trim();
        const submitted=(Array.isArray(data)?data:[data]).filter(candidate=>candidate&&normalize(candidate.plainLyrics)===normalize(payload.plainLyrics)&&(!("syncedLyrics" in payload)||normalize(candidate.syncedLyrics)===normalize(payload.syncedLyrics)));
        const match=selectLyricsCandidate(identity,submitted);
        if(match.status==="matched"){track=match.track;break;}
      }
    }
  } catch { /* The caller retries reading, never publishing, after a successful 201. */ }
  return {published:true as const,track};
}
