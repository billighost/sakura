import { randomUUID } from "node:crypto";
import { fetchAudioHeaders } from "../core/streaming";
import { selectAudioCandidate } from "../core/matching";
import type { ProviderReference, RecordingMetadata } from "../core/types";
import type { CatalogRecording } from "./contracts";
import { readMetadataJson, readMetadataText } from "./providers";
import { catalogTrack, type DeezerCatalogService } from "./catalog";
import type { RecordingIngestor, SqlTransaction } from "./ingestion";
import { ProviderFlight } from "./provider-flight";
import { ProductError } from "../data/validation";

type ImportItem={reference?:ProviderReference;metadata?:RecordingMetadata;title:string;artist:string;status:"matched"|"review"|"unavailable";candidates?:readonly CatalogRecording[]};
export interface ImportPreview {provider:"deezer"|"spotify"|"youtube";sourceId:string;name:string;coverUrl?:string;items:ImportItem[];total:number;truncated:boolean;}
export interface ImportResult {playlistId:string;added:number;total:number;review:number;unavailable:number;failed:number;truncated:boolean}
interface ImportReceipt {account_id:string;source_key:string;result:ImportResult}
function row(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function runs(value:unknown):string{const raw=row(value);return typeof raw.simpleText==="string"?raw.simpleText:Array.isArray(raw.runs)?raw.runs.map(item=>String(row(item).text??"")).join(""):"";}
export function youtubeInitialData(text:string):unknown {
 const start=/\b(?:var\s+)?ytInitialData\s*=\s*\{/.exec(text);
 if(!start)throw new Error("YouTube requires sign-in or did not expose public playlist metadata.");
 const from=start.index+start[0].length-1;let depth=0,quoted=false,escaped=false;
 for(let at=from;at<text.length;at++){
  const char=text[at];
  if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"')quoted=true;else if(char==="{")depth++;else if(char==="}"&&--depth===0)return JSON.parse(text.slice(from,at+1));
 }
 throw new Error("YouTube returned incomplete playlist metadata.");
}
export function collectionUrl(raw:string){
 const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Use a public HTTPS music playlist link.");
 if(["deezer.com","www.deezer.com"].includes(url.hostname)){const id=/\/playlist\/([1-9]\d{0,17})(?:\/|$)/.exec(url.pathname)?.[1];if(id)return{provider:"deezer" as const,id};}
 if(url.hostname==="open.spotify.com"){const id=/\/playlist\/([A-Za-z0-9]{22})(?:\/|$)/.exec(url.pathname)?.[1];if(id)return{provider:"spotify" as const,id};}
 if(["youtube.com","www.youtube.com","music.youtube.com"].includes(url.hostname)){const id=url.searchParams.get("list");if(id&&/^[A-Za-z0-9_-]{10,160}$/.test(id))return{provider:"youtube" as const,id};}
 throw new Error("Use a Deezer, Spotify or YouTube playlist link.");
}

export class MusicCollectionImporter {
 private previews=new Map<string,{expires:number;value:ImportPreview}>();
 private readonly previewReads=new ProviderFlight<ImportPreview>(100);
 private readonly tokenReads=new ProviderFlight<string>(1);
 private spotifyToken:{value:string;expires:number}|undefined;
  private receiptSupport:{supported:boolean;expires:number}|undefined;
 constructor(private readonly catalog:DeezerCatalogService,private readonly ingestor:RecordingIngestor,private readonly transaction:SqlTransaction,
   private readonly credentials:{spotifyClientId?:string;spotifyClientSecret?:string;youtubeApiKey?:string}={},private readonly fetcher:typeof fetch=fetch){}
 private async json(url:string,headers?:Record<string,string>,method="GET",body?:string,signal?:AbortSignal){
  signal?.throwIfAborted();
  const response=await fetchAudioHeaders(url,{method,body,signal,headerTimeoutMs:8000,redirect:"error",headers},this.fetcher);
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===404||response.status===403?"This playlist is private, removed, or cannot be accessed with the current provider account.":"The playlist provider is temporarily unavailable.");}
  const result=row(await readMetadataJson(response));signal?.throwIfAborted();return result;
 }
 async preview(url:string,signal?:AbortSignal):Promise<ImportPreview>{
  signal?.throwIfAborted();
  const source=collectionUrl(url),key=`${source.provider}:${source.id}`;
  const cached=this.previews.get(key);if(cached&&cached.expires>Date.now())return structuredClone(cached.value);
  if(cached)this.previews.delete(key);
  const preview=await this.previewReads.run(key,signal,async sharedSignal=>{
   const result=source.provider==="deezer"?await this.deezer(source.id,sharedSignal):source.provider==="spotify"?await this.spotify(source.id,sharedSignal):await this.youtube(source.id,sharedSignal);
   sharedSignal.throwIfAborted();
   if(this.previews.size>=100)this.previews.delete(this.previews.keys().next().value!);
   this.previews.set(key,{expires:Date.now()+10*60*1000,value:structuredClone(result)});return result;
  });
  return structuredClone(preview);
 }
 private async deezer(id:string,signal?:AbortSignal):Promise<ImportPreview>{
  const playlist=await this.json(`https://api.deezer.com/playlist/${id}`,undefined,"GET",undefined,signal);
  if(playlist.error)throw new Error("This Deezer playlist is private or unavailable.");
  const items:ImportItem[]=[];let tracks=row(playlist.tracks);const visited=new Set<string>();
  while(true){
   for(const raw of Array.isArray(tracks.data)?tracks.data:[]){const track=catalogTrack(raw);if(track)items.push({reference:track.reference,metadata:track.metadata,title:track.metadata.title,artist:track.metadata.artists[0],status:"matched"});if(items.length>=2000)break;}
   if(!tracks.next||items.length>=2000)break;const next=new URL(String(tracks.next));if(next.protocol!=="https:"||next.hostname!=="api.deezer.com"||next.username||next.password)throw new Error("Playlist provider returned an invalid page.");
   if(visited.has(next.href)||visited.size>=40)throw new Error("Playlist provider returned repeating or excessive pages.");visited.add(next.href);tracks=await this.json(next.toString(),undefined,"GET",undefined,signal);
  }
  return{provider:"deezer",sourceId:id,name:String(playlist.title??"Imported playlist"),coverUrl:typeof playlist.picture_big==="string"?playlist.picture_big:undefined,items,total:Number(playlist.nb_tracks)||items.length,truncated:!!tracks.next&&items.length>=2000};
 }
 private async spotifyBearer(signal?:AbortSignal):Promise<string>{
  signal?.throwIfAborted();
  if(!this.credentials.spotifyClientId||!this.credentials.spotifyClientSecret)throw new Error("Spotify playlist access requires a configured Spotify connection. Public Deezer and YouTube links can also be imported.");
  if(this.spotifyToken&&this.spotifyToken.expires>Date.now()+30000)return this.spotifyToken.value;
  return this.tokenReads.run("token",signal,async sharedSignal=>{
   const token=await this.json("https://accounts.spotify.com/api/token",{Authorization:`Basic ${Buffer.from(`${this.credentials.spotifyClientId}:${this.credentials.spotifyClientSecret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},"POST","grant_type=client_credentials",sharedSignal);
   if(typeof token.access_token!=="string")throw new Error("Spotify playlist authorization failed.");
   if(typeof token.expires_in==="number"&&Number.isFinite(token.expires_in)&&token.expires_in>0)this.spotifyToken={value:token.access_token,expires:Date.now()+token.expires_in*1000};
   return token.access_token;
  });
 }
 private async spotify(id:string,signal?:AbortSignal):Promise<ImportPreview>{
  const headers={Authorization:`Bearer ${await this.spotifyBearer(signal)}`};
  const playlist=await this.json(`https://api.spotify.com/v1/playlists/${id}`,headers,"GET",undefined,signal);let page=row(playlist.tracks);const items:ImportItem[]=[];const visited=new Set<string>();
  while(true){for(const wrapper of Array.isArray(page.items)?page.items:[]){const track=row(row(wrapper).track);const artists=Array.isArray(track.artists)?track.artists.map(artist=>String(row(artist).name??"")).filter(Boolean):[];
    if(typeof track.id==="string"&&typeof track.name==="string"&&artists.length)items.push({reference:{provider:"spotify",id:track.id},metadata:{title:track.name,artists,durationMs:Number(track.duration_ms)||null,explicit:track.explicit===true?"explicit":"unknown"},title:track.name,artist:artists[0],status:"matched"});if(items.length>=2000)break;}
   if(!page.next||items.length>=2000)break;const next=new URL(String(page.next));if(next.protocol!=="https:"||next.hostname!=="api.spotify.com"||next.username||next.password)throw new Error("Spotify returned an invalid playlist page.");
   if(visited.has(next.href)||visited.size>=40)throw new Error("Spotify returned repeating or excessive playlist pages.");visited.add(next.href);page=await this.json(next.toString(),headers,"GET",undefined,signal);}
  const images=Array.isArray(playlist.images)?playlist.images:[];return{provider:"spotify",sourceId:id,name:String(playlist.name??"Imported Spotify playlist"),coverUrl:typeof row(images[0]).url==="string"?String(row(images[0]).url):undefined,items,total:Number(page.total)||items.length,truncated:!!page.next&&items.length>=2000};
 }
 private async youtube(id:string,signal?:AbortSignal):Promise<ImportPreview>{
  let name="Imported YouTube playlist";const videos:{title:string;artist:string;durationMs:number|null}[]=[];
  if(this.credentials.youtubeApiKey){
   const playlist=await this.json(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(this.credentials.youtubeApiKey)}`,undefined,"GET",undefined,signal);
   const first=Array.isArray(playlist.items)?row(playlist.items[0]):{};name=String(row(first.snippet).title??name);let pageToken="";
   do{const page=await this.json(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(id)}&key=${encodeURIComponent(this.credentials.youtubeApiKey)}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:""}`,undefined,"GET",undefined,signal);
    for(const item of Array.isArray(page.items)?page.items:[]){const snippet=row(row(item).snippet);videos.push({title:String(snippet.title??""),artist:String(snippet.videoOwnerChannelTitle??""),durationMs:null});}pageToken=typeof page.nextPageToken==="string"?page.nextPageToken:"";
   }while(pageToken&&videos.length<2000);
  }else{
   const response=await fetchAudioHeaders(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,{signal,headerTimeoutMs:8000,headers:{"User-Agent":"Mozilla/5.0"}},this.fetcher);
   if(!response.ok){await response.body?.cancel();throw new Error("Public YouTube playlist metadata is temporarily unavailable.");}
   const text=await readMetadataText(response,5*1024*1024);signal?.throwIfAborted();
   const pending:unknown[]=[youtubeInitialData(text)];let nodes=0;
   while(nodes<pending.length&&nodes<30000){const value=pending[nodes++];if(Array.isArray(value)){pending.push(...value);continue;}const object=row(value);
    if(object.playlistHeaderRenderer)name=runs(row(object.playlistHeaderRenderer).title)||name;
    if(object.playlistVideoRenderer){const video=row(object.playlistVideoRenderer),length=runs(video.lengthText).split(":").map(Number);const seconds=length.reduce((sum,number)=>sum*60+number,0);
      videos.push({title:runs(video.title),artist:runs(video.shortBylineText),durationMs:seconds>0?seconds*1000:null});}
    pending.push(...Object.values(object).filter(value=>value&&typeof value==="object"));
   }
  }
  if(!videos.length)throw new Error("This YouTube playlist is private, empty, or unavailable.");
  const selected=videos.slice(0,2000),items:ImportItem[]=new Array(selected.length),matching=new AbortController();
  const matchingSignal=signal?AbortSignal.any([signal,matching.signal]):matching.signal;let index=0;
  try{await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{while(index<selected.length){
   matchingSignal.throwIfAborted();const at=index++,video=selected[at];
   const cleaned=video.title.replace(/[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?|visuali[sz]er|hd|4k)\s*[)\]]/gi,"").trim();
   const parts=cleaned.split(/\s[-–—]\s/);const artist=parts.length>1?parts.shift()!:video.artist.replace(/\s*-\s*Topic$|VEVO$/i,"").trim();const title=parts.length?parts.join(" - "):cleaned;
   const results=await this.catalog.search(`${artist} ${title}`,matchingSignal,{kind:"tracks"});
   const expected={title,artists:[artist],durationMs:video.durationMs};
   const selection=selectAudioCandidate({metadata:expected},results.tracks.map((track,index)=>({candidateId:String(index),metadata:track.metadata,references:track.references,audioKind:"full" as const})));
   if(selection.status==="matched"){const track=results.tracks[Number(selection.candidate.candidateId)];items[at]={reference:track.reference,metadata:track.metadata,title,artist,status:"matched"};}
   else items[at]={title,artist,status:results.tracks.length?"review":"unavailable",candidates:results.tracks.slice(0,5)};
  }}));}catch(error){matching.abort(error);throw error;}
  return{provider:"youtube",sourceId:id,name,items,total:videos.length,truncated:videos.length>2000};
 }
 private async receiptsAvailable(){
  if(this.receiptSupport&&this.receiptSupport.expires>Date.now())return this.receiptSupport.supported;
  // An additive migration is reviewed separately. Existing deployments continue
  // to import safely before it is applied; no DDL ever runs on the request path.
  const rows=await this.transaction(query=>query<{relation:string|null}>(`SELECT to_regclass('sakura_v2."ImportReceipt"')::text AS relation`,[]));
  const supported=Boolean(rows[0]?.relation);this.receiptSupport={supported,expires:Date.now()+60000};return supported;
 }
 private receiptResult(receipt:ImportReceipt,accountId:string,sourceKey:string):ImportResult{
  if(receipt.account_id!==accountId||receipt.source_key!==sourceKey)throw new ProductError(409,"Import request has already been used for another collection.");
  return structuredClone(receipt.result);
 }
 async confirm(accountId:string,url:string,requestId?:string,signal?:AbortSignal):Promise<ImportResult>{
  signal?.throwIfAborted();
  const source=collectionUrl(url),sourceKey=`${source.provider}:${source.id}`;
  const receipts=Boolean(requestId)&&await this.receiptsAvailable();
  if(requestId&&receipts){
   const existing=(await this.transaction(query=>query<ImportReceipt>('SELECT account_id,source_key,result FROM sakura_v2."ImportReceipt" WHERE request_id=$1::uuid',[requestId])))[0];
   signal?.throwIfAborted();if(existing)return this.receiptResult(existing,accountId,sourceKey);
  }
  const preview=await this.preview(url,signal),selected=preview.items.filter(item=>item.status==="matched"&&item.reference);
  const recordingIds=new Array<string|undefined>(selected.length);let next=0,failed=0;
  // A slow item no longer stalls an entire four-item batch. Indexed results keep
  // source order and duplicate-recording handling identical to the old path.
  await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
   while(next<selected.length){
    signal?.throwIfAborted();const at=next++,item=selected[at];
    try{recordingIds[at]=(await this.ingestor.ensureRecording(item.reference!,item.metadata,signal)).recordingId;}
    catch{signal?.throwIfAborted();failed++;}
   }
  }));
  signal?.throwIfAborted();
  const unique=[...new Set(recordingIds.filter((id):id is string=>Boolean(id)))];
  if(!unique.length)throw new Error("No songs were verified. Review the playlist matches before importing.");
  const playlistId=requestId||randomUUID();
  const result:ImportResult={playlistId,added:unique.length,total:preview.total,review:preview.items.filter(item=>item.status==="review").length,unavailable:preview.items.filter(item=>item.status==="unavailable").length,failed,truncated:preview.truncated};
  // Cancellation owns preparation. Once the durable transaction starts, it must
  // finish (or roll back) even if the HTTP response is lost.
  return this.transaction(async query=>{
   if(requestId){
    await query("SELECT pg_advisory_xact_lock(hashtext('playlist-import:'||$1))",[requestId]);
    if(receipts){const receipt=(await query<ImportReceipt>('SELECT account_id,source_key,result FROM sakura_v2."ImportReceipt" WHERE request_id=$1::uuid',[requestId]))[0];if(receipt)return this.receiptResult(receipt,accountId,sourceKey);}
    const existing=(await query<{account_id:string}>('SELECT account_id FROM sakura_v2."Playlist" WHERE id=$1::uuid',[requestId]))[0];
    if(existing){
     if(existing.account_id!==accountId)throw new ProductError(409,"Import request has already been used.");
     // A pre-migration playlist has no trustworthy source binding. Keep the
     // legacy retry behavior rather than inventing a receipt for another URL.
     return result;
    }
   }
   await query(`INSERT INTO sakura_v2."Playlist"(id,account_id,name,description,cover_url) VALUES($1::uuid,$2::uuid,$3,$4,$5)`,[playlistId,accountId,preview.name,`Imported from ${preview.provider}.`,preview.coverUrl??null]);
   await query(`INSERT INTO sakura_v2."PlaylistRecording"(playlist_id,recording_id,position) SELECT $1::uuid,id,ordinality-1 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id,ordinality)`,[playlistId,unique]);
   if(requestId&&receipts)await query('INSERT INTO sakura_v2."ImportReceipt"(request_id,account_id,source_key,result) VALUES($1::uuid,$2::uuid,$3,$4::jsonb)',[requestId,accountId,sourceKey,JSON.stringify(result)]);
   return result;
  });
 }
}
