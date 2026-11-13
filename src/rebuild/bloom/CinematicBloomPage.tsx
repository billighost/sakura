"use client";
import {memo,useEffect,useState} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {useMusic} from "../app/MusicContext";
import {replaceMusicUrl} from "../app/offlineNavigation";
import {useResource,invalidateResources} from "../app/resources";
import {requestJson,UserFacingError,responseIssue} from "../app/errors";
import {RecoveryNotice} from "../app/RecoveryNotice";
import {LoadingRows} from "../app/Elements";
import {Icon} from "../app/Icon";
import {BloomCover} from "./BloomCover";
import {useBoundary} from "./useBoundary";
import {useBloomPalette} from "./useBloomPalette";
import {useBloomAudio} from "./useBloomAudio";
import {useBloomPreparation} from "./useBloomPreparation";
import {BloomReadyLink} from "./BloomReadyLink";
import {BloomArtworkContext} from "./ArtworkContext";
import {bloomPreparationScope} from "./preparationIdentity";
import {applyBloomDisclosureReply,type BloomDisclosureReceipt} from "./receipts";
import {bloomDate,type BloomItem,type BloomRecap,type BloomPeriod,type BloomPreparedStory} from "./uiTypes";
import {bloomDesignForItem} from "./design";
import {BLOOM_WORLDS,bloomWorld,isBloomWorld} from "./worlds/registry";
import s from "./bloom.module.css";
import c from "./cinema.module.css";
const BloomStory=dynamic(()=>import("./BloomStory").then(module=>module.BloomStory),{loading:()=> <LoadingRows/>});
function itemCopy(item:BloomItem){if(item.status==="locked")return `Still growing. Opens ${bloomDate(item.publishAt,item.timeZone)}.`;if(item.status==="expired")return "This season has closed. Your next Bloom is on its way.";if(item.status==="empty")return "No listening was recorded for this period.";return "Your standout songs, unexpected discoveries, and the listening moments that made this period yours.";}
function usePalette(){const p=useMusic();return useBloomPalette(p.settings.theme);}
export function BloomPage({id}:{id?:string}){const p=useMusic(),query=useSearchParams(),preview=process.env.NODE_ENV!=="production"?query.get("world"):null,key=`${p.account?.id||"guest"}:${id||"index"}:${query.get("archive")}:${preview}`;return id?<BloomDetail key={key} id={id}/>:<BloomGallery key={key}/>;}
function BloomDetail({id}:{id:string}){
 const p=useMusic(),router=useRouter(),query=useSearchParams(),theme=usePalette(),archival=query.get("archive")==="1";
 const [erased,setErased]=useState(false);
 const detail=useResource<BloomPreparedStory>(p.account?.id||null,!archival?`/api/v2/bloom/${encodeURIComponent(id)}?prepare=1`:null),archive=useResource<{items:BloomRecap[]}>(p.account?.id||null,archival?`/api/v2/bloom/archive?year=${encodeURIComponent(id.slice(7))}`:null);
 const recap=archival?archive.data?.items.find(item=>item.id===id):detail.data?.story,expired=useBoundary(!archival?recap?.expiresAt:undefined,()=>{});
 const preparation=useBloomPreparation(p.account?.id||null,recap?.chapterCount&&!expired&&!erased?id:null,recap,archival,true,"detail",detail.data);
 const audio=useBloomAudio(preparation.playback);
 useEffect(()=>{if(expired)audio.close();},[expired,audio]);
 useEffect(()=>{
  const revoke=(event:Event)=>{const data=(event as CustomEvent<{accountId?:string;scope?:string}>).detail;if(data?.accountId!==p.account?.id||data.scope==="feedback")return;setErased(true);audio.close();replaceMusicUrl(router,"/bloom");};
  window.addEventListener("sakura-personalization-cleared",revoke);window.addEventListener("sakura-listening-erased",revoke);
  return()=>{window.removeEventListener("sakura-personalization-cleared",revoke);window.removeEventListener("sakura-listening-erased",revoke);};
 },[p.account?.id,router,audio]);
 function close(){audio.close();replaceMusicUrl(router,"/bloom");if(p.account)invalidateResources(p.account.id,"/api/v2/bloom");}
 async function reveal(chapterId:string){if(archival&&recap)return recap;const prepared=await preparation.prepare();const reply=await requestJson<BloomRecap|BloomDisclosureReceipt>(`/api/v2/bloom/${encodeURIComponent(id!)}/reveal`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chapterId,scope:bloomPreparationScope(prepared.story)})},{context:"page",accountId:p.account?.id});return applyBloomDisclosureReply(prepared,reply);}
 async function prepare():Promise<BloomPreparedStory>{return preparation.prepare();}
 async function complete(){if(archival&&recap)return recap;const prepared=await preparation.prepare();const reply=await requestJson<BloomRecap|BloomDisclosureReceipt>(`/api/v2/bloom/${encodeURIComponent(id!)}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:bloomPreparationScope(prepared.story)})},{context:"page",accountId:p.account?.id});return applyBloomDisclosureReply(prepared,reply);}
 const active=archival?archive:detail,preview=process.env.NODE_ENV!=="production"?query.get("world"):null;return erased?<LoadingRows/>:expired?<RecoveryNotice error={new UserFacingError(responseIssue(410,null))} retry={active.retry}/>:active.error?<RecoveryNotice error={active.error} retry={active.retry}/>:recap?<BloomArtworkContext value={preparation.prepared?.artwork||{}}><BloomStory key={recap.id} initial={recap} design={isBloomWorld(preview)?preview:bloomDesignForItem(recap)} theme={theme} reducedMotion={p.settings.reducedMotion} performance={p.settings.bloomPerformance} accountId={p.account?.id} preparation={preparation} onClose={close} onPrepare={prepare} onReveal={reveal} onComplete={complete} onPlay={audio.play} onStopSound={audio.stop} onPauseSound={audio.pause} onResumeSound={audio.resume} audioMessage={audio.message}/></BloomArtworkContext>:archival&&archive.data?<RecoveryNotice error={new UserFacingError(responseIssue(404,null))} retry={archive.retry}/>:<LoadingRows/>;
}
function BloomGallery(){
const p=useMusic(),theme=usePalette(),query=useSearchParams(),requested=query.get("period"),[period,setPeriod]=useState<BloomPeriod>(requested==="monthly"||requested==="yearly"?requested:"weekly");
 const index=useResource<{items:BloomItem[];schedule:{timeZone:string}}>(p.account?.id||null,`/api/v2/bloom?period=${period}`),archive=useResource<{items:BloomRecap[]}>(p.account?.id||null,period==="yearly"?"/api/v2/bloom/archive":null);
 const changes=(index.data?.items||[]).filter(item=>item.status==="available"||item.status==="locked").map(item=>item.status==="locked"?item.publishAt:item.expiresAt).sort();useBoundary(changes[0],index.retry);
 return <div className={s.bloomPage}><span className={s.kicker}>SAKURA BLOOM · YOUR LISTENING WORLDS</span><h1>A little music.<br/>A whole <em>world.</em></h1><p>Enter an orchard, follow a painted river, open a lantern book. Your songs and most-listened artists become the story in ten illustrated worlds.</p><div className={s.periodPicker} aria-label="Bloom period">{(["weekly","monthly","yearly"] as const).map(value=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value.charAt(0).toUpperCase()+value.slice(1)}</button>)}</div>{index.error&&<RecoveryNotice error={index.error} retry={index.retry}/>} {!index.data&&!index.error?<LoadingRows/>:<div className={s.recapGrid}>{(index.data?.items||[]).map(item=>{const design=bloomDesignForItem(item),world=bloomWorld(design),upcoming=item.status==="locked";return <article className={`${c.coverCard} ${item.status!=="available"?c.disabledCard:""}`} key={item.id}><BloomCover design={design} theme={theme} experience={item.experience}/><div className={c.cardBody}><span>{item.period.toUpperCase()} BLOOM · {item.status==="available"?"READY TO UNFOLD":upcoming?"STILL GROWING":item.status==="empty"?"NO LISTENING RECORDED":"SEASON CLOSED"}</span><h2>{world.name}</h2><p>{bloomDate(item.periodStart,item.timeZone)} — {bloomDate(new Date(new Date(item.periodEnd).getTime()-1).toISOString(),item.timeZone)}</p><p>{itemCopy(item)}</p>{item.status==="available"?<BloomReadyLink id={item.id} href={`/bloom/${item.id}`}>Open this Bloom <Icon name="arrow" size={16}/></BloomReadyLink>:item.status==="empty"?<Link href="/discover">Explore music <Icon name="arrow" size={16}/></Link>:null}<small>{item.status==="available"?`Available until ${bloomDate(new Date(new Date(item.expiresAt).getTime()-1).toISOString(),item.timeZone)}`:upcoming?`Opens ${bloomDate(item.publishAt,item.timeZone)}`:"Check the dates for the next listening story."}</small></div></article>;})}</div>}
  {period==="yearly"&&archive.error&&<RecoveryNotice error={archive.error} retry={archive.retry}/>} {period==="yearly"&&Boolean(archive.data?.items.length)&&<><h2 className={c.libraryTitle}>Your collected years</h2><div className={s.recapGrid}>{archive.data!.items.map(item=><article className={c.coverCard} key={item.id}><BloomCover design={bloomDesignForItem(item)} theme={theme} listening={item.listening} experience={item.experience}/><div className={c.cardBody}><h2>{item.id.slice(7)}</h2><p>{listeningHours(item.summary.audibleMs)} hours · {item.summary.recordingCount} songs</p><Link href={`/bloom/${item.id}?archive=1`}>Revisit this year <Icon name="arrow" size={16}/></Link></div></article>)}</div></>}
  <h2 className={c.libraryTitle}>Ten ways to remember.</h2><p>Ten illustrated worlds. A fresh arrangement every time: new light, new words, and new ways to see your music. Once your Bloom opens, its story stays yours to revisit.</p><WorldLibrary theme={theme}/>
  <div className={s.schedule}><div><b>Weekly.</b>Opens Monday. Available through Saturday.</div><div><b>Monthly.</b>Opens on the 1st. Closes seven days before the next month.</div><div><b>A year in music.</b>Opens January 1. Completed years stay in your archive.</div><div><b>Your listening clock.</b>{index.data?.schedule.timeZone||p.settings.timeZone||"Africa/Lagos"}</div></div>
 </div>;
}
function listeningHours(ms:number){return (ms/3600000).toFixed(1);}

const WorldLibrary=memo(function WorldLibrary({theme}:{theme:"light"|"dark"}){return <div className={c.worldLibrary}>{BLOOM_WORLDS.map(world=><article key={world.id} className={c.coverCard}><BloomCover design={world.id} theme={theme}/><div className={c.cardBody}><span>{world.subtitle.toUpperCase()}</span><h2>{world.name}</h2><p>{world.description}</p></div></article>)}</div>;});
