"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMusic } from "./MusicContext";
import { loadResource, resourceSnapshot, invalidateResources } from "./resources";
import { readFavoriteDraft } from "./favorites";
import { type MusicTrack } from "./types";
import { Button, SearchField, Empty, LoadingRows, SectionTitle, TrackList } from "./Elements";
import { requestJson } from "./errors";
import { localId } from "./sessionState";
import { useScreenActions } from "./screenActions";
import { Icon } from "./Icon";
import { collectionTrackMatches } from "./collectionSearch";
import { CollectionHero, CollectionToolbar, PlaylistArtwork, sortRoomTracks, useRoomPresentation } from "./CollectionRoom";
import { StickySearch } from "./StickySearch";
import { CollectionGesture } from "./CollectionGesture";
import { SmartQueueButton } from "./SmartQueueButton";
import room from "./collection-room.module.css";
import s from "./ink.module.css";
import { type Data, list, normalizedSearchText, useApi, ResourceBody } from "./MusicScreenResources";

export function Library({likedOnly=false}:{likedOnly?:boolean}){
 const p=useMusic(),router=useRouter(),actions=useScreenActions(p.account?.id);
 const resource=useApi("/api/v2/library?kind=all"),data=useApi(likedOnly?"/api/v2/library?kind=liked":null),active=likedOnly?data:resource;
 const [creating,setCreating]=useState(false),[name,setName]=useState(""),[busy,setBusy]=useState(false),[query,setQuery]=useState("");
 const [presentation,setPresentation]=useRoomPresentation(p.account?.id,likedOnly?"liked":"library"),{layout,sort,direction}=presentation;
 const creation=useRef<{name:string;id:string}|null>(null);
 const [extra,setExtra]=useState<{base:number;tracks:MusicTrack[];cursor:string|null}>({base:0,tracks:[],cursor:null}),[loadingMore,setLoadingMore]=useState<number|null>(null);
 const [failedCursor,setFailedCursor]=useState<string|null>(null);
 const paging=useScreenActions(p.account?.id,String(likedOnly)+":"+active.updatedAt),extraValid=extra.base===active.updatedAt;
 const [favoriteCards,setFavoriteCards]=useState<{owner:string;tracks:MusicTrack[]}|null>(null);
 useEffect(()=>{const owner=p.account?.id;if(!owner)return;let live=true;void readFavoriteDraft(owner).then(draft=>{if(live)setFavoriteCards({owner,tracks:Object.values(draft?.pending||{}).filter(intent=>intent.liked).map(intent=>intent.track)});}).catch(()=>{});return()=>{live=false;};},[p.account?.id,p.liked]);
 const localLiked=[...(favoriteCards&&favoriteCards.owner===p.account?.id?favoriteCards.tracks:[]),...p.queue.map(entry=>entry.track),...Object.values(p.downloads).map(entry=>entry.track)].filter(track=>p.liked.has(p.effectiveId(track)));
 const allTracks=[...new Map([...list(active.data?.recordings),...(extraValid?extra.tracks:[]),...localLiked].filter(track=>!likedOnly||p.liked.has(p.effectiveId(track))).map(track=>[p.effectiveId(track),track])).values()];
 const match=normalizedSearchText(query),tracks=sortRoomTracks(allTracks.filter(track=>collectionTrackMatches(track,query)),sort,direction);
 const playlists=((resource.data?.playlists||[]) as Data[]).filter(playlist=>normalizedSearchText(String(playlist.name||"")).includes(match));
 const cursor=extraValid?extra.cursor:typeof active.data?.nextCursor==="string"?active.data.nextCursor:null;
 async function more(){
  if(!cursor||!p.account)return;const controller=paging.begin("more");if(!controller)return;setLoadingMore(active.updatedAt);setFailedCursor(null);
  try{const pagePath="/api/v2/library?kind="+(likedOnly?"liked":"all")+"&cursor="+encodeURIComponent(cursor);
   await loadResource(p.account.id,pagePath);
   const snapshot=resourceSnapshot<Data>(p.account.id,pagePath);
   if(!snapshot.data||snapshot.error&&!p.offline)throw snapshot.error||new Error("This collection page is unavailable offline.");
   const result=snapshot.data;
   if(!paging.current("more",controller))return;
   setExtra(previous=>({base:active.updatedAt,tracks:[...(previous.base===active.updatedAt?previous.tracks:[]),...list(result.recordings)],cursor:typeof result.nextCursor==="string"?result.nextCursor:null}));
  }catch(error){if(paging.current("more",controller)){setFailedCursor(cursor);p.reportError(error,"page",()=>void more());}}finally{if(paging.finish("more",controller))setLoadingMore(null);}
 }
 // A collection query exhausts local membership pages, never the external catalogue.
 useEffect(()=>{
  if(!match||!cursor||failedCursor===cursor||loadingMore===active.updatedAt)return;
  const timer=setTimeout(()=>void more(),200);
  return()=>clearTimeout(timer);
 // more owns cancellation and page identity through useScreenActions.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[match,cursor,failedCursor,loadingMore,active.updatedAt,p.offline]);
 async function create(e?:React.FormEvent){
  e?.preventDefault();const trimmed=name.trim();if(!trimmed)return;const controller=actions.begin("create");if(!controller)return;setBusy(true);
  if(creation.current?.name!==trimmed)creation.current={name:trimmed,id:localId()};
  try{const result=await requestJson("/api/v2/playlists",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({name:trimmed,requestId:creation.current.id})},{context:"save",accountId:p.account?.id});
   if(!actions.current("create",controller))return;creation.current=null;setCreating(false);setName("");resource.retry();if(p.account)invalidateResources(p.account.id);p.notify("Playlist created.");router.push("/playlist/"+result.id);
  }catch(error){if(actions.current("create",controller))p.reportError(error,"save",()=>void create());}finally{if(actions.finish("create",controller))setBusy(false);}
 }
 return <div className={room.libraryRoom}><CollectionHero eyebrow={likedOnly?"YOUR LIKED SONGS":"The things you keep"} title={likedOnly?"Your favorite songs.":"Your little music world."} description={likedOnly?"The songs you've liked, collected in one place.":"Your liked songs and playlists, together in one place."} covers={allTracks.slice(0,3)} label={likedOnly?p.liked.size+" liked songs":"your music, collected."}><Button icon="play" disabled={!tracks.length} onClick={()=>p.play(tracks[0],tracks)}>Play {likedOnly?"liked songs":"your collection"}</Button><SmartQueueButton scope={likedOnly?"liked":"collection"} tracks={likedOnly?undefined:allTracks} label={likedOnly?"Find my saved soundtrack":"Smart play this collection"}/>{!likedOnly&&<Button secondary icon="plus" disabled={busy} onClick={()=>setCreating(!creating)}>New playlist</Button>}</CollectionHero>
 {creating&&<form className={s.createPlaylist} onSubmit={create}><label>A name for your collection<input value={name} disabled={busy} onChange={e=>setName(e.target.value)} maxLength={80} required autoFocus placeholder="Songs for a softer day"/></label><button className={s.primaryButton} disabled={busy} type="submit">{busy?"Making room...":"Create playlist"}</button><Button secondary disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button></form>}
 {!likedOnly&&<div className={room.shortcuts}><Link href="/liked"><span className={room.shortcutMark}><Icon name="heart"/></span><span><h3>Your liked songs.</h3><small>{p.liked.size} liked songs, kept close</small></span><Icon name="arrow"/></Link><Link href="/library/downloaded"><span className={room.shortcutMark}><Icon name="download"/></span><span><h3>Take it with you.</h3><small>{Object.values(p.downloads).filter(d=>d.status==="ready"&&d.requested!==false).length} songs ready offline</small></span><Icon name="arrow"/></Link></div>}
 <StickySearch label={likedOnly?"Liked songs search":"Library search"}><SearchField value={query} onChange={setQuery} label={likedOnly?"Find a liked song":"Find in your library"} placeholder="Find a title, artist or album"/></StickySearch><CollectionToolbar layout={layout} onLayout={value=>setPresentation({layout:value})} sort={sort} onSort={value=>setPresentation({sort:value})} direction={direction} onDirection={value=>setPresentation({direction:value})} count={tracks.length} firstSortLabel="Order added" dateSortLabel={likedOnly?"Date liked":"Date added"}/>
 <ResourceBody resource={active}>{!likedOnly&&<><SectionTitle title="Your playlists" note="Music for any part of your day." href="/import" action="Bring your music"/><div className={room.playlistShelf} data-layout={layout}>{playlists.map((playlist,i)=><CollectionGesture key={String(playlist.id)} kind="playlist" id={String(playlist.id)} title={String(playlist.name)}><Link className={room.playlist} href={"/playlist/"+encodeURIComponent(String(playlist.id))}><div className={room.playlistCover}><PlaylistArtwork dedicatedCover={playlist.hasCustomCover===true} coverUrl={playlist.coverUrl} coverUrls={playlist.coverUrls} title={String(playlist.name)}/><span className={room.playlistNumber}>{String(i+1).padStart(2,"0")}</span></div><div><h3>{String(playlist.name)}</h3><p>{Number(playlist.trackCount)||0} songs</p></div></Link></CollectionGesture>)}</div>{!playlists.length&&<div className={s.smallEmpty}>{match?"No collections match this search yet.":"Create a playlist to collect songs in your own order."}</div>}</>}
 <div className={room.songHeader}><h2>{likedOnly?"Your liked songs":"Songs you keep close"}</h2><span>{likedOnly?"A good place to come back to.":"Your soundtrack, your way."}</span></div>{match&&cursor&&failedCursor!==cursor&&!tracks.length?<LoadingRows/>:tracks.length?<TrackList tracks={tracks} layout={layout} dateLabel={likedOnly?"Liked":"Added"}/>:<Empty title={match?"No songs match your search.":likedOnly?"No liked songs yet.":"Your collection begins with a song."} description={match?"Try another name, or clear your search.":"Like a song to add it here. Liking a song does not download it."}/>}
 {match&&cursor&&failedCursor!==cursor&&<p role="status">Searching the rest of your collection...</p>}
 {cursor&&<Button secondary disabled={loadingMore===active.updatedAt} onClick={()=>void more()}>{loadingMore===active.updatedAt?"Loading more...":"Show more songs"}</Button>}</ResourceBody></div>;
}
