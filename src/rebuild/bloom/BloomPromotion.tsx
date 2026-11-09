"use client";
import {useCallback,useMemo,useState,useSyncExternalStore} from "react";
import Link from "next/link";
import {useMusic} from "../app/MusicContext";
import {useResource} from "../app/resources";
import {Icon} from "../app/Icon";
import {Blossom} from "../app/Brand";
import type {BloomShelfItem} from "./uiTypes";
import {bloomDesignForItem} from "./design";
import {BloomCover} from "./BloomCover";
import {useBloomPalette} from "./useBloomPalette";
import {useBoundary} from "./useBoundary";
import {bloomPromotions,nextBloomPromotionBoundary} from "./promotions";
import s from "./shelf.module.css";

const dismissalEvent="sakura-bloom-promotion-dismissed";
const noItems:BloomShelfItem[]=[];
function readDismissals(key:string){try{return localStorage.getItem(key)||"[]";}catch{return "[]";}}
function dismissalList(raw:string):string[]{try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((key):key is string=>typeof key==="string"):[];}catch{return [];}}

/** This notice shares the shelf's cached request; it never starts a story or
 * discloses listening statistics before the listener chooses to open it. */
export function BloomPromotion(){
 const music=useMusic(),accountId=music.account?.id||null;
 const resource=useResource<{items:BloomShelfItem[]}>(accountId,"/api/v2/bloom/shelf"),items=resource.data?.items||noItems;
 const [calendarNow,refreshCalendar]=useState(()=>Date.now());
 const currentTime=Math.max(calendarNow,resource.updatedAt);
 const boundary=useMemo(()=>nextBloomPromotionBoundary(items,new Date(currentTime)),[items,currentTime]);
 useBoundary(boundary,()=>{refreshCalendar(Date.now());resource.retry();});
 const promotion=useMemo(()=>bloomPromotions(items,new Date(currentTime))[0],[items,currentTime]),theme=useBloomPalette(music.settings.theme);
 const storageKey=`sakura-bloom-promotions:${accountId||"guest"}`;
 const [dismissedKey,setDismissedKey]=useState("");
 const subscribe=useCallback((listener:()=>void)=>{
  const changed=(event:Event)=>{if(event instanceof StorageEvent&&event.key!==storageKey)return;listener();};
  window.addEventListener("storage",changed);window.addEventListener(dismissalEvent,changed);
  return()=>{window.removeEventListener("storage",changed);window.removeEventListener(dismissalEvent,changed);};
 },[storageKey]);
 const snapshot=useCallback(()=>readDismissals(storageKey),[storageKey]);
 const stored=useSyncExternalStore(subscribe,snapshot,()=>"[]");
 if(!accountId||!promotion||dismissedKey===`${accountId}:${promotion.key}`||dismissalList(stored).includes(promotion.key))return null;
 function dismiss(){
  if(!promotion)return;
  setDismissedKey(`${accountId}:${promotion.key}`);
  const list=[...dismissalList(readDismissals(storageKey)).filter(key=>key!==promotion.key),promotion.key].slice(-60);
  try{localStorage.setItem(storageKey,JSON.stringify(list));}catch{}
  window.dispatchEvent(new Event(dismissalEvent));
 }
 const upcoming=promotion.phase==="anticipation";
 return <section className={s.promotion} aria-label={`${promotion.item.period} Sakura Bloom ${upcoming?"opening soon":"ready to open"}`} data-bloom-promotion={promotion.phase} data-bloom-period={promotion.item.period} data-reduced-motion={music.settings.reducedMotion}>
  <div className={s.promotionCopy}>
   <div className={s.promotionEyebrow}><Blossom/><span>{promotion.eyebrow}</span><span className={s.promotionTiming}>{promotion.timing}</span></div>
   <h2>{promotion.title}</h2><p>{promotion.detail}</p>
   <Link className={s.promotionAction} href={promotion.href}>{promotion.action}<Icon name="arrow" size={17}/></Link>
   <span className={s.promotionNote}>{upcoming?"A new world. A story only your music could tell.":"Your music becomes the world. You get the reveal."}</span>
  </div>
  <div className={s.promotionArt} aria-hidden="true"><span className={s.promotionOrbit}/><BloomCover design={bloomDesignForItem(promotion.item)} theme={theme} experience={promotion.item.experience} sizes="(max-width:750px) 170px, 360px"/><Blossom className={s.promotionPetal}/><span className={s.promotionSeal}>{upcoming?"almost\nyour moment":"made from\nyour music"}</span></div>
  <button type="button" className={s.promotionDismiss} aria-label="Dismiss this Bloom reminder" onClick={dismiss}><Icon name="close" size={17}/></button>
 </section>;
}
