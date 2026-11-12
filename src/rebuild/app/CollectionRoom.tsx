"use client";
import { useState, type ReactNode } from "react";
import { Artwork } from "./Elements";
import { Branch, Blossom } from "./Brand";
import type { RoomSort, RoomSortDirection } from "./trackSorting";
import type { RoomLayout } from "./collectionPresentation";
import { playlistArtworkSources, safeArtworkUrl } from "./playlistArtwork";
import { SelectPopover } from "./SelectPopover";
import s from "./collection-room.module.css";

export type { RoomLayout } from "./collectionPresentation";
export type { RoomSort, RoomSortDirection } from "./trackSorting";
export { sortRoomTracks } from "./trackSorting";
export { useRoomPresentation } from "./collectionPresentation";

export function CollectionHero({eyebrow,title,description,covers=[],label,children}:{eyebrow:string;title:string;description:string;covers?:{coverUrl:string|null;title:string}[];label:string;children?:ReactNode}) {
 return <header className={s.hero}><div className={s.heroCopy}><span className={s.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p><div className={s.heroActions}>{children}</div></div><div className={s.albumGarden} aria-hidden="true"><Branch className={s.gardenBranch}/><div className={s.record}><i/><span>sakura</span></div>{covers.slice(0,3).map((cover,i)=><div className={s.albumFrame} key={cover.title+i}><Artwork url={cover.coverUrl} title=""/><span>{String(i+1).padStart(2,"0")} / a little music</span></div>)}{!covers.length&&<div className={s.emptyAlbum}><Blossom/><span>a little room<br/>for your songs</span></div>}<span className={s.gardenLabel}>{label}</span></div></header>;
}

export function PlaylistArtwork({title,coverUrl,coverUrls,dedicatedCover=false,className=""}:{title:string;coverUrl?:unknown;coverUrls?:unknown;dedicatedCover?:boolean;className?:string}) {
 const [failed,setFailed]=useState<string[]>([]);
 const primary=safeArtworkUrl(coverUrl);
 const candidates=(Array.isArray(coverUrls)?coverUrls:[]).map(safeArtworkUrl).filter((url):url is string=>Boolean(url)&&!failed.includes(url!));
 const sources=playlistArtworkSources(primary&&!failed.includes(primary)?primary:null,candidates);
 const displayed=dedicatedCover&&primary&&!failed.includes(primary)?sources.slice(0,1):sources;

 return <div className={`${s.playlistArtwork} ${className}`} data-cover-count={displayed.length} role="img" aria-label={`${title} playlist artwork`}>
  {displayed.length?<div className={s.playlistArtworkGrid} aria-hidden="true">{displayed.map((source,index)=><Artwork key={source} url={source} title="" onError={()=>setFailed(previous=>previous.includes(source)?previous:[...previous,source])} className={s.playlistArtworkTile+" "+s["playlistArtworkTile"+(index+1)]}/>)}</div>:<div className={s.playlistArtworkEmpty}><Blossom/><span>{title.slice(0,1)||"S"}</span></div>}
  <Branch className={s.playlistArtworkBranch}/><span className={s.playlistArtworkSeal} aria-hidden="true">s</span>
 </div>;
}

function LayoutGlyph({layout}:{layout:RoomLayout}){return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">{layout==="cards"?<><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/></>:layout==="compact"?<><path d="M6 4h12M6 8h12M6 12h12M6 16h12"/><path d="M2 4h1M2 8h1M2 12h1M2 16h1"/></>:<><rect x="2" y="2" width="4" height="5" rx="1"/><rect x="2" y="12" width="4" height="5" rx="1"/><path d="M10 3h8M10 6h5M10 13h8M10 16h5"/></>}</svg>;}

export function CollectionToolbar({layout,onLayout,sort,onSort,count,children,firstSortLabel="Original order",direction="asc",onDirection,dateSortLabel,extraSortOptions=[]}:{layout:RoomLayout;onLayout:(layout:RoomLayout)=>void;sort:RoomSort;onSort:(sort:RoomSort)=>void;count:number;children?:ReactNode;firstSortLabel?:string;direction?:RoomSortDirection;onDirection?:(direction:RoomSortDirection)=>void;dateSortLabel?:string;extraSortOptions?:{value:RoomSort;label:string}[]}) {
 const reversed=direction==="desc",order=sort==="added"||sort==="recent"?(reversed?"Oldest first":"Newest first"):sort==="plays"?(reversed?"Fewest plays first":"Most plays first"):sort==="duration"?(reversed?"Longest first":"Shortest first"):sort==="kept"?(reversed?"Reversed order":"Original order"):(reversed?"Z to A":"A to Z");
 return <div className={s.toolbar} data-collection-toolbar><span className={s.songCount} data-song-count>{count} {count===1?"song":"songs"}</span>{children}<div className={s.sortControls} data-sort-controls><div className={s.sort}><SelectPopover<RoomSort> label="Sort songs" value={sort} onChange={onSort} options={[{value:"kept",label:firstSortLabel},...extraSortOptions,{value:"title",label:"Song title"},{value:"artist",label:"Artist name"},{value:"duration",label:reversed?"Longest first":"Shortest first"},...(dateSortLabel?[{value:"added" as const,label:dateSortLabel}]:[])]}/></div>{onDirection&&<button className={s.reverseSort} type="button" aria-label="Reverse sort order" aria-pressed={reversed} title={order+" · Reverse sort order"} onClick={()=>onDirection(reversed?"asc":"desc")}><svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={reversed?"M10 16V4M5 9l5-5 5 5":"M10 4v12M5 11l5 5 5-5"}/></svg><span className={s.srOnly}>{order}</span></button>}</div><div className={s.layoutSwitch} data-collection-layout role="group" aria-label="Collection layout">{(["list","cards","compact"] as const).map(value=><button key={value} type="button" aria-label={value[0].toUpperCase()+value.slice(1)+" layout"} title={value[0].toUpperCase()+value.slice(1)+" layout"} aria-pressed={layout===value} onClick={()=>onLayout(value)}><LayoutGlyph layout={value}/></button>)}</div></div>;
}
