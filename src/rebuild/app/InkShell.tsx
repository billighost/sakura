"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { pushMusicUrl } from "./offlineNavigation";
import { OfflineNavigationController } from "./NavigationUX";
import { useMusic } from "./MusicContext";
import { preloadMusicScreen } from "./MusicScreens";
import {preloadDownloadRemovalDialog} from "./DownloadRemovalModal";
import {waitForClientAssetCache} from "./cacheClientAssets";
import {ClientDiagnostics} from "./ClientDiagnostics";
import {finishClientJourney} from "./clientPerformance";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import { IconButton, PlayerBar } from "./Elements";
import { RecoveryNotice } from "./RecoveryNotice";
import { UserFacingError } from "./errors";
import { SakuraOpening } from "./Opening";
import {waitForFragment} from "./fragmentScroll";
import {useVisibleViewport} from "./useVisibleViewport";
import {PlaybackKeyboard} from "./PlaybackKeyboard";
import s from "./ink.module.css";
function ModalLoading(){return <div className={s.toast} role="status" aria-live="polite">Opening your listening room…</div>;}
// Reuse the exact import sites: Turbopack gives Next dynamic imports and raw
// imports different chunk groups, so a second import site cannot warm a modal.
const loadFullPlayer=()=>import("../player/FullPlayer").then(module=>module.FullPlayer);
const loadLyricsView=()=>import("../player/LyricsView").then(module=>module.LyricsView);
const loadQueueDialog=()=>import("../player/QueueDialog").then(module=>module.QueueDialog);
const FullPlayer=dynamic(loadFullPlayer,{ssr:false,loading:ModalLoading});
const LyricsView=dynamic(loadLyricsView,{ssr:false,loading:ModalLoading});
const QueueDialog=dynamic(loadQueueDialog,{ssr:false,loading:ModalLoading});
const ShareDialog=dynamic(()=>import("../player/ShareDialog").then(module=>module.ShareDialog),{ssr:false,loading:ModalLoading});
function HeaderTitle(){
 const pathname=usePathname(),[clientPathname,setClientPathname]=useState("");
 // The offline worker can serve /offline HTML at a different browser URL.
 // Keep the server and first client text identical, then show the actual route.
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)setClientPathname(pathname);});return()=>{active=false;};},[pathname]);
 const title=clientPathname.split("/")[1]||"music";
 return <span>{title==="library"&&clientPathname.includes("downloaded")?"Downloads":title.charAt(0).toUpperCase()+title.slice(1)}</span>;
}
const navigation=[{href:"/home",icon:"home",name:"Home"},{href:"/discover",icon:"discover",name:"Discover"},{href:"/search",icon:"search",name:"Search"},{href:"/library",icon:"library",name:"Your library"}] as const;
export function InkShell({children}:{children:ReactNode}){
 const viewportRef=useVisibleViewport();
 const p=useMusic();const pathname=usePathname();const router=useRouter();const main=useRef<HTMLDivElement>(null);const scrolls=useRef(new Map<string,number>());const [playerUnderlay,setPlayerUnderlay]=useState(false);const [sidebarMode,setSidebarMode]=useState<"auto"|"expanded"|"collapsed">("auto");const [shortSidebar,setShortSidebar]=useState(false);const sidebarCollapsed=sidebarMode==="collapsed"||sidebarMode==="auto"&&shortSidebar;
 const modalPath=useRef(pathname);
 useEffect(()=>{if(!p.booting)finishClientJourney("startup");},[p.booting]);
 useEffect(()=>{if(navigator.onLine&&!p.offline)void preloadMusicScreen(pathname).catch(()=>{});},[pathname,p.offline]);
 const closeModal=p.closeModal;
 useEffect(()=>{if(modalPath.current!==pathname){modalPath.current=pathname;setPlayerUnderlay(false);closeModal();}},[pathname,closeModal]);
 const closePlayer=()=>{setPlayerUnderlay(false);p.closeModal();};
 const openFromPlayer=(modal:"lyrics"|"queue"|"share")=>{setPlayerUnderlay(true);p.openModal(modal);};
 const closeOverlay=()=>{if(playerUnderlay){setPlayerUnderlay(false);p.openModal("player");}else p.closeModal();};
 const hasDeviceSongs=Object.values(p.downloads).some(entry=>entry.status==="ready"&&entry.requested!==false);
 useEffect(()=>{
  if(p.booting||!p.account?.id||p.offline||!hasDeviceSongs)return;
  const pending=[loadFullPlayer,loadLyricsView,loadQueueDialog,preloadDownloadRemovalDialog];
  let stopped=false,warming=false,timer:ReturnType<typeof setTimeout>|undefined,idle:number|undefined;
  const eligible=()=>navigator.onLine&&document.visibilityState==="visible"&&!!navigator.serviceWorker?.controller;
  const cancel=()=>{if(timer!==undefined)clearTimeout(timer);if(idle!==undefined)window.cancelIdleCallback(idle);timer=undefined;idle=undefined;};
  const schedule=()=>{
   cancel();if(stopped||warming||!pending.length||!eligible())return;
   timer=setTimeout(()=>{timer=undefined;const warm=async()=>{idle=undefined;if(stopped||warming||!eligible())return;warming=true;try{await pending[0]();await waitForClientAssetCache();if(stopped)return;pending.shift();}catch{return;}finally{warming=false;}schedule();};if(typeof window.requestIdleCallback==="function")idle=window.requestIdleCallback(()=>void warm(),{timeout:15000});else void warm();},3000);
  };
  // Saved songs need these chunks on the next offline launch. Load them one at
  // a time after startup so the service worker caches the actual requests.
  // Sharing and video export remain on demand.
  schedule();document.addEventListener("visibilitychange",schedule);window.addEventListener("online",schedule);navigator.serviceWorker?.addEventListener("controllerchange",schedule);
  return()=>{stopped=true;cancel();document.removeEventListener("visibilitychange",schedule);window.removeEventListener("online",schedule);navigator.serviceWorker?.removeEventListener("controllerchange",schedule);};
 },[p.booting,p.account?.id,p.offline,hasDeviceSongs]);
 useEffect(()=>{if(!p.booting&&!p.account&&!p.error&&pathname!=="/offline")router.replace("/login?next="+encodeURIComponent(pathname));},[p.booting,p.account,p.error,pathname,router]);
 useLayoutEffect(()=>{
  const container=main.current;if(!container)return;let stopFragment=()=>{},pendingFrame:number|null=null;
  const navigate=()=>{stopFragment();if(location.pathname!==pathname)return;if(location.hash){if(!p.booting)stopFragment=waitForFragment(container,pathname,location.hash);}else container.scrollTop=scrolls.current.get(pathname)||0;};
  const clicked=(event:MouseEvent)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[href]"):null;if(!anchor||anchor.hasAttribute("download")||anchor.target&&anchor.target!=="_self")return;const target=new URL(anchor.href,location.href);if(target.origin!==location.origin||target.pathname!==pathname||!target.hash)return;if(pendingFrame!==null)cancelAnimationFrame(pendingFrame);pendingFrame=requestAnimationFrame(()=>{pendingFrame=null;if(location.hash===target.hash)navigate();});};
  navigate();window.addEventListener("hashchange",navigate);window.addEventListener("popstate",navigate);document.addEventListener("click",clicked);
  return()=>{stopFragment();if(pendingFrame!==null)cancelAnimationFrame(pendingFrame);window.removeEventListener("hashchange",navigate);window.removeEventListener("popstate",navigate);document.removeEventListener("click",clicked);};
 },[pathname,p.booting]);
 useEffect(()=>{const media=matchMedia("(min-width: 651px) and (max-height: 760px)");const sync=()=>setShortSidebar(media.matches);const frame=requestAnimationFrame(()=>{try{const saved=localStorage.getItem("sakura-sidebar-mode");if(saved==="expanded"||saved==="collapsed")setSidebarMode(saved);}catch{}sync();});media.addEventListener("change",sync);return()=>{cancelAnimationFrame(frame);media.removeEventListener("change",sync);};},[]);
 useEffect(()=>{if(p.booting&&!p.account)return;const choice=p.settings.theme;const dark=choice==="dark"||choice==="system"&&matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.inkTheme=dark?"dark":"light";try{localStorage.setItem("sakura-v2-theme",choice);}catch{}const media=matchMedia("(prefers-color-scheme: dark)");const listener=()=>{if(choice==="system")document.documentElement.dataset.inkTheme=media.matches?"dark":"light";};media.addEventListener("change",listener);return()=>media.removeEventListener("change",listener);},[p.settings.theme,p.booting,p.account]);
 return <div ref={viewportRef} className={s.app} data-reduced-motion={p.settings.reducedMotion||undefined}><ClientDiagnostics/><OfflineNavigationController/><a className={s.skipLink} href="#music-main" onClick={e=>{e.preventDefault();main.current?.focus();}}>Skip to music</a><SakuraOpening autoPlay={!p.booting&&p.settings.openingAnimation!==0} reduced={p.settings.reducedMotion}/><div className={s.workspace}><aside className={`${s.sidebar} ${sidebarCollapsed?s.sidebarCollapsed:""}`} data-collapsed={sidebarCollapsed||undefined}><div className={s.sidebarHead}><Link href="/home" className={s.brand} aria-label="Sakura home"><Blossom/><span className={s.sidebarText}>sakura<small>your little music world</small></span></Link><button type="button" className={s.sidebarToggle} aria-label={sidebarCollapsed?"Expand sidebar":"Collapse sidebar"} aria-expanded={!sidebarCollapsed} aria-controls="sakura-sidebar-body" onClick={()=>{const next=sidebarCollapsed?"expanded":"collapsed";setSidebarMode(next);try{localStorage.setItem("sakura-sidebar-mode",next);}catch{}}}><Icon name="chevron" size={13}/></button></div><div id="sakura-sidebar-body" className={s.sidebarBody}><nav aria-label="Main navigation" className={s.desktopNav}>{navigation.map(item=><Link key={item.href} href={item.href} aria-label={item.name} title={sidebarCollapsed?item.name:undefined} aria-current={pathname===item.href?"page":undefined}><Icon name={item.icon}/><span className={s.sidebarText}>{item.name}</span>{pathname===item.href&&<i/>}</Link>)}</nav><section className={s.sidebarLibrary}><span className={`${s.eyebrow} ${s.sidebarText}`}>THE THINGS YOU KEEP</span><Link href="/liked" aria-label="Liked songs" title={sidebarCollapsed?"Liked songs":undefined}><Icon name="heart" size={18}/><span className={s.sidebarText}>Liked songs</span></Link><Link href="/library/downloaded" aria-label="Downloads" title={sidebarCollapsed?"Downloads":undefined}><Icon name="download" size={18}/><span className={s.sidebarText}>Downloads</span><span className={s.sidebarCount}>{Object.values(p.downloads).filter(d=>d.status==="ready"&&d.requested!==false).length}</span></Link><Link href="/bloom" aria-label="Sakura Bloom" title={sidebarCollapsed?"Sakura Bloom":undefined}><Blossom/><span className={s.sidebarText}>Sakura Bloom</span></Link><Link href="/import" aria-label="Bring your music" title={sidebarCollapsed?"Bring your music":undefined}><Icon name="plus" size={18}/><span className={s.sidebarText}>Bring your music</span></Link></section><div className={s.sidebarNote}><Blossom/><span>A quiet place.<br/>Room for your music.</span></div><Link href="/profile" className={s.sidebarProfile} aria-label="Your listening profile" title={sidebarCollapsed?"Your listening profile":undefined}><span className={s.avatar}><Blossom/></span><span className={s.sidebarText}>{p.account?.username||"Your listening journal"}<small>Your music, your moments</small></span><Icon className={s.sidebarChevron} name="chevron" size={15}/></Link></div></aside><div className={s.mainArea}><header className={s.appHeader}><div><IconButton icon="back" label="Go back" onClick={()=>history.length>1?router.back():pushMusicUrl(router,"/home")}/><HeaderTitle/></div><div><IconButton icon="search" label="Find music" shortcut="Ctrl / Cmd + K" onClick={()=>pushMusicUrl(router,"/search")}/><PlaybackKeyboard/><IconButton icon={p.settings.theme==="dark"?"sun":"moon"} label="Change appearance" onClick={()=>void p.updateSettings({theme:document.documentElement.dataset.inkTheme==="dark"?"light":"dark"}).catch(e=>p.reportError(e,"save",p.retryConnection))}/><Link className={s.avatar} href="/profile" aria-label="Your listening profile"><Blossom/></Link></div></header>{p.offline&&<div className={s.offlineBanner}><Icon name="offline" size={16}/><span>You&apos;re offline. Saved pages and downloaded songs are available.</span><Link href="/library/downloaded">Open downloads</Link></div>}<div ref={main} id="music-main" tabIndex={-1} className={s.stage} onScroll={e=>scrolls.current.set(pathname,e.currentTarget.scrollTop)}><main className={s.pageContent}>{p.booting?<div className={s.bootFrame}><Blossom/><span>Loading your music…</span></div>:p.account?children:p.error?<RecoveryNotice error={p.error} context="account" retry={p.retryConnection}/>:<div className={s.empty}><Blossom/><h1>Your music has a place here.</h1><p>{p.error||"Sign in to open your library."}</p><Link className={s.primaryButton} href="/login">Sign in</Link></div>}</main><footer className={s.pageFooter}><Blossom/><span>Made for the music. Made for you.</span><Link href="/about">About Sakura</Link></footer></div></div></div><PlayerBar/><nav className={s.mobileNav} aria-label="Mobile navigation">{navigation.map(item=><Link key={item.href} href={item.href} aria-current={pathname===item.href?"page":undefined}><Icon name={item.icon}/><span>{item.name}</span></Link>)}</nav>{(p.modal==="player"||playerUnderlay)&&<FullPlayer onClose={closePlayer} onOpenLyrics={()=>openFromPlayer("lyrics")} onOpenQueue={()=>openFromPlayer("queue")} onOpenShare={()=>openFromPlayer("share")}/>} {p.modal==="lyrics"&&<LyricsView onClose={closeOverlay}/>} {p.modal==="queue"&&<QueueDialog onClose={closeOverlay}/>} {p.modal==="share"&&<ShareDialog track={p.shareTrack||undefined} onClose={closeOverlay}/>} {p.notice&&<div className={s.recoveryToast}><RecoveryNotice compact error={new UserFacingError(p.notice.issue)} retry={p.notice.retry} onDismiss={p.dismissNotice}/></div>}{p.toast&&<div className={s.toast} role="status"><Icon name="check" size={17}/>{p.toast}</div>}</div>;
}
