import { randomUUID } from "node:crypto";
import { fetchAudioHeaders } from "../core/streaming";
import { selectAudioCandidate } from "../core/matching";
import type { ProviderReference, RecordingMetadata } from "../core/types";
import type { CatalogRecording } from "./contracts";
import { readMetadataJson, readMetadataText } from "./providers";
import { catalogTrack, type DeezerCatalogService } from "./catalog";
import type { RecordingIngestor, SqlTransaction } from "./ingestion";

type ImportItem={reference?:ProviderReference;metadata?:RecordingMetadata;title:string;artist:string;status:"matched"|"review"|"unavailable";candidates?:readonly CatalogRecording[]};
export interface ImportPreview {provider:"deezer"|"spotify"|"youtube";sourceId:string;name:string;coverUrl?:string;items:ImportItem[];total:number;truncated:boolean;}
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
 constructor(private readonly catalog:DeezerCatalogService,private readonly ingestor:RecordingIngestor,private readonly transaction:SqlTransaction,
   private readonly credentials:{spotifyClientId?:string;spotifyClientSecret?:string;youtubeApiKey?:string}={},private readonly fetcher:typeof fetch=fetch){}
 private async json(url:string,headers?:Record<string,string>,method="GET",body?:string){
  const response=await fetchAudioHeaders(url,{method,body,headerTimeoutMs:8000,redirect:"error",headers},this.fetcher);
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===404||response.status===403?"This playlist is private, removed, or cannot be accessed with the current provider account.":"The playlist provider is temporarily unavailable.");}
  return row(await readMetadataJson(response));
 }
 async preview(url:string):Promise<ImportPreview>{
  const source=collectionUrl(url),key=`${source.provider}:${source.id}`;
  const cached=this.previews.get(key);if(cached&&cached.expires>Date.now())return structuredClone(cached.value);
  let preview:ImportPreview;
  if(source.provider==="deezer")preview=await this.deezer(source.id);
  else if(source.provider==="spotify")preview=await this.spotify(source.id);
  else preview=await this.youtube(source.id);
  if(this.previews.size>=100)this.previews.delete(this.previews.keys().next().value!);
  this.previews.set(key,{expires:Date.now()+10*60*1000,value:structuredClone(preview)});return preview;
 }
 private async deezer(id:string):Promise<ImportPreview>{
  const playlist=await this.json(`https://api.deezer.com/playlist/${id}`);
  if(playlist.error)throw new Error("This Deezer playlist is private or unavailable.");
  const items:ImportItem[]=[];let tracks=row(playlist.tracks);const visited=new Set<string>();
  while(true){
   for(const raw of Array.isArray(tracks.data)?tracks.data:[]){const track=catalogTrack(raw);if(track)items.push({reference:track.reference,metadata:track.metadata,title:track.metadata.title,artist:track.metadata.artists[0],status:"matched"});if(items.length>=2000)break;}
   if(!tracks.next||items.length>=2000)break;const next=new URL(String(tracks.next));if(next.protocol!=="https:"||next.hostname!=="api.deezer.com"||next.username||next.password)throw new Error("Playlist provider returned an invalid page.");
   if(visited.has(next.href)||visited.size>=40)throw new Error("Playlist provider returned repeating or excessive pages.");visited.add(next.href);tracks=await this.json(next.toString());
  }
  return{provider:"deezer",sourceId:id,name:String(playlist.title??"Imported playlist"),coverUrl:typeof playlist.picture_big==="string"?playlist.picture_big:undefined,items,total:Number(playlist.nb_tracks)||items.length,truncated:!!tracks.next&&items.length>=2000};
 }
 private async spotify(id:string):Promise<ImportPreview>{
  if(!this.credentials.spotifyClientId||!this.credentials.spotifyClientSecret)throw new Error("Spotify playlist access requires a configured Spotify connection. Public Deezer and YouTube links can also be imported.");
  const token=await this.json("https://accounts.spotify.com/api/token",{Authorization:`Basic ${Buffer.from(`${this.credentials.spotifyClientId}:${this.credentials.spotifyClientSecret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},"POST","grant_type=client_credentials");
  if(typeof token.access_token!=="string")throw new Error("Spotify playlist authorization failed.");const headers={Authorization:`Bearer ${token.access_token}`};
  const playlist=await this.json(`https://api.spotify.com/v1/playlists/${id}`,headers);let page=row(playlist.tracks);const items:ImportItem[]=[];const visited=new Set<string>();
  while(true){for(const wrapper of Array.isArray(page.items)?page.items:[]){const track=row(row(wrapper).track);const artists=Array.isArray(track.artists)?track.artists.map(artist=>String(row(artist).name??"")).filter(Boolean):[];
    if(typeof track.id==="string"&&typeof track.name==="string"&&artists.length)items.push({reference:{provider:"spotify",id:track.id},metadata:{title:track.name,artists,durationMs:Number(track.duration_ms)||null,explicit:track.explicit===true?"explicit":"unknown"},title:track.name,artist:artists[0],status:"matched"});if(items.length>=2000)break;}
   if(!page.next||items.length>=2000)break;const next=new URL(String(page.next));if(next.protocol!=="https:"||next.hostname!=="api.spotify.com"||next.username||next.password)throw new Error("Spotify returned an invalid playlist page.");
   if(visited.has(next.href)||visited.size>=40)throw new Error("Spotify returned repeating or excessive playlist pages.");visited.add(next.href);page=await this.json(next.toString(),headers);}
  const images=Array.isArray(playlist.images)?playlist.images:[];return{provider:"spotify",sourceId:id,name:String(playlist.name??"Imported Spotify playlist"),coverUrl:typeof row(images[0]).url==="string"?String(row(images[0]).url):undefined,items,total:Number(page.total)||items.length,truncated:!!page.next&&items.length>=2000};
 }
 private async youtube(id:string):Promise<ImportPreview>{
  let name="Imported YouTube playlist";const videos:{title:string;artist:string;durationMs:number|null}[]=[];
  if(this.credentials.youtubeApiKey){
   const playlist=await this.json(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(this.credentials.youtubeApiKey)}`);
   const first=Array.isArray(playlist.items)?row(playlist.items[0]):{};name=String(row(first.snippet).title??name);let pageToken="";
   do{const page=await this.json(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(id)}&key=${encodeURIComponent(this.credentials.youtubeApiKey)}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:""}`);
    for(const item of Array.isArray(page.items)?page.items:[]){const snippet=row(row(item).snippet);videos.push({title:String(snippet.title??""),artist:String(snippet.videoOwnerChannelTitle??""),durationMs:null});}pageToken=typeof page.nextPageToken==="string"?page.nextPageToken:"";
   }while(pageToken&&videos.length<2000);
  }else{
   const response=await fetchAudioHeaders(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,{headerTimeoutMs:8000,headers:{"User-Agent":"Mozilla/5.0"}},this.fetcher);
   if(!response.ok){await response.body?.cancel();throw new Error("Public YouTube playlist metadata is temporarily unavailable.");}
   const text=await readMetadataText(response,5*1024*1024);
   const pending:unknown[]=[youtubeInitialData(text)];let nodes=0;
   while(pending.length&&nodes++<30000){const value=pending.shift();if(Array.isArray(value)){pending.push(...value);continue;}const object=row(value);
    if(object.playlistHeaderRenderer)name=runs(row(object.playlistHeaderRenderer).title)||name;
    if(object.playlistVideoRenderer){const video=row(object.playlistVideoRenderer),length=runs(video.lengthText).split(":").map(Number);const seconds=length.reduce((sum,number)=>sum*60+number,0);
      videos.push({title:runs(video.title),artist:runs(video.shortBylineText),durationMs:seconds>0?seconds*1000:null});}
    pending.push(...Object.values(object).filter(value=>value&&typeof value==="object"));
   }
  }
  if(!videos.length)throw new Error("This YouTube playlist is private, empty, or unavailable.");
  const items:ImportItem[]=[];
  for(const video of videos.slice(0,2000)){
   const cleaned=video.title.replace(/[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?|visuali[sz]er|hd|4k)\s*[)\]]/gi,"").trim();
   const parts=cleaned.split(/\s[-–—]\s/);const artist=parts.length>1?parts.shift()!:video.artist.replace(/\s*-\s*Topic$|VEVO$/i,"").trim();const title=parts.length?parts.join(" - "):cleaned;
   const results=await this.catalog.search(`${artist} ${title}`);
   const expected={title,artists:[artist],durationMs:video.durationMs};
   const selection=selectAudioCandidate({metadata:expected},results.tracks.map((track,index)=>({candidateId:String(index),metadata:track.metadata,references:track.references,audioKind:"full" as const})));
   if(selection.status==="matched"){const track=results.tracks[Number(selection.candidate.candidateId)];items.push({reference:track.reference,metadata:track.metadata,title,artist,status:"matched"});}
   else items.push({title,artist,status:results.tracks.length?"review":"unavailable",candidates:results.tracks.slice(0,5)});
  }
  return{provider:"youtube",sourceId:id,name,items,total:videos.length,truncated:videos.length>2000};
 }
 async confirm(accountId:string,url:string){
  const preview=await this.preview(url),recordingIds:string[]=[],failed:string[]=[];const selected=preview.items.filter(item=>item.status==="matched"&&item.reference);
  for(let at=0;at<selected.length;at+=4){const results=await Promise.allSettled(selected.slice(at,at+4).map(item=>this.ingestor.ensureRecording(item.reference!,item.metadata)));
   results.forEach((result,index)=>{if(result.status==="fulfilled")recordingIds.push(result.value.recordingId);else failed.push(selected[at+index].title);});}
  const unique=[...new Set(recordingIds)];if(!unique.length)throw new Error("No songs were verified. Review the playlist matches before importing.");const playlistId=randomUUID();
  await this.transaction(async query=>{
   await query(`INSERT INTO sakura_v2."Playlist"(id,account_id,name,description,cover_url) VALUES($1::uuid,$2::uuid,$3,$4,$5)`,[playlistId,accountId,preview.name,`Imported from ${preview.provider}.`,preview.coverUrl??null]);
   await query(`INSERT INTO sakura_v2."PlaylistRecording"(playlist_id,recording_id,position) SELECT $1::uuid,id,ordinality-1 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id,ordinality)`,[playlistId,unique]);
  });
  return{playlistId,added:unique.length,total:preview.total,review:preview.items.filter(item=>item.status==="review").length,unavailable:preview.items.filter(item=>item.status==="unavailable").length,failed:failed.length,truncated:preview.truncated};
 }
}
