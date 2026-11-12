"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMusic } from "./MusicContext";
import { useResource } from "./resources";
import { Button, Empty, IconButton, LoadingRows, LoadError, SearchField, TrackList } from "./Elements";
import { Branch, Blossom } from "./Brand";
import { Icon } from "./Icon";
import { CollectionToolbar, sortRoomTracks, useRoomPresentation, type RoomSort } from "./CollectionRoom";
import { collectionTrackMatches } from "./collectionSearch";
import { StickySearch } from "./StickySearch";
import { RecoveryNotice } from "./RecoveryNotice";
import { SmartQueueButton } from "./SmartQueueButton";
import { MixPlaylistDialog } from "./MixPlaylistDialog";
import { topSongs, topSongListeningTime } from "./topSongs";
import type { MusicTrack } from "./types";
import s from "./top-songs.module.css";

interface TopSongsProfile { profile:{username:string};insights?:{topSongs:Record<string,unknown>[]} }
const extraSortOptions:{value:RoomSort;label:string}[]=[{value:"plays",label:"Number of plays"},{value:"album",label:"Album name"},{value:"recent",label:"Recently played"}];

function TopSongsCover({count}:{count:number}) {
 return <div className={s.cover} role="img" aria-label="On repeat: botanical cover art with cherry blossoms and the grooves of a record">
  <span className={s.coverEdition} aria-hidden="true">SAKURA / YOUR LISTENING JOURNAL</span>
  <span className={s.coverTitle} aria-hidden="true">on<br/><em>repeat.</em></span>
  <svg className={s.grooves} viewBox="0 0 300 300" fill="none" aria-hidden="true">{[137,124,111,98,85,72,59,46,33].map((radius,i)=><circle key={radius} cx="150" cy="150" r={radius} stroke="currentColor" strokeWidth={i%3===0?1:.55} opacity={i%3===0?.42:.22}/>)}<circle cx="150" cy="150" r="6" fill="currentColor" opacity=".35"/></svg>
  <Branch className={s.coverBranch}/><Blossom className={s.coverBlossom}/>
  <span className={s.coverFoot} aria-hidden="true"><span>the songs you come back to.</span><b>{count?`01 — ${String(count).padStart(2,"0")}`:"SIDE A"}</b></span>
 </div>;
}

export function TopSongsMix() {
 const music=useMusic(),resource=useResource<TopSongsProfile>(music.account?.id||null,"/api/v2/profile");
 const [query,setQuery]=useState(""),[playlistMaker,setPlaylistMaker]=useState(false);
 const [presentation,setPresentation]=useRoomPresentation(music.account?.id,"mix:top-songs"),{layout,sort,direction}=presentation;
 const tracks=useMemo(()=>topSongs(resource.data?.insights?.topSongs||[]),[resource.data]);
 const shown=useMemo(()=>sortRoomTracks(tracks.filter(track=>collectionTrackMatches(track,query)),sort,direction),[tracks,query,sort,direction]);
 const byId=useMemo(()=>new Map(tracks.map(track=>[track.id,track])),[tracks]);
 const detail=useCallback((track:MusicTrack)=>{
  const song=byId.get(track.id);return song?<span className={s.songStats}><span>{topSongListeningTime(song.audibleMs)} listened</span><i aria-hidden="true">·</i><span>{song.playCount.toLocaleString()} {song.playCount===1?"play":"plays"}</span></span>:null;
 },[byId]);
 const listeningMs=tracks.reduce((sum,track)=>sum+track.audibleMs,0),durationMs=tracks.reduce((sum,track)=>sum+track.durationMs,0);
 const play=()=>{if(shown.length){music.setShuffle(false);music.play(shown[0],shown,{context:"mix",contextId:"top-songs"});}};
 const shuffle=()=>{if(shown.length){music.setShuffle(true);music.play(shown[Math.floor(Math.random()*shown.length)],shown,{context:"mix",contextId:"top-songs"});}};
 const active=Boolean(music.track&&shown.some(track=>music.effectiveId(track)===music.effectiveId(music.track!)));
 const playing=active&&["playing","buffering","resolving"].includes(music.status);

 return <div className={s.page} data-top-songs-mix>
  <Link className={s.back} href="/profile"><Icon name="arrow" size={15}/> Your listening journal</Link>
  <header className={s.hero}><TopSongsCover count={tracks.length}/><div className={s.heroCopy}>
   <span className={s.eyebrow}>YOUR PERSONAL MIX / ALL TIME</span><h1>Your top<br/><em>songs.</em></h1>
   <p>A little collection of the music you return to.<br/>Up to 50 songs, gathered from your listening.</p>
   <div className={s.byline}><Blossom/><span>Made for <b>{resource.data?.profile.username||music.account?.username||"you"}</b></span></div>
   <div className={s.summary}><span>{tracks.length} {tracks.length===1?"song":"songs"}</span><i>·</i><span>{Math.ceil(durationMs/60000)} min</span>{tracks.length>0&&<><i>·</i><span>{topSongListeningTime(listeningMs)} together</span></>}</div>
   <div className={s.controls}>
    <Button icon={playing?"pause":"play"} disabled={!shown.length} onClick={playing?music.togglePlay:play}>{playing?"Pause mix":"Play mix"}</Button>
    <IconButton icon="shuffle" label="Shuffle your top songs" active={music.shuffle&&active} disabled={!shown.length} onClick={shuffle}/>
    <IconButton icon="download" label="Download your top songs" disabled={!tracks.length} onClick={()=>tracks.forEach(music.requestDownload)}/>
    <IconButton icon="plus" label="Make a playlist from your top songs" disabled={!tracks.length} onClick={()=>setPlaylistMaker(true)}/>
    <SmartQueueButton scope="collection" tracks={tracks} iconOnly label="Find my soundtrack in your top songs" disabled={!tracks.length}/>
   </div>
  </div></header>
  {resource.loading&&!resource.data?<LoadingRows/>:resource.error&&!resource.data?<LoadError message={resource.error} retry={resource.retry}/>:<>
   {resource.error&&resource.data&&<RecoveryNotice compact error={resource.error} retry={resource.retry}/>}
   {tracks.length?<section aria-label="Your top songs">
    <div className={s.listPrelude}><span>YOUR SONGS, ON REPEAT</span><span>From your saved listening</span></div>
    <StickySearch label="Top songs search"><SearchField value={query} onChange={setQuery} label="Find in your top songs" placeholder="Find a title, artist or album"/></StickySearch>
    <CollectionToolbar layout={layout} onLayout={value=>setPresentation({layout:value})} sort={sort} onSort={value=>setPresentation({sort:value,direction:"asc"})} direction={direction} onDirection={value=>setPresentation({direction:value})} count={shown.length} firstSortLabel="Listening time" extraSortOptions={extraSortOptions}/>
    {shown.length?<TrackList tracks={shown} layout={layout} trackDetail={detail}/>:<div className={s.noMatches}><Blossom/><h2>No songs match that search.</h2><p>Try another title, artist or album.</p><Button secondary onClick={()=>setQuery("")}>Clear search</Button></div>}
    <p className={s.footnote}><Blossom/>Your top 50 are chosen by total listening time. Change the sort to see them your way.</p>
   </section>:<Empty title="Your repeat listens start here." description="As you listen in Sakura, your most heard songs will gather into a mix here." href="/home" action="Find something to play"/>}
  </>}
  {playlistMaker&&<MixPlaylistDialog mixId="top-songs" mixName="Your top songs" tracks={sortRoomTracks(tracks,sort,direction)} onClose={()=>setPlaylistMaker(false)}/>}
 </div>;
}
