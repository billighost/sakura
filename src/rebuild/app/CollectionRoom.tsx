"use client";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { Artwork } from "./Elements";
import { Branch, Blossom } from "./Brand";
import s from "./collection-room.module.css";

export type RoomLayout = "list" | "cards" | "compact";
export type RoomSort = "kept" | "title" | "artist" | "duration";
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

export function CollectionToolbar({layout,onLayout,sort,onSort,count,children,firstSortLabel="Order added"}:{layout:RoomLayout;onLayout:(layout:RoomLayout)=>void;sort:RoomSort;onSort:(sort:RoomSort)=>void;count:number;children?:ReactNode;firstSortLabel?:string}) {
 return <div className={s.toolbar}><span className={s.songCount}>{count} {count===1?"song":"songs"}</span>{children}<label className={s.sort}><span className={s.srOnly}>Sort songs</span><select aria-label="Sort songs" value={sort} onChange={event=>onSort(event.target.value as RoomSort)}><option value="kept">{firstSortLabel}</option><option value="title">Song title</option><option value="artist">Artist name</option><option value="duration">Shortest first</option></select></label><div className={s.layoutSwitch} role="group" aria-label="Collection layout">{(["list","cards","compact"] as const).map(value=><button key={value} type="button" aria-label={value[0].toUpperCase()+value.slice(1)+" layout"} title={value[0].toUpperCase()+value.slice(1)+" layout"} aria-pressed={layout===value} onClick={()=>onLayout(value)}><LayoutGlyph layout={value}/></button>)}</div></div>;
}

export function sortRoomTracks<T extends {title:string;artists:string[];durationMs:number}>(tracks:T[],sort:RoomSort):T[]{
 if(sort==="kept")return tracks;
 const collator=new Intl.Collator(undefined,{sensitivity:"base",numeric:true});
 return [...tracks].sort((a,b)=>sort==="duration"?a.durationMs-b.durationMs:collator.compare(sort==="artist"?a.artists.join(" "):a.title,sort==="artist"?b.artists.join(" "):b.title)||collator.compare(a.title,b.title));
}
