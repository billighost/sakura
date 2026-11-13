import type {MusicTrack} from "./types";

/** The attached, account-owned full Blob is already the exact selected audio.
 * Prefer it to fetching that same recording again through its HTTP gateway. */
export function previewSourceUrls(track: MusicTrack): string[] {
 const local=track.audioUrl?.startsWith("blob:")?track.audioUrl:undefined;
 return [...new Set([local,track.readyPlayback?.fallbackUrl,track.audioUrl,track.readyPlayback?.url]
  .filter((value):value is string=>!!value))];
}

/** Only immutable, canonical CDN pointers can bypass recording resolution. */
export function readyPlaybackFor(track:MusicTrack){
 const ready=track.readyPlayback;
 if(!ready||ready.kind!=="stream"||ready.delivery!=="cdn"||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(track.id)||!Number.isSafeInteger(ready.sizeBytes)||ready.sizeBytes<=0||ready.sizeBytes>120*1024*1024||typeof ready.sha256!=="string"||!/^[a-f0-9]{64}$/i.test(ready.sha256)||typeof ready.mimeType!=="string"||!ready.mimeType.startsWith("audio/"))return;
 try{
  const url=new URL(ready.url),fallback=new URL(ready.fallbackUrl,"https://sakura.invalid");
  const path=new RegExp("^/[A-Za-z0-9_-]+/video/upload/v[1-9][0-9]*/sakura/v2/audio/"+track.id+"/"+ready.sha256+"\\.(mp3|mp4|m4a|aac|flac|ogg|opus|wav|webm)$","i");
  if(url.protocol!=="https:"||url.hostname!=="res.cloudinary.com"||url.port||url.username||url.password||url.search||url.hash||!path.test(url.pathname))return;
  if(fallback.origin!=="https://sakura.invalid"||fallback.pathname!=="/api/v2/recordings/"+track.id+"/audio"||fallback.searchParams.get("assetId")!==ready.assetId||fallback.hash)return;
  return ready;
 }catch{return;}
}
