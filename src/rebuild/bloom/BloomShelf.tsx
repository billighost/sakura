"use client";
import Link from "next/link";
import {useMusic} from "../app/MusicContext";
import {useResource} from "../app/resources";
import {RecoveryNotice} from "../app/RecoveryNotice";
import {Icon} from "../app/Icon";
import {BloomCover} from "./BloomCover";
import {bloomDate,type BloomShelfItem} from "./uiTypes";
import {bloomDesignForItem} from "./design";
import {bloomWorld} from "./worlds/registry";
import {useBoundary} from "./useBoundary";
import {useBloomPalette} from "./useBloomPalette";
import {bloomOpeningDate,bloomShelfItems} from "./shelf";
import {bloomPromotions} from "./promotions";
import s from "./shelf.module.css";

export function BloomShelf(){
 const music=useMusic(),resource=useResource<{items:BloomShelfItem[]}>(music.account?.id||null,"/api/v2/bloom/shelf");
 const all=resource.data?.items||[];
 const boundary=all.filter(item=>item.status==="available"||item.status==="empty"||item.status==="locked")
  .map(item=>item.status==="locked"?item.publishAt:item.expiresAt).sort()[0];
 useBoundary(boundary,resource.retry);
 const items=bloomShelfItems(all);
 const theme=useBloomPalette(music.settings.theme);
 if(!music.account)return null;
 return <section className={s.shelf} aria-label="Sakura Bloom" data-bloom-shelf>
  <div className={s.heading}><div><span>SAKURA BLOOM</span><h2>Your listening, illustrated.</h2></div><Link href="/bloom">All listening stories<Icon name="arrow" size={15}/></Link></div>
  {resource.error&&<RecoveryNotice error={resource.error} retry={resource.retry}/>}
  {resource.loading&&!resource.data?<div className={s.loading} role="status">Loading your Blooms…</div>:items.length?<div className={s.cards} data-count={items.length}>{items.map(item=>{
   const design=bloomDesignForItem(item),world=bloomWorld(design),ready=item.status==="available",upcoming=item.status==="locked",promotion=bloomPromotions([item])[0];
   const end=new Date(Date.parse(item.periodEnd)-1).toISOString();
   return <article key={item.id} className={s.card} data-bloom-status={item.status}>
    <BloomCover design={design} theme={theme} listening={item.completed?item.listening:undefined} experience={item.experience} sizes="(max-width:750px) calc(100vw - 48px), 480px"/>
    <div className={s.body}><span className={s.status}>{item.period.toUpperCase()} · {ready?item.completed?"YOUR COLLECTED STORY":promotion?.timing.toUpperCase()||"READY TO OPEN":upcoming?promotion?.timing.toUpperCase()||"UP NEXT":"NO LISTENING RECORDED"}</span>
     <h3>{world.name}</h3><p className={s.period}>{bloomDate(item.periodStart,item.timeZone)} — {bloomDate(end,item.timeZone)}</p>
     <p>{promotion?promotion.detail:ready?world.description:upcoming?"Your next listening world is growing. Music saved during these dates becomes the story.":"No listening was saved for this period. Explore a song you love to start your next Bloom."}</p>
     <p className={s.timing}>{upcoming?<>Opens <time dateTime={item.publishAt}>{bloomOpeningDate(item.publishAt,item.timeZone)}</time></>:ready?<>Available through <time dateTime={item.expiresAt}>{bloomDate(new Date(Date.parse(item.expiresAt)-1).toISOString(),item.timeZone)}</time></>:null}</p>
     <Link className={ready?s.primary:s.link} href={ready?`/bloom/${item.id}`:upcoming?`/bloom?period=${item.period}`:"/discover"}>{ready?item.completed?"Revisit my Bloom":"Check your Sakura Bloom":upcoming?promotion?"See what's coming":"View Bloom schedule":"Explore music"}<Icon name="arrow" size={16}/></Link>
    </div>
   </article>;
  })}</div>:!resource.error?<p className={s.loading}>Your next listening story will appear here. <Link href="/bloom">View Bloom schedule</Link></p>:null}
 </section>;
}
