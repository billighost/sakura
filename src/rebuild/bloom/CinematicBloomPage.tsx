"use client";
import {memo,useState} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {useMusic} from "../app/MusicContext";
import {useResource,invalidateResources} from "../app/resources";
import {requestJson,UserFacingError,responseIssue} from "../app/errors";
import {RecoveryNotice} from "../app/RecoveryNotice";
import {LoadingRows} from "../app/Elements";
import {Icon} from "../app/Icon";
import {BloomCover} from "./BloomCover";
import {useBoundary} from "./useBoundary";
import {useBloomAudio} from "./useBloomAudio";
import {bloomDate,type BloomItem,type BloomRecap,type BloomPeriod} from "./uiTypes";
import {bloomDesignForItem} from "./design";
import {BLOOM_WORLDS,bloomWorld,isBloomWorld} from "./worlds/registry";
import s from "./bloom.module.css";
import c from "./cinema.module.css";
const BloomStory=dynamic(()=>import("./BloomStory").then(module=>module.BloomStory),{loading:()=> <LoadingRows/>});
function itemCopy(item:BloomItem){if(item.status==="locked")return `Still growing. Opens ${bloomDate(item.publishAt,item.timeZone)}.`;if(item.status==="expired")return "This season has closed. Your next Bloom is on its way.";if(item.status==="empty")return "Your next story starts with a song.";return "The songs you carried. The voices that stayed. A little world made from your listening.";}
function usePalette(){const p=useMusic();return p.settings.theme==="dark"||p.settings.theme==="system"&&typeof matchMedia!=="undefined"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
export function BloomShelf(){
 const p=useMusic(),theme=usePalette();const resource=useResource<{items:BloomItem[]}>(p.account?.id||null,"/api/v2/bloom");const items=resource.data?.items||[];const available=items.find(item=>item.status==="available"),locked=items.find(item=>item.status==="locked");const ended=useBoundary(available?.expiresAt,resource.retry),released=useBoundary(locked?.publishAt,resource.retry);const item=(!ended?available:undefined)||(!released?locked:undefined);if(!item)return null;const design=bloomDesignForItem(item),world=bloomWorld(design);
 return <section className={s.shelf}><div className={s.shelfHeader}><h2>Your music has a story.</h2><Link href="/bloom">Your listening worlds ↗</Link></div><div className={c.shelfCard}><BloomCover design={design} theme={theme}/><div className={c.cardBody}><span>SAKURA BLOOM · {item.period.toUpperCase()}</span><h2>{world.name}</h2><p>{item.status==="available"?world.description:itemCopy(item)}</p><Link href={item.status==="available"?`/bloom/${item.id}`:"/bloom"}>{item.status==="available"?"Open my Bloom":"See what’s growing"}<Icon name="arrow" size={16}/></Link></div></div></section>;
}
export function BloomPage({id}:{id?:string}){const p=useMusic(),query=useSearchParams(),key=`${p.account?.id||"guest"}:${id||"index"}:${query.get("archive")}:${query.get("world")}`;return id?<BloomDetail key={key} id={id}/>:<BloomGallery key={key}/>;}
function BloomDetail({id}:{id:string}){
 const p=useMusic(),router=useRouter(),query=useSearchParams(),theme=usePalette(),archival=query.get("archive")==="1";
 const detail=useResource<BloomRecap>(p.account?.id||null,!archival?`/api/v2/bloom/${encodeURIComponent(id)}`:null),archive=useResource<{items:BloomRecap[]}>(p.account?.id||null,archival?`/api/v2/bloom/archive?year=${encodeURIComponent(id.slice(7))}`:null);
 const audio=useBloomAudio(),recap=archival?archive.data?.items.find(item=>item.id===id):detail.data,expired=useBoundary(!archival?recap?.expiresAt:undefined,()=>audio.close());
 function close(){audio.close();router.replace("/bloom");if(p.account)invalidateResources(p.account.id,"/api/v2/bloom");}
 async function reveal(chapterId:string){if(archival&&recap)return recap;return requestJson<BloomRecap>(`/api/v2/bloom/${encodeURIComponent(id!)}/reveal`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chapterId})},{context:"page",accountId:p.account?.id});}
 async function complete(){if(archival&&recap)return recap;return requestJson<BloomRecap>(`/api/v2/bloom/${encodeURIComponent(id!)}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"},{context:"page",accountId:p.account?.id});}
 const active=archival?archive:detail;const selected=query.get("world");return expired?<RecoveryNotice error={new UserFacingError(responseIssue(410,null))} retry={active.retry}/>:active.error?<RecoveryNotice error={active.error} retry={active.retry}/>:recap?<BloomStory key={recap.id} initial={recap} design={isBloomWorld(selected)?selected:bloomDesignForItem(recap)} theme={theme} reducedMotion={p.settings.reducedMotion} performance={p.settings.bloomPerformance} accountId={p.account?.id} onClose={close} onReveal={reveal} onComplete={complete} onPlay={audio.play} onStopSound={audio.stop} onPauseSound={audio.pause} onResumeSound={audio.resume} audioMessage={audio.message}/>:archival&&archive.data?<RecoveryNotice error={new UserFacingError(responseIssue(404,null))} retry={archive.retry}/>:<LoadingRows/>;
}
function BloomGallery(){
 const p=useMusic(),theme=usePalette(),[period,setPeriod]=useState<BloomPeriod>("weekly");
 const index=useResource<{items:BloomItem[];schedule:{timeZone:string}}>(p.account?.id||null,`/api/v2/bloom?period=${period}`),archive=useResource<{items:BloomRecap[]}>(p.account?.id||null,period==="yearly"?"/api/v2/bloom/archive":null);
 const changes=(index.data?.items||[]).filter(item=>item.status==="available"||item.status==="locked").map(item=>item.status==="locked"?item.publishAt:item.expiresAt).sort();useBoundary(changes[0],index.retry);
 const available=index.data?.items.find(item=>item.status==="available");
 return <div className={s.bloomPage}><span className={s.kicker}>SAKURA BLOOM · YOUR LISTENING WORLDS</span><h1>A little music.<br/>A whole <em>world.</em></h1><p>Enter an orchard, follow a painted river, open a lantern book. Your songs and favorite artists become the story in ten illustrated worlds.</p><div className={s.periodPicker} aria-label="Bloom period">{(["weekly","monthly","yearly"] as const).map(value=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value.charAt(0).toUpperCase()+value.slice(1)}</button>)}</div>{index.error&&<RecoveryNotice error={index.error} retry={index.retry}/>} {!index.data&&!index.error?<LoadingRows/>:<div className={s.recapGrid}>{(index.data?.items||[]).map(item=>{const design=bloomDesignForItem(item),world=bloomWorld(design);return <article className={`${c.coverCard} ${item.status!=="available"?c.disabledCard:""}`} key={item.id}><BloomCover design={design} theme={theme}/><div className={c.cardBody}><span>{item.period.toUpperCase()} BLOOM · {item.status==="available"?"READY TO UNFOLD":item.status==="locked"?"STILL GROWING":item.status==="empty"?"A FRESH BEGINNING":"SEASON CLOSED"}</span><h2>{world.name}</h2><p>{bloomDate(item.periodStart,item.timeZone)} — {bloomDate(new Date(new Date(item.periodEnd).getTime()-1).toISOString(),item.timeZone)}</p><p>{itemCopy(item)}</p>{item.status==="available"?<Link href={`/bloom/${item.id}`}>Open this Bloom <Icon name="arrow" size={16}/></Link>:item.status==="empty"?<Link href="/discover">Find your next soundtrack <Icon name="arrow" size={16}/></Link>:null}<small>{item.status==="available"?`Available until ${bloomDate(new Date(new Date(item.expiresAt).getTime()-1).toISOString(),item.timeZone)}`:item.status==="locked"?`Release: ${bloomDate(item.publishAt,item.timeZone)}`:"A new story is coming."}</small></div></article>;})}</div>}
  {period==="yearly"&&archive.error&&<RecoveryNotice error={archive.error} retry={archive.retry}/>} {period==="yearly"&&Boolean(archive.data?.items.length)&&<><h2 className={c.libraryTitle}>Your collected years</h2><div className={s.recapGrid}>{archive.data!.items.map(item=><article className={c.coverCard} key={item.id}><BloomCover design={bloomDesignForItem(item)} theme={theme}/><div className={c.cardBody}><h2>{item.id.slice(7)}</h2><p>{listeningHours(item.summary.audibleMs)} hours · {item.summary.recordingCount} songs</p><Link href={`/bloom/${item.id}?archive=1`}>Revisit this year <Icon name="arrow" size={16}/></Link></div></article>)}</div></>}
  <h2 className={c.libraryTitle}>Ten ways to remember.</h2><p>Each world has its own artwork, unfolding story and little surprises. {available?"Choose the setting for your listening story.":"Your next listening story can unfold in any of them."}</p><WorldLibrary availableId={available?.id} theme={theme}/>
  <div className={s.schedule}><div><b>Weekly.</b>Opens Monday. Available through Saturday.</div><div><b>Monthly.</b>Opens on the 1st. Closes seven days before the next month.</div><div><b>A year in music.</b>Opens January 1. Completed years stay in your archive.</div><div><b>Your listening clock.</b>{index.data?.schedule.timeZone||p.settings.timeZone||"Africa/Lagos"}</div></div>
 </div>;
}
function listeningHours(ms:number){return (ms/3600000).toFixed(1);}

const WorldLibrary=memo(function WorldLibrary({availableId,theme}:{availableId?:string;theme:"light"|"dark"}){return <div className={c.worldLibrary}>{BLOOM_WORLDS.map(world=><article key={world.id} className={c.coverCard}><BloomCover design={world.id} theme={theme}/><div className={c.cardBody}><span>{world.subtitle.toUpperCase()}</span><h2>{world.name}</h2><p>{world.description}</p>{availableId&&<Link href={`/bloom/${availableId}?world=${world.id}`}>Open in this world <Icon name="arrow" size={16}/></Link>}</div></article>)}</div>;});
