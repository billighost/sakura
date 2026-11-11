import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { waitForLyrics } from "./transport";
import { LyricRequestError } from "./request";
import { parseTimedLyrics } from "./parse";
import { lyricEdition } from "./identity";
import { selectLyricsCandidate, type LyricIdentity, type LrcLibTrack } from "./provider";

export function parseLyricSubmission(value: unknown, identity: LyricIdentity) {
  const input = value && typeof value === "object" ? value as Record<string,unknown> : {};
  if (typeof input.text !== "string" || !input.text.trim()) throw new LyricRequestError("Add the lyrics first");
  if (input.text.length > 20_000 || input.text.split(/\r?\n/).length > 400) throw new LyricRequestError("Lyrics exceed 400 lines or 20,000 characters",413);
  if (!identity.album || !identity.durationSeconds || identity.durationSeconds > 3600) throw new LyricRequestError("Verified album and duration are required to publish this recording");
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
    }
    const lines = parseTimedLyrics(text);
    if (!lines.some(line=>line.text.trim()) || lines.some(line=>line.start > identity.durationSeconds! + 2)) throw new LyricRequestError("LRC timestamps must fit this recording");
    // Reject partial parsing instead of silently dropping unstamped lyric text.
    if (text.split("\n").some(line=>line.trim() && !/^\s*\[(?:\d+:\d|[a-z]+:)/i.test(line))) throw new LyricRequestError("Each LRC lyric line needs a timestamp");
    return {trackName:identity.title, artistName:identity.artist, albumName:identity.album, duration:Math.round(identity.durationSeconds), syncedLyrics:text, plainLyrics:lines.map(line=>line.text).join("\n")};
  }
  return {trackName:identity.title, artistName:identity.artist, albumName:identity.album, duration:Math.round(identity.durationSeconds), plainLyrics:text};
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

export async function publishLyrics(identity: LyricIdentity, value: unknown, options:{fetch?:typeof fetch;signal?:AbortSignal}={}) {
  const payload=parseLyricSubmission(value,identity), fetcher=options.fetch||fetch;
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(50_000)]):AbortSignal.timeout(50_000);
  const headers={"Content-Type":"application/json","User-Agent":"Sakura/2.0 (https://github.com/billighost/sakura)"};
  const challenge=await fetcher("https://lrclib.net/api/request-challenge",{method:"POST",headers,signal,cache:"no-store"});
  if(!challenge.ok)throw new LyricRequestError("LRCLIB publishing is temporarily unavailable",503);
  const proof=await challenge.json() as {prefix:string;target:string};
  const token=await solvePublishChallenge(proof.prefix,proof.target,signal);
  const response=await fetcher("https://lrclib.net/api/publish",{method:"POST",headers:{...headers,"X-Publish-Token":token},body:JSON.stringify(payload),signal,cache:"no-store"});
  if(response.status!==201)throw new LyricRequestError(response.status===400?"LRCLIB did not accept these lyrics. Check the text and try again.":"LRCLIB publishing is temporarily unavailable",response.status===400?400:503);
  // Publishing already succeeded. A delayed read must never suggest resubmitting.
  let track:LrcLibTrack|undefined;
  try {
    const query=new URLSearchParams({track_name:identity.title,artist_name:identity.artist,album_name:identity.album!,duration:String(Math.round(identity.durationSeconds!))});
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)await waitForLyrics(250*2**(attempt-1),signal);
      const result=await fetcher(`https://lrclib.net/api/get?${query}`,{headers,signal:AbortSignal.any([signal,AbortSignal.timeout(4000)]),cache:"no-store"});
      if(result.ok){
        const candidate=await result.json() as LrcLibTrack,match=selectLyricsCandidate(identity,[candidate]);
        const normalize=(text:string|undefined|null)=>(text||"").replace(/\r\n?/g,"\n").trim();
        if(match.status==="matched"&&normalize(candidate.plainLyrics)===normalize(payload.plainLyrics)&&(!("syncedLyrics" in payload)||normalize(candidate.syncedLyrics)===normalize(payload.syncedLyrics))){track=match.track;break;}
      }
    }
  } catch { /* The caller retries reading, never publishing, after a successful 201. */ }
  return {published:true as const,track};
}
