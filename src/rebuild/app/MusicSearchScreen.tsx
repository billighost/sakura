"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMusic } from "./MusicContext";
import { loadResource, resourceSnapshot } from "./resources";
import { replaceMusicUrl } from "./offlineNavigation";
import { type MusicTrack } from "./types";
import { Artwork, Button, SearchField, PageTitle, SectionTitle } from "./Elements";
import { TrackCollection } from "./TrackCollection";
import { StickySearch } from "./StickySearch";
import { CollectionGesture } from "./CollectionGesture";
import { SearchArtistSuggestions } from "./SearchArtistSuggestions";
import s from "./ink.module.css";
import { type Data, list, normalizedSearchText, useApi, ResourceBody } from "./MusicScreenResources";

type SearchKind="tracks"|"artists"|"albums";

function searchTrackKey(track:MusicTrack){return [normalizedSearchText(track.title),track.artists.map(normalizedSearchText).sort().join("|"),normalizedSearchText(track.versionLabel),Math.round(track.durationMs/1000)].join("::");}

function uniqueSearchTracks(...groups:MusicTrack[][]){const seen=new Set<string>();return groups.flat().filter(track=>{const key=searchTrackKey(track);if(seen.has(key))return false;seen.add(key);return true;});}

function uniqueSearchEntities(...groups:Data[][]){const seen=new Set<string>();return groups.flat().filter(entity=>{const key=String(entity.id||entity.deezerId||entity.externalId||"");if(!key||seen.has(key))return false;seen.add(key);return true;});}

