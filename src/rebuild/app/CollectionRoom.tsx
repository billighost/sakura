"use client";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { Artwork } from "./Elements";
import { Branch, Blossom } from "./Brand";
import type { RoomSort, RoomSortDirection } from "./trackSorting";
import s from "./collection-room.module.css";

export type RoomLayout = "list" | "cards" | "compact";
export type { RoomSort, RoomSortDirection } from "./trackSorting";
export { sortRoomTracks } from "./trackSorting";
const temporaryLayouts=new Map<string,RoomLayout>();

/** Keep presentation on this device, separately for each account and collection. */
export function useRoomLayout(accountId:string|undefined,room:string) {
 const storageKey="sakura-collection-layout:"+(accountId||"guest")+":"+room;
 const subscribe=useCallback((notify:()=>void)=>{const changed=(event:Event)=>{if(event instanceof StorageEvent&&(event.key===null||event.key===storageKey)||event instanceof CustomEvent&&event.detail===storageKey)notify();};window.addEventListener("storage",changed);window.addEventListener("sakura-collection-layout-changed",changed);return()=>{window.removeEventListener("storage",changed);window.removeEventListener("sakura-collection-layout-changed",changed);};},[storageKey]);
 const snapshot=useCallback(()=>{try{const saved=localStorage.getItem(storageKey);return saved==="cards"||saved==="compact"?saved:"list";}catch{return temporaryLayouts.get(storageKey)||"list";}},[storageKey]);
 const layout=useSyncExternalStore(subscribe,snapshot,()=>"list" as RoomLayout);
 function changeLayout(value:RoomLayout){temporaryLayouts.set(storageKey,value);try{localStorage.setItem(storageKey,value);}catch{}window.dispatchEvent(new CustomEvent("sakura-collection-layout-changed",{detail:storageKey}));}
 return [layout,changeLayout] as const;
}

export function CollectionHero({eyebrow,title,description,covers=[],label,children}:{eyebrow:string;title:string;description:string;covers?:{coverUrl:string|null;title:string}[];label:string;children?:ReactNode}) {
 return <header className={s.hero}><div className={s.heroCopy}><span className={s.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p><div className={s.heroActions}>{children}</div></div><div className={s.albumGarden} aria-hidden="true"><Branch className={s.gardenBranch}/><div className={s.record}><i/><span>sakura</span></div>{covers.slice(0,3).map((cover,i)=><div className={s.albumFrame} key={cover.title+i}><Artwork url={cover.coverUrl} title=""/><span>{String(i+1).padStart(2,"0")} / a little music</span></div>)}{!covers.length&&<div className={s.emptyAlbum}><Blossom/><span>a little room<br/>for your songs</span></div>}<span className={s.gardenLabel}>{label}</span></div></header>;
}

function LayoutGlyph({layout}:{layout:RoomLayout}){return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">{layout==="cards"?<><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/></>:layout==="compact"?<><path d="M6 4h12M6 8h12M6 12h12M6 16h12"/><path d="M2 4h1M2 8h1M2 12h1M2 16h1"/></>:<><rect x="2" y="2" width="4" height="5" rx="1"/><rect x="2" y="12" width="4" height="5" rx="1"/><path d="M10 3h8M10 6h5M10 13h8M10 16h5"/></>}</svg>;}

export function CollectionToolbar({layout,onLayout,sort,onSort,count,children,firstSortLabel="Original order",direction="asc",onDirection,dateSortLabel}:{layout:RoomLayout;onLayout:(layout:RoomLayout)=>void;sort:RoomSort;onSort:(sort:RoomSort)=>void;count:number;children?:ReactNode;firstSortLabel?:string;direction?:RoomSortDirection;onDirection?:(direction:RoomSortDirection)=>void;dateSortLabel?:string}) {
 const reversed=direction==="desc",order=sort==="added"?(reversed?"Oldest first":"Newest first"):sort==="duration"?(reversed?"Longest first":"Shortest first"):sort==="kept"?(reversed?"Reversed order":"Original order"):(reversed?"Z to A":"A to Z");
 return <div className={s.toolbar}><span className={s.songCount}>{count} {count===1?"song":"songs"}</span>{children}<div className={s.sortControls}><label className={s.sort}><span className={s.srOnly}>Sort songs</span><select aria-label="Sort songs" value={sort} onChange={event=>onSort(event.target.value as RoomSort)}><option value="kept">{firstSortLabel}</option><option value="title">Song title</option><option value="artist">Artist name</option><option value="duration">{reversed?"Longest first":"Shortest first"}</option>{dateSortLabel&&<option value="added">{dateSortLabel}</option>}</select></label>{onDirection&&<button className={s.reverseSort} type="button" aria-label="Reverse sort order" aria-pressed={reversed} title={order+" · Reverse sort order"} onClick={()=>onDirection(reversed?"asc":"desc")}><svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={reversed?"M10 16V4M5 9l5-5 5 5":"M10 4v12M5 11l5 5 5-5"}/></svg><span className={s.srOnly}>{order}</span></button>}</div><div className={s.layoutSwitch} role="group" aria-label="Collection layout">{(["list","cards","compact"] as const).map(value=><button key={value} type="button" aria-label={value[0].toUpperCase()+value.slice(1)+" layout"} title={value[0].toUpperCase()+value.slice(1)+" layout"} aria-pressed={layout===value} onClick={()=>onLayout(value)}><LayoutGlyph layout={value}/></button>)}</div></div>;
}