export function Search(){
 const p=useMusic(),query=useSearchParams(),router=useRouter(),urlQuery=query.get("q")||"";
 const [input,setInput]=useState(urlQuery),[debounced,setDebounced]=useState(urlQuery),[loadingMore,setLoadingMore]=useState(false);
 const tab=["Songs","Artists","Albums"].includes(query.get("tab")||"")?query.get("tab")!:"Songs",kind:SearchKind=tab==="Artists"?"artists":tab==="Albums"?"albums":"tracks";
 const sentQuery=useRef<string|null>(null),loadingMoreRef=useRef(false),moreController=useRef<AbortController|null>(null),sentinel=useRef<HTMLDivElement|null>(null),latestSearchKey=useRef(debounced),retryMore=useRef<()=>void>(()=>{});
 const [extra,setExtra]=useState<{key:string;tracks:MusicTrack[];artists:Data[];albums:Data[];cursors:Partial<Record<SearchKind,string|null>>}>({key:"",tracks:[],artists:[],albums:[],cursors:{}});
 useEffect(()=>{if(sentQuery.current===urlQuery){sentQuery.current=null;return;}setInput(urlQuery);setDebounced(urlQuery);},[urlQuery]);
 useEffect(()=>{const timer=setTimeout(()=>{const next=input.trim();setDebounced(next);if(next!==urlQuery){sentQuery.current=next;replaceMusicUrl(router,"/search?"+new URLSearchParams({q:next,tab}),{scroll:false});}},350);return()=>clearTimeout(timer);},[input,urlQuery,router,tab]);
 useEffect(()=>{latestSearchKey.current=debounced;return()=>moreController.current?.abort();},[debounced]);
 const result=useApi(debounced?"/api/v2/search?q="+encodeURIComponent(debounced)+"&searchVersion=2":null),extraValid=extra.key===debounced;
 const tracks=uniqueSearchTracks(list(result.data?.tracks),...(extraValid?[extra.tracks]:[])),artists=uniqueSearchEntities((result.data?.artists||[]) as Data[],...(extraValid?[extra.artists]:[])),albums=uniqueSearchEntities((result.data?.albums||[]) as Data[],...(extraValid?[extra.albums]:[]));
 const baseCursors=(result.data?.nextCursors||{}) as Data,cursor=extraValid&&Object.prototype.hasOwnProperty.call(extra.cursors,kind)?extra.cursors[kind]:typeof baseCursors[kind]==="string"?String(baseCursors[kind]):null,totals=(result.data?.totals||{}) as Data,shown=kind==="tracks"?tracks.length:kind==="artists"?artists.length:albums.length,total=Math.max(shown,Number(totals[kind])||0);
 const more=useCallback(async()=>{if(!cursor||loadingMoreRef.current||!debounced)return;loadingMoreRef.current=true;setLoadingMore(true);const controller=new AbortController();moreController.current=controller;const requestKey=debounced;try{
  if(!p.account)return;const path="/api/v2/search?"+new URLSearchParams({q:requestKey,kind,cursor,searchVersion:"2"});await loadResource(p.account.id,path,{signal:controller.signal,kind:"visible"});const snapshot=resourceSnapshot<Data>(p.account.id,path);if(!snapshot.data)throw snapshot.error||new Error("These results have not been saved on this device yet.");const data=snapshot.data;
  if(controller.signal.aborted||latestSearchKey.current!==requestKey)return;const next=(data.nextCursors||{}) as Data;
  setExtra(previous=>{const current=previous.key===requestKey?previous:{key:requestKey,tracks:[],artists:[],albums:[],cursors:{}};return {...current,tracks:kind==="tracks"?uniqueSearchTracks(current.tracks,list(data.tracks)):current.tracks,artists:kind==="artists"?uniqueSearchEntities(current.artists,(data.artists||[]) as Data[]):current.artists,albums:kind==="albums"?uniqueSearchEntities(current.albums,(data.albums||[]) as Data[]):current.albums,cursors:{...current.cursors,[kind]:typeof next[kind]==="string"?String(next[kind]):null}};});
 }catch(error){if(!controller.signal.aborted)p.reportError(error,"page",()=>retryMore.current());}finally{if(moreController.current===controller){moreController.current=null;loadingMoreRef.current=false;setLoadingMore(false);}}},[cursor,debounced,kind,p]);
 useEffect(()=>{retryMore.current=()=>void more();return()=>{retryMore.current=()=>{};};},[more]);
 useEffect(()=>{const node=sentinel.current;if(!node||!cursor)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void more();},{rootMargin:"300px 0px"});observer.observe(node);return()=>observer.disconnect();},[cursor,more]);
 function changeTab(value:string){replaceMusicUrl(router,"/search?"+new URLSearchParams({q:debounced,tab:value}),{scroll:false});}
 return <><PageTitle eyebrow="Follow your curiosity" title="What’s on your mind?" description="Songs, voices, and the version you meant."/><StickySearch label="Music search"><SearchField value={input} onChange={value=>{setInput(value);if(!value){moreController.current?.abort();setDebounced("");sentQuery.current="";replaceMusicUrl(router,"/search?"+new URLSearchParams({q:"",tab}),{scroll:false});}}} autoFocus label="Search music" placeholder="Songs, artists, albums..."/></StickySearch><div className={s.chips}>{["Songs","Artists","Albums"].map(value=><button key={value} aria-pressed={tab===value} onClick={()=>changeTab(value)}>{value}</button>)}</div>{!debounced?<SearchArtistSuggestions onChoose={setInput}/>:<ResourceBody resource={result}><SectionTitle title={"Results for “"+debounced+"”"} note={tab==="Songs"?"Original, remix, live, and acoustic recordings stay separate.":undefined}/>{tab==="Songs"?<TrackCollection tracks={tracks} room="search" label="Song search results" firstSortLabel="Relevance" searchable={false} sticky={false}/>:<div className={s.entityGrid}>{(tab==="Artists"?artists:albums).map((entity,i)=>{const href="/"+(tab==="Artists"?"artist":"album")+"/"+encodeURIComponent(String(entity.id||entity.deezerId||""));return <CollectionGesture key={String(entity.id||i)} kind={tab==="Artists"?"artist":"album"} id={String(entity.id||entity.deezerId||"")} title={String(entity.name||entity.title||"")}><Link href={href}><Artwork url={String(entity.imageUrl||entity.picture||entity.coverUrl||"")||null} title={String(entity.name||entity.title||"")}/><h3>{String(entity.name||entity.title||"")}</h3></Link>{tab==="Albums"&&entity.artistName?<Link href={entity.artistId?"/artist/"+encodeURIComponent(String(entity.artistId)):"/search?"+new URLSearchParams({q:String(entity.artistName),tab:"Artists"})}>{String(entity.artistName)}</Link>:<p>Artist</p>}</CollectionGesture>;})}</div>}<div ref={sentinel} className={s.searchMore} aria-live="polite"><span>{total>shown?`Showing ${shown} from about ${total} catalog matches.`:`${shown} ${shown===1?"match":"matches"}.`}</span>{cursor&&<Button secondary disabled={loadingMore} onClick={()=>void more()}>{loadingMore?"Loading more…":"Show more results"}</Button>}</div></ResourceBody>}</>;
}
